import * as Tone from "tone";
import {
  deepClone,
  safeSet,
  rampParam,
  applyPlayerLikeOptions,
  SOURCE_LIBRARY,
} from "../utils/helpers.js";

export function createNoteVoiceTracker(voiceCount) {
  const voiceStates = Array.from({ length: voiceCount }, () => ({
    note: null,
    startTime: 0,
  }));

  const findAvailableVoice = () => {
    let oldest = null;
    let oldestIndex = -1;
    for (let i = 0; i < voiceStates.length; i++) {
      if (!voiceStates[i].note) {
        return i;
      }
      if (!oldest || voiceStates[i].startTime < oldest.startTime) {
        oldest = voiceStates[i];
        oldestIndex = i;
      }
    }
    return oldest ? oldestIndex : 0;
  };

  return {
    allocate(note, time) {
      const index = findAvailableVoice();
      voiceStates[index].note = note;
      voiceStates[index].startTime = time;
      return index;
    },
    releaseByNote(note) {
      const index = voiceStates.findIndex((item) => item.note === note);
      if (index < 0) {
        return -1;
      }
      voiceStates[index].note = null;
      return index;
    },
    clearAll() {
      voiceStates.forEach((item) => {
        item.note = null;
        item.startTime = 0;
      });
    },
    hasActiveNotes() {
      return voiceStates.some((item) => item.note !== null);
    },
  };
}

export function createSourceRuntime({
  module,
  getVelocityEnabled = () => true,
}) {
  const definition = SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator;
  let moduleState = deepClone(module);
  const VOICE_COUNT = 8;
  const PLAYER_IDLE_DISPOSE_SECONDS = 6;
  const VOICE_INDEX_RESERVE_SECONDS = 10;
  const VOICE_STATE = {
    IDLE: "idle",
    ACTIVE: "active",
    RELEASING: "releasing",
  };

  const getFrequencyOffset = () => {
    const offset = Number(moduleState?.options?.frequencyOffset);
    if (!Number.isFinite(offset)) {
      return 1;
    }
    return Math.max(0, Math.min(2, offset));
  };

  const getNoteFrequency = (note) => Tone.Frequency(note).toFrequency();
  const getBaseFrequencyForNote = (note) => {
    let frequency = getNoteFrequency(note);
    const octave = Number(moduleState?.options?.octave) || 0;
    if (octave !== 0) {
      frequency *= Math.pow(2, octave);
    }
    return frequency;
  };
  const getPitchRatio = (note) => {
    const root = Tone.Frequency(moduleState.rootNote || "C4").toFrequency();
    return (getBaseFrequencyForNote(note) * getFrequencyOffset()) / root;
  };
  const getModulationFrequency = () => {
    const configuredFrequency = Number(moduleState?.options?.frequency);
    if (Number.isFinite(configuredFrequency) && configuredFrequency > 0) {
      return configuredFrequency;
    }

    const legacyFrequency = Number(moduleState?.modulationFrequency);
    if (Number.isFinite(legacyFrequency) && legacyFrequency > 0) {
      return legacyFrequency;
    }

    return 1;
  };

  const getNodeOptions = (options = {}) => {
    const { gain, frequencyOffset, ...nodeOptions } = options || {};
    return nodeOptions;
  };

  const getPitchedNodeOptions = (options = {}) => {
    const { frequency, ...nodeOptions } = getNodeOptions(options);
    return nodeOptions;
  };

  const getSourceOutputGain = () => {
    if (moduleState.modulationMode) {
      if (!moduleState.enabled) {
        return 0;
      }
      const depth = Number(moduleState?.options?.gain);
      return Number.isFinite(depth) ? Math.max(0, depth) : 1;
    }
    return Tone.dbToGain(moduleState.enabled ? moduleState.volume : -48);
  };

  const createVoice = () => {
    const volumeNode = new Tone.Gain(getSourceOutputGain());
    const isModulationMode = moduleState.modulationMode;
    let panNode = null;

    const hiddenAmpEnv = new Tone.AmplitudeEnvelope({
      attack: 0.005,
      decay: 0.01,
      sustain: 1,
      release: 0.005,
    });

    if (isModulationMode) {
      volumeNode.connect(hiddenAmpEnv);
    } else {
      panNode = new Tone.Panner(module.pan);
      volumeNode.connect(panNode);
      panNode.connect(hiddenAmpEnv);
    }

    let node;
    if (definition.runtime === "pitchedSource") {
      node = new Tone[module.type](getPitchedNodeOptions(module.options));
      node.connect(volumeNode);
      node.start();
    } else if (definition.runtime === "noise") {
      node = new Tone.Noise(getNodeOptions(module.options));
      node.connect(volumeNode);
      node.start();
    } else if (definition.runtime === "player") {
      const nodeOptions = getNodeOptions(moduleState.options);
      node = new Tone.Player(nodeOptions);
      applyPlayerLikeOptions(node, nodeOptions);
      node.connect(volumeNode);
    } else {
      node = new Tone.Oscillator(getNodeOptions(module.options));
      node.connect(volumeNode);
      node.start();
    }

    return {
      node,
      volumeNode,
      panNode,
      frequencyBaseSignal: null,
      frequencyOffsetParam: null,
      frequencyMultiply: null,
      hiddenAmpEnv,
      note: null,
      startTime: 0,
      state: VOICE_STATE.IDLE,
      releaseEndTime: 0,
      idleSince: 0,
    };
  };

  const voices = Array.from({ length: VOICE_COUNT }, createVoice);

  if (definition.runtime === "pitchedSource") {
    voices.forEach((voice) => {
      if (!voice.node?.frequency) {
        return;
      }
      voice.frequencyBaseSignal = new Tone.Signal(getModulationFrequency());
      voice.frequencyOffsetParam = new Tone.Signal(getFrequencyOffset());
      voice.frequencyMultiply = new Tone.Multiply(1);
      voice.frequencyBaseSignal.connect(voice.frequencyMultiply);
      voice.frequencyOffsetParam.connect(voice.frequencyMultiply.factor);
      if ("value" in voice.node.frequency) {
        voice.node.frequency.value = 0;
      }
      voice.frequencyMultiply.connect(voice.node.frequency);
    });
  }

  const createPlayerNodeForVoice = (voice) => {
    const nodeOptions = getNodeOptions(moduleState.options);
    const playerNode = new Tone.Player(nodeOptions);
    applyPlayerLikeOptions(playerNode, nodeOptions);
    playerNode.connect(voice.volumeNode);
    voice.node = playerNode;
    return playerNode;
  };

  const disposeVoiceNode = (voice) => {
    if (!voice.node || typeof voice.node.dispose !== "function") {
      voice.node = null;
      return;
    }
    voice.node.dispose();
    voice.node = null;
  };

  const ensureVoiceNode = (voice) => {
    if (definition.runtime !== "player") {
      return voice.node;
    }
    if (voice.node) {
      return voice.node;
    }
    return createPlayerNodeForVoice(voice);
  };

  const getVoiceReleaseDuration = (voice, voiceIndex) => {
    if (runtime.preserveVoiceSlotsForSourceTargets && moduleState.modulationMode && moduleState.midiOn) {
      return VOICE_INDEX_RESERVE_SECONDS;
    }

    if (runtime.hasAmpEnv) {
      const ampEnvVoice = runtime.ampEnvRuntime?.voices?.[voiceIndex];
      const release = Number(ampEnvVoice?.release);
      if (Number.isFinite(release) && release >= 0) {
        return release;
      }
    }

    const hiddenRelease = Number(voice.hiddenAmpEnv?.release);
    if (Number.isFinite(hiddenRelease) && hiddenRelease >= 0) {
      return hiddenRelease;
    }

    return 0.01;
  };

  const refreshVoiceLifecycle = (voice, now = Tone.now()) => {
    if (voice.state === VOICE_STATE.RELEASING && now >= voice.releaseEndTime) {
      voice.state = VOICE_STATE.IDLE;
      voice.releaseEndTime = 0;
      voice.idleSince = now;
      if (!voice.note) {
        voice.startTime = 0;
      }
    }

    if (voice.state === VOICE_STATE.IDLE && voice.note) {
      voice.state = VOICE_STATE.ACTIVE;
      voice.idleSince = 0;
    }

    if (
      definition.runtime === "player"
      && voice.state === VOICE_STATE.IDLE
      && voice.node
      && voice.idleSince > 0
      && now - voice.idleSince >= PLAYER_IDLE_DISPOSE_SECONDS
    ) {
      disposeVoiceNode(voice);
    }
  };

  const refreshAllVoiceLifecycles = (now = Tone.now()) => {
    voices.forEach((voice) => {
      refreshVoiceLifecycle(voice, now);
    });
  };

  const scheduleVoiceRelease = (voice, voiceIndex, now = Tone.now()) => {
    voice.state = VOICE_STATE.RELEASING;
    voice.releaseEndTime = now + getVoiceReleaseDuration(voice, voiceIndex);
    voice.idleSince = 0;
  };

  const releaseVoice = (voice, voiceIndex, now = Tone.now()) => {
    const hadAssignedNote = voice.note !== null;
    voice.note = null;

    if (runtime.hasAmpEnv) {
      triggerAmpEnvRelease(voiceIndex);
    } else {
      voice.hiddenAmpEnv.triggerRelease(now);
    }

    if (definition.runtime === "player") {
      if (voice.node) {
        try {
          voice.node.stop(now);
        } catch {}
      }
    }

    if (hadAssignedNote || voice.state !== VOICE_STATE.IDLE) {
      scheduleVoiceRelease(voice, voiceIndex, now);
    } else {
      refreshVoiceLifecycle(voice, now);
    }
  };

  const findAvailableVoice = () => {
    const now = Tone.now();
    refreshAllVoiceLifecycles(now);

    for (let i = 0; i < voices.length; i++) {
      if (voices[i].state === VOICE_STATE.IDLE && !voices[i].note) {
        return { voice: voices[i], index: i };
      }
    }

    let oldestStealable = null;
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

  const findVoiceByNote = (note) => {
    refreshAllVoiceLifecycles();
    const index = voices.findIndex((v) => v.note === note);
    return index >= 0 ? { voice: voices[index], index } : null;
  };

  const triggerAmpEnvAttack = (voiceIndex, velocity) => {
    const ampEnv = runtime.ampEnvRuntime;
    if (!ampEnv || typeof ampEnv.triggerVoiceAttack !== "function") {
      return;
    }
    ampEnv.triggerVoiceAttack(voiceIndex, velocity);
  };

  const triggerAmpEnvRelease = (voiceIndex) => {
    const ampEnv = runtime.ampEnvRuntime;
    if (!ampEnv || typeof ampEnv.triggerVoiceRelease !== "function") {
      return;
    }
    ampEnv.triggerVoiceRelease(voiceIndex);
  };

  const getActiveVoiceCount = () => voices.filter((v) => v.note !== null).length;

  const updateHiddenAmpEnvRelease = () => {
    if (!runtime.needsExtendedRelease) {
      return;
    }
    const activeCount = getActiveVoiceCount();
    const releaseTime = activeCount <= 1 ? 10 : 0.005;
    voices.forEach((voice) => {
      voice.hiddenAmpEnv.release = releaseTime;
    });
  };

  const runtime = {
    type: module.type,
    category: "source",
    voices,
    definition,
    moduleState,
    hasAmpEnv: false,
    ampEnvRuntime: null,
    needsExtendedRelease: false,
    preserveVoiceSlotsForSourceTargets: false,

    getModulationOutput: (voiceIndex) => {
      const voice = voices[voiceIndex];
      return voice ? (voice.panNode || voice.volumeNode) : null;
    },

    apply: (nextModule) => {
      moduleState = deepClone(nextModule);
      runtime.moduleState = moduleState;
      refreshAllVoiceLifecycles();
      voices.forEach((voice) => {
        const nodeOptions = getNodeOptions(moduleState.options);
        rampParam(voice.volumeNode.gain, getSourceOutputGain());
        if (voice.panNode) {
          rampParam(voice.panNode.pan, moduleState.pan);
        }

        if (definition.runtime === "pitchedSource") {
          const optsForSafeSet = getPitchedNodeOptions(nodeOptions);
          safeSet(voice.node, optsForSafeSet);
          if (voice.frequencyOffsetParam) {
            rampParam(voice.frequencyOffsetParam, getFrequencyOffset());
          }
          if (moduleState.modulationMode && voice.node.frequency) {
            if (moduleState.midiOn && voice.note) {
              const nextFrequency = getBaseFrequencyForNote(voice.note);
              voice.frequencyBaseSignal?.rampTo(nextFrequency, 0.02);
            } else if (!moduleState.midiOn) {
              voice.frequencyBaseSignal?.rampTo(getModulationFrequency(), 0.02);
            }
          }
        } else if (definition.runtime === "noise") {
          safeSet(voice.node, nodeOptions);
        } else if (definition.runtime === "player") {
          if (voice.node) {
            safeSet(voice.node, nodeOptions);
            applyPlayerLikeOptions(voice.node, nodeOptions);
          }
        }
      });
    },

    triggerAttack: (note, velocity) => {
      if (!moduleState.enabled) {
        return;
      }
      const result = findAvailableVoice();
      if (!result) {
        return;
      }
      const { voice, index } = result;
      const now = Tone.now();

      if (voice.note && voice.note !== note) {
        releaseVoice(voice, index, now);
      }

      voice.note = note;
      voice.startTime = now;
      voice.state = VOICE_STATE.ACTIVE;
      voice.releaseEndTime = 0;
      voice.idleSince = 0;

      const effectiveVelocity = (!getVelocityEnabled() || moduleState.modulationMode) ? 1 : velocity;

      if (runtime.hasAmpEnv) {
        triggerAmpEnvAttack(index, effectiveVelocity);
      } else {
        voice.hiddenAmpEnv.triggerAttack(now, effectiveVelocity);
      }

      if (definition.runtime === "pitchedSource") {
        if (voice.node.frequency) {
          const useMidiPitch = !moduleState.modulationMode || moduleState.midiOn;
          const nextFrequency = useMidiPitch
            ? getBaseFrequencyForNote(note)
            : getModulationFrequency();
          voice.frequencyBaseSignal?.rampTo(nextFrequency, 0.02);
        }
      } else if (definition.runtime === "player") {
        const playerNode = ensureVoiceNode(voice);
        if (!playerNode || !playerNode.loaded) {
          releaseVoice(voice, index, now);
          updateHiddenAmpEnvRelease();
          return;
        }
        if ("playbackRate" in playerNode) {
          playerNode.playbackRate = getPitchRatio(note) * Number(moduleState.options.playbackRate || 1);
        }
        try {
          playerNode.stop(now);
        } catch {}
        playerNode.start(now);
      }
      updateHiddenAmpEnvRelease();
    },

    triggerRelease: (note) => {
      const result = findVoiceByNote(note);
      if (!result) {
        return;
      }
      const { voice, index } = result;
      releaseVoice(voice, index);
      updateHiddenAmpEnvRelease();
    },

    releaseAll: () => {
      const now = Tone.now();
      voices.forEach((voice, index) => {
        if (voice.note || voice.state !== VOICE_STATE.IDLE) {
          releaseVoice(voice, index, now);
        }
      });
      updateHiddenAmpEnvRelease();
    },

    dispose: () => {
      voices.forEach((voice) => {
        if (voice.node && typeof voice.node.dispose === "function") {
          voice.node.dispose();
        }
        voice.volumeNode.dispose();
        if (voice.panNode) {
          voice.panNode.dispose();
        }
        if (voice.frequencyBaseSignal) {
          voice.frequencyBaseSignal.dispose();
        }
        if (voice.frequencyOffsetParam) {
          voice.frequencyOffsetParam.dispose();
        }
        if (voice.frequencyMultiply) {
          voice.frequencyMultiply.dispose();
        }
        voice.hiddenAmpEnv.dispose();
      });
    },
  };

  runtime.apply(moduleState);

  return runtime;
}

export function createEnvelopeModulationRuntime(module) {
  let moduleState = deepClone(module);
  const VOICE_COUNT = 8;
  const getEnvelopeOptions = (options = {}) => {
    const { gain, ...envelopeOptions } = options || {};
    return envelopeOptions;
  };
  const getDepthGain = (options = {}) => Number(options?.gain ?? 1);
  const voices = Array.from({ length: VOICE_COUNT }, () => new Tone.Envelope(getEnvelopeOptions(moduleState.options)));
  const outputGains = Array.from({ length: VOICE_COUNT }, () => new Tone.Gain(getDepthGain(moduleState.options)));
  voices.forEach((env, index) => env.connect(outputGains[index]));
  const noteTracker = createNoteVoiceTracker(VOICE_COUNT);

  return {
    type: module.type,
    category: "modulation-envelope",
    voices,
    outputGains,
    moduleState,
    getModulationOutput: (voiceIndex) => outputGains[voiceIndex] || null,
    apply: (nextModule) => {
      moduleState = deepClone(nextModule);
      const envelopeOptions = getEnvelopeOptions(moduleState.options);
      const gainValue = getDepthGain(moduleState.options);
      voices.forEach((env) => safeSet(env, envelopeOptions));
      outputGains.forEach((gainNode) => rampParam(gainNode.gain, gainValue));
    },
    triggerAttack: (note, velocity) => {
      if (!moduleState.enabled) {
        return;
      }
      const index = noteTracker.allocate(note, Tone.now());
      voices[index].triggerAttack(Tone.now(), velocity);
    },
    triggerRelease: (note) => {
      const index = noteTracker.releaseByNote(note);
      if (index < 0) {
        return;
      }
      voices[index].triggerRelease(Tone.now());
    },
    releaseAll: () => {
      noteTracker.clearAll();
      voices.forEach((env) => {
        env.triggerRelease(Tone.now());
      });
    },
    dispose: () => {
      voices.forEach((env) => env.dispose());
      outputGains.forEach((gainNode) => gainNode.dispose());
    },
  };
}

export function createAmplitudeEnvelopeRuntime(module) {
  const VOICE_COUNT = 8;
  const voices = Array.from({ length: VOICE_COUNT }, () => new Tone.AmplitudeEnvelope(module.options));
  const node = new Tone.AmplitudeEnvelope(module.options);
  const voiceRefCount = new Array(VOICE_COUNT).fill(0);
  const nodeNoteTracker = createNoteVoiceTracker(VOICE_COUNT);

  return {
    type: module.type,
    category: module.category || "component",
    voices,
    voiceRefCount,
    node,
    apply: (nextModule) => {
      voices.forEach((env) => safeSet(env, nextModule.options));
      safeSet(node, nextModule.options);
    },
    triggerVoiceAttack: (voiceIndex, velocity) => {
      if (voiceIndex < 0 || voiceIndex >= VOICE_COUNT) return;
      voiceRefCount[voiceIndex] += 1;
      if (voiceRefCount[voiceIndex] === 1) {
        voices[voiceIndex].triggerAttack(Tone.now(), velocity);
      }
    },
    triggerVoiceRelease: (voiceIndex) => {
      if (voiceIndex < 0 || voiceIndex >= VOICE_COUNT) return;
      voiceRefCount[voiceIndex] = Math.max(0, voiceRefCount[voiceIndex] - 1);
      if (voiceRefCount[voiceIndex] === 0) {
        voices[voiceIndex].triggerRelease(Tone.now());
      }
    },
    triggerAttack: (note, velocity) => {
      nodeNoteTracker.allocate(note, Tone.now());
      node.triggerAttack(Tone.now(), 1);
    },
    triggerRelease: (note) => {
      const releasedIndex = nodeNoteTracker.releaseByNote(note);
      if (releasedIndex >= 0 && !nodeNoteTracker.hasActiveNotes()) {
        node.triggerRelease(Tone.now());
      }
    },
    releaseAll: () => {
      nodeNoteTracker.clearAll();
      node.triggerRelease(Tone.now());
      voices.forEach((env, index) => {
        voiceRefCount[index] = 0;
        env.triggerRelease(Tone.now());
      });
    },
    dispose: () => {
      voices.forEach((env) => env.dispose());
      node.dispose();
    },
  };
}
