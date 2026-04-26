import * as Tone from "tone";
import {
  deepClone,
  safeSet,
  rampParam,
  SOURCE_LIBRARY,
} from "../utils/helpers.js";
import { createSourceRuntime } from "./runtimes/sourceRuntime.js";
import { createEnvelopeModulationRuntime } from "./runtimes/envelopeModulationRuntime.js";
import { createEffectRuntime } from "./runtimes/effectRuntime.js";
import { connectSignalChain } from "./chain/signalChain.js";

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

    // Downmix stereo master output to mono before analysers so the
    // oscilloscope displays the combined L+R signal instead of left channel only.
    this.scopeMonoMix = new Tone.Gain(1);
    this.scopeMonoMix.input.channelCount = 1;
    this.scopeMonoMix.input.channelCountMode = 'explicit';

    this.masterVolume.connect(this.scopeMonoMix);
    this.scopeMonoMix.connect(this.analyser);
    this.scopeMonoMix.connect(this.spectrumAnalyser);

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
    console.log("[Audio] Rebuilding signal chains...");
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
        const runtime = this.createModuleRuntime(module, chainIndex);
        runtimeMap.set(module.id, runtime);
      });

      connectSignalChain({
        modules,
        runtimeMap,
        masterVolume: this.masterVolume,
        isSourceModule: (m) => this.isSourceModule(m),
        isAmpEnvModule: (m) => this.isAmpEnvModule(m),
      });

      this.chainRuntimes.set(chainIndex, runtimeMap);
    });

    this.refreshCurrentRuntimeAlias();
  }

  createModuleRuntime(module, chainIndex) {
    if (module.type === "Envelope") {
      return this.createEnvelopeModulationRuntime(module);
    }
    if (this.isSourceModule(module)) {
      return this.createSourceRuntime(module, chainIndex);
    }
    return createEffectRuntime(module);
  }

  createSourceRuntime(module, chainIndex) {
    return createSourceRuntime({
      module,
      getVelocityEnabled: () => Boolean(this.state?.global?.velocityEnabled),
      onAllVoicesIdle: () => this.rebuildSignalChains(),
      onVoiceDisposed: (voiceIndex) => {
        // Voice dispose 后增量清理调制连接（延迟到下一帧避免阻塞音频线程）
        setTimeout(() => {
          this.app?.modulationManager?.disconnectVoiceModulations?.(chainIndex, module.id, voiceIndex);
        }, 0);
      },
      onVoiceInitialized: (voiceIndex) => {
        // Voice 初始化后增量建立调制连接（延迟到下一帧避免阻塞音频线程）
        setTimeout(() => {
          this.app?.modulationManager?.connectVoiceModulations?.(chainIndex, module.id, voiceIndex);
        }, 0);
      },
    });
  }

  createEnvelopeModulationRuntime(module) {
    return createEnvelopeModulationRuntime(module);
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

    console.log(`[AudioEngine] attack note=${note} vel=${velocity}`);
    this.activeNotes.add(note);

    // 对于有 source-to-source 调制的 chain，统一分配 voice index
    // 确保 modulation source 和 target source 使用相同的 voice
    const assignedVoices = new Map(); // key: `${chainIndex}:${moduleId}` -> voiceIndex

    this.chainRuntimes.forEach((runtimeMap, chainIndex) => {
      const chain = this.getChainState(chainIndex);
      if (!chain?.enabled) {
        return;
      }

      const modulations = Array.isArray(chain.modulations) ? chain.modulations : [];
      const modules = Array.isArray(chain.modules) ? chain.modules : [];

      // 收集 source-to-source 调制连接
      const sourceToSourceMods = modulations.filter((mod) => {
        const targetModule = modules.find((m) => m.id === mod.targetModuleId);
        return targetModule && this.isSourceModule(targetModule);
      });

      if (sourceToSourceMods.length === 0) {
        return;
      }

      // 按 target 分组，收集所有调制该 target 的 sources
      const targetToSources = new Map();
      sourceToSourceMods.forEach((mod) => {
        if (!targetToSources.has(mod.targetModuleId)) {
          targetToSources.set(mod.targetModuleId, new Set());
        }
        targetToSources.get(mod.targetModuleId).add(mod.sourceModuleId);
      });

      const processedInChain = new Set();

      targetToSources.forEach((sources, targetId) => {
        if (processedInChain.has(targetId)) {
          return;
        }

        const targetRuntime = runtimeMap.get(targetId);
        if (!targetRuntime || typeof targetRuntime.triggerAttack !== "function") {
          return;
        }

        const voiceIndex = targetRuntime.triggerAttack(note, velocity);
        if (typeof voiceIndex !== "number" || voiceIndex < 0) {
          return;
        }

        processedInChain.add(targetId);
        assignedVoices.set(`${chainIndex}:${targetId}`, voiceIndex);

        sources.forEach((sourceId) => {
          if (processedInChain.has(sourceId)) {
            return;
          }
          const sourceRuntime = runtimeMap.get(sourceId);
          if (sourceRuntime && typeof sourceRuntime.triggerAttack === "function") {
            sourceRuntime.triggerAttack(note, velocity, voiceIndex);
            processedInChain.add(sourceId);
            assignedVoices.set(`${chainIndex}:${sourceId}`, voiceIndex);
          }
        });
      });
    });

    // 触发剩余的 source 和 modulation-envelope
    this.forEachRuntime((runtime, chainIndex, moduleId) => {
      const key = `${chainIndex}:${moduleId}`;
      if (assignedVoices.has(key)) {
        return;
      }

      if ((runtime.category === "source" || runtime.category === "modulation-envelope") && runtime.triggerAttack) {
        console.log(`[AudioEngine] triggerAttack on chain=${chainIndex} module=${moduleId} type=${runtime.type}`);
        const voiceIdx = runtime.triggerAttack(note, velocity);
        console.log(`[AudioEngine] triggerAttack result voiceIdx=${voiceIdx}`);
      }
    });

    // 触发 AmplitudeEnvelope
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
