import * as Tone from "tone";
import { deepClone, safeSet, rampParam } from "../../utils/helpers.js";
import { createNoteVoiceTracker } from "../voice/noteVoiceTracker.js";

const VOICE_COUNT = 8;

/**
 * 创建统一的包络运行时
 *
 * 根据 modulationMode 决定行为：
 * - modulationMode=false（默认）：作为振幅包络，处理音频信号
 * - modulationMode=true：作为调制包络，输出调制信号
 */
export function createEnvelopeRuntime(module) {
  let moduleState = deepClone(module);
  const isModulation = moduleState.modulationMode === true;

  // === 调制模式：Tone.Envelope + outputGains ===
  let modVoices = null;
  let outputGains = null;
  let modNoteTracker = null;

  // === 振幅模式：Tone.AmplitudeEnvelope ===
  let ampVoices = null;
  let ampNode = null;
  let voiceRefCount = null;
  let nodeNoteTracker = null;

  if (isModulation) {
    modVoices = Array.from({ length: VOICE_COUNT }, () => {
      const { gain, ...envelopeOptions } = moduleState.options || {};
      return new Tone.Envelope(envelopeOptions);
    });
    outputGains = Array.from(
      { length: VOICE_COUNT },
      () => new Tone.Gain(Number(moduleState.options?.gain ?? 1))
    );
    modVoices.forEach((env, index) => env.connect(outputGains[index]));
    modNoteTracker = createNoteVoiceTracker(VOICE_COUNT);
  } else {
    ampVoices = Array.from(
      { length: VOICE_COUNT },
      () => new Tone.AmplitudeEnvelope(moduleState.options)
    );
    ampNode = new Tone.AmplitudeEnvelope(moduleState.options);
    voiceRefCount = new Array(VOICE_COUNT).fill(0);
    nodeNoteTracker = createNoteVoiceTracker(VOICE_COUNT);
  }

  const runtime = {
    type: module.type,
    category: isModulation ? "modulation-envelope" : "component",
    modulationMode: isModulation,

    // === 通用属性（根据模式暴露） ===
    get voices() {
      return isModulation ? modVoices : ampVoices;
    },
    get node() {
      return isModulation ? null : ampNode;
    },
    get outputGains() {
      return isModulation ? outputGains : null;
    },

    // === 调制源接口 ===
    getModulationOutput: (voiceIndex) => {
      if (!isModulation || voiceIndex < 0 || voiceIndex >= VOICE_COUNT) {
        return null;
      }
      return outputGains[voiceIndex] || null;
    },

    // === 状态更新 ===
    apply: (nextModule) => {
      const prevModulation = isModulation;
      moduleState = deepClone(nextModule);
      const newModulation = moduleState.modulationMode === true;

      // 模式切换时需要重建（由 audioEngine 处理）
      if (newModulation !== prevModulation) {
        return;
      }

      if (isModulation) {
        const { gain, ...envelopeOptions } = moduleState.options || {};
        const gainValue = Number(moduleState.options?.gain ?? 1);
        modVoices.forEach((env) => safeSet(env, envelopeOptions));
        outputGains.forEach((gainNode) => rampParam(gainNode.gain, gainValue));
      } else {
        ampVoices.forEach((env) => safeSet(env, moduleState.options));
        safeSet(ampNode, moduleState.options);
      }
    },

    // === 触发接口 ===
    triggerVoiceAttack: (voiceIndex, velocity) => {
      if (voiceIndex < 0 || voiceIndex >= VOICE_COUNT) return;

      if (isModulation) {
        if (!moduleState.enabled) return;
        modVoices[voiceIndex].triggerAttack(Tone.now(), velocity);
      } else {
        voiceRefCount[voiceIndex] += 1;
        if (voiceRefCount[voiceIndex] === 1) {
          ampVoices[voiceIndex].triggerAttack(Tone.now(), velocity);
        }
      }
    },

    triggerVoiceRelease: (voiceIndex) => {
      if (voiceIndex < 0 || voiceIndex >= VOICE_COUNT) return;

      if (isModulation) {
        modVoices[voiceIndex].triggerRelease(Tone.now());
      } else {
        voiceRefCount[voiceIndex] = Math.max(0, voiceRefCount[voiceIndex] - 1);
        if (voiceRefCount[voiceIndex] === 0) {
          ampVoices[voiceIndex].triggerRelease(Tone.now());
        }
      }
    },

    triggerAttack: (note, velocity) => {
      if (isModulation) {
        if (!moduleState.enabled) return;
        const index = modNoteTracker.allocate(note, Tone.now());
        modVoices[index].triggerAttack(Tone.now(), velocity);
      } else {
        nodeNoteTracker.allocate(note, Tone.now());
        ampNode.triggerAttack(Tone.now(), 1);
      }
    },

    triggerRelease: (note) => {
      if (isModulation) {
        const index = modNoteTracker.releaseByNote(note);
        if (index >= 0) {
          modVoices[index].triggerRelease(Tone.now());
        }
      } else {
        const releasedIndex = nodeNoteTracker.releaseByNote(note);
        if (releasedIndex >= 0 && !nodeNoteTracker.hasActiveNotes()) {
          ampNode.triggerRelease(Tone.now());
        }
      }
    },

    releaseAll: () => {
      if (isModulation) {
        modNoteTracker?.clearAll();
        modVoices.forEach((env) => env.triggerRelease(Tone.now()));
      } else {
        nodeNoteTracker?.clearAll();
        ampNode?.triggerRelease(Tone.now());
        ampVoices.forEach((env, index) => {
          voiceRefCount[index] = 0;
          env.triggerRelease(Tone.now());
        });
      }
    },

    dispose: () => {
      if (isModulation) {
        modVoices.forEach((env) => env.dispose());
        outputGains.forEach((gainNode) => gainNode.dispose());
      } else {
        ampVoices.forEach((env) => env.dispose());
        ampNode?.dispose();
      }
    },
  };

  return runtime;
}
