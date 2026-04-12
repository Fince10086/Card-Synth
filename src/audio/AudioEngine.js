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
    this.analyser = new Tone.Analyser("waveform", 1024);

    this.masterVolume.toDestination();
    this.masterVolume.connect(this.analyser);

    this.rebuildSignalChain();
    
    // 调用 ModulationManager 连接调制
    if (this.app && this.app.modulationManager) {
      this.app.modulationManager.connectModulations(this.state.modules || []);
    }
  }

  getAnalyser() {
    return this.analyser;
  }

  fullSync(state) {
    this.state = deepClone(state);
    if (!this.ready) {
      return;
    }

    rampParam(this.masterVolume.volume, state.global.volume);
    this.silenceAll();
    this.rebuildSignalChain();
    
    // 调用 ModulationManager 连接调制
    if (this.app && this.app.modulationManager) {
      this.app.modulationManager.connectModulations(this.state.modules || []);
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

  rebuildSignalChain() {
    if (!this.masterVolume) {
      return;
    }

    this.moduleRuntimes.forEach((runtime) => {
      if (runtime.dispose) {
        runtime.dispose();
      }
    });
    this.moduleRuntimes.clear();

    const modules = this.state.modules || [];
    if (modules.length === 0) {
      return;
    }

    modules.forEach((module) => {
      const runtime = this.createModuleRuntime(module);
      this.moduleRuntimes.set(module.id, runtime);
    });

    this.connectSignalChain(modules);
  }

  connectSignalChain(modules) {
    const ampEnvIndices = new Set();
    modules.forEach((module, index) => {
      if (this.isAmpEnvModule(module) && module.enabled) {
        ampEnvIndices.add(index);
      }
    });

    modules.forEach((module, index) => {
      const runtime = this.moduleRuntimes.get(module.id);
      if (!runtime || !module.enabled) {
        return;
      }

      if (this.isSourceModule(module)) {
        this.connectSourceModule(modules, index, runtime, ampEnvIndices);
      } else {
        this.connectNonSourceModule(modules, index, runtime);
      }
    });
  }

  connectSourceModule(modules, sourceIndex, runtime, ampEnvIndices) {
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
      const ampEnvRuntime = this.moduleRuntimes.get(ampEnvModule.id);
      runtime.ampEnvRuntime = ampEnvRuntime;

      runtime.voices.forEach((voice, i) => {
        if (ampEnvRuntime && ampEnvRuntime.voices && ampEnvRuntime.voices[i]) {
          voice.panNode.connect(ampEnvRuntime.voices[i]);
        }
      });
    } else {
      runtime.ampEnvRuntime = null;

      let targetNode;
      if (targetIndex >= 0) {
        const targetModule = modules[targetIndex];
        const targetRuntime = this.moduleRuntimes.get(targetModule.id);
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

  connectNonSourceModule(modules, moduleIndex, runtime) {
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
        const targetRuntime = this.moduleRuntimes.get(targetModule.id);
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
      const targetRuntime = this.moduleRuntimes.get(targetModule.id);
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

    const getNoteFrequency = (note) => Tone.Frequency(note).toFrequency();
    const getPitchRatio = (note) => {
      const root = Tone.Frequency(moduleState.rootNote || "C4").toFrequency();
      return getNoteFrequency(note) / root;
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

    const createVoice = () => {
      const volumeNode = new Tone.Gain(Tone.dbToGain(module.enabled ? module.volume : -48));
      const panNode = new Tone.Panner(module.pan);
      volumeNode.connect(panNode);

      const hiddenAmpEnv = new Tone.AmplitudeEnvelope({
        attack: 0.005,
        decay: 0.01,
        sustain: 1,
        release: 0.005,
      });
      panNode.connect(hiddenAmpEnv);

      let node;
      if (definition.runtime === "pitchedSource") {
        node = new Tone[module.type](module.options);
        node.connect(volumeNode);
        node.start();
      } else if (definition.runtime === "noise") {
        node = new Tone.Noise(module.options);
        node.connect(volumeNode);
        node.start();
      } else if (definition.runtime === "player") {
        node = new Tone.Player(moduleState.options);
        applyPlayerLikeOptions(node, moduleState.options);
        node.connect(volumeNode);
      } else {
        node = new Tone.Oscillator(module.options);
        node.connect(volumeNode);
        node.start();
      }

      return {
        node,
        volumeNode,
        panNode,
        hiddenAmpEnv,
        note: null,
        startTime: 0,
      };
    };

    const voices = Array.from({ length: VOICE_COUNT }, createVoice);

    const findAvailableVoice = () => {
      let oldest = null;
      let oldestIndex = -1;
      for (let i = 0; i < voices.length; i++) {
        if (!voices[i].note) {
          return { voice: voices[i], index: i };
        }
        if (!oldest || voices[i].startTime < oldest.startTime) {
          oldest = voices[i];
          oldestIndex = i;
        }
      }
      return oldest ? { voice: oldest, index: oldestIndex } : null;
    };

    const findVoiceByNote = (note) => {
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
        return voice ? voice.panNode : null;
      },

      apply: (nextModule) => {
        moduleState = deepClone(nextModule);
        voices.forEach((voice) => {
          rampParam(voice.volumeNode.gain, Tone.dbToGain(moduleState.enabled ? moduleState.volume : -48));
          rampParam(voice.panNode.pan, moduleState.pan);

          if (definition.runtime === "pitchedSource") {
            safeSet(voice.node, moduleState.options);
            if (moduleState.modulationMode && voice.node.frequency) {
              voice.node.frequency.rampTo(getModulationFrequency(), 0.02);
            }
          } else if (definition.runtime === "noise") {
            safeSet(voice.node, moduleState.options);
          } else if (definition.runtime === "player") {
            safeSet(voice.node, moduleState.options);
            applyPlayerLikeOptions(voice.node, moduleState.options);
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

        voice.note = note;
        voice.startTime = Tone.now();

        const effectiveVelocity = moduleState.modulationMode ? 1 : velocity;

        if (runtime.hasAmpEnv) {
          triggerAmpEnvAttack(index, effectiveVelocity);
        } else {
          voice.hiddenAmpEnv.triggerAttack(Tone.now(), effectiveVelocity);
        }

        if (definition.runtime === "pitchedSource") {
          if (voice.node.frequency) {
            const nextFrequency = moduleState.modulationMode
              ? getModulationFrequency()
              : getNoteFrequency(note);
            voice.node.frequency.rampTo(nextFrequency, 0.02);
          }
        } else if (definition.runtime === "noise") {
        } else if (definition.runtime === "player") {
          if (!voice.node.loaded) {
            voice.note = null;
            if (runtime.hasAmpEnv) {
              triggerAmpEnvRelease(index);
            } else {
              voice.hiddenAmpEnv.triggerRelease(Tone.now());
            }
            updateHiddenAmpEnvRelease();
            return;
          }
          if ("playbackRate" in voice.node) {
            voice.node.playbackRate = getPitchRatio(note) * Number(moduleState.options.playbackRate || 1);
          }
          try {
            voice.node.stop(Tone.now());
          } catch {}
          voice.node.start(Tone.now());
        }
        updateHiddenAmpEnvRelease();
      },

      triggerRelease: (note) => {
        const result = findVoiceByNote(note);
        if (!result) {
          return;
        }
        const { voice, index } = result;
        voice.note = null;

        if (runtime.hasAmpEnv) {
          triggerAmpEnvRelease(index);
        } else {
          voice.hiddenAmpEnv.triggerRelease(Tone.now());
        }

        if (definition.runtime === "pitchedSource") {
        } else if (definition.runtime === "noise") {
        } else if (definition.runtime === "player") {
          try {
            voice.node.stop(Tone.now());
          } catch {}
        }
        updateHiddenAmpEnvRelease();
      },

      releaseAll: () => {
        voices.forEach((voice, index) => {
          if (voice.note) {
            voice.note = null;
            if (runtime.hasAmpEnv) {
              triggerAmpEnvRelease(index);
            } else {
              voice.hiddenAmpEnv.triggerRelease(Tone.now());
            }
          }
          if (definition.runtime === "player") {
            try {
              voice.node.stop(Tone.now());
            } catch {}
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
          voice.panNode.dispose();
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
    const voices = Array.from({ length: VOICE_COUNT }, () => new Tone.Envelope(moduleState.options));
    const noteTracker = this.createNoteVoiceTracker(VOICE_COUNT);

    return {
      type: module.type,
      category: "modulation-envelope",
      voices,
      moduleState,
      getModulationOutput: (voiceIndex) => voices[voiceIndex] || null,
      apply: (nextModule) => {
        moduleState = deepClone(nextModule);
        voices.forEach((env) => safeSet(env, moduleState.options));
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

  updateModule(moduleId, updates) {
    const moduleIndex = this.state.modules.findIndex((m) => m.id === moduleId);
    if (moduleIndex < 0) {
      return;
    }

    this.state.modules[moduleIndex] = { ...this.state.modules[moduleIndex], ...updates };

    if (!this.ready) {
      return;
    }

    const runtime = this.moduleRuntimes.get(moduleId);
    if (runtime && runtime.apply) {
      runtime.apply(this.state.modules[moduleIndex]);
    }
  }

  updateSource(module) {
    this.updateModule(module.id, module);
  }

  updateComponent(module) {
    const moduleIndex = this.state.modules.findIndex((m) => m.id === module.id);
    if (moduleIndex >= 0) {
      this.state.modules[moduleIndex] = deepClone(module);
    }
    if (this.ready) {
      this.rebuildSignalChain();
    }
  }

  updateEffect(module) {
    this.updateComponent(module);
  }

  attack(note, velocity) {
    if (!this.ready) {
      return;
    }

    this.activeNotes.add(note);

    this.moduleRuntimes.forEach((runtime) => {
      if ((runtime.category === "source" || runtime.category === "modulation-envelope") && runtime.triggerAttack) {
        runtime.triggerAttack(note, velocity);
      }
    });

    this.moduleRuntimes.forEach((runtime) => {
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

    this.moduleRuntimes.forEach((runtime) => {
      if ((runtime.category === "source" || runtime.category === "modulation-envelope") && runtime.triggerRelease) {
        runtime.triggerRelease(note);
      }
    });

    this.moduleRuntimes.forEach((runtime) => {
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

    this.moduleRuntimes.forEach((runtime) => {
      if ((runtime.category === "source" || runtime.category === "modulation-envelope") && runtime.releaseAll) {
        runtime.releaseAll();
      }
    });

    this.moduleRuntimes.forEach((runtime) => {
      if (runtime.type === "AmplitudeEnvelope" && runtime.node && runtime.releaseAll) {
        runtime.releaseAll();
      }
    });
  }
}
