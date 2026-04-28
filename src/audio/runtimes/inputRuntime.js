import { clamp, deepClone } from "../../utils/helpers.js";
import * as Tone from "tone";

/**
 * 创建输入模块运行时
 *
 * Input 模块是链中的控制器，负责：
 * - 统一分配 voice slot（取代各 Source 独立分配）
 * - 管理音符生命周期（延续音、pedal、声部窃取）
 * - 确定控制范围（当前位置到下一个 Input 之间的 Source 和 Envelope）
 * - 转换输入数据（MIDI: 应用 transpose/octave; Frequency: 输出固定频率）
 */
export function createInputRuntime(module, chainModules, inputIndex) {
  let moduleState = deepClone(module);

  const getPolyVoice = () => clamp(Number(moduleState.options?.polyVoice) || 8, 1, 8);

  // Voice 状态数组（动态调整大小）
  let voiceStates = Array.from({ length: getPolyVoice() }, () => ({
    note: null,
    startTime: 0,
    pendingRelease: false,
  }));

  // 活跃音符映射：note -> voiceIndex
  const activeNotes = new Map();

  /**
   * 确定此 Input 的控制范围
   * 从 inputIndex+1 开始，到下一个 Input 之前
   */
  const getControlledModules = () => {
    const sources = [];
    const envelopes = [];

    for (let i = inputIndex + 1; i < chainModules.length; i++) {
      const m = chainModules[i];
      if (!m.enabled) continue;
      if (m.category === "input") break; // 遇到下一个 Input，停止

      if (m.category === "source" || m.type === "Envelope") {
        sources.push(m.id);
      }
      if (m.type === "Envelope") {
        envelopes.push({ id: m.id, type: m.type });
      }
    }

    return { sources, envelopes };
  };

  /**
   * 查找可用 voice
   * 策略：
   * 1. 优先找已分配但空闲的 voice
   * 2. 找未初始化的 voice（如果 polyVoice 减小，可能有一些未使用）
   * 3. 窃取最老的活跃 voice
   */
  const findAvailableVoice = () => {
    const polyVoice = getPolyVoice();

    // 1. 优先找空闲 voice
    for (let i = 0; i < polyVoice; i++) {
      if (!voiceStates[i].note && !voiceStates[i].pendingRelease) {
        return i;
      }
    }

    // 2. 窃取最老的活跃 voice（startTime 最早的）
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

  /**
   * 释放指定 voice（内部使用）
   */
  const releaseVoice = (voiceIndex) => {
    const state = voiceStates[voiceIndex];
    if (state.note) {
      activeNotes.delete(state.note);
    }
    state.note = null;
    state.startTime = 0;
    state.pendingRelease = false;
  };

  /**
   * 将 MIDI note 应用 transpose 和 octave
   */
  const applyMidiTransforms = (note) => {
    const transpose = clamp(Number(moduleState.options?.transpose) || 0, -12, 12);
    const octave = clamp(Number(moduleState.options?.octave) || 0, -4, 4);

    if (transpose === 0 && octave === 0) {
      return note;
    }

    // 转换为 MIDI note number，应用偏移，再转回 note name
    let midiNum = Tone.Frequency(note).toMidi();
    midiNum += transpose + (octave * 12);
    return Tone.Frequency(midiNum, "midi").toNote();
  };

  /**
   * 获取频率值（Frequency Input）
   */
  const getFrequencyValue = () => {
    const mode = moduleState.options?.mode || "high";
    const freq = Number(moduleState.options?.frequency) || 440;

    if (mode === "low") {
      return clamp(freq, 0.1, 100);
    }
    return clamp(freq, 20, 20000);
  };

  const runtime = {
    type: module.type,
    category: "input",
    moduleState,

    /**
     * 获取控制范围内的模块 ID
     */
    getControlledModules,

    /**
     * 触发音符 Attack
     *
     * @param {string} note - 音符名称
     * @param {number} velocity - 力度值
     * @returns {Object|null} { voiceIndex, noteData, isRetrigger, controlledSources, controlledEnvelopes }
     */
    triggerAttack: (note, velocity) => {
      // 检查延续音
      if (activeNotes.has(note)) {
        const voiceIndex = activeNotes.get(note);
        const noteData = moduleState.type === "MIDI"
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

      // 分配 voice
      const voiceIndex = findAvailableVoice();
      if (voiceIndex < 0) {
        return null;
      }

      // 如果窃取了已有 voice，先释放它
      let stolenNote = null;
      if (voiceStates[voiceIndex].note) {
        stolenNote = voiceStates[voiceIndex].note;
        activeNotes.delete(voiceStates[voiceIndex].note);
      }

      voiceStates[voiceIndex].note = note;
      voiceStates[voiceIndex].startTime = Tone.now();
      voiceStates[voiceIndex].pendingRelease = false;
      activeNotes.set(note, voiceIndex);

      // 生成 noteData
      const noteData = moduleState.type === "MIDI"
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

    /**
     * 触发音符 Release
     *
     * @param {string} note - 音符名称
     * @returns {Object|null} { released, voiceIndex }
     */
    triggerRelease: (note) => {
      const voiceIndex = activeNotes.get(note);
      if (voiceIndex === undefined) {
        return null;
      }

      const pedal = Boolean(moduleState.options?.pedal);

      if (pedal) {
        // Pedal on：标记 pending release，不实际释放
        voiceStates[voiceIndex].pendingRelease = true;
        return { released: false, voiceIndex };
      }

      // Pedal off：立即释放
      releaseVoice(voiceIndex);
      return { released: true, voiceIndex };
    },

    /**
     * Pedal off 时释放所有 pending 的音符
     *
     * @returns {Array} 释放的 { note, voiceIndex } 列表
     */
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

    /**
     * 释放所有活跃音符（用于 silenceAll 或紧急停止）
     */
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

    /**
     * 应用模块状态更新
     */
    apply: (nextModule) => {
      const prevPolyVoice = getPolyVoice();
      const prevPedal = Boolean(moduleState.options?.pedal);
      moduleState = deepClone(nextModule);
      runtime.moduleState = moduleState;

      // Pedal 从 on 变为 off：释放所有 pending 的音符
      const newPedal = Boolean(moduleState.options?.pedal);
      if (prevPedal && !newPedal) {
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
        runtime.pendingReleasedNotes = released;
      }

      const newPolyVoice = getPolyVoice();
      if (newPolyVoice !== prevPolyVoice) {
        // 调整 voiceStates 数组大小
        if (newPolyVoice > prevPolyVoice) {
          // 扩展：添加新的空 voice slot
          for (let i = prevPolyVoice; i < newPolyVoice; i++) {
            voiceStates.push({
              note: null,
              startTime: 0,
              pendingRelease: false,
            });
          }
        } else {
          // 缩小：释放超出范围的活跃 voice
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

    /**
     * 销毁运行时
     */
    dispose: () => {
      activeNotes.clear();
    },
  };

  return runtime;
}
