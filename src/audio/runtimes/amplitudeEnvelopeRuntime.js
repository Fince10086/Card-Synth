import * as Tone from "tone";
import { safeSet } from "../../utils/helpers.js";
import { createNoteVoiceTracker } from "../voice/noteVoiceTracker.js";

/**
 * 创建振幅包络运行时
 *
 * 用于管理振幅包络（音量包络）。
 * 支持两种模式：
 * 1. 多声音模式：每个声音有独立的振幅包络
 * 2. 全局模式：所有声音共享一个振幅包络
 *
 * @param {Object} module - 模块配置
 * @returns {Object} 振幅包络运行时对象
 */
export function createAmplitudeEnvelopeRuntime(module) {
  const VOICE_COUNT = 8;

  // 为每个声音创建独立的振幅包络
  const voices = Array.from({ length: VOICE_COUNT }, () => new Tone.AmplitudeEnvelope(module.options));

  // 全局振幅包络节点，用于非多声音模式
  const node = new Tone.AmplitudeEnvelope(module.options);

  // 声音引用计数，用于跟踪每个声音被多少音符使用
  const voiceRefCount = new Array(VOICE_COUNT).fill(0);

  // 全局音符追踪器
  const nodeNoteTracker = createNoteVoiceTracker(VOICE_COUNT);

  return {
    type: module.type,
    category: module.category || "component",
    voices,
    voiceRefCount,
    node,

    /**
     * 应用模块状态更新
     *
     * @param {Object} nextModule - 新的模块状态
     */
    apply: (nextModule) => {
      voices.forEach((env) => safeSet(env, nextModule.options));
      safeSet(node, nextModule.options);
    },

    /**
     * 触发指定声音的攻击阶段
     *
     * 使用引用计数管理声音的生命周期。
     *
     * @param {number} voiceIndex - 声音索引
     * @param {number} velocity - 力度值
     */
    triggerVoiceAttack: (voiceIndex, velocity) => {
      if (voiceIndex < 0 || voiceIndex >= VOICE_COUNT) return;
      voiceRefCount[voiceIndex] += 1;
      if (voiceRefCount[voiceIndex] === 1) {
        voices[voiceIndex].triggerAttack(Tone.now(), velocity);
      }
    },

    /**
     * 触发指定声音的释放阶段
     *
     * 使用引用计数确保所有音符释放后才触发包络释放。
     *
     * @param {number} voiceIndex - 声音索引
     */
    triggerVoiceRelease: (voiceIndex) => {
      if (voiceIndex < 0 || voiceIndex >= VOICE_COUNT) return;
      voiceRefCount[voiceIndex] = Math.max(0, voiceRefCount[voiceIndex] - 1);
      if (voiceRefCount[voiceIndex] === 0) {
        voices[voiceIndex].triggerRelease(Tone.now());
      }
    },

    /**
     * 触发全局振幅包络攻击
     *
     * @param {string} note - 音符名称
     * @param {number} velocity - 力度值
     */
    triggerAttack: (note, velocity) => {
      nodeNoteTracker.allocate(note, Tone.now());
      node.triggerAttack(Tone.now(), 1);
    },

    /**
     * 触发全局振幅包络释放
     *
     * 只有当所有音符都释放后才触发。
     *
     * @param {string} note - 音符名称
     */
    triggerRelease: (note) => {
      const releasedIndex = nodeNoteTracker.releaseByNote(note);
      if (releasedIndex >= 0 && !nodeNoteTracker.hasActiveNotes()) {
        node.triggerRelease(Tone.now());
      }
    },

    /**
     * 释放所有声音
     */
    releaseAll: () => {
      nodeNoteTracker.clearAll();
      node.triggerRelease(Tone.now());
      voices.forEach((env, index) => {
        voiceRefCount[index] = 0;
        env.triggerRelease(Tone.now());
      });
    },

    /**
     * 销毁运行时
     */
    dispose: () => {
      voices.forEach((env) => env.dispose());
      node.dispose();
    },
  };
}
