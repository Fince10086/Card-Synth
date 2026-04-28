import { clamp, deepClone } from "../../utils/helpers.js";
import * as Tone from "tone";

/**
 * 创建 Voices 输入模块运行时
 * 负责音符触发、voice 分配、管理 activeNotes 和 voice stealing
 */
function createVoicesRuntime(module, getGlobalPolyVoice = () => 8) {
  let moduleState = deepClone(module);

  const getPolyVoice = () => {
    if (moduleState.options?.mono) {
      return 1;
    }
    return clamp(getGlobalPolyVoice(), 2, 8);
  };

  // Voice 状态数组（动态调整大小）
  let voiceStates = Array.from({ length: getPolyVoice() }, () => ({
    note: null,
    startTime: 0,
    pendingRelease: false,
  }));

  // 活跃音符映射：note -> voiceIndex
  const activeNotes = new Map();

  const findAvailableVoice = () => {
    const polyVoice = getPolyVoice();

    for (let i = 0; i < polyVoice; i++) {
      if (!voiceStates[i].note && !voiceStates[i].pendingRelease) {
        return i;
      }
    }

    let oldestIndex = -1;
    let oldestTime = Infinity;
    for (let i = 0; i < polyVoice; i++) {
      if (voiceStates[i].note && voiceStates[i].startTime < oldestTime) {
        oldestTime = voiceStates[i].startTime;
        oldestIndex = i;
      }
    }

    return oldestIndex;
  };

  const releaseVoice = (voiceIndex) => {
    const state = voiceStates[voiceIndex];
    if (state.note) {
      activeNotes.delete(state.note);
    }
    state.note = null;
    state.startTime = 0;
    state.pendingRelease = false;
  };

  const runtime = {
    type: module.type,
    category: "input",
    isVoiceManager: true,
    moduleState,

    triggerAttack: (note, velocity) => {
      if (activeNotes.has(note)) {
        const voiceIndex = activeNotes.get(note);
        return { voiceIndex, isRetrigger: true, stolenNote: null };
      }

      const voiceIndex = findAvailableVoice();
      if (voiceIndex < 0) {
        return null;
      }

      let stolenNote = null;
      if (voiceStates[voiceIndex].note) {
        stolenNote = voiceStates[voiceIndex].note;
        activeNotes.delete(voiceStates[voiceIndex].note);
      }

      voiceStates[voiceIndex].note = note;
      voiceStates[voiceIndex].startTime = Tone.now();
      voiceStates[voiceIndex].pendingRelease = false;
      activeNotes.set(note, voiceIndex);

      return { voiceIndex, isRetrigger: false, stolenNote };
    },

    triggerRelease: (note, pedal) => {
      const voiceIndex = activeNotes.get(note);
      if (voiceIndex === undefined) {
        return null;
      }

      if (pedal) {
        voiceStates[voiceIndex].pendingRelease = true;
        return { voiceIndex, released: false };
      }

      releaseVoice(voiceIndex);
      return { voiceIndex, released: true };
    },

    releaseAll: () => {
      const released = [];
      for (let i = 0; i < getPolyVoice(); i++) {
        if (voiceStates[i].note) {
          const note = voiceStates[i].note;
          releaseVoice(i);
          released.push({ note, voiceIndex: i });
        }
      }
      return released;
    },

    releaseAllPending: () => {
      const released = [];
      for (let i = 0; i < getPolyVoice(); i++) {
        if (voiceStates[i].pendingRelease) {
          const note = voiceStates[i].note;
          releaseVoice(i);
          if (note) {
            released.push({ note, voiceIndex: i });
          }
        }
      }
      return released;
    },

    getActiveNotes: () => {
      const result = [];
      activeNotes.forEach((voiceIndex, note) => {
        result.push({ note, voiceIndex });
      });
      return result;
    },

    apply: (nextModule) => {
      const prevPolyVoice = voiceStates.length;
      moduleState = deepClone(nextModule);
      runtime.moduleState = moduleState;

      // PolyVoice 变化时调整数组大小
      const newPolyVoice = getPolyVoice();
      if (newPolyVoice !== prevPolyVoice) {
        if (newPolyVoice > prevPolyVoice) {
          for (let i = prevPolyVoice; i < newPolyVoice; i++) {
            voiceStates.push({
              note: null,
              startTime: 0,
              pendingRelease: false,
            });
          }
        } else {
          const released = [];
          for (let i = newPolyVoice; i < prevPolyVoice; i++) {
            if (voiceStates[i].note) {
              const note = voiceStates[i].note;
              releaseVoice(i);
              if (note) {
                released.push({ note, voiceIndex: i });
              }
            }
          }
          voiceStates.length = newPolyVoice;
          if (released.length > 0) {
            runtime.pendingReleasedNotes = (runtime.pendingReleasedNotes || []).concat(released);
          }
        }
      }
    },

    dispose: () => {
      activeNotes.clear();
    },
  };

  return runtime;
}

/**
 * 创建 Pitch 输入模块运行时
 * 负责音高变换（transpose/octave/frequency）和控制范围计算
 */
function createPitchRuntime(module, chainModules, inputIndex) {
  let moduleState = deepClone(module);

  /**
   * 确定此 Pitch 的控制范围（到下一个 Pitch 之前）
   */
  const getControlledModules = () => {
    const sources = [];
    const envelopes = [];

    for (let i = inputIndex + 1; i < chainModules.length; i++) {
      const m = chainModules[i];
      if (!m.enabled) continue;
      if (m.type === "Pitch") break;

      if (m.category === "source" || m.type === "Envelope") {
        sources.push(m.id);
      }
      if (m.type === "Envelope") {
        envelopes.push({ id: m.id, type: m.type });
      }
    }

    return { sources, envelopes };
  };

  const applyMidiTransforms = (note) => {
    const transpose = clamp(Number(moduleState.options?.transpose) || 0, -12, 12);
    const octave = clamp(Number(moduleState.options?.octave) || 0, -4, 4);

    if (transpose === 0 && octave === 0) {
      return note;
    }

    let midiNum = Tone.Frequency(note).toMidi();
    midiNum += transpose + (octave * 12);
    return Tone.Frequency(midiNum, "midi").toNote();
  };

  const getFrequencyValue = () => {
    return clamp(Number(moduleState.options?.frequency) || 440, 0.1, 20000);
  };

  const runtime = {
    type: module.type,
    category: "input",
    moduleState,
    getControlledModules,

    triggerAttack: (note, velocity, voiceIndex) => {
      const noteData = moduleState.options?.mode === "midi"
        ? { type: "midi", note: applyMidiTransforms(note), originalNote: note, velocity }
        : { type: "frequency", frequency: getFrequencyValue(), originalNote: note, velocity };

      const controlled = getControlledModules();

      return {
        voiceIndex,
        noteData,
        controlledSources: controlled.sources,
        controlledEnvelopes: controlled.envelopes,
      };
    },

    triggerRelease: (note) => {
      // Pitch 不再管理 voice，直接返回 true
      return { released: true };
    },

    releaseAll: () => [],
    releaseAllPending: () => [],

    apply: (nextModule) => {
      moduleState = deepClone(nextModule);
      runtime.moduleState = moduleState;
    },

    dispose: () => {},
  };

  return runtime;
}

/**
 * 创建 Pedal 输入模块运行时
 * 维护 pedal 状态，在 AudioEngine 中统一处理延音逻辑
 */
function createPedalRuntime(module) {
  let moduleState = deepClone(module);

  const runtime = {
    type: module.type,
    category: "input",
    moduleState,

    getControlledModules: () => ({ sources: [], envelopes: [] }),

    triggerAttack: () => null,
    triggerRelease: () => null,
    releaseAll: () => [],
    releaseAllPending: () => [],

    apply: (nextModule) => {
      const prevPedal = Boolean(moduleState.options?.pedal);
      moduleState = deepClone(nextModule);
      runtime.moduleState = moduleState;

      // Pedal 从 on 变为 off：标记 pedalOff
      const newPedal = Boolean(moduleState.options?.pedal);
      if (prevPedal && !newPedal) {
        runtime.pedalOff = true;
      }
    },

    dispose: () => {},
  };

  return runtime;
}

/**
 * Input Runtime 工厂函数
 */
export function createInputRuntime(module, chainModules, inputIndex, getGlobalPolyVoice = () => 8) {
  if (module.type === "Voices") {
    return createVoicesRuntime(module, getGlobalPolyVoice);
  }
  if (module.type === "Pedal") {
    return createPedalRuntime(module);
  }
  return createPitchRuntime(module, chainModules, inputIndex);
}
