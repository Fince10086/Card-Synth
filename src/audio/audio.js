import * as Tone from "tone";
import {
  deepClone,
  safeSet,
  rampParam,
  clamp,
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
    const prevPolyVoice = this.state?.global?.polyVoice;
    this.state.global = deepClone(globalState);
    if (!this.ready) {
      return;
    }
    rampParam(this.masterVolume.volume, globalState.volume);

    // PolyVoice 变化时通知所有 Input runtime 调整 voice 数量
    if (globalState.polyVoice !== prevPolyVoice) {
      this.chainRuntimes.forEach((runtimeMap) => {
        runtimeMap.forEach((runtime) => {
          if (runtime.category === "input" && runtime.apply) {
            runtime.apply(runtime.moduleState);
            this._flushInputPendingNotes(runtime, runtimeMap);
          }
        });
      });
    }
  }

  isSourceModule(module) {
    return module.category === "source" || SOURCE_LIBRARY[module.type] !== undefined;
  }

  isEnvModule(module) {
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

      // 1. 创建所有非 Input 显式模块的 runtime
      // Input 在第 3 步单独处理，避免创建无效的 fallback runtime
      modules.forEach((module, index) => {
        if (this.isInputModule(module)) {
          return;
        }
        const runtime = this.createModuleRuntime(module, chainIndex, modules, index);
        runtimeMap.set(module.id, runtime);
      });

      // 2. 创建 Input runtimes（包括隐藏的 MIDI Input，只处理启用的）
      const inputIndices = [];
      modules.forEach((module, index) => {
        if (this.isInputModule(module) && module.enabled) {
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
          type: "Pitch",
          category: "input",
          enabled: true,
          options: { mode: "midi", transpose: 0, octave: 0, frequency: 440, mono: false, pedal: false },
        };
        const hiddenInputRuntime = createInputRuntime(
          hiddenMidiModule,
          modules,
          -1,
          () => clamp(Number(this.state?.global?.polyVoice) || 8, 2, 8),
        );
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
            type: "Pitch",
            category: "input",
            enabled: true,
            options: { mode: "midi", transpose: 0, octave: 0, frequency: 440, mono: false, pedal: false },
          };
          actualIndex = -1;
        } else {
          inputModule = modules[inputIndex];
          actualIndex = inputIndex;
        }

        const inputRuntime = createInputRuntime(
          inputModule,
          modules,
          actualIndex,
          () => clamp(Number(this.state?.global?.polyVoice) || 8, 2, 8),
        );
        runtimeMap.set(inputModule.id, inputRuntime);
      });

      // 4. 连接信号链
      connectSignalChain({
        modules,
        runtimeMap,
        masterVolume: this.masterVolume,
        isSourceModule: (m) => this.isSourceModule(m),
        isEnvModule: (m) => this.isEnvModule(m),
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
    return createEffectRuntime(module);
  }

  createSourceRuntime(module, chainIndex) {
    return createSourceRuntime({
      module,
      getVelocityEnabled: () => Boolean(this.state?.global?.velocityEnabled),
      onAllVoicesIdle: () => this.rebuildSignalChains(),
      onVoiceDisposed: (voiceIndex) => {
        this.app?.modulationManager?.disconnectVoiceModulations?.(chainIndex, module.id, voiceIndex);
      },
      onVoiceInitialized: (voiceIndex) => {
        this.app?.modulationManager?.connectVoiceModulations?.(chainIndex, module.id, voiceIndex);
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

    // 收集显式 Input（只包含启用的）
    modules.forEach((module, index) => {
      if (this.isInputModule(module) && module.enabled) {
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

  _flushInputPendingNotes(runtime, runtimeMap) {
    // Input 模块 polyVoice 缩小后，处理待释放的音符
    if (runtime.category === "input" && runtime.pendingReleasedNotes?.length > 0) {
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

          if (envRuntime.modulationMode) {
            envRuntime.triggerVoiceRelease(voiceIndex);
          } else if (envRuntime.hasPerVoiceConnection) {
            envRuntime.triggerVoiceRelease(voiceIndex);
          } else {
            envRuntime.triggerRelease(note);
          }
        });
      });
    }

    // Input 模块 transpose/octave 改变后，更新 Source 频率
    if (runtime.category === "input" && runtime.pendingNoteUpdates?.length > 0) {
      const pendingUpdates = runtime.pendingNoteUpdates;
      runtime.pendingNoteUpdates = []; // 清空队列

      pendingUpdates.forEach(({ voiceIndex, transformedNote }) => {
        const controlled = runtime.getControlledModules();

        // 通知 Source 更新频率
        controlled.sources.forEach((sourceId) => {
          const sourceRuntime = runtimeMap.get(sourceId);
          if (sourceRuntime && typeof sourceRuntime.updateVoiceFrequency === "function") {
            sourceRuntime.updateVoiceFrequency(voiceIndex, transformedNote);
          }
        });
      });
    }

    // Input 模块 frequency 改变后，更新 Source 频率
    if (runtime.category === "input" && runtime.pendingFreqUpdates?.length > 0) {
      const pendingUpdates = runtime.pendingFreqUpdates;
      runtime.pendingFreqUpdates = []; // 清空队列

      pendingUpdates.forEach(({ voiceIndex, frequency }) => {
        const controlled = runtime.getControlledModules();

        // 通知 Source 更新频率
        controlled.sources.forEach((sourceId) => {
          const sourceRuntime = runtimeMap.get(sourceId);
          if (sourceRuntime && typeof sourceRuntime.updateVoiceFrequency === "function") {
            sourceRuntime.updateVoiceFrequency(voiceIndex, frequency);
          }
        });
      });
    }
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
    const runtimeMap = this.getChainRuntimeMap(chainIndex);
    if (runtime && runtime.apply) {
      runtime.apply(modules[moduleIndex]);
      this._flushInputPendingNotes(runtime, runtimeMap);
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

        const { voiceIndex, noteData, isRetrigger, stolenNote, controlledSources, controlledEnvelopes } = result;

        // 延续音：不重新触发 Attack
        if (isRetrigger) {
          return;
        }

        // 如果发生了 voice stealing，先释放旧 note
        if (stolenNote) {
          const inputNote = stolenNote;
          const inputVoiceIndex = voiceIndex;

          // 通知 Source release
          controlledSources.forEach((sourceId) => {
            const sourceRuntime = runtimeMap.get(sourceId);
            if (sourceRuntime && typeof sourceRuntime.triggerRelease === "function") {
              sourceRuntime.triggerRelease(inputNote, inputVoiceIndex);
            }
          });

          // 通知 Envelope release
          controlledEnvelopes.forEach((envInfo) => {
            const envRuntime = runtimeMap.get(envInfo.id);
            if (!envRuntime) {
              return;
            }

            if (envRuntime.modulationMode) {
              envRuntime.triggerVoiceRelease(inputVoiceIndex);
            } else if (envRuntime.hasPerVoiceConnection) {
              envRuntime.triggerVoiceRelease(inputVoiceIndex);
            } else {
              envRuntime.triggerRelease(inputNote);
            }
          });
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
