import * as Tone from "tone";
import {
  deepClone,
  safeSet,
  rampParam,
  SOURCE_LIBRARY,
} from "../utils/helpers.js";
import {
  createSourceRuntime,
  createEnvelopeModulationRuntime,
  createAmplitudeEnvelopeRuntime,
} from "./voiceManager.js";

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
    console.log("[AudioEngine] Rebuilding signal chains...");
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

    runtime.hasAmpEnv = isFirstModuleAmpEnv;

    if (isFirstModuleAmpEnv) {
      const ampEnvModule = modules[targetIndex];
      const ampEnvRuntime = runtimeMap.get(ampEnvModule.id);
      runtime.ampEnvRuntime = ampEnvRuntime;

      runtime.voices.forEach((voice, i) => {
        if (voice.initialized && ampEnvRuntime && ampEnvRuntime.voices && ampEnvRuntime.voices[i]) {
          const outputNode = voice.panNode || voice.hiddenAmpEnv;
          outputNode.connect(ampEnvRuntime.voices[i]);
        }
      });
    } else {
      runtime.ampEnvRuntime = null;

      if (needsExtendedRelease) {
        for (let i = sourceIndex + 1; i < modules.length; i++) {
          if (ampEnvIndices.has(i)) {
            const ampEnvModule = modules[i];
            runtime.chainedAmpEnvRuntime = runtimeMap.get(ampEnvModule.id);
            break;
          }
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

      runtime.voices.forEach((voice) => {
        if (targetNode && voice.initialized && voice.hiddenAmpEnv) {
          voice.hiddenAmpEnv.connect(targetNode);
        }
      });

      // 存储 targetNode 供懒加载的 voice 使用
      runtime.targetNode = targetNode;
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
    return createSourceRuntime({
      module,
      getVelocityEnabled: () => Boolean(this.state?.global?.velocityEnabled),
      onAllVoicesIdle: () => this.rebuildSignalChains(),
      onVoiceDisposed: () => {
        // Voice dispose 后重建调制连接（因为 sourceOutput 节点已改变）
        this.app?.modulationManager?.connectAllModulations?.();
      },
    });
  }

  createEnvelopeModulationRuntime(module) {
    return createEnvelopeModulationRuntime(module);
  }

  createEffectRuntime(module) {
    if (module.type === "AmplitudeEnvelope") {
      return createAmplitudeEnvelopeRuntime(module);
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
