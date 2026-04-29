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
const HIDDEN_VOICES_ID = "__hidden_voices__";

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

    // PolyVoice 变化时通知所有 VoiceManager 调整 voice 数量
    if (globalState.polyVoice !== prevPolyVoice) {
      this.chainRuntimes.forEach((runtimeMap) => {
        runtimeMap.forEach((runtime) => {
          if (runtime.isVoiceManager && runtime.apply) {
            runtime.apply(runtime.moduleState);
            this._flushInputPendingNotes(runtime, runtimeMap, [], -1);
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

      // 2. 检查是否有显式 Voices 和 Pitch
      const hasExplicitVoices = modules.some((m) => m.type === "Voices" && m.enabled);
      const hasExplicitPitch = modules.some((m) => m.type === "Pitch" && m.enabled);
      const hasSourcesOrEnvelopes = modules.some((m) =>
        m.category === "source" || m.type === "Envelope"
      );

      // 如果没有显式 Voices 但链中有 Source 或 Envelope，创建隐藏 Voices
      if (hasSourcesOrEnvelopes && !hasExplicitVoices) {
        const hiddenVoicesModule = {
          id: HIDDEN_VOICES_ID,
          type: "Voices",
          category: "input",
          enabled: true,
          options: { mono: false },
        };
        const hiddenVoicesRuntime = createInputRuntime(
          hiddenVoicesModule,
          modules,
          -1,
          () => clamp(Number(this.state?.global?.polyVoice) || 8, 2, 8),
        );
        runtimeMap.set(HIDDEN_VOICES_ID, hiddenVoicesRuntime);
      }

      // 如果没有显式 Pitch 但链中有 Source 或 Envelope，创建隐藏 Pitch（MIDI 模式）
      if (hasSourcesOrEnvelopes && !hasExplicitPitch) {
        const hiddenMidiModule = {
          id: HIDDEN_MIDI_INPUT_ID,
          type: "Pitch",
          category: "input",
          enabled: true,
          options: { mode: "midi", transpose: 0, octave: 0, frequency: 440 },
        };
        const hiddenInputRuntime = createInputRuntime(
          hiddenMidiModule,
          modules,
          -1,
          () => clamp(Number(this.state?.global?.polyVoice) || 8, 2, 8),
        );
        runtimeMap.set(HIDDEN_MIDI_INPUT_ID, hiddenInputRuntime);
      }

      // 3. 为所有显式 Input 创建 runtime
      modules.forEach((module, index) => {
        if (this.isInputModule(module) && module.enabled) {
          const inputRuntime = createInputRuntime(
            module,
            modules,
            index,
            () => clamp(Number(this.state?.global?.polyVoice) || 8, 2, 8),
          );
          runtimeMap.set(module.id, inputRuntime);
        }
      });

      // 4. 绑定 voiceManagerId：每个 Source/Envelope 归属最近的 Voices
      let currentVoiceManagerId = hasExplicitVoices ? null : HIDDEN_VOICES_ID;
      modules.forEach((module) => {
        if (module.type === "Voices" && module.enabled) {
          currentVoiceManagerId = module.id;
        }
        if (
          (module.category === "source" || module.type === "Envelope") &&
          module.enabled &&
          currentVoiceManagerId
        ) {
          const runtime = runtimeMap.get(module.id);
          if (runtime) {
            runtime.voiceManagerId = currentVoiceManagerId;
          }
        }
      });

      // 5. 连接信号链
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
    const chain = this.getChainState(chainIndex);
    const modules = Array.isArray(chain?.modules) ? chain.modules : [];
    const moduleIndex = modules.findIndex((m) => m.id === module.id);

    const getIsMono = () => {
      // 从当前 Source 向前查找最近的 Voices 配置
      for (let i = moduleIndex - 1; i >= 0; i--) {
        const m = modules[i];
        if (!m.enabled) continue;
        if (m.category === "source") break; // 被前一个 Source 阻断
        if (m.type === "Voices") {
          return Boolean(m.options?.mono);
        }
      }
      return false; // 默认 Poly
    };

    return createSourceRuntime({
      module,
      getVelocityEnabled: () => Boolean(this.state?.global?.velocityEnabled),
      getIsMono,
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

  /**
   * 获取链的所有 VoiceManager（显式或隐藏）
   */
  getVoiceManagers(runtimeMap) {
    const managers = [];
    for (const [id, runtime] of runtimeMap) {
      if (runtime.isVoiceManager) {
        managers.push({ id, runtime });
      }
    }
    // 按模块位置排序（需要在构建时记录位置，这里先按插入顺序）
    return managers;
  }

  /**
   * 获取链的 VoiceManager（显式或隐藏）- 兼容旧代码，返回最后一个
   */
  getVoiceManager(runtimeMap) {
    const managers = this.getVoiceManagers(runtimeMap);
    return managers.length > 0 ? managers[managers.length - 1].runtime : null;
  }

  /**
   * 获取链的 Pedal 状态
   */
  getPedalState(runtimeMap) {
    for (const [id, runtime] of runtimeMap) {
      if (runtime.type === "Pedal" && runtime.moduleState?.options?.pedal) {
        return true;
      }
    }
    return false;
  }

  /**
   * 通知指定 VoiceManager zone 内的 Source 和 Envelope 释放
   */
  notifySourcesAndEnvelopesRelease(note, voiceIndex, runtimeMap, voiceManagerId) {
    runtimeMap.forEach((runtime) => {
      if (runtime.type === "Pitch" && runtime.getControlledModules) {
        const controlled = runtime.getControlledModules();

        controlled.sources.forEach((sourceId) => {
          const sourceRuntime = runtimeMap.get(sourceId);
          if (
            sourceRuntime &&
            sourceRuntime.voiceManagerId === voiceManagerId &&
            typeof sourceRuntime.triggerRelease === "function"
          ) {
            sourceRuntime.triggerRelease(note, voiceIndex);
          }
        });

        controlled.envelopes.forEach((envInfo) => {
          const envRuntime = runtimeMap.get(envInfo.id);
          if (!envRuntime || envRuntime.voiceManagerId !== voiceManagerId) {
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
      }
    });
  }

  /**
   * 重置指定 voiceIndex 的所有 Source 和 Envelope
   * 用于 voice stealing 后，确保新 note 的 attack 从 0 开始渐变
   */
  resetVoices(voiceIndex, runtimeMap) {
    runtimeMap.forEach((runtime) => {
      if (runtime.category === "source" && typeof runtime.resetVoice === "function") {
        runtime.resetVoice(voiceIndex);
      }
      if (runtime.type === "Envelope" && typeof runtime.resetVoice === "function") {
        runtime.resetVoice(voiceIndex);
      }
    });
  }

  forEachRuntime(callback) {
    this.chainRuntimes.forEach((runtimeMap, chainIndex) => {
      runtimeMap.forEach((runtime, moduleId) => {
        callback(runtime, chainIndex, moduleId);
      });
    });
  }

  _flushInputPendingNotes(runtime, runtimeMap, chainModules, moduleIndex) {
    // VoiceManager 的 pendingReleasedNotes：polyVoice 缩小后处理
    if (runtime.isVoiceManager && runtime.pendingReleasedNotes?.length > 0) {
      const pendingNotes = runtime.pendingReleasedNotes;
      runtime.pendingReleasedNotes = []; // 清空队列

      // 找到该 VoiceManager 的 id
      let vmId = null;
      for (const [id, rt] of runtimeMap) {
        if (rt === runtime) {
          vmId = id;
          break;
        }
      }

      pendingNotes.forEach(({ note, voiceIndex }) => {
        this.notifySourcesAndEnvelopesRelease(note, voiceIndex, runtimeMap, vmId);
      });
    }

    // Pedal 关闭：通知所有 VoiceManager 释放 pending notes
    if (runtime.type === "Pedal" && runtime.pedalOff) {
      runtime.pedalOff = false;

      const voiceManagers = this.getVoiceManagers(runtimeMap);
      voiceManagers.forEach(({ id: vmId, runtime: voiceManager }) => {
        const released = voiceManager.releaseAllPending();
        released.forEach(({ note, voiceIndex }) => {
          this.notifySourcesAndEnvelopesRelease(note, voiceIndex, runtimeMap, vmId);
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
      this._flushInputPendingNotes(runtime, runtimeMap, modules, moduleIndex);
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

  /**
   * 触发指定 note 的 attack，通知指定 VoiceManager zone 内的 Source 和 Envelope
   */
  _triggerAttackForNote(note, velocity, voiceIndex, runtimeMap, chainIndex, voiceManagerId) {
    const inputs = this.getChainInputs(chainIndex, runtimeMap);
    inputs.forEach((input) => {
      if (input.runtime.type !== "Pitch") {
        return;
      }

      const result = input.runtime.triggerAttack(note, velocity, voiceIndex);
      if (!result) {
        return;
      }

      const { noteData, controlledSources, controlledEnvelopes } = result;

      // 只触发属于指定 VoiceManager zone 的 Source
      controlledSources.forEach((sourceId) => {
        const sourceRuntime = runtimeMap.get(sourceId);
        if (
          sourceRuntime &&
          sourceRuntime.voiceManagerId === voiceManagerId &&
          typeof sourceRuntime.triggerAttack === "function"
        ) {
          sourceRuntime.triggerAttack(noteData, velocity, voiceIndex);
        }
      });

      // 只触发属于指定 VoiceManager zone 的 Envelope
      controlledEnvelopes.forEach((envInfo) => {
        const envRuntime = runtimeMap.get(envInfo.id);
        if (!envRuntime || envRuntime.voiceManagerId !== voiceManagerId) {
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

      // 1. 获取所有 VoiceManager
      const voiceManagers = this.getVoiceManagers(runtimeMap);
      if (!voiceManagers.length) {
        return;
      }

      // 2. 每个 VoiceManager 独立分配 voice
      voiceManagers.forEach(({ id: vmId, runtime: voiceManager }) => {
        const voiceResult = voiceManager.triggerAttack(note, velocity);
        if (!voiceResult) {
          return;
        }

        const { voiceIndex, isRetrigger, stolenNote } = voiceResult;

        // 延续音：不重新触发 Attack
        if (isRetrigger) {
          return;
        }

        // 3. 处理 voice stealing：只释放该 VoiceManager zone 内的 note
        if (stolenNote) {
          this.notifySourcesAndEnvelopesRelease(stolenNote, voiceIndex, runtimeMap, vmId);
        }

        // 4. 触发该 VoiceManager zone 内新 note 的 attack
        this._triggerAttackForNote(note, velocity, voiceIndex, runtimeMap, chainIndex, vmId);
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

      // 1. 获取所有 VoiceManager 和 Pedal 状态
      const voiceManagers = this.getVoiceManagers(runtimeMap);
      if (!voiceManagers.length) {
        return;
      }

      const pedal = this.getPedalState(runtimeMap);

      // 2. 每个 VoiceManager 独立释放
      voiceManagers.forEach(({ id: vmId, runtime: voiceManager }) => {
        const releaseResult = voiceManager.triggerRelease(note, pedal);
        if (!releaseResult || !releaseResult.released) {
          return;
        }

        const { voiceIndex, recoveredNote, originalVelocity } = releaseResult;

        // 3. 遍历所有 Pitch，只释放该 VoiceManager zone 内的 Source 和 Envelope
        const inputs = this.getChainInputs(chainIndex, runtimeMap);
        inputs.forEach((input) => {
          if (input.runtime.type !== "Pitch") {
            return;
          }

          const controlled = input.runtime.getControlledModules();

          // 只通知该 VoiceManager zone 内的 Source release
          controlled.sources.forEach((sourceId) => {
            const sourceRuntime = runtimeMap.get(sourceId);
            if (
              sourceRuntime &&
              sourceRuntime.voiceManagerId === vmId &&
              typeof sourceRuntime.triggerRelease === "function"
            ) {
              sourceRuntime.triggerRelease(note, voiceIndex);
            }
          });

          // 只通知该 VoiceManager zone 内的 Envelope release
          controlled.envelopes.forEach((envInfo) => {
            const envRuntime = runtimeMap.get(envInfo.id);
            if (!envRuntime || envRuntime.voiceManagerId !== vmId) {
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

        // 4. 如果有恢复的 note，延迟触发该 VoiceManager zone 的 re-attack
        if (recoveredNote) {
          const recoveredVoiceIndex = voiceManager.getVoiceForNote(recoveredNote);
          if (recoveredVoiceIndex >= 0) {
            const recoveredVelocity = originalVelocity ?? 1;
            // 使用 requestAnimationFrame 确保 release 先执行
            requestAnimationFrame(() => {
              // 防御性检查：确认 recoveredNote 仍然有效
              const currentVoiceIndex = voiceManager.getVoiceForNote(recoveredNote);
              if (currentVoiceIndex < 0) return;
              
              this._triggerAttackForNote(
                recoveredNote, 
                recoveredVelocity,
                recoveredVoiceIndex, 
                runtimeMap, 
                chainIndex,
                vmId
              );
            });
          }
        }
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

      // 1. 获取所有 VoiceManager
      const voiceManagers = this.getVoiceManagers(runtimeMap);
      if (!voiceManagers.length) {
        return;
      }

      // 2. 每个 VoiceManager 独立释放所有 voice
      voiceManagers.forEach(({ id: vmId, runtime: voiceManager }) => {
        const released = voiceManager.releaseAll();

        // 3. 遍历所有 Pitch，只释放该 VoiceManager zone 内的 Source 和 Envelope
        released.forEach(({ note, voiceIndex }) => {
          const inputs = this.getChainInputs(chainIndex, runtimeMap);
          inputs.forEach((input) => {
            if (input.runtime.type !== "Pitch") {
              return;
            }

            const controlled = input.runtime.getControlledModules();

            controlled.sources.forEach((sourceId) => {
              const sourceRuntime = runtimeMap.get(sourceId);
              if (
                sourceRuntime &&
                sourceRuntime.voiceManagerId === vmId &&
                typeof sourceRuntime.triggerRelease === "function"
              ) {
                sourceRuntime.triggerRelease(note, voiceIndex);
              }
            });

            controlled.envelopes.forEach((envInfo) => {
              const envRuntime = runtimeMap.get(envInfo.id);
              if (!envRuntime || envRuntime.voiceManagerId !== vmId) {
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
      });

      // 4. 释放所有未通过 Input 触发的 runtime（保险措施）
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
