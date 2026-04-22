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

  /**
   * 提取包络选项
   *
   * 排除 gain 参数后的包络选项。
   *
   * @param {Object} options - 原始选项
   * @returns {Object} 包络选项
   */
  const getEnvelopeOptions = (options = {}) => {
    const { gain, ...envelopeOptions } = options || {};
    return envelopeOptions;
  };

  /**
   * 获取调制深度增益值
   *
   * @param {Object} options - 选项对象
   * @returns {number} 增益值
   */
  const getDepthGain = (options = {}) => Number(options?.gain ?? 1);

  // 为每个声音创建独立的包络发生器
  const voices = Array.from({ length: VOICE_COUNT }, () => new Tone.Envelope(getEnvelopeOptions(moduleState.options)));

  // 为每个声音创建输出增益节点，用于控制调制深度
  const outputGains = Array.from({ length: VOICE_COUNT }, () => new Tone.Gain(getDepthGain(moduleState.options)));

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
      const envelopeOptions = getEnvelopeOptions(moduleState.options);
      const gainValue = getDepthGain(moduleState.options);
      voices.forEach((env) => safeSet(env, envelopeOptions));
      outputGains.forEach((gainNode) => rampParam(gainNode.gain, gainValue));
    },

    /**
     * 触发音符攻击
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
     * 触发音符释放
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
