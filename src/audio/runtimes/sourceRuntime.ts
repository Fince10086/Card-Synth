/**
 * Source runtime - manages voices and audio nodes for source modules
 */

import * as Tone from "tone";
import {
  deepClone,
  safeSet,
  rampParam,
  applyPlayerLikeOptions,
  SOURCE_LIBRARY,
} from "../../utils/helpers";
import type { ModuleConfig } from "../../types";

export interface SourceVoice {
  node: Tone.ToneAudioNode | null;
  volumeNode: Tone.Gain | null;
  panNode: Tone.Panner | null;
  frequencyBaseSignal: Tone.Signal | null;
  frequencyOffsetParam: Tone.Signal | null;
  frequencyMultiply: Tone.Multiply | null;
  hiddenEnv: Tone.AmplitudeEnvelope | null;
  analyser: Tone.Analyser | null;
  initialized: boolean;
  note: string | null;
  startTime: number;
  state: VoiceState;
  releaseEndTime: number;
  idleSince: number;
  disposeTimeoutId: ReturnType<typeof setTimeout> | null;
}

type VoiceState = "idle" | "active" | "releasing";

export interface SourceRuntime {
  type: string;
  category: string;
  voices: SourceVoice[];
  definition: Record<string, unknown>;
  moduleState: ModuleConfig;
  hasEnv: boolean;
  envRuntime: Record<string, unknown> | null;
  needsExtendedRelease: boolean;
  preserveVoiceSlotsForSourceTargets: boolean;
  readonly isMono: boolean;
  getModulationOutput(voiceIndex: number): AudioNode | null;
  apply(nextModule: ModuleConfig): void;
  triggerAttack(noteData: NoteData, velocity: number, voiceIndex: number): number;
  triggerRelease(note: string, voiceIndex: number): void;
  releaseAll(): void;
  getOutputValue(): number;
  updateVoiceFrequency(voiceIndex: number, noteOrFrequency: string | number): void;
  resetVoice(voiceIndex: number): void;
  dispose(): void;
}

export interface NoteData {
  type: "midi" | "frequency";
  note?: string;
  frequency?: number;
  originalNote: string;
  velocity: number;
}

export interface SourceRuntimeOptions {
  module: ModuleConfig;
  getVelocityEnabled?: () => boolean;
  getIsMono?: () => boolean;
  onAllVoicesIdle?: (() => void) | null;
  onVoiceDisposed?: ((voiceIndex: number) => void) | null;
  onVoiceInitialized?: ((voiceIndex: number) => void) | null;
}

const VOICE_COUNT = 8;
const ALL_VOICES_IDLE_REBUILD_DELAY = 10;

export function createSourceRuntime({
  module,
  getVelocityEnabled = () => true,
  getIsMono = () => false,
  onAllVoicesIdle = null,
  onVoiceDisposed = null,
  onVoiceInitialized = null,
}: SourceRuntimeOptions): SourceRuntime {
  const definition = SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator;
  let moduleState = deepClone(module);

  let sharedPlayerBuffer: Tone.Buffer | null = null;
  if ((definition as Record<string, unknown>).runtime === "player" && (moduleState.options as Record<string, unknown>)?.url) {
    try {
      sharedPlayerBuffer = new Tone.Buffer((moduleState.options as Record<string, unknown>).url as string);
    } catch {
      // Silently ignore buffer preload failure
    }
  }

  const VOICE_STATE = {
    IDLE: "idle" as VoiceState,
    ACTIVE: "active" as VoiceState,
    RELEASING: "releasing" as VoiceState,
  };

  let allVoicesIdleTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const checkAllVoicesIdle = (): void => {
    if (!onAllVoicesIdle) {
      return;
    }

    if (allVoicesIdleTimeoutId) {
      clearTimeout(allVoicesIdleTimeoutId);
      allVoicesIdleTimeoutId = null;
    }

    const allIdleOrReleasing = voices.every((v) =>
      !v.initialized ||
      (v.state === VOICE_STATE.IDLE && !v.note) ||
      v.state === VOICE_STATE.RELEASING
    );

    if (allIdleOrReleasing) {
      allVoicesIdleTimeoutId = setTimeout(() => {
        onAllVoicesIdle!();
        allVoicesIdleTimeoutId = null;
      }, ALL_VOICES_IDLE_REBUILD_DELAY * 1000);
    }
  };

  const getFrequencyOffset = (): number => {
    const offset = Number((moduleState?.options as Record<string, unknown>)?.frequencyOffset);
    if (!Number.isFinite(offset)) {
      return 1;
    }
    return Math.max(0, Math.min(2, offset));
  };

  const getNoteFrequency = (note: string): number => Tone.Frequency(note).toFrequency();

  const getBaseFrequencyForNote = (note: string): number => {
    return getNoteFrequency(note);
  };

  const getPitchRatio = (note: string): number => {
    const root = Tone.Frequency((moduleState.rootNote as string) || "C4").toFrequency();
    return (getBaseFrequencyForNote(note) * getFrequencyOffset()) / root;
  };

  const getModulationFrequency = (): number => {
    const configuredFrequency = Number((moduleState?.options as Record<string, unknown>)?.frequency);
    if (Number.isFinite(configuredFrequency) && configuredFrequency > 0) {
      return configuredFrequency;
    }

    const legacyFrequency = Number((moduleState as Record<string, unknown>)?.modulationFrequency);
    if (Number.isFinite(legacyFrequency) && legacyFrequency > 0) {
      return legacyFrequency;
    }

    return 1;
  };

  const getNodeOptions = (options: Record<string, unknown> = {}, exclude: string[] = []): Record<string, unknown> => {
    const result = { ...options };
    exclude.forEach((key) => delete result[key]);
    return result;
  };

  const getSourceOutputGain = (): number => {
    if (moduleState.modulationMode) {
      if (!moduleState.enabled) {
        return 0;
      }
      const depth = Number((moduleState?.options as Record<string, unknown>)?.gain);
      return Number.isFinite(depth) ? Math.max(0, depth) : 1;
    }
    return Tone.dbToGain(moduleState.enabled ? (moduleState.volume as number) : -48);
  };

  const createVoicePlaceholder = (): SourceVoice => ({
    node: null,
    volumeNode: null,
    panNode: null,
    frequencyBaseSignal: null,
    frequencyOffsetParam: null,
    frequencyMultiply: null,
    hiddenEnv: null,
    analyser: null,
    initialized: false,
    note: null,
    startTime: 0,
    state: VOICE_STATE.IDLE,
    releaseEndTime: 0,
    idleSince: 0,
    disposeTimeoutId: null,
  });

  const createSourceNode = (connectTarget: Tone.Gain): Tone.ToneAudioNode => {
    let node: Tone.ToneAudioNode;

    const runtime = (definition as Record<string, unknown>).runtime;
    const options = getNodeOptions((moduleState.options || {}) as Record<string, unknown>, ["gain", "frequencyOffset", "frequency"]);

    if (runtime === "pitchedSource") {
      const Ctor = (Tone as Record<string, unknown>)[module.type] as new (opts?: unknown) => Tone.ToneAudioNode;
      node = new Ctor(options);
      node.connect(connectTarget);
      (node as Record<string, unknown>).start?.();
    } else if (runtime === "noise") {
      node = new Tone.Noise(options as Tone.NoiseOptions);
      node.connect(connectTarget);
      node.start();
    } else if (runtime === "player") {
      if (sharedPlayerBuffer) {
        node = new Tone.Player(sharedPlayerBuffer);
      } else {
        node = new Tone.Player(options as Tone.PlayerOptions);
      }
      applyPlayerLikeOptions(node as Record<string, unknown>, options);
      node.connect(connectTarget);
    } else {
      node = new Tone.Oscillator(options as Tone.OscillatorOptions);
      node.connect(connectTarget);
      node.start();
    }

    return node;
  };

  const initVoice = (index: number): SourceVoice => {
    const voice = voices[index];
    if (voice.initialized) {
      return voice;
    }

    const volumeNode = new Tone.Gain(getSourceOutputGain());
    const isModulationMode = moduleState.modulationMode;
    let panNode: Tone.Panner | null = null;

    const hiddenEnv = new Tone.AmplitudeEnvelope({
      attack: 0.005,
      decay: 0.01,
      sustain: 1,
      release: 0.005,
    });

    if (!isModulationMode) {
      panNode = new Tone.Panner(module.pan as number);
      volumeNode.connect(panNode);
      panNode.connect(hiddenEnv);
    }

    const node = createSourceNode(volumeNode);

    voice.node = node;
    voice.volumeNode = volumeNode;
    voice.panNode = panNode;
    voice.hiddenEnv = hiddenEnv;

    if ((definition as Record<string, unknown>).runtime === "pitchedSource" && (node as Record<string, unknown>)?.frequency) {
      const initFreq = getModulationFrequency();
      voice.frequencyBaseSignal = new Tone.Signal(initFreq);
      voice.frequencyOffsetParam = new Tone.Signal(getFrequencyOffset());
      voice.frequencyMultiply = new Tone.Multiply(1);
      voice.frequencyBaseSignal.connect(voice.frequencyMultiply);
      voice.frequencyOffsetParam.connect(voice.frequencyMultiply.factor);
      const freq = (node as Record<string, unknown>).frequency as { value: number };
      freq.value = 0;
      voice.frequencyMultiply.connect(freq as unknown as Tone.AudioNode);
    }

    voice.initialized = true;

    if (!isModulationMode) {
      if (rt.hasEnv && rt.envRuntime?.voices?.[index]) {
        const outputNode = voice.panNode || voice.hiddenEnv;
        if (outputNode) {
          outputNode.connect((rt.envRuntime.voices as Array<AudioNode>)[index]);
        }
      } else if (!rt.hasEnv && rt.targetNode && voice.hiddenEnv) {
        voice.hiddenEnv.connect(rt.targetNode as AudioNode);
      }
    }

    if (onVoiceInitialized) {
      onVoiceInitialized(index);
    }

    return voice;
  };

  const getOrInitVoice = (index: number): SourceVoice => {
    const voice = voices[index];
    if (!voice.initialized) {
      return initVoice(index);
    }
    return voice;
  };

  const voices: SourceVoice[] = Array.from({ length: VOICE_COUNT }, createVoicePlaceholder);

  const createNodeForVoice = (voice: SourceVoice): Tone.ToneAudioNode => {
    const node = createSourceNode(voice.volumeNode!);
    voice.node = node;

    if ((definition as Record<string, unknown>).runtime === "pitchedSource" && (node as Record<string, unknown>)?.frequency && voice.frequencyMultiply) {
      const freq = (node as Record<string, unknown>).frequency as { value: number };
      freq.value = 0;
      voice.frequencyMultiply.connect(freq as unknown as Tone.AudioNode);
    }

    return node;
  };

  const disposeVoiceNode = (voice: SourceVoice): void => {
    if (voice.disposeTimeoutId) {
      clearTimeout(voice.disposeTimeoutId);
      voice.disposeTimeoutId = null;
    }

    const nodesToDispose = [
      voice.frequencyMultiply,
      voice.frequencyOffsetParam,
      voice.frequencyBaseSignal,
      voice.node,
      voice.hiddenEnv,
      voice.panNode,
      voice.volumeNode,
      voice.analyser,
    ];
    nodesToDispose.forEach((node) => {
      if (node && typeof (node as Record<string, unknown>).dispose === "function") {
        (node as Record<string, unknown>).dispose?.();
      }
    });

    voice.node = null;
    voice.volumeNode = null;
    voice.panNode = null;
    voice.frequencyBaseSignal = null;
    voice.frequencyOffsetParam = null;
    voice.frequencyMultiply = null;
    voice.hiddenEnv = null;
    voice.analyser = null;
  };

  const ensureVoiceNode = (voiceIndex: number): Tone.ToneAudioNode => {
    const voice = getOrInitVoice(voiceIndex);
    if (voice.node) {
      return voice.node;
    }
    return createNodeForVoice(voice);
  };

  const getEnvReleaseTime = (voiceIndex: number): number => {
    const envRuntime = rt.envRuntime || rt.chainedEnvRuntime;
    const envVoices = envRuntime?.voices as Array<{ release?: number }> | undefined;
    const envVoice = envVoices?.[voiceIndex];
    const release = Number(envVoice?.release);
    return Number.isFinite(release) && release >= 0 ? release : 0.01;
  };

  const getEnvAttackTime = (voiceIndex: number): number => {
    const envRuntime = rt.envRuntime || rt.chainedEnvRuntime;
    const envVoices = envRuntime?.voices as Array<{ attack?: number }> | undefined;
    const envVoice = envVoices?.[voiceIndex];
    const attack = Number(envVoice?.attack);
    return Number.isFinite(attack) && attack >= 0 ? attack : 0.01;
  };

  const getVoiceReleaseDuration = (voice: SourceVoice, voiceIndex: number): number => {
    if (moduleState.modulationMode) {
      return 0.01;
    }
    if (rt.needsExtendedRelease) {
      return getEnvReleaseTime(voiceIndex);
    }
    if (rt.hasEnv) {
      return getEnvReleaseTime(voiceIndex);
    }
    return 0.01;
  };

  const refreshVoiceLifecycle = (voice: SourceVoice, now: number = Tone.now()): void => {
    if (voice.state === VOICE_STATE.RELEASING && now >= voice.releaseEndTime) {
      voice.state = VOICE_STATE.IDLE;
      voice.releaseEndTime = 0;
      voice.idleSince = now;
      if (!voice.note) {
        voice.startTime = 0;
      }

      if (voice.node && !moduleState.modulationMode) {
        if ((definition as Record<string, unknown>).runtime === "player" && voice.node) {
          try {
            (voice.node as Record<string, unknown>).stop?.(now);
          } catch {
            // ignore
          }
        }
        disposeVoiceNode(voice);
        voice.initialized = false;
      }
      checkAllVoicesIdle();
    }

    if (voice.state === VOICE_STATE.IDLE && voice.note) {
      voice.state = VOICE_STATE.ACTIVE;
      voice.idleSince = 0;
    }
  };

  const refreshAllVoiceLifecycles = (now: number = Tone.now()): void => {
    voices.forEach((voice) => {
      if (voice.initialized) {
        refreshVoiceLifecycle(voice, now);
      }
    });
  };

  const scheduleVoiceRelease = (voice: SourceVoice, voiceIndex: number, now: number = Tone.now()): void => {
    voice.state = VOICE_STATE.RELEASING;
    const releaseDuration = getVoiceReleaseDuration(voice, voiceIndex);
    voice.releaseEndTime = now + releaseDuration;
    voice.idleSince = 0;

    if (voice.disposeTimeoutId) {
      clearTimeout(voice.disposeTimeoutId);
      voice.disposeTimeoutId = null;
    }

    voice.disposeTimeoutId = setTimeout(() => {
      if (voice.initialized) {
        refreshVoiceLifecycle(voice, Tone.now());
        if (!voice.initialized && onVoiceDisposed) {
          onVoiceDisposed(voiceIndex);
        }
      }
      voice.disposeTimeoutId = null;
    }, releaseDuration * 1000);
  };

  const releaseVoice = (voice: SourceVoice, voiceIndex: number, now: number = Tone.now()): void => {
    const hadAssignedNote = voice.note !== null;

    voice.note = null;

    const isModulationMode = moduleState.modulationMode;

    if (isModulationMode) {
      // Skip hiddenEnv release in modulation mode
    } else if (rt.hasEnv) {
      triggerEnvRelease(voiceIndex);
      const envRelease = getEnvReleaseTime(voiceIndex);
      if (voice.hiddenEnv) {
        voice.hiddenEnv.release = envRelease;
        voice.hiddenEnv.triggerRelease(now);
      }
    } else if (rt.needsExtendedRelease) {
      const envRelease = getEnvReleaseTime(voiceIndex);
      if (voice.hiddenEnv) {
        voice.hiddenEnv.release = envRelease;
        voice.hiddenEnv.triggerRelease(now);
      }
    } else {
      voice.hiddenEnv?.triggerRelease(now);
    }

    if ((definition as Record<string, unknown>).runtime === "player" && !moduleState.modulationMode) {
      if (voice.node && !rt.hasEnv && !rt.needsExtendedRelease) {
        try {
          (voice.node as Record<string, unknown>).stop?.(now);
        } catch {
          // ignore
        }
      }
    }

    if (hadAssignedNote || voice.state !== VOICE_STATE.IDLE) {
      scheduleVoiceRelease(voice, voiceIndex, now);
    } else {
      refreshVoiceLifecycle(voice, now);
    }

    checkAllVoicesIdle();
  };

  const findAvailableVoice = (): { voice: SourceVoice; index: number } | null => {
    const now = Tone.now();
    refreshAllVoiceLifecycles(now);

    for (let i = 0; i < voices.length; i++) {
      if (voices[i].initialized && voices[i].state === VOICE_STATE.IDLE && !voices[i].note) {
        return { voice: voices[i], index: i };
      }
    }

    for (let i = 0; i < voices.length; i++) {
      if (!voices[i].initialized) {
        return { voice: getOrInitVoice(i), index: i };
      }
    }

    let oldestReleasing: SourceVoice | null = null;
    let oldestReleasingIndex = -1;
    for (let i = 0; i < voices.length; i++) {
      if (voices[i].state === VOICE_STATE.RELEASING) {
        if (!oldestReleasing || voices[i].releaseEndTime < oldestReleasing.releaseEndTime) {
          oldestReleasing = voices[i];
          oldestReleasingIndex = i;
        }
      }
    }

    if (oldestReleasing) {
      return { voice: oldestReleasing, index: oldestReleasingIndex };
    }

    let oldestStealable: SourceVoice | null = null;
    let oldestStealableIndex = -1;
    for (let i = 0; i < voices.length; i++) {
      if (voices[i].state === VOICE_STATE.IDLE) {
        continue;
      }
      if (!oldestStealable || voices[i].startTime < oldestStealable.startTime) {
        oldestStealable = voices[i];
        oldestStealableIndex = i;
      }
    }

    return oldestStealable ? { voice: oldestStealable, index: oldestStealableIndex } : null;
  };

  const findVoiceByNote = (note: string): { voice: SourceVoice; index: number } | null => {
    refreshAllVoiceLifecycles();
    const index = voices.findIndex((v) => v.note === note);
    if (index >= 0 && voices[index].initialized) {
      return { voice: voices[index], index };
    }
    return null;
  };

  const triggerEnvAttack = (voiceIndex: number, velocity: number): void => {
    const env = rt.envRuntime as Record<string, unknown> | null;
    if (!env || typeof env.triggerVoiceAttack !== "function") {
      return;
    }
    env.triggerVoiceAttack(voiceIndex, velocity);
  };

  const triggerEnvRelease = (voiceIndex: number): void => {
    const env = rt.envRuntime as Record<string, unknown> | null;
    if (!env || typeof env.triggerVoiceRelease !== "function") {
      return;
    }
    env.triggerVoiceRelease(voiceIndex);
  };

  const rt: SourceRuntime = {
    type: module.type as string,
    category: "source",
    voices,
    definition,
    moduleState,
    hasEnv: false,
    envRuntime: null,
    needsExtendedRelease: false,
    preserveVoiceSlotsForSourceTargets: false,

    get isMono() {
      return getIsMono();
    },

    getModulationOutput: (voiceIndex: number): AudioNode | null => {
      const isMono = getIsMono();
      const index = isMono ? 0 : voiceIndex;
      const voice = getOrInitVoice(index);
      if (!voice || !voice.initialized) {
        return null;
      }
      return (voice.panNode || voice.volumeNode) as AudioNode | null;
    },

    apply: (nextModule: ModuleConfig) => {
      const prevUrl = (moduleState.options as Record<string, unknown>)?.url;
      moduleState = deepClone(nextModule);
      rt.moduleState = moduleState;

      if ((definition as Record<string, unknown>).runtime === "player" && (moduleState.options as Record<string, unknown>)?.url !== prevUrl) {
        if (sharedPlayerBuffer) {
          sharedPlayerBuffer.dispose();
          sharedPlayerBuffer = null;
        }
      }

      refreshAllVoiceLifecycles();
      voices.forEach((voice) => {
        if (!voice.initialized) {
          return;
        }
        const nodeOptions = getNodeOptions((moduleState.options || {}) as Record<string, unknown>, ["gain", "frequencyOffset"]);
        if (voice.volumeNode) {
          rampParam(voice.volumeNode.gain, getSourceOutputGain());
        }
        if (voice.panNode) {
          rampParam(voice.panNode.pan, moduleState.pan as number);
        }

        if ((definition as Record<string, unknown>).runtime === "pitchedSource") {
          const optsForSafeSet = getNodeOptions(nodeOptions, ["frequency"]);
          if (voice.node) {
            safeSet(voice.node, optsForSafeSet);
          }
          if (voice.frequencyOffsetParam) {
            rampParam(voice.frequencyOffsetParam, getFrequencyOffset());
          }
          if ((voice.node as Record<string, unknown>)?.frequency && voice.frequencyBaseSignal) {
            if (moduleState.modulationMode && voice.note) {
              voice.frequencyBaseSignal.rampTo(getBaseFrequencyForNote(voice.note), 0.02);
            }
          }
        } else if ((definition as Record<string, unknown>).runtime === "noise") {
          if (voice.node) {
            safeSet(voice.node, nodeOptions);
          }
        } else if ((definition as Record<string, unknown>).runtime === "player") {
          if (voice.node) {
            safeSet(voice.node, nodeOptions);
            applyPlayerLikeOptions(voice.node as Record<string, unknown>, nodeOptions);
          }
        }
      });
    },

    triggerAttack: (noteData: NoteData, velocity: number, voiceIndex: number): number => {
      if (!moduleState.enabled) {
        return -1;
      }

      if (allVoicesIdleTimeoutId) {
        clearTimeout(allVoicesIdleTimeoutId);
        allVoicesIdleTimeoutId = null;
      }

      const isMono = getIsMono();
      const index = isMono ? 0 : voiceIndex;
      const voice = voices[index];
      const now = Tone.now();

      if (voice.disposeTimeoutId) {
        clearTimeout(voice.disposeTimeoutId);
        voice.disposeTimeoutId = null;
      }

      refreshVoiceLifecycle(voice, now);

      if (voice.note && voice.note !== noteData.originalNote) {
        releaseVoice(voice, index, now);
      }

      if (!voice.initialized) {
        initVoice(index);
      }

      if (voice.state === VOICE_STATE.RELEASING) {
        voice.state = VOICE_STATE.IDLE;
        voice.releaseEndTime = 0;
        voice.idleSince = 0;
      }

      voice.note = noteData.originalNote;
      voice.startTime = now;
      voice.state = VOICE_STATE.ACTIVE;
      voice.releaseEndTime = 0;
      voice.idleSince = 0;

      const effectiveVelocity = (!getVelocityEnabled() || moduleState.modulationMode) ? 1 : velocity;

      if (moduleState.modulationMode) {
        // Skip hiddenEnv trigger in modulation mode
      } else if (rt.hasEnv) {
        triggerEnvAttack(index, effectiveVelocity);
      } else if (rt.needsExtendedRelease) {
        const envAttack = getEnvAttackTime(index);
        if (voice.hiddenEnv) {
          voice.hiddenEnv.attack = envAttack;
          voice.hiddenEnv.triggerAttack(now, effectiveVelocity);
        }
      } else {
        voice.hiddenEnv?.triggerAttack(now, effectiveVelocity);
      }

      const sourceNode = ensureVoiceNode(index);
      if (!sourceNode) {
        releaseVoice(voice, index, now);
        return -1;
      }

      if ((definition as Record<string, unknown>).runtime === "pitchedSource") {
        if ((sourceNode as Record<string, unknown>).frequency) {
          const nextFrequency = noteData.type === "midi"
            ? getBaseFrequencyForNote(noteData.note!)
            : noteData.frequency!;
          voice.frequencyBaseSignal?.rampTo(nextFrequency, 0.02);
        }
      } else if ((definition as Record<string, unknown>).runtime === "player") {
        if (!(sourceNode as Record<string, unknown>).loaded) {
          releaseVoice(voice, index, now);
          return -1;
        }
        if (noteData.type === "midi" && "playbackRate" in sourceNode) {
          (sourceNode as Record<string, unknown>).playbackRate = getPitchRatio(noteData.note!) * Number((moduleState.options as Record<string, unknown>).playbackRate || 1);
        }
        if (!moduleState.modulationMode) {
          try {
            (sourceNode as Record<string, unknown>).stop?.(now);
          } catch {
            // ignore
          }
          (sourceNode as Record<string, unknown>).start?.(now);
        }
      }

      return index;
    },

    triggerRelease: (note: string, voiceIndex: number): void => {
      const isMono = getIsMono();
      const index = isMono ? 0 : voiceIndex;
      const voice = voices[index];
      if (!voice || voice.note !== note) {
        return;
      }
      releaseVoice(voice, index);
    },

    releaseAll: (): void => {
      const now = Tone.now();
      voices.forEach((voice, index) => {
        if (voice.initialized && (voice.note || voice.state !== VOICE_STATE.IDLE)) {
          releaseVoice(voice, index, now);
        }
      });
    },

    getOutputValue: (): number => {
      let latestValue = 0;
      voices.forEach((voice) => {
        if (!voice.initialized || !voice.volumeNode) return;

        if (!voice.analyser) {
          voice.analyser = new Tone.Analyser("waveform", 256);
          voice.volumeNode.connect(voice.analyser);
        }

        try {
          const waveform = voice.analyser.getValue() as Float32Array;
          if (waveform && waveform.length > 0) {
            latestValue = waveform[waveform.length - 1];
          }
        } catch {
          // ignore
        }
      });
      return latestValue;
    },

    updateVoiceFrequency: (voiceIndex: number, noteOrFrequency: string | number): void => {
      const voice = voices[voiceIndex];
      if (!voice || !voice.initialized) return;
      if ((definition as Record<string, unknown>).runtime === "pitchedSource" && voice.frequencyBaseSignal) {
        const nextFrequency = typeof noteOrFrequency === "number"
          ? noteOrFrequency
          : Tone.Frequency(noteOrFrequency).toFrequency();
        voice.frequencyBaseSignal.rampTo(nextFrequency, 0.02);
      }
    },

    resetVoice: (voiceIndex: number): void => {
      const isMono = getIsMono();
      const index = isMono ? 0 : voiceIndex;
      const voice = voices[index];
      if (!voice || !voice.initialized) return;

      const now = Tone.now();

      if (voice.state === VOICE_STATE.ACTIVE) {
        releaseVoice(voice, index, now);
      }

      if (voice.hiddenEnv) {
        voice.hiddenEnv.cancel(now);
        const output = (voice.hiddenEnv as Record<string, unknown>).output as { gain?: { setValueAtTime(value: number, time: number): void } } | undefined;
        if (output?.gain) {
          output.gain.setValueAtTime(0, now);
        }
      }

      if (voice.disposeTimeoutId) {
        clearTimeout(voice.disposeTimeoutId);
        voice.disposeTimeoutId = null;
      }

      if (voice.state === VOICE_STATE.RELEASING) {
        voice.state = VOICE_STATE.IDLE;
        voice.releaseEndTime = 0;
        voice.idleSince = 0;
      }
    },

    dispose: (): void => {
      if (allVoicesIdleTimeoutId) {
        clearTimeout(allVoicesIdleTimeoutId);
        allVoicesIdleTimeoutId = null;
      }
      voices.forEach((voice) => {
        if (voice.initialized) {
          disposeVoiceNode(voice);
        }
      });
      if (sharedPlayerBuffer) {
        sharedPlayerBuffer.dispose();
        sharedPlayerBuffer = null;
      }
    },
  };

  rt.apply(moduleState);

  return rt;
}
