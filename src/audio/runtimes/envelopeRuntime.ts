/**
 * Envelope runtime - supports both amplitude and modulation modes
 */

import * as Tone from "tone";
import { deepClone, safeSet, rampParam } from "../../utils/helpers";
import { createNoteVoiceTracker } from "../voice/noteVoiceTracker";
import type { ModuleConfig } from "../../types";

const VOICE_COUNT = 8;

export interface EnvelopeRuntime {
  type: string;
  category: string;
  modulationMode: boolean;
  voices: Tone.Envelope[] | Tone.AmplitudeEnvelope[];
  node: Tone.AmplitudeEnvelope | null;
  outputGains: Tone.Gain[] | null;
  hasPerVoiceConnection: boolean;
  getModulationOutput(voiceIndex: number): Tone.Gain | null;
  apply(nextModule: ModuleConfig): void;
  triggerVoiceAttack(voiceIndex: number, velocity: number): void;
  triggerVoiceRelease(voiceIndex: number): void;
  triggerAttack(note: number, velocity: number): void;
  triggerRelease(note: number): void;
  releaseAll(): void;
  resetVoice(voiceIndex: number): void;
  dispose(): void;
}

export function createEnvelopeRuntime(module: ModuleConfig): EnvelopeRuntime {
  let moduleState = deepClone(module);
  const isModulation = moduleState.modulationMode === true;

  // Modulation mode: Tone.Envelope + outputGains
  let modVoices: Tone.Envelope[] | null = null;
  let outputGains: Tone.Gain[] | null = null;
  let modNoteTracker = null;

  // Amplitude mode: Tone.AmplitudeEnvelope
  let ampVoices: Tone.AmplitudeEnvelope[] | null = null;
  let ampNode: Tone.AmplitudeEnvelope | null = null;
  let voiceRefCount: number[] | null = null;
  let nodeNoteTracker = null;

  if (isModulation) {
    const { gain: _gain, ...envelopeOptions } = (moduleState.options || {}) as unknown as Record<string, unknown>;
    modVoices = Array.from({ length: VOICE_COUNT }, () => {
      return new Tone.Envelope(envelopeOptions as unknown as Tone.EnvelopeOptions);
    });
    outputGains = Array.from(
      { length: VOICE_COUNT },
      () => new Tone.Gain(Number((moduleState.options as unknown as Record<string, unknown>)?.gain ?? 1))
    );
    modVoices.forEach((env, index) => env.connect(outputGains![index]));
    modNoteTracker = createNoteVoiceTracker(VOICE_COUNT);
  } else {
    ampVoices = Array.from(
      { length: VOICE_COUNT },
      () => new Tone.AmplitudeEnvelope((moduleState.options || {}) as unknown as Tone.EnvelopeOptions)
    );
    ampNode = new Tone.AmplitudeEnvelope((moduleState.options || {}) as unknown as Tone.EnvelopeOptions);
    voiceRefCount = new Array(VOICE_COUNT).fill(0);
    nodeNoteTracker = createNoteVoiceTracker(VOICE_COUNT);
  }

  const runtime: EnvelopeRuntime = {
    type: module.type as string,
    category: isModulation ? "modulation-envelope" : "envelope",
    modulationMode: isModulation,
    hasPerVoiceConnection: false,

    // Dynamic getters based on mode
    get voices() {
      return (isModulation ? modVoices : ampVoices) as Tone.Envelope[] | Tone.AmplitudeEnvelope[];
    },
    get node() {
      return isModulation ? null : ampNode;
    },
    get outputGains() {
      return isModulation ? outputGains : null;
    },

    // Modulation source interface
    getModulationOutput: (voiceIndex: number) => {
      if (!isModulation || voiceIndex < 0 || voiceIndex >= VOICE_COUNT) {
        return null;
      }
      return outputGains![voiceIndex] || null;
    },

    // State update
    apply: (nextModule: ModuleConfig) => {
      const prevModulation = isModulation;
      moduleState = deepClone(nextModule);
      const newModulation = moduleState.modulationMode === true;

      // Mode change requires rebuild (handled by audioEngine)
      if (newModulation !== prevModulation) {
        return;
      }

      if (isModulation) {
        const { gain: _gain, ...envelopeOptions } = (moduleState.options || {}) as unknown as Record<string, unknown>;
        const gainValue = Number((moduleState.options as unknown as Record<string, unknown>)?.gain ?? 1);
        modVoices!.forEach((env) => safeSet(env, envelopeOptions));
        outputGains!.forEach((gainNode) => rampParam(gainNode.gain, gainValue));
      } else {
        ampVoices!.forEach((env) => safeSet(env, moduleState.options));
        safeSet(ampNode!, moduleState.options);
      }
    },

    // Trigger interfaces
    triggerVoiceAttack: (voiceIndex: number, velocity: number) => {
      if (voiceIndex < 0 || voiceIndex >= VOICE_COUNT) return;

      if (isModulation) {
        if (!moduleState.enabled) return;
        modVoices![voiceIndex].triggerAttack(Tone.now(), velocity);
      } else {
        voiceRefCount![voiceIndex] += 1;
        if (voiceRefCount![voiceIndex] === 1) {
          ampVoices![voiceIndex].triggerAttack(Tone.now(), velocity);
        }
      }
    },

    triggerVoiceRelease: (voiceIndex: number) => {
      if (voiceIndex < 0 || voiceIndex >= VOICE_COUNT) return;

      if (isModulation) {
        modVoices![voiceIndex].triggerRelease(Tone.now());
      } else {
        voiceRefCount![voiceIndex] = Math.max(0, voiceRefCount![voiceIndex] - 1);
        if (voiceRefCount![voiceIndex] === 0) {
          ampVoices![voiceIndex].triggerRelease(Tone.now());
        }
      }
    },

    triggerAttack: (note: number, velocity: number) => {
      if (isModulation) {
        if (!moduleState.enabled) return;
        const index = modNoteTracker!.allocate(String(note), Tone.now());
        modVoices![index].triggerRelease(Tone.now());
        modVoices![index].triggerAttack(Tone.now(), velocity);
      } else {
        nodeNoteTracker!.allocate(String(note), Tone.now());
        ampNode!.triggerAttack(Tone.now(), 1);
      }
    },

    triggerRelease: (note: number) => {
      if (isModulation) {
        const index = modNoteTracker!.releaseByNote(String(note));
        if (index >= 0) {
          modVoices![index].triggerRelease(Tone.now());
        }
      } else {
        const releasedIndex = nodeNoteTracker!.releaseByNote(String(note));
        if (releasedIndex >= 0 && !nodeNoteTracker!.hasActiveNotes()) {
          ampNode!.triggerRelease(Tone.now());
        }
      }
    },

    releaseAll: () => {
      if (isModulation) {
        modNoteTracker?.clearAll();
        modVoices!.forEach((env) => env.triggerRelease(Tone.now()));
      } else {
        nodeNoteTracker?.clearAll();
        ampNode?.triggerRelease(Tone.now());
        ampVoices!.forEach((env, index) => {
          voiceRefCount![index] = 0;
          env.triggerRelease(Tone.now());
        });
      }
    },

    resetVoice: (voiceIndex: number) => {
      if (voiceIndex < 0 || voiceIndex >= VOICE_COUNT) return;

      const now = Tone.now();

      const resetEnv = (env: Tone.Envelope | Tone.AmplitudeEnvelope | null) => {
        if (!env) return;
        env.cancel(now);
        const output = (env as unknown as Record<string, unknown>).output as { gain?: { setValueAtTime(value: number, time: number): void } } | undefined;
        if (output?.gain) {
          output.gain.setValueAtTime(0, now);
        }
      };

      if (isModulation) {
        resetEnv(modVoices![voiceIndex]);
      } else {
        resetEnv(ampVoices![voiceIndex]);
        voiceRefCount![voiceIndex] = 0;
      }
    },

    dispose: () => {
      if (isModulation) {
        modVoices!.forEach((env) => env.dispose());
        outputGains!.forEach((gainNode) => gainNode.dispose());
      } else {
        ampVoices!.forEach((env) => env.dispose());
        ampNode?.dispose();
      }
    },
  };

  return runtime;
}
