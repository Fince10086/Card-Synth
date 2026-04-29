/**
 * Input runtime - Voices, Pitch, and Pedal modules
 */

import { clamp, deepClone } from "../../utils/helpers";
import * as Tone from "tone";
import type { ModuleConfig } from "../../types";

export interface VoiceAllocationResult {
  voiceIndex: number;
  isRetrigger: boolean;
  stolenNote: number | null;
}

export interface VoiceReleaseResult {
  voiceIndex: number;
  released: boolean;
  recoveredNote: number | null;
  originalVelocity: number;
}

export interface InputRuntime {
  type: string;
  category: string;
  isVoiceManager?: boolean;
  moduleState: ModuleConfig;
  triggerAttack(note: number, velocity: number, voiceIndex?: number): unknown;
  triggerRelease(note: number, pedal?: boolean): unknown;
  releaseAll(): Array<{ note: number; voiceIndex: number }>;
  releaseAllPending(): Array<{ note: number; voiceIndex: number }>;
  getVoiceForNote(note: number): number;
  getNoteState(note: number): { pressed: boolean; voiceIndex: number } | undefined;
  getControlledModules(): { sources: string[]; envelopes: Array<{id: string; type: string}> };
  getActiveNotes(): Array<{ note: number; voiceIndex: number }>;
  getStolenNotes(): number[];
  apply(nextModule: ModuleConfig): void;
  dispose(): void;
  pendingReleasedNotes?: Array<{ note: number; voiceIndex: number }>;
  pedalOff?: boolean;
}

interface NoteState {
  note: number;
  pressed: boolean;
  voiceIndex: number;
  stolenAt: number;
  pendingRelease: boolean;
  velocity: number;
}

interface VoiceState {
  note: number | null;
  startTime: number;
  active: boolean;
}

function createVoicesRuntime(
  module: ModuleConfig,
  getGlobalPolyVoice: () => number = () => 8
): InputRuntime {
  let moduleState = deepClone(module);

  const getPolyVoice = (): number => {
    if ((moduleState.options as unknown as Record<string, unknown>)?.mono) {
      return 1;
    }
    return clamp(getGlobalPolyVoice(), 2, 8);
  };

  let voiceStates: VoiceState[] = Array.from({ length: getPolyVoice() }, () => ({
    note: null,
    startTime: 0,
    active: false,
  }));

  const noteStates = new Map<number, NoteState>();
  const stolenQueue: number[] = [];

  const findAvailableVoice = (): number => {
    const polyVoice = getPolyVoice();

    for (let i = 0; i < polyVoice; i++) {
      if (!voiceStates[i].active) {
        return i;
      }
    }

    let oldestIndex = -1;
    let oldestTime = Infinity;
    for (let i = 0; i < polyVoice; i++) {
      if (voiceStates[i].active && voiceStates[i].startTime < oldestTime) {
        oldestTime = voiceStates[i].startTime;
        oldestIndex = i;
      }
    }

    return oldestIndex;
  };

  const stealVoice = (voiceIndex: number, stolenNote: number): void => {
    const state = voiceStates[voiceIndex];
    const stolenNoteState = noteStates.get(stolenNote);
    if (stolenNoteState) {
      stolenNoteState.voiceIndex = -1;
      stolenNoteState.stolenAt = Tone.now();
      stolenQueue.push(stolenNote);
    }

    state.note = null;
    state.active = false;
    state.startTime = 0;
  };

  const releaseVoice = (voiceIndex: number): void => {
    const state = voiceStates[voiceIndex];
    state.note = null;
    state.active = false;
    state.startTime = 0;
  };

  const tryRecoverStolenNote = (freedVoiceIndex: number): number | null => {
    while (stolenQueue.length > 0) {
      const note = stolenQueue.shift()!;
      const state = noteStates.get(note);

      if (state && state.pressed) {
        state.voiceIndex = freedVoiceIndex;
        state.stolenAt = 0;

        voiceStates[freedVoiceIndex] = {
          note,
          active: true,
          startTime: Tone.now(),
        };

        return note;
      }
    }
    return null;
  };

  const getNoteState = (note: number): NoteState | undefined => {
    return noteStates.get(note);
  };

  const getVoiceForNote = (note: number): number => {
    const state = noteStates.get(note);
    return state ? state.voiceIndex : -1;
  };

  const runtime: InputRuntime = {
    type: module.type as string,
    category: "input",
    isVoiceManager: true,
    moduleState,

    triggerAttack: (note: number, velocity: number): VoiceAllocationResult | null => {
      const existingState = noteStates.get(note);
      if (existingState && existingState.voiceIndex >= 0) {
        return {
          voiceIndex: existingState.voiceIndex,
          isRetrigger: true,
          stolenNote: null,
        };
      }

      const voiceIndex = findAvailableVoice();
      if (voiceIndex < 0) {
        return null;
      }

      let stolenNote: number | null = null;
      if (voiceStates[voiceIndex].active) {
        stolenNote = voiceStates[voiceIndex].note;
        stealVoice(voiceIndex, stolenNote!);
      }

      voiceStates[voiceIndex] = {
        note,
        active: true,
        startTime: Tone.now(),
      };

      const noteState = existingState || {
        note,
        pressed: true,
        voiceIndex: -1,
        stolenAt: 0,
        pendingRelease: false,
        velocity: velocity ?? 1,
      };
      noteState.pressed = true;
      noteState.voiceIndex = voiceIndex;
      noteState.stolenAt = 0;
      noteState.pendingRelease = false;
      noteState.velocity = velocity ?? 1;
      noteStates.set(note, noteState);

      return { voiceIndex, isRetrigger: false, stolenNote };
    },

    triggerRelease: (note: number, pedal: boolean): VoiceReleaseResult | null => {
      const noteState = noteStates.get(note);
      if (!noteState) {
        return null;
      }

      noteState.pressed = false;
      noteState.pendingRelease = false;
      const originalVelocity = noteState.velocity ?? 1;

      if (noteState.voiceIndex === -1) {
        const idx = stolenQueue.indexOf(note);
        if (idx >= 0) stolenQueue.splice(idx, 1);
        noteStates.delete(note);
        return { voiceIndex: -1, released: false, recoveredNote: null, originalVelocity };
      }

      const voiceIndex = noteState.voiceIndex;

      if (pedal) {
        noteState.pendingRelease = true;
        return { voiceIndex, released: false, recoveredNote: null, originalVelocity };
      }

      releaseVoice(voiceIndex);
      noteState.voiceIndex = -1;
      noteStates.delete(note);

      const recoveredNote = tryRecoverStolenNote(voiceIndex);

      return { voiceIndex, released: true, recoveredNote, originalVelocity };
    },

    releaseAll: (): Array<{ note: number; voiceIndex: number }> => {
      const released: Array<{ note: number; voiceIndex: number }> = [];
      for (let i = 0; i < getPolyVoice(); i++) {
        if (voiceStates[i].active) {
          const note = voiceStates[i].note;
          releaseVoice(i);
          if (note !== null) {
            released.push({ note, voiceIndex: i });
            noteStates.delete(note);
          }
        }
      }
      stolenQueue.length = 0;
      return released;
    },

    releaseAllPending: (): Array<{ note: number; voiceIndex: number }> => {
      const released: Array<{ note: number; voiceIndex: number }> = [];
      for (let i = 0; i < getPolyVoice(); i++) {
        if (voiceStates[i].active) {
          const note = voiceStates[i].note;
          const state = noteStates.get(note!);
          if (state && state.pendingRelease) {
            releaseVoice(i);
            state.voiceIndex = -1;
            noteStates.delete(note!);
            released.push({ note: note!, voiceIndex: i });
          }
        }
      }
      return released;
    },

    getNoteState,
    getVoiceForNote,
    getControlledModules: () => ({ sources: [], envelopes: [] }),

    getActiveNotes: () => {
      const result: Array<{ note: number; voiceIndex: number }> = [];
      noteStates.forEach((state, note) => {
        if (state.voiceIndex >= 0) {
          result.push({ note, voiceIndex: state.voiceIndex });
        }
      });
      return result;
    },

    getStolenNotes: () => {
      return stolenQueue.filter((note) => {
        const state = noteStates.get(note);
        return state && state.pressed;
      });
    },

    apply: (nextModule: ModuleConfig) => {
      const prevPolyVoice = voiceStates.length;
      moduleState = deepClone(nextModule);
      runtime.moduleState = moduleState;

      const newPolyVoice = getPolyVoice();
      if (newPolyVoice !== prevPolyVoice) {
        if (newPolyVoice > prevPolyVoice) {
          for (let i = prevPolyVoice; i < newPolyVoice; i++) {
            voiceStates.push({
              note: null,
              active: false,
              startTime: 0,
            });
          }
        } else {
          const released: Array<{ note: number; voiceIndex: number }> = [];
          for (let i = newPolyVoice; i < prevPolyVoice; i++) {
            if (voiceStates[i].active) {
              const note = voiceStates[i].note;
              releaseVoice(i);
              if (note !== null) {
                released.push({ note, voiceIndex: i });
                noteStates.delete(note);
              }
            }
          }
          voiceStates.length = newPolyVoice;

          while (stolenQueue.length > 0) {
            const availableVoice = findAvailableVoice();
            if (availableVoice < 0 || availableVoice >= newPolyVoice) break;

            const recovered = tryRecoverStolenNote(availableVoice);
            if (!recovered) break;
          }

          stolenQueue.length = 0;
          noteStates.forEach((state, note) => {
            if (state.voiceIndex === -1) {
              noteStates.delete(note);
            }
          });

          if (released.length > 0) {
            runtime.pendingReleasedNotes = (runtime.pendingReleasedNotes || []).concat(released);
          }
        }
      }
    },

    dispose: () => {
      noteStates.clear();
      stolenQueue.length = 0;
    },
  };

  return runtime;
}

interface NoteData {
  type: string;
  note?: string;
  frequency?: number;
  originalNote: number;
  velocity: number;
}

interface PitchRuntime extends InputRuntime {
  getControlledModules(): { sources: string[]; envelopes: Array<{ id: string; type: string }> };
}

function createPitchRuntime(
  module: ModuleConfig,
  chainModules: ModuleConfig[],
  inputIndex: number
): PitchRuntime {
  let moduleState = deepClone(module);

  const getControlledModules = () => {
    const sources: string[] = [];
    const envelopes: Array<{ id: string; type: string }> = [];

    for (let i = inputIndex + 1; i < chainModules.length; i++) {
      const m = chainModules[i];
      if (!m.enabled) continue;
      if (m.type === "Pitch") break;

      if (m.category === "source" || m.type === "Envelope") {
        sources.push(m.id);
      }
      if (m.type === "Envelope") {
        envelopes.push({ id: m.id, type: m.type });
      }
    }

    return { sources, envelopes };
  };

  const applyMidiTransforms = (note: number): string => {
    const transpose = clamp(Number((moduleState.options as unknown as Record<string, unknown>)?.transpose) || 0, -12, 12);
    const octave = clamp(Number((moduleState.options as unknown as Record<string, unknown>)?.octave) || 0, -4, 4);

    if (transpose === 0 && octave === 0) {
      return Tone.Frequency(note).toNote();
    }

    let midiNum = Tone.Frequency(note).toMidi();
    midiNum += transpose + octave * 12;
    return Tone.Frequency(midiNum, "midi").toNote();
  };

  const getFrequencyValue = (): number => {
    return clamp(Number((moduleState.options as unknown as Record<string, unknown>)?.frequency) || 440, 0.1, 20000);
  };

  const runtime: PitchRuntime = {
    type: module.type as string,
    category: "input",
    moduleState,
    getControlledModules,
    getNoteState: () => undefined,

    triggerAttack: (note: number, velocity: number, _voiceIndex: number) => {
      const noteData: NoteData =
        (moduleState.options as unknown as Record<string, unknown>)?.mode === "midi"
          ? { type: "midi", note: applyMidiTransforms(note), originalNote: note, velocity }
          : { type: "frequency", frequency: getFrequencyValue(), originalNote: note, velocity };

      const controlled = getControlledModules();

      return {
        voiceIndex: _voiceIndex,
        noteData,
        controlledSources: controlled.sources,
        controlledEnvelopes: controlled.envelopes,
      };
    },

    triggerRelease: (_note: number) => {
      return { released: true };
    },

    releaseAll: () => [],
    releaseAllPending: () => [],

    apply: (nextModule: ModuleConfig) => {
      moduleState = deepClone(nextModule);
      runtime.moduleState = moduleState;
    },

    dispose: () => {},
    getVoiceForNote: () => -1,
    getActiveNotes: () => [],
    getStolenNotes: () => [],
  };

  return runtime;
}

function createPedalRuntime(module: ModuleConfig): InputRuntime {
  let moduleState = deepClone(module);

  const runtime: InputRuntime = {
    type: module.type as string,
    category: "input",
    moduleState,

    getControlledModules: () => ({ sources: [], envelopes: [] }),

    triggerAttack: () => null,
    triggerRelease: () => null,
    releaseAll: () => [],
    releaseAllPending: () => [],

    apply: (nextModule: ModuleConfig) => {
      const prevPedal = Boolean((moduleState.options as unknown as Record<string, unknown>)?.pedal);
      moduleState = deepClone(nextModule);
      runtime.moduleState = moduleState;

      const newPedal = Boolean((moduleState.options as unknown as Record<string, unknown>)?.pedal);
      if (prevPedal && !newPedal) {
        runtime.pedalOff = true;
      }
    },

    dispose: () => {},
    getVoiceForNote: () => -1,
    getNoteState: () => undefined,
    getActiveNotes: () => [],
    getStolenNotes: () => [],
  };

  return runtime;
}

export function createInputRuntime(
  module: ModuleConfig,
  chainModules: ModuleConfig[] = [],
  inputIndex: number = -1,
  getGlobalPolyVoice: () => number = () => 8
): InputRuntime {
  if (module.type === "Voices") {
    return createVoicesRuntime(module, getGlobalPolyVoice);
  }
  if (module.type === "Pedal") {
    return createPedalRuntime(module);
  }
  return createPitchRuntime(module, chainModules, inputIndex);
}
