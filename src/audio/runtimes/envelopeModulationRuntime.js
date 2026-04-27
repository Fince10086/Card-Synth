import * as Tone from "tone";
import { deepClone, safeSet, rampParam } from "../../utils/helpers.js";
import { createNoteVoiceTracker } from "../voice/noteVoiceTracker.js";

/**
 * 创建包络调制运行时
 *
 * 用于创建包络调制效果，如滤波器包络。
 * 每个声音有独立的包络发生器和输出增益。
 *
 * @param {Object} module - 模块配置
 * @returns {Object} 包络调制运行时对象
 */
export function createEnvelopeModulationRuntime(module) {
  let moduleState = deepClone(module);
  const VOICE_COUNT = 8;

  // 为每个声音创建独立的包络发生器（排除 gain 参数）
  const voices = Array.from({ length: VOICE_COUNT }, () => {
    const { gain, ...envelopeOptions } = moduleState.options || {};
    return new Tone.Envelope(envelopeOptions);
  });

  // 为每个声音创建输出增益节点，用于控制调制深度
  const outputGains = Array.from({ length: VOICE_COUNT }, () => new Tone.Gain(Number(moduleState.options?.gain ?? 1)));

  voices.forEach((env, index) => env.connect(outputGains[index]));

  const noteTracker = createNoteVoiceTracker(VOICE_COUNT);

  return {
    type: module.type,
    category: "modulation-envelope",
    voices,
    outputGains,
    moduleState,

    /**
     * 获取指定声音的调制输出节点
     *
     * @param {number} voiceIndex - 声音索引
     * @returns {Object|null} 输出增益节点
     */
    getModulationOutput: (voiceIndex) => outputGains[voiceIndex] || null,

    /**
     * 应用模块状态更新
     *
     * @param {Object} nextModule - 新的模块状态
     */
    apply: (nextModule) => {
      moduleState = deepClone(nextModule);
      const { gain, ...envelopeOptions } = moduleState.options || {};
      const gainValue = Number(moduleState.options?.gain ?? 1);
      voices.forEach((env) => safeSet(env, envelopeOptions));
      outputGains.forEach((gainNode) => rampParam(gainNode.gain, gainValue));
    },

    /**
     * 触发指定 voice 的攻击
     *
     * @param {number} voiceIndex - 声音索引
     * @param {number} velocity - 力度值
     */
    triggerVoiceAttack: (voiceIndex, velocity) => {
      if (!moduleState.enabled || voiceIndex < 0 || voiceIndex >= VOICE_COUNT) {
        return;
      }
      voices[voiceIndex].triggerAttack(Tone.now(), velocity);
    },

    /**
     * 触发指定 voice 的释放
     *
     * @param {number} voiceIndex - 声音索引
     */
    triggerVoiceRelease: (voiceIndex) => {
      if (voiceIndex < 0 || voiceIndex >= VOICE_COUNT) {
        return;
      }
      voices[voiceIndex].triggerRelease(Tone.now());
    },

    /**
     * 触发音符攻击（旧接口，用于非 Input 控制场景）
     *
     * @param {string} note - 音符名称
     * @param {number} velocity - 力度值
     */
    triggerAttack: (note, velocity) => {
      if (!moduleState.enabled) {
        return;
      }
      const index = noteTracker.allocate(note, Tone.now());
      voices[index].triggerAttack(Tone.now(), velocity);
    },

    /**
     * 触发音符释放（旧接口，用于非 Input 控制场景）
     *
     * @param {string} note - 音符名称
     */
    triggerRelease: (note) => {
      const index = noteTracker.releaseByNote(note);
      if (index < 0) {
        return;
      }
      voices[index].triggerRelease(Tone.now());
    },

    /**
     * 释放所有声音
     */
    releaseAll: () => {
      noteTracker.clearAll();
      voices.forEach((env) => {
        env.triggerRelease(Tone.now());
      });
    },

    /**
     * 销毁运行时
     */
    dispose: () => {
      voices.forEach((env) => env.dispose());
      outputGains.forEach((gainNode) => gainNode.dispose());
    },
  };
}
