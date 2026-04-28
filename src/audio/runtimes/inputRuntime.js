import { clamp, deepClone } from "../../utils/helpers.js";
import * as Tone from "tone";

/**
 * 创建 Pitch 输入模块运行时
 * 负责音符触发、voice 分配、查找 Voices/Pedal 配置
 */
function createPitchRuntime(module, chainModules, inputIndex, getGlobalPolyVoice = () => 8) {
  let moduleState = deepClone(module);

  // 在范围内查找 Voices 配置
  const findVoicesModule = () => {
    for (let i = inputIndex + 1; i < chainModules.length; i++) {
      const m = chainModules[i];
      if (!m.enabled) continue;
      if (m.type === "Voices") return m;
      if (m.type === "Pitch") break; // 同类型阻断
    }
    return null;
  };

  // 在范围内查找 Pedal 配置
  const findPedalModule = () => {
    for (let i = inputIndex + 1; i < chainModules.length; i++) {
      const m = chainModules[i];
      if (!m.enabled) continue;
      if (m.type === "Pedal") return m;
      if (m.type === "Pitch") break; // 同类型阻断
    }
    return null;
  };

  const getPolyVoice = () => {
    const voicesModule = findVoicesModule();
    if (voicesModule?.options?.mono) {
      return 1;
    }
    return clamp(getGlobalPolyVoice(), 2, 8);
  };

  const getPedal = () => {
    const pedalModule = findPedalModule();
    return Boolean(pedalModule?.options?.pedal);
  };

  // Voice 状态数组（动态调整大小）
  let voiceStates = Array.from({ length: getPolyVoice() }, () => ({
    note: null,
    startTime: 0,
    pendingRelease: false,
  }));

  // 活跃音符映射：note -> voiceIndex
  const activeNotes = new Map();

  /**
   * 确定此 Pitch 的控制范围（到下一个 Pitch 之前）
   */
  const getControlledModules = () => {
    const sources = [];
    const envelopes = [];

    for (let i = inputIndex + 1; i < chainModules.length; i++) {
      const m = chainModules[i];
      if (!m.enabled) continue;
      if (m.type === "Pitch") break; // 同类型阻断

      if (m.category === "source" || m.type === "Envelope") {
        sources.push(m.id);
      }
      if (m.type === "Envelope") {
        envelopes.push({ id: m.id, type: m.type });
      }
    }

    return { sources, envelopes };
  };

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

    triggerAttack: (note, velocity) => {
      if (activeNotes.has(note)) {
        const voiceIndex = activeNotes.get(note);
        const noteData = moduleState.options?.mode === "midi"
          ? { type: "midi", note: applyMidiTransforms(note), originalNote: note, velocity }
          : { type: "frequency", frequency: getFrequencyValue(), originalNote: note, velocity };

        return {
          voiceIndex,
          noteData,
          isRetrigger: true,
          controlledSources: getControlledModules().sources,
          controlledEnvelopes: getControlledModules().envelopes,
        };
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

      const noteData = moduleState.options?.mode === "midi"
        ? { type: "midi", note: applyMidiTransforms(note), originalNote: note, velocity }
        : { type: "frequency", frequency: getFrequencyValue(), originalNote: note, velocity };

      const controlled = getControlledModules();

      return {
        voiceIndex,
        noteData,
        isRetrigger: false,
        stolenNote,
        controlledSources: controlled.sources,
        controlledEnvelopes: controlled.envelopes,
      };
    },

    triggerRelease: (note) => {
      const voiceIndex = activeNotes.get(note);
      if (voiceIndex === undefined) {
        return null;
      }

      const pedal = getPedal();

      if (pedal) {
        voiceStates[voiceIndex].pendingRelease = true;
        return { released: false, voiceIndex };
      }

      releaseVoice(voiceIndex);
      return { released: true, voiceIndex };
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

    apply: (nextModule) => {
      const prevPolyVoice = voiceStates.length;
      const prevMode = moduleState.options?.mode || "midi";
      const prevTranspose = Number(moduleState.options?.transpose) || 0;
      const prevOctave = Number(moduleState.options?.octave) || 0;
      const prevFrequency = Number(moduleState.options?.frequency) || 440;
      moduleState = deepClone(nextModule);
      runtime.moduleState = moduleState;

      // Mode 改变：立即停止所有活跃 voice
      const newMode = moduleState.options?.mode || "midi";
      if (newMode !== prevMode) {
        const released = [];
        for (let i = 0; i < voiceStates.length; i++) {
          if (voiceStates[i].note) {
            const note = voiceStates[i].note;
            releaseVoice(i);
            if (note) {
              released.push({ note, voiceIndex: i });
            }
          }
        }
        if (released.length > 0) {
          runtime.pendingReleasedNotes = (runtime.pendingReleasedNotes || []).concat(released);
        }
      }

      // Transpose 或 Octave 改变（仅 MIDI 模式）
      if (newMode === "midi") {
        const newTranspose = Number(moduleState.options?.transpose) || 0;
        const newOctave = Number(moduleState.options?.octave) || 0;
        if (newTranspose !== prevTranspose || newOctave !== prevOctave) {
          const noteUpdates = [];
          for (let i = 0; i < getPolyVoice(); i++) {
            const note = voiceStates[i].note;
            if (note) {
              noteUpdates.push({
                note,
                voiceIndex: i,
                transformedNote: applyMidiTransforms(note),
              });
            }
          }
          if (noteUpdates.length > 0) {
            runtime.pendingNoteUpdates = noteUpdates;
          }
        }
      }

      // Frequency 改变（仅 Frequency 模式）
      if (newMode === "frequency") {
        const newFrequency = Number(moduleState.options?.frequency) || 440;
        if (newFrequency !== prevFrequency) {
          const freqUpdates = [];
          for (let i = 0; i < getPolyVoice(); i++) {
            const note = voiceStates[i].note;
            if (note) {
              freqUpdates.push({
                voiceIndex: i,
                frequency: getFrequencyValue(),
              });
            }
          }
          if (freqUpdates.length > 0) {
            runtime.pendingFreqUpdates = freqUpdates;
          }
        }
      }

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
 * 创建 Voices 输入模块运行时
 * 只提供 mono 配置，不处理音符
 */
function createVoicesRuntime(module) {
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
      moduleState = deepClone(nextModule);
      runtime.moduleState = moduleState;
    },

    dispose: () => {},
  };

  return runtime;
}

/**
 * 创建 Pedal 输入模块运行时
 * 只提供 pedal 状态，不处理音符
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

      // Pedal 从 on 变为 off：标记 pendingReleasedNotes
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
    return createVoicesRuntime(module);
  }
  if (module.type === "Pedal") {
    return createPedalRuntime(module);
  }
  return createPitchRuntime(module, chainModules, inputIndex, getGlobalPolyVoice);
}
