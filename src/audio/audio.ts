/**
 * Audio Engine - Core audio management
 */

import * as Tone from "tone";
import {
  deepClone,
  rampParam,
  clamp,
  SOURCE_LIBRARY,
  INPUT_LIBRARY,
} from "../utils/helpers";
import { createSourceRuntime } from "./runtimes/sourceRuntime";
import { createEnvelopeRuntime } from "./runtimes/envelopeRuntime";
import { createEffectRuntime } from "./runtimes/effectRuntime";
import { createInputRuntime, type InputRuntime } from "./runtimes/inputRuntime";
import { connectSignalChain } from "./chain/signalChain";
import type { ModuleConfig, Preset, GlobalState } from "../types";

const HIDDEN_MIDI_INPUT_ID = "__hidden_midi_input__";
const HIDDEN_VOICES_ID = "__hidden_voices__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export class AudioEngine {
  app: AnyRecord;
  ready: boolean;
  state: Preset | null;
  chainRuntimes: Map<number, Map<string, AnyRecord>>;
  moduleRuntimes: Map<string, AnyRecord>;
  activeNotes: Set<number>;
  masterVolume!: Tone.Volume;
  limiter!: Tone.Limiter;
  analyser!: Tone.Analyser;
  spectrumAnalyser!: Tone.Analyser;
  scopeMonoMix!: Tone.Gain;

  constructor(app: AnyRecord) {
    this.app = app;
    this.ready = false;
    this.state = null;
    this.chainRuntimes = new Map();
    this.moduleRuntimes = new Map();
    this.activeNotes = new Set();
  }

  async start(state: Preset): Promise<void> {
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
    (this.scopeMonoMix.input as unknown as AnyRecord).channelCountMode = "explicit";

    this.masterVolume.connect(this.scopeMonoMix);
    this.scopeMonoMix.connect(this.analyser);
    this.scopeMonoMix.connect(this.spectrumAnalyser);

    this.rebuildSignalChains();

    if (this.app && this.app.modulationManager) {
      (this.app.modulationManager as unknown as AnyRecord).connectAllModulations?.();
    }
  }

  getAnalyser(): Tone.Analyser {
    return this.analyser;
  }

  getSpectrumAnalyser(): Tone.Analyser {
    return this.spectrumAnalyser;
  }

  fullSync(state: Preset): void {
    this.state = deepClone(state);
    if (!this.ready) {
      return;
    }

    rampParam(this.masterVolume.volume, state.global.volume);
    this.silenceAll();
    this.rebuildSignalChains();

    if (this.app && this.app.modulationManager) {
      (this.app.modulationManager as unknown as AnyRecord).connectAllModulations?.();
    }
  }

  updateGlobal(globalState: GlobalState): void {
    const prevPolyVoice = this.state?.global?.polyVoice;
    this.state!.global = deepClone(globalState);
    if (!this.ready) {
      return;
    }
    rampParam(this.masterVolume.volume, globalState.volume);

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

  isSourceModule(module: ModuleConfig): boolean {
    return module.category === "source" || SOURCE_LIBRARY[module.type] !== undefined;
  }

  isEnvModule(module: ModuleConfig): boolean {
    return module.type === "Envelope" && module.modulationMode !== true;
  }

  isInputModule(module: ModuleConfig): boolean {
    return module.category === "input" || INPUT_LIBRARY[module.type] !== undefined;
  }

  getChainState(chainIndex: number): { enabled: boolean; modules: ModuleConfig[]; modulations: unknown[] } {
    const chains = Array.isArray(this.state?.chains) ? this.state.chains : [];
    return chains[chainIndex] || { enabled: false, modules: [], modulations: [] };
  }

  getChainRuntimeMap(chainIndex: number): Map<string, AnyRecord> | null {
    return this.chainRuntimes.get(chainIndex) || null;
  }

  getModuleRuntime(chainIndex: number, moduleId: string): AnyRecord | null {
    const map = this.getChainRuntimeMap(chainIndex);
    return map ? map.get(moduleId) || null : null;
  }

  disposeRuntimeMap(runtimeMap: Map<string, AnyRecord> | null): void {
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

  refreshCurrentRuntimeAlias(): void {
    const selectedChain = (this.app?.getSelectedChainIndex as () => number)?.() ?? 0;
    this.moduleRuntimes = this.getChainRuntimeMap(selectedChain) || new Map();
  }

  rebuildSignalChains(): void {
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

      const runtimeMap = new Map<string, AnyRecord>();

      // 1. Create runtimes for all non-Input explicit modules
      modules.forEach((module, index) => {
        if (this.isInputModule(module)) {
          return;
        }
        const runtime = this.createModuleRuntime(module, chainIndex, modules, index);
        runtimeMap.set(module.id, runtime);
      });

      // 2. Check for explicit Voices and Pitch
      const hasExplicitVoices = modules.some((m) => m.type === "Voices" && m.enabled);
      const hasExplicitPitch = modules.some((m) => m.type === "Pitch" && m.enabled);
      const hasSourcesOrEnvelopes = modules.some((m) =>
        m.category === "source" || m.type === "Envelope"
      );

      // Create hidden Voices if needed
      if (hasSourcesOrEnvelopes && !hasExplicitVoices) {
        const hiddenVoicesModule: ModuleConfig = {
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
        runtimeMap.set(HIDDEN_VOICES_ID, hiddenVoicesRuntime as unknown as unknown as AnyRecord);
      }

      // Create hidden Pitch if needed
      if (hasSourcesOrEnvelopes && !hasExplicitPitch) {
        const hiddenMidiModule: ModuleConfig = {
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
        runtimeMap.set(HIDDEN_MIDI_INPUT_ID, hiddenInputRuntime as unknown as unknown as AnyRecord);
      }

      // 3. Create runtimes for all explicit Input modules
      modules.forEach((module, index) => {
        if (this.isInputModule(module) && module.enabled) {
          const inputRuntime = createInputRuntime(
            module,
            modules,
            index,
            () => clamp(Number(this.state?.global?.polyVoice) || 8, 2, 8),
          );
          runtimeMap.set(module.id, inputRuntime as unknown as unknown as AnyRecord);
        }
      });

      // 4. Bind voiceManagerId and pedalId
      let currentVoiceManagerId = hasExplicitVoices ? null : HIDDEN_VOICES_ID;
      let currentPedalId: string | null = null;
      modules.forEach((module) => {
        if (module.type === "Voices" && module.enabled) {
          currentVoiceManagerId = module.id;
        }
        if (module.type === "Pedal" && module.enabled) {
          currentPedalId = module.id;
        }
        if (
          (module.category === "source" || module.type === "Envelope") &&
          module.enabled &&
          currentVoiceManagerId
        ) {
          const runtime = runtimeMap.get(module.id);
          if (runtime) {
            runtime.voiceManagerId = currentVoiceManagerId;
            runtime.pedalId = currentPedalId;
          }
        }
      });

      // 5. Connect signal chain
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

  createModuleRuntime(module: ModuleConfig, chainIndex: number, chainModules: ModuleConfig[], moduleIndex: number): AnyRecord {
    if (module.type === "Envelope") {
      return createEnvelopeRuntime(module) as unknown as unknown as AnyRecord;
    }
    if (this.isSourceModule(module)) {
      return this.createSourceRuntime(module, chainIndex);
    }
    return createEffectRuntime(module) as unknown as unknown as AnyRecord;
  }

  createSourceRuntime(module: ModuleConfig, chainIndex: number): AnyRecord {
    const chain = this.getChainState(chainIndex);
    const modules = Array.isArray(chain?.modules) ? chain.modules : [];
    const moduleIndex = modules.findIndex((m) => m.id === module.id);

    const getIsMono = (): boolean => {
      for (let i = moduleIndex - 1; i >= 0; i--) {
        const m = modules[i];
        if (!m.enabled) continue;
        if (m.category === "source") break;
        if (m.type === "Voices") {
          return Boolean((m.options as unknown as AnyRecord)?.mono);
        }
      }
      return false;
    };

    return createSourceRuntime({
      module,
      getVelocityEnabled: () => Boolean(this.state?.global?.velocityEnabled),
      getIsMono,
      onAllVoicesIdle: () => this.rebuildSignalChains(),
      onVoiceDisposed: (voiceIndex: number) => {
        (this.app?.modulationManager as unknown as AnyRecord)?.disconnectVoiceModulations?.(chainIndex, module.id, voiceIndex);
      },
      onVoiceInitialized: (voiceIndex: number) => {
        (this.app?.modulationManager as unknown as AnyRecord)?.connectVoiceModulations?.(chainIndex, module.id, voiceIndex);
      },
    }) as unknown as unknown as AnyRecord;
  }

  getChainInputs(chainIndex: number, runtimeMap: Map<string, AnyRecord>): Array<{ runtime: AnyRecord; index: number; id: string }> {
    const chain = this.getChainState(chainIndex);
    const modules = Array.isArray(chain?.modules) ? chain.modules : [];

    const inputs: Array<{ runtime: AnyRecord; index: number; id: string }> = [];

    const hiddenInput = runtimeMap.get(HIDDEN_MIDI_INPUT_ID);
    if (hiddenInput) {
      inputs.push({ runtime: hiddenInput, index: -1, id: HIDDEN_MIDI_INPUT_ID });
    }

    modules.forEach((module, index) => {
      if (this.isInputModule(module) && module.enabled) {
        const runtime = runtimeMap.get(module.id);
        if (runtime) {
          inputs.push({ runtime, index, id: module.id });
        }
      }
    });

    inputs.sort((a, b) => a.index - b.index);

    return inputs;
  }

  getVoiceManagers(runtimeMap: Map<string, AnyRecord>): Array<{ id: string; runtime: InputRuntime }> {
    const managers: Array<{ id: string; runtime: InputRuntime }> = [];
    for (const [id, runtime] of runtimeMap) {
      if (runtime.isVoiceManager) {
        managers.push({ id, runtime: runtime as unknown as InputRuntime });
      }
    }
    return managers;
  }

  getVoiceManager(runtimeMap: Map<string, AnyRecord>): InputRuntime | null {
    const managers = this.getVoiceManagers(runtimeMap);
    return managers.length > 0 ? managers[managers.length - 1].runtime : null;
  }

  getPedalState(runtimeMap: Map<string, AnyRecord>): boolean {
    for (const [id, runtime] of runtimeMap) {
      if (runtime.type === "Pedal" && (runtime.moduleState as unknown as AnyRecord)?.options?.pedal) {
        return true;
      }
    }
    return false;
  }

  getPedalStateById(runtimeMap: Map<string, AnyRecord>, pedalId: string | null): boolean {
    if (!pedalId) return false;
    const pedal = runtimeMap.get(pedalId);
    return pedal?.type === "Pedal" && (pedal.moduleState as unknown as AnyRecord)?.options?.pedal;
  }

  notifySourcesAndEnvelopesRelease(
    note: number,
    voiceIndex: number,
    runtimeMap: Map<string, AnyRecord>,
    voiceManagerId: string | null
  ): void {
    runtimeMap.forEach((runtime) => {
      if (runtime.type === "Pitch" && runtime.getControlledModules) {
        const controlled = runtime.getControlledModules() as {
          sources: string[];
          envelopes: Array<{ id: string }>;
        };

        controlled.sources.forEach((sourceId: string) => {
          const sourceRuntime = runtimeMap.get(sourceId);
          if (
            sourceRuntime &&
            sourceRuntime.voiceManagerId === voiceManagerId &&
            typeof sourceRuntime.triggerRelease === "function"
          ) {
            sourceRuntime.triggerRelease(note, voiceIndex);
          }
        });

        controlled.envelopes.forEach((envInfo: { id: string }) => {
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

  resetVoices(voiceIndex: number, runtimeMap: Map<string, AnyRecord>): void {
    runtimeMap.forEach((runtime) => {
      if (runtime.category === "source" && typeof runtime.resetVoice === "function") {
        runtime.resetVoice(voiceIndex);
      }
      if (runtime.type === "Envelope" && typeof runtime.resetVoice === "function") {
        runtime.resetVoice(voiceIndex);
      }
    });
  }

  forEachRuntime(
    callback: (runtime: AnyRecord, chainIndex: number, moduleId: string) => void
  ): void {
    this.chainRuntimes.forEach((runtimeMap, chainIndex) => {
      runtimeMap.forEach((runtime, moduleId) => {
        callback(runtime, chainIndex, moduleId);
      });
    });
  }

  _flushInputPendingNotes(
    runtime: AnyRecord,
    runtimeMap: Map<string, AnyRecord>,
    _chainModules: ModuleConfig[],
    _moduleIndex: number
  ): void {
    if (runtime.isVoiceManager && (runtime.pendingReleasedNotes as Array<{ note: number; voiceIndex: number }>)?.length > 0) {
      const pendingNotes = runtime.pendingReleasedNotes as Array<{ note: number; voiceIndex: number }>;
      runtime.pendingReleasedNotes = [];

      let vmId: string | null = null;
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

  updateModule(
    moduleId: string,
    updates: Partial<ModuleConfig>,
    chainIndex: number = (this.app?.getSelectedChainIndex as () => number)?.() ?? 0
  ): void {
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
      this._flushInputPendingNotes(runtime, runtimeMap!, modules, moduleIndex);
    }
  }

  updateSource(module: ModuleConfig, chainIndex: number = (this.app?.getSelectedChainIndex as () => number)?.() ?? 0): void {
    this.updateModule(module.id, module, chainIndex);
  }

  updateComponent(module: ModuleConfig, chainIndex: number = (this.app?.getSelectedChainIndex as () => number)?.() ?? 0): void {
    const chain = this.getChainState(chainIndex);
    const modules = Array.isArray(chain.modules) ? chain.modules : [];
    const moduleIndex = modules.findIndex((m) => m.id === module.id);
    if (moduleIndex >= 0) {
      modules[moduleIndex] = deepClone(module);
    }
    if (this.ready) {
      this.rebuildSignalChains();
      (this.app?.modulationManager as unknown as AnyRecord)?.connectAllModulations?.();
    }
  }

  updateEffect(module: ModuleConfig, chainIndex: number = (this.app?.getSelectedChainIndex as () => number)?.() ?? 0): void {
    this.updateComponent(module, chainIndex);
  }

  _triggerAttackForNote(
    note: number,
    velocity: number,
    voiceIndex: number,
    runtimeMap: Map<string, AnyRecord>,
    chainIndex: number,
    voiceManagerId: string | null
  ): void {
    const inputs = this.getChainInputs(chainIndex, runtimeMap);
    inputs.forEach((input) => {
      if (input.runtime.type !== "Pitch") {
        return;
      }

      const result = input.runtime.triggerAttack(note, velocity, voiceIndex);
      if (!result) {
        return;
      }

      const { noteData, controlledSources, controlledEnvelopes } = result as {
        noteData: unknown;
        controlledSources: string[];
        controlledEnvelopes: Array<{ id: string }>;
      };

      controlledSources.forEach((sourceId: string) => {
        const sourceRuntime = runtimeMap.get(sourceId);
        if (
          sourceRuntime &&
          sourceRuntime.voiceManagerId === voiceManagerId &&
          typeof sourceRuntime.triggerAttack === "function"
        ) {
          sourceRuntime.triggerAttack(noteData, velocity, voiceIndex);
        }
      });

      controlledEnvelopes.forEach((envInfo: { id: string }) => {
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

  attack(note: number, velocity: number): void {
    if (!this.ready) {
      return;
    }

    this.activeNotes.add(note);

    this.chainRuntimes.forEach((runtimeMap, chainIndex) => {
      const chain = this.getChainState(chainIndex);
      if (!chain?.enabled) {
        return;
      }

      const voiceManagers = this.getVoiceManagers(runtimeMap);
      if (!voiceManagers.length) {
        return;
      }

      voiceManagers.forEach(({ id: vmId, runtime: voiceManager }) => {
        const voiceResult = voiceManager.triggerAttack(note, velocity);
        if (!voiceResult) {
          return;
        }

        const { voiceIndex, isRetrigger, stolenNote } = voiceResult as { voiceIndex: number; isRetrigger: boolean; stolenNote: number | null };

        if (isRetrigger) {
          return;
        }

        if (stolenNote !== null) {
          this.notifySourcesAndEnvelopesRelease(stolenNote, voiceIndex, runtimeMap, vmId);
        }

        this._triggerAttackForNote(note, velocity, voiceIndex, runtimeMap, chainIndex, vmId);
      });
    });
  }

  release(note: number): void {
    if (!this.ready) {
      return;
    }

    this.activeNotes.delete(note);

    this.chainRuntimes.forEach((runtimeMap, chainIndex) => {
      const chain = this.getChainState(chainIndex);
      if (!chain?.enabled) {
        return;
      }

      const voiceManagers = this.getVoiceManagers(runtimeMap);
      if (!voiceManagers.length) {
        return;
      }

      voiceManagers.forEach(({ id: vmId, runtime: voiceManager }) => {
        let zonePedal = false;
        for (const [id, runtime] of runtimeMap) {
          if (runtime.voiceManagerId === vmId && runtime.pedalId) {
            zonePedal = this.getPedalStateById(runtimeMap, runtime.pedalId as string);
            break;
          }
        }

        const releaseResult = voiceManager.triggerRelease(note, zonePedal) as { released: boolean; voiceIndex: number; recoveredNote: number | null; originalVelocity: number } | null;
        if (!releaseResult || !releaseResult.released) {
          return;
        }

        const { voiceIndex, recoveredNote, originalVelocity } = releaseResult;

        const inputs = this.getChainInputs(chainIndex, runtimeMap);
        inputs.forEach((input) => {
          if (input.runtime.type !== "Pitch") {
            return;
          }

          const controlled = input.runtime.getControlledModules() as {
            sources: string[];
            envelopes: Array<{ id: string }>;
          };

          controlled.sources.forEach((sourceId: string) => {
            const sourceRuntime = runtimeMap.get(sourceId);
            if (
              sourceRuntime &&
              sourceRuntime.voiceManagerId === vmId &&
              typeof sourceRuntime.triggerRelease === "function"
            ) {
              sourceRuntime.triggerRelease(note, voiceIndex);
            }
          });

          controlled.envelopes.forEach((envInfo: { id: string }) => {
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

        if (recoveredNote !== null) {
          const recoveredVoiceIndex = voiceManager.getVoiceForNote(recoveredNote);
          if (recoveredVoiceIndex >= 0) {
            const recoveredVelocity = originalVelocity ?? 1;
            requestAnimationFrame(() => {
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

  silenceAll(): void {
    this.activeNotes.clear();
    if (!this.ready) {
      return;
    }

    this.chainRuntimes.forEach((runtimeMap, chainIndex) => {
      const chain = this.getChainState(chainIndex);
      if (!chain?.enabled) {
        return;
      }

      const voiceManagers = this.getVoiceManagers(runtimeMap);
      if (!voiceManagers.length) {
        return;
      }

      voiceManagers.forEach(({ id: vmId, runtime: voiceManager }) => {
        const released = voiceManager.releaseAll();

        released.forEach(({ note, voiceIndex }) => {
          const inputs = this.getChainInputs(chainIndex, runtimeMap);
          inputs.forEach((input) => {
            if (input.runtime.type !== "Pitch") {
              return;
            }

            const controlled = input.runtime.getControlledModules() as {
              sources: string[];
              envelopes: Array<{ id: string }>;
            };

            controlled.sources.forEach((sourceId: string) => {
              const sourceRuntime = runtimeMap.get(sourceId);
              if (
                sourceRuntime &&
                sourceRuntime.voiceManagerId === vmId &&
                typeof sourceRuntime.triggerRelease === "function"
              ) {
                sourceRuntime.triggerRelease(note, voiceIndex);
              }
            });

            controlled.envelopes.forEach((envInfo: { id: string }) => {
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

      runtimeMap.forEach((runtime) => {
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
