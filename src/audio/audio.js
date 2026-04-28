import * as Tone from "tone";
import {
  deepClone,
  safeSet,
  rampParam,
  SOURCE_LIBRARY,
  INPUT_LIBRARY,
} from "../utils/helpers.js";
import { createSourceRuntime } from "./runtimes/sourceRuntime.js";
import { createEnvelopeRuntime } from "./runtimes/envelopeRuntime.js";
import { createEffectRuntime } from "./runtimes/effectRuntime.js";
import { createInputRuntime } from "./runtimes/inputRuntime.js";
import { connectSignalChain } from "./chain/signalChain.js";

const HIDDEN_MIDI_INPUT_ID = "__hidden_midi_input__";

export class AudioEngine {
  constructor(app) {
    this.app = app;
    this.ready = false;
    this.state = null;

    this.chainRuntimes = new Map();
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
    return module.category === "source" || SOURCE_LIBRARY[module.type] !== undefined;
  }

  isAmpEnvModule(module) {
    return module.type === "Envelope" && module.modulationMode !== true;
  }

  isInputModule(module) {
    return module.category === "input" || INPUT_LIBRARY[module.type] !== undefined;
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

      // 1. 创建所有显式模块的 runtime
      modules.forEach((module, index) => {
        const runtime = this.createModuleRuntime(module, chainIndex, modules, index);
        runtimeMap.set(module.id, runtime);
      });

      // 2. 创建 Input runtimes（包括隐藏的 MIDI Input）
      const inputIndices = [];
      modules.forEach((module, index) => {
        if (this.isInputModule(module)) {
          inputIndices.push(index);
        }
      });

      // 如果没有显式 Input 但链中有 Source 或 Envelope，创建隐藏 MIDI Input
      const hasSourcesOrEnvelopes = modules.some((m) =>
        m.category === "source" || m.type === "Envelope"
      );

      if (hasSourcesOrEnvelopes && inputIndices.length === 0) {
        // 在链头创建隐藏 MIDI Input
        const hiddenMidiModule = {
          id: HIDDEN_MIDI_INPUT_ID,
          type: "MIDI",
          category: "input",
          enabled: true,
          options: { transpose: 0, octave: 0, polyVoice: 8, pedal: false },
        };
        const hiddenInputRuntime = createInputRuntime(hiddenMidiModule, modules, -1);
        runtimeMap.set(HIDDEN_MIDI_INPUT_ID, hiddenInputRuntime);
      }

      // 3. 为所有 Input 创建 runtime（显式和隐藏）
      const allInputIndices = inputIndices.length > 0
        ? inputIndices
        : (hasSourcesOrEnvelopes ? [-1] : []);

      allInputIndices.forEach((inputIndex) => {
        let inputModule;
        let actualIndex;

        if (inputIndex === -1) {
          inputModule = {
            id: HIDDEN_MIDI_INPUT_ID,
            type: "MIDI",
            category: "input",
            enabled: true,
            options: { transpose: 0, octave: 0, polyVoice: 8, pedal: false },
          };
          actualIndex = -1;
        } else {
          inputModule = modules[inputIndex];
          actualIndex = inputIndex;
        }

        const inputRuntime = createInputRuntime(inputModule, modules, actualIndex);
        runtimeMap.set(inputModule.id, inputRuntime);
      });

      // 4. 连接信号链
      connectSignalChain({
        modules,
        runtimeMap,
        masterVolume: this.masterVolume,
        isSourceModule: (m) => this.isSourceModule(m),
        isAmpEnvModule: (m) => this.isAmpEnvModule(m),
        isInputModule: (m) => this.isInputModule(m),
      });

      this.chainRuntimes.set(chainIndex, runtimeMap);
    });

    this.refreshCurrentRuntimeAlias();
  }

  createModuleRuntime(module, chainIndex, chainModules, moduleIndex) {
    if (module.type === "Envelope") {
      return createEnvelopeRuntime(module);
    }
    if (this.isSourceModule(module)) {
      return this.createSourceRuntime(module, chainIndex);
    }
    if (this.isInputModule(module)) {
      return createInputRuntime(module, chainModules, moduleIndex);
    }
    return createEffectRuntime(module);
  }

  createSourceRuntime(module, chainIndex) {
    return createSourceRuntime({
      module,
      getVelocityEnabled: () => Boolean(this.state?.global?.velocityEnabled),
      onAllVoicesIdle: () => this.rebuildSignalChains(),
      onVoiceDisposed: (voiceIndex) => {
        setTimeout(() => {
          this.app?.modulationManager?.disconnectVoiceModulations?.(chainIndex, module.id, voiceIndex);
        }, 0);
      },
      onVoiceInitialized: (voiceIndex) => {
        setTimeout(() => {
          this.app?.modulationManager?.connectVoiceModulations?.(chainIndex, module.id, voiceIndex);
        }, 0);
      },
    });
  }

  /**
   * 获取链中所有 Input（包括隐藏），按位置排序
   */
  getChainInputs(chainIndex, runtimeMap) {
    const chain = this.getChainState(chainIndex);
    const modules = Array.isArray(chain?.modules) ? chain.modules : [];

    const inputs = [];

    // 检查是否有隐藏 MIDI Input
    const hiddenInput = runtimeMap.get(HIDDEN_MIDI_INPUT_ID);
    if (hiddenInput) {
      inputs.push({ runtime: hiddenInput, index: -1, id: HIDDEN_MIDI_INPUT_ID });
    }

    // 收集显式 Input
    modules.forEach((module, index) => {
      if (this.isInputModule(module)) {
        const runtime = runtimeMap.get(module.id);
        if (runtime) {
          inputs.push({ runtime, index, id: module.id });
        }
      }
    });

    // 按位置排序（隐藏的在最前）
    inputs.sort((a, b) => a.index - b.index);

    return inputs;
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

      // Input 模块 pedal off 后，处理待释放的音符
      if (runtime.category === "input" && runtime.pendingReleasedNotes?.length > 0) {
        const runtimeMap = this.getChainRuntimeMap(chainIndex);
        const pendingNotes = runtime.pendingReleasedNotes;
        runtime.pendingReleasedNotes = []; // 清空队列

        pendingNotes.forEach(({ note, voiceIndex }) => {
          const controlled = runtime.getControlledModules();

          // 通知 Source release
          controlled.sources.forEach((sourceId) => {
            const sourceRuntime = runtimeMap.get(sourceId);
            if (sourceRuntime && typeof sourceRuntime.triggerRelease === "function") {
              sourceRuntime.triggerRelease(note, voiceIndex);
            }
          });

          // 通知 Envelope release
          controlled.envelopes.forEach((envInfo) => {
            const envRuntime = runtimeMap.get(envInfo.id);
            if (!envRuntime) {
              return;
            }

            if (envInfo.type === "AmplitudeEnvelope") {
              if (envRuntime.hasPerVoiceConnection) {
                envRuntime.triggerVoiceRelease(voiceIndex);
              } else {
                envRuntime.triggerRelease(note);
              }
            } else if (envInfo.type === "Envelope") {
              if (typeof envRuntime.triggerVoiceRelease === "function") {
                envRuntime.triggerVoiceRelease(voiceIndex);
              } else {
                envRuntime.triggerRelease(note);
              }
            }
          });
        });
      }
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

    this.chainRuntimes.forEach((runtimeMap, chainIndex) => {
      const chain = this.getChainState(chainIndex);
      if (!chain?.enabled) {
        return;
      }

      // 获取该链的所有 Input（包括隐藏），按位置排序
      const inputs = this.getChainInputs(chainIndex, runtimeMap);

      inputs.forEach((input) => {
        const result = input.runtime.triggerAttack(note, velocity);
        if (!result) {
          return;
        }

        const { voiceIndex, noteData, isRetrigger, controlledSources, controlledEnvelopes } = result;

        // 延续音：不重新触发 Attack
        if (isRetrigger) {
          return;
        }

        // 触发控制范围内的所有 Source
        controlledSources.forEach((sourceId) => {
          const sourceRuntime = runtimeMap.get(sourceId);
          if (sourceRuntime && typeof sourceRuntime.triggerAttack === "function") {
            sourceRuntime.triggerAttack(noteData, velocity, voiceIndex);
          }
        });

        // 触发控制范围内的所有 Envelope
        controlledEnvelopes.forEach((envInfo) => {
          const envRuntime = runtimeMap.get(envInfo.id);
          if (!envRuntime) {
            return;
          }

          if (envRuntime.modulationMode) {
            envRuntime.triggerVoiceAttack(voiceIndex, velocity);
          } else if (envRuntime.hasPerVoiceConnection) {
            envRuntime.triggerVoiceAttack(voiceIndex, velocity);
          } else {
            envRuntime.triggerAttack(note, velocity);
          }
        });
      });
    });
  }

  release(note) {
    if (!this.ready) {
      return;
    }

    this.activeNotes.delete(note);

    this.chainRuntimes.forEach((runtimeMap, chainIndex) => {
      const chain = this.getChainState(chainIndex);
      if (!chain?.enabled) {
        return;
      }

      const inputs = this.getChainInputs(chainIndex, runtimeMap);

      inputs.forEach((input) => {
        const releaseResult = input.runtime.triggerRelease(note);
        if (!releaseResult || !releaseResult.released) {
          return;
        }

        const { voiceIndex } = releaseResult;

        // 获取控制范围（因为 Input 可能在 release 后重新计算）
        const controlled = input.runtime.getControlledModules();

        // 通知 Source release
        controlled.sources.forEach((sourceId) => {
          const sourceRuntime = runtimeMap.get(sourceId);
          if (sourceRuntime && typeof sourceRuntime.triggerRelease === "function") {
            sourceRuntime.triggerRelease(note, voiceIndex);
          }
        });

        // 通知 Envelope release
        controlled.envelopes.forEach((envInfo) => {
          const envRuntime = runtimeMap.get(envInfo.id);
          if (!envRuntime) {
            return;
          }

            if (envRuntime.modulationMode) {
              envRuntime.triggerVoiceRelease(voiceIndex);
            } else if (envRuntime.hasPerVoiceConnection) {
              envRuntime.triggerVoiceRelease(voiceIndex);
            } else {
              envRuntime.triggerRelease(note);
            }
        });
      });
    });
  }

  silenceAll() {
    this.activeNotes.clear();
    if (!this.ready) {
      return;
    }

    this.chainRuntimes.forEach((runtimeMap, chainIndex) => {
      const chain = this.getChainState(chainIndex);
      if (!chain?.enabled) {
        return;
      }

      const inputs = this.getChainInputs(chainIndex, runtimeMap);

      // 先让 Input 释放所有 voice
      inputs.forEach((input) => {
        const released = input.runtime.releaseAll();
        released.forEach(({ note, voiceIndex }) => {
          const controlled = input.runtime.getControlledModules();

          controlled.sources.forEach((sourceId) => {
            const sourceRuntime = runtimeMap.get(sourceId);
            if (sourceRuntime && typeof sourceRuntime.triggerRelease === "function") {
              sourceRuntime.triggerRelease(note, voiceIndex);
            }
          });

          controlled.envelopes.forEach((envInfo) => {
            const envRuntime = runtimeMap.get(envInfo.id);
            if (!envRuntime) {
              return;
            }

            if (envInfo.type === "AmplitudeEnvelope") {
              if (envRuntime.hasPerVoiceConnection) {
                envRuntime.triggerVoiceRelease(voiceIndex);
              } else {
                envRuntime.triggerRelease(note);
              }
            } else if (envInfo.type === "Envelope") {
              if (typeof envRuntime.triggerVoiceRelease === "function") {
                envRuntime.triggerVoiceRelease(voiceIndex);
              } else {
                envRuntime.triggerRelease(note);
              }
            }
          });
        });
      });

      // 释放所有未通过 Input 触发的 runtime（保险措施）
      runtimeMap.forEach((runtime, moduleId) => {
        if (runtime.type === "Envelope" && runtime.releaseAll) {
          runtime.releaseAll();
        }
        if (runtime.category === "source" && runtime.releaseAll) {
          runtime.releaseAll();
        }
      });
    });
  }
}
