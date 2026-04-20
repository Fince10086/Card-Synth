import * as Tone from "tone";
import {
  deepClone,
  safeSet,
  rampParam,
  getByPath,
  applyPlayerLikeOptions,
  SOURCE_LIBRARY,
} from "../utils/helpers.js";

export class AudioEngine {
  constructor(app) {
    this.app = app;
    this.ready = false;
    this.state = null;

    this.chainRuntimes = new Map();
    // Backward-compatible reference for callers that still expect current-chain map.
    this.moduleRuntimes = new Map();

    this.activeNotes = new Set();
  }

  async start(state) {
    if (this.ready) {
      return;
    }

    await Tone.start();
    Tone.context.lookAhead = 0;
    this.state = deepClone(state);
    this.ready = true;

    this.masterVolume = new Tone.Volume(state.global.volume);
    this.limiter = new Tone.Limiter(-10);
    this.analyser = new Tone.Analyser("waveform", 1024);
    this.spectrumAnalyser = new Tone.Analyser("fft", 2048);

    this.masterVolume.connect(this.limiter);
    this.limiter.toDestination();
    this.masterVolume.connect(this.analyser);
    this.masterVolume.connect(this.spectrumAnalyser);

    this.rebuildSignalChains();

    if (this.app && this.app.modulationManager) {
      this.app.modulationManager.connectAllModulations();
    }
  }

  getAnalyser() {
    return this.analyser;
  }

  getSpectrumAnalyser() {
    return this.spectrumAnalyser;
  }

  fullSync(state) {
    this.state = deepClone(state);
    if (!this.ready) {
      return;
    }

    rampParam(this.masterVolume.volume, state.global.volume);
    this.silenceAll();
    this.rebuildSignalChains();

    if (this.app && this.app.modulationManager) {
      this.app.modulationManager.connectAllModulations();
    }
  }

  updateGlobal(globalState) {
    this.state.global = deepClone(globalState);
    if (!this.ready) {
      return;
    }
    rampParam(this.masterVolume.volume, globalState.volume);
  }

  isSourceModule(module) {
    return module.type === "Envelope" || module.category === "source" || SOURCE_LIBRARY[module.type] !== undefined;
  }

  isAmpEnvModule(module) {
    return module.type === "AmplitudeEnvelope";
  }

  createNoteVoiceTracker(voiceCount) {
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

  getChainState(chainIndex) {
    const chains = Array.isArray(this.state?.chains) ? this.state.chains : [];
    return chains[chainIndex] || { enabled: false, modules: [], modulations: [] };
  }

  getChainRuntimeMap(chainIndex) {
    return this.chainRuntimes.get(chainIndex) || null;
  }

  getModuleRuntime(chainIndex, moduleId) {
    const map = this.getChainRuntimeMap(chainIndex);
    return map ? map.get(moduleId) || null : null;
  }

  disposeRuntimeMap(runtimeMap) {
    if (!runtimeMap) {
      return;
    }
    runtimeMap.forEach((runtime) => {
      if (runtime.dispose) {
        runtime.dispose();
      }
    });
    runtimeMap.clear();
  }

  refreshCurrentRuntimeAlias() {
    const selectedChain = this.app?.getSelectedChainIndex?.() ?? 0;
    this.moduleRuntimes = this.getChainRuntimeMap(selectedChain) || new Map();
  }

  rebuildSignalChains() {
    if (!this.masterVolume) {
      return;
    }

    this.chainRuntimes.forEach((runtimeMap) => {
      this.disposeRuntimeMap(runtimeMap);
    });
    this.chainRuntimes.clear();

    const chains = Array.isArray(this.state?.chains) ? this.state.chains : [];
    chains.forEach((chain, chainIndex) => {
      const modules = Array.isArray(chain?.modules) ? chain.modules : [];
      if (!chain?.enabled || !modules.length) {
        return;
      }

      const runtimeMap = new Map();
      modules.forEach((module) => {
        const runtime = this.createModuleRuntime(module);
        runtimeMap.set(module.id, runtime);
      });

      this.connectSignalChain(modules, runtimeMap);
      this.chainRuntimes.set(chainIndex, runtimeMap);
    });

    this.refreshCurrentRuntimeAlias();
  }

  connectSignalChain(modules, runtimeMap) {
    const ampEnvIndices = new Set();
    modules.forEach((module, index) => {
      if (this.isAmpEnvModule(module) && module.enabled) {
        ampEnvIndices.add(index);
      }
    });

    modules.forEach((module, index) => {
      const runtime = runtimeMap.get(module.id);
      if (!runtime || !module.enabled) {
        return;
      }

      if (this.isSourceModule(module)) {
        this.connectSourceModule(modules, index, runtime, ampEnvIndices, runtimeMap);
      } else {
        this.connectNonSourceModule(modules, index, runtime, runtimeMap);
      }
    });
  }

  connectSourceModule(modules, sourceIndex, runtime, ampEnvIndices, runtimeMap) {
    const sourceModule = modules[sourceIndex];
    if (sourceModule?.type === "Envelope") {
      return;
    }

    if (sourceModule?.modulationMode) {
      return;
    }

    let targetIndex = -1;
    for (let i = sourceIndex + 1; i < modules.length; i++) {
      if (!this.isSourceModule(modules[i]) && modules[i].enabled) {
        targetIndex = i;
        break;
      }
    }

    const isFirstModuleAmpEnv = targetIndex >= 0 && ampEnvIndices.has(targetIndex);

    let hasAmpEnvAnywhere = false;
    for (let i = sourceIndex + 1; i < modules.length; i++) {
      if (ampEnvIndices.has(i)) {
        hasAmpEnvAnywhere = true;
        break;
      }
    }

    const needsExtendedRelease = hasAmpEnvAnywhere && !isFirstModuleAmpEnv;
    runtime.needsExtendedRelease = needsExtendedRelease;
    runtime.voices.forEach((voice) => {
      voice.hiddenAmpEnv.release = needsExtendedRelease ? 10 : 0.005;
    });

    runtime.hasAmpEnv = isFirstModuleAmpEnv;

    if (isFirstModuleAmpEnv) {
      const ampEnvModule = modules[targetIndex];
      const ampEnvRuntime = runtimeMap.get(ampEnvModule.id);
      runtime.ampEnvRuntime = ampEnvRuntime;

      runtime.voices.forEach((voice, i) => {
        if (ampEnvRuntime && ampEnvRuntime.voices && ampEnvRuntime.voices[i]) {
          const outputNode = voice.panNode || voice.hiddenAmpEnv;
          outputNode.connect(ampEnvRuntime.voices[i]);
        }
      });
    } else {
      runtime.ampEnvRuntime = null;

      let targetNode;
      if (targetIndex >= 0) {
        const targetModule = modules[targetIndex];
        const targetRuntime = runtimeMap.get(targetModule.id);
        targetNode = targetRuntime && targetRuntime.node;
      } else {
        targetNode = this.masterVolume;
      }

      runtime.voices.forEach((voice) => {
        if (targetNode) {
          voice.hiddenAmpEnv.connect(targetNode);
        }
      });
    }
  }

  connectNonSourceModule(modules, moduleIndex, runtime, runtimeMap) {
    if (runtime.type === "AmplitudeEnvelope") {
      let targetIndex = -1;
      for (let i = moduleIndex + 1; i < modules.length; i++) {
        if (!this.isSourceModule(modules[i]) && modules[i].enabled) {
          targetIndex = i;
          break;
        }
      }

      let targetNode;
      if (targetIndex >= 0) {
        const targetModule = modules[targetIndex];
        const targetRuntime = runtimeMap.get(targetModule.id);
        targetNode = targetRuntime && targetRuntime.node;
      } else {
        targetNode = this.masterVolume;
      }

      if (targetNode) {
        if (runtime.node) {
          runtime.node.connect(targetNode);
        }
        if (runtime.voices) {
          runtime.voices.forEach((env) => env.connect(targetNode));
        }
      }
      return;
    }

    let targetIndex = -1;
    for (let i = moduleIndex + 1; i < modules.length; i++) {
      if (!this.isSourceModule(modules[i]) && modules[i].enabled) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex >= 0) {
      const targetModule = modules[targetIndex];
      const targetRuntime = runtimeMap.get(targetModule.id);
      if (targetRuntime && targetRuntime.node) {
        runtime.node.connect(targetRuntime.node);
      }
    } else {
      runtime.node.connect(this.masterVolume);
    }
  }

  createModuleRuntime(module) {
    if (module.type === "Envelope") {
      return this.createEnvelopeModulationRuntime(module);
    }
    if (this.isSourceModule(module)) {
      return this.createSourceRuntime(module);
    }
    return this.createEffectRuntime(module);
  }

  createSourceRuntime(module) {
    const definition = SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator;
    let moduleState = deepClone(module);
    const VOICE_COUNT = 8;
    const PLAYER_IDLE_DISPOSE_SECONDS = 6;
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

      getModulationOutput: (voiceIndex) => {
        const voice = voices[voiceIndex];
        return voice ? (voice.panNode || voice.volumeNode) : null;
      },

      apply: (nextModule) => {
        moduleState = deepClone(nextModule);
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

        const effectiveVelocity = (!this.state.global.velocityEnabled || moduleState.modulationMode) ? 1 : velocity;

        if (runtime.hasAmpEnv) {
          triggerAmpEnvAttack(index, effectiveVelocity);
        } else {
          voice.hiddenAmpEnv.triggerAttack(now, effectiveVelocity);
        }

        if (definition.runtime === "pitchedSource") {
          if (voice.node.frequency) {
            const useMidiPitch = !moduleState.modulationMode || moduleState.midiOn;
            let nextFrequency = useMidiPitch
              ? getBaseFrequencyForNote(note)
              : getModulationFrequency();
            voice.frequencyBaseSignal?.rampTo(nextFrequency, 0.02);
          }
        } else if (definition.runtime === "noise") {
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

  createEnvelopeModulationRuntime(module) {
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
    const noteTracker = this.createNoteVoiceTracker(VOICE_COUNT);

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
        voices.forEach((env, index) => {
          env.triggerRelease(Tone.now());
        });
      },
      dispose: () => {
        voices.forEach((env) => env.dispose());
        outputGains.forEach((gainNode) => gainNode.dispose());
      },
    };
  }



  createEffectRuntime(module) {
    if (module.type === "AmplitudeEnvelope") {
      const VOICE_COUNT = 8;
      const voices = Array.from({ length: VOICE_COUNT }, () => new Tone.AmplitudeEnvelope(module.options));
      const node = new Tone.AmplitudeEnvelope(module.options);
      const voiceRefCount = new Array(VOICE_COUNT).fill(0);
      const nodeNoteTracker = this.createNoteVoiceTracker(VOICE_COUNT);

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

    const RuntimeCtor = Tone[module.type];
    if (!RuntimeCtor) {
      return {
        type: module.type,
        category: module.category || "component",
        node: null,
        dispose: () => {},
      };
    }

    const node = new RuntimeCtor(module.options);

    if (typeof node.start === "function") {
      node.start();
    }
    if (typeof node.generate === "function") {
      node.generate();
    }

    return {
      type: module.type,
      category: module.category || "component",
      node,
      apply: (nextModule) => {
        safeSet(node, nextModule.options);
      },
      dispose: () => {
        if (node && typeof node.dispose === "function") {
          node.dispose();
        }
      },
    };
  }

  forEachRuntime(callback) {
    this.chainRuntimes.forEach((runtimeMap, chainIndex) => {
      runtimeMap.forEach((runtime, moduleId) => {
        callback(runtime, chainIndex, moduleId);
      });
    });
  }

  updateModule(moduleId, updates, chainIndex = this.app?.getSelectedChainIndex?.() ?? 0) {
    const chain = this.getChainState(chainIndex);
    const modules = Array.isArray(chain.modules) ? chain.modules : [];
    const moduleIndex = modules.findIndex((m) => m.id === moduleId);
    if (moduleIndex < 0) {
      return;
    }

    modules[moduleIndex] = { ...modules[moduleIndex], ...updates };

    if (!this.ready) {
      return;
    }

    const runtime = this.getModuleRuntime(chainIndex, moduleId);
    if (runtime && runtime.apply) {
      runtime.apply(modules[moduleIndex]);
    }
  }

  updateSource(module, chainIndex = this.app?.getSelectedChainIndex?.() ?? 0) {
    this.updateModule(module.id, module, chainIndex);
  }

  updateComponent(module, chainIndex = this.app?.getSelectedChainIndex?.() ?? 0) {
    const chain = this.getChainState(chainIndex);
    const modules = Array.isArray(chain.modules) ? chain.modules : [];
    const moduleIndex = modules.findIndex((m) => m.id === module.id);
    if (moduleIndex >= 0) {
      modules[moduleIndex] = deepClone(module);
    }
    if (this.ready) {
      this.rebuildSignalChains();
      this.app?.modulationManager?.connectAllModulations?.();
    }
  }

  updateEffect(module, chainIndex = this.app?.getSelectedChainIndex?.() ?? 0) {
    this.updateComponent(module, chainIndex);
  }

  attack(note, velocity) {
    if (!this.ready) {
      return;
    }

    this.activeNotes.add(note);

    this.forEachRuntime((runtime) => {
      if ((runtime.category === "source" || runtime.category === "modulation-envelope") && runtime.triggerAttack) {
        runtime.triggerAttack(note, velocity);
      }
    });

    this.forEachRuntime((runtime) => {
      if (runtime.type === "AmplitudeEnvelope" && runtime.node && runtime.triggerAttack) {
        runtime.triggerAttack(note, velocity);
      }
    });
  }

  release(note) {
    if (!this.ready) {
      return;
    }

    this.activeNotes.delete(note);

    this.forEachRuntime((runtime) => {
      if ((runtime.category === "source" || runtime.category === "modulation-envelope") && runtime.triggerRelease) {
        runtime.triggerRelease(note);
      }
    });

    this.forEachRuntime((runtime) => {
      if (runtime.type === "AmplitudeEnvelope" && runtime.node && runtime.triggerRelease) {
        runtime.triggerRelease(note);
      }
    });
  }

  silenceAll() {
    this.activeNotes.clear();
    if (!this.ready) {
      return;
    }

    this.forEachRuntime((runtime) => {
      if ((runtime.category === "source" || runtime.category === "modulation-envelope") && runtime.releaseAll) {
        runtime.releaseAll();
      }
    });

    this.forEachRuntime((runtime) => {
      if (runtime.type === "AmplitudeEnvelope" && runtime.node && runtime.releaseAll) {
        runtime.releaseAll();
      }
    });
  }
}
