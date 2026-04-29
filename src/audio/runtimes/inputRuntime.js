import { clamp, deepClone } from "../../utils/helpers.js";
import * as Tone from "tone";

/**
 * 创建 Voices 输入模块运行时
 * Note-Centric Voice Allocation with Recovery
 * 
 * 核心设计：
 * - Note 状态与 Voice 状态分离
 * - 被 Steal 的 Note 进入 stolen 状态，只要按键还按着就会尝试恢复
 * - 统一处理 Mono/Poly（Mono 是 polyVoice=1 的特例）
 */
function createVoicesRuntime(module, getGlobalPolyVoice = () => 8) {
  let moduleState = deepClone(module);

  const getPolyVoice = () => {
    if (moduleState.options?.mono) {
      return 1;
    }
    return clamp(getGlobalPolyVoice(), 2, 8);
  };

  // Voice 状态数组
  let voiceStates = Array.from({ length: getPolyVoice() }, () => ({
    note: null,
    startTime: 0,
    active: false,
  }));

  // Note 状态映射：note -> { pressed, voiceIndex, stolenAt, pendingRelease, velocity }
  const noteStates = new Map();

  // 被 steal 的 note 队列（FIFO，按 steal 时间排序）
  const stolenQueue = [];

  const findAvailableVoice = () => {
    const polyVoice = getPolyVoice();

    // 优先找完全空闲的
    for (let i = 0; i < polyVoice; i++) {
      if (!voiceStates[i].active) {
        return i;
      }
    }

    // 找最旧的 active voice
    let oldestIndex = -1;
    let oldestTime = Infinity;
    for (let i = 0; i < polyVoice; i++) {
      if (voiceStates[i].active && voiceStates[i].startTime < oldestTime) {
        oldestTime = voiceStates[i].startTime;
        oldestIndex = i;
      }
    }

    return oldestIndex;
  };

  const stealVoice = (voiceIndex, stolenNote) => {
    const state = voiceStates[voiceIndex];
    
    // 被 steal 的 note 进入 stolen 状态
    const stolenNoteState = noteStates.get(stolenNote);
    if (stolenNoteState) {
      stolenNoteState.voiceIndex = -1;
      stolenNoteState.stolenAt = Tone.now();
      stolenQueue.push(stolenNote);
    }

    state.note = null;
    state.active = false;
    state.startTime = 0;
  };

  const releaseVoice = (voiceIndex) => {
    const state = voiceStates[voiceIndex];
    state.note = null;
    state.active = false;
    state.startTime = 0;
  };

  const tryRecoverStolenNote = (freedVoiceIndex) => {
    // 从 stolenQueue 中找最早被 steal、且 key 还按着的 note
    // 使用 shift 自动清理无效条目
    while (stolenQueue.length > 0) {
      const note = stolenQueue.shift();
      const state = noteStates.get(note);
      
      if (state && state.pressed) {
        state.voiceIndex = freedVoiceIndex;
        state.stolenAt = 0;
        
        voiceStates[freedVoiceIndex] = {
          note,
          active: true,
          startTime: Tone.now(),
        };
        
        return note;
      }
      // 无效的 note（已被释放或不存在）自动被丢弃
    }
    return null;
  };

  const getNoteState = (note) => {
    return noteStates.get(note);
  };

  const getVoiceForNote = (note) => {
    const state = noteStates.get(note);
    return state ? state.voiceIndex : -1;
  };

  const runtime = {
    type: module.type,
    category: "input",
    isVoiceManager: true,
    moduleState,

    triggerAttack: (note, velocity) => {
      // 已存在且 active = legato/retrigger
      const existingState = noteStates.get(note);
      if (existingState && existingState.voiceIndex >= 0) {
        return { 
          voiceIndex: existingState.voiceIndex, 
          isRetrigger: true, 
          stolenNote: null 
        };
      }

      const voiceIndex = findAvailableVoice();
      if (voiceIndex < 0) {
        return null;
      }

      let stolenNote = null;
      if (voiceStates[voiceIndex].active) {
        stolenNote = voiceStates[voiceIndex].note;
        stealVoice(voiceIndex, stolenNote);
      }

      // 分配 voice 给新 note
      voiceStates[voiceIndex] = {
        note,
        active: true,
        startTime: Tone.now(),
      };

      // 更新 note 状态
      const noteState = existingState || {
        note,
        pressed: true,
        voiceIndex: -1,
        stolenAt: 0,
        pendingRelease: false,
        velocity: velocity ?? 1,
      };
      noteState.pressed = true;
      noteState.voiceIndex = voiceIndex;
      noteState.stolenAt = 0;
      noteState.pendingRelease = false;
      noteState.velocity = velocity ?? 1;
      noteStates.set(note, noteState);

      return { voiceIndex, isRetrigger: false, stolenNote };
    },

    triggerRelease: (note, pedal) => {
      const noteState = noteStates.get(note);
      if (!noteState) {
        return null;
      }

      noteState.pressed = false;
      noteState.pendingRelease = false;
      const originalVelocity = noteState.velocity ?? 1;

      // 如果已经被 steal，从 stolenQueue 移除
      if (noteState.voiceIndex === -1) {
        const idx = stolenQueue.indexOf(note);
        if (idx >= 0) stolenQueue.splice(idx, 1);
        noteStates.delete(note);
        return { voiceIndex: -1, released: false, recoveredNote: null, originalVelocity };
      }

      const voiceIndex = noteState.voiceIndex;

      if (pedal) {
        noteState.pendingRelease = true;
        return { voiceIndex, released: false, recoveredNote: null, originalVelocity };
      }

      // 释放 voice
      releaseVoice(voiceIndex);
      noteState.voiceIndex = -1;
      noteStates.delete(note);

      // 尝试恢复 stolen note
      const recoveredNote = tryRecoverStolenNote(voiceIndex);

      return { voiceIndex, released: true, recoveredNote, originalVelocity };
    },

    releaseAll: () => {
      const released = [];
      for (let i = 0; i < getPolyVoice(); i++) {
        if (voiceStates[i].active) {
          const note = voiceStates[i].note;
          releaseVoice(i);
          if (note) {
            released.push({ note, voiceIndex: i });
            noteStates.delete(note);
          }
        }
      }
      stolenQueue.length = 0;
      return released;
    },

    releaseAllPending: () => {
      const released = [];
      for (let i = 0; i < getPolyVoice(); i++) {
        if (voiceStates[i].active) {
          const note = voiceStates[i].note;
          const state = noteStates.get(note);
          if (state && state.pendingRelease) {
            releaseVoice(i);
            state.voiceIndex = -1;
            noteStates.delete(note);
            released.push({ note, voiceIndex: i });
          }
        }
      }
      return released;
    },

    getNoteState,
    getVoiceForNote,

    getActiveNotes: () => {
      const result = [];
      noteStates.forEach((state, note) => {
        if (state.voiceIndex >= 0) {
          result.push({ note, voiceIndex: state.voiceIndex });
        }
      });
      return result;
    },

    getStolenNotes: () => {
      return stolenQueue.filter(note => {
        const state = noteStates.get(note);
        return state && state.pressed;
      });
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
              active: false,
              startTime: 0,
            });
          }
        } else {
          const released = [];
          for (let i = newPolyVoice; i < prevPolyVoice; i++) {
            if (voiceStates[i].active) {
              const note = voiceStates[i].note;
              releaseVoice(i);
              if (note) {
                released.push({ note, voiceIndex: i });
                noteStates.delete(note);
              }
            }
          }
          voiceStates.length = newPolyVoice;
          
          // 尝试将 stolenQueue 中的 note 恢复到保留的 voice 中
          while (stolenQueue.length > 0) {
            const availableVoice = findAvailableVoice();
            if (availableVoice < 0 || availableVoice >= newPolyVoice) break;
            
            const recovered = tryRecoverStolenNote(availableVoice);
            if (!recovered) break;
          }
          
          // 清空无法恢复的 stolenQueue，并清理对应的 noteStates
          stolenQueue.length = 0;
          noteStates.forEach((state, note) => {
            if (state.voiceIndex === -1) {
              noteStates.delete(note);
            }
          });
          
          if (released.length > 0) {
            runtime.pendingReleasedNotes = (runtime.pendingReleasedNotes || []).concat(released);
          }
        }
      }
    },

    dispose: () => {
      noteStates.clear();
      stolenQueue.length = 0;
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
