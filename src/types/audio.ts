/**
 * Audio runtime type definitions
 */
import type { ModuleConfig, NoteData } from './core';

// Base runtime interface
export interface BaseRuntime {
  type: string;
  category?: string;
  moduleState: ModuleConfig;
  apply(moduleState: ModuleConfig): void;
  dispose(): void;
}

// Source runtime
export interface SourceRuntime extends BaseRuntime {
  category: 'source';
  voiceManagerId: string | null;
  pedalId: string | null;
  triggerAttack(noteData: NoteData, velocity: number, voiceIndex: number): void;
  triggerRelease(note: number, voiceIndex: number): void;
  resetVoice(voiceIndex: number): void;
  releaseAll?(): void;
}

// Envelope runtime
export interface EnvelopeRuntime extends BaseRuntime {
  type: 'Envelope';
  modulationMode: boolean;
  hasPerVoiceConnection: boolean;
  triggerAttack(note: number, velocity: number): void;
  triggerRelease(note: number): void;
  triggerVoiceAttack(voiceIndex: number, velocity: number): void;
  triggerVoiceRelease(voiceIndex: number): void;
  releaseAll(): void;
}

// Effect runtime
export interface EffectRuntime extends BaseRuntime {
  category: 'effect';
  input: AudioNode;
  output: AudioNode;
}

// Input runtime (Voices, Pitch, Pedal)
export interface InputRuntime extends BaseRuntime {
  type: string;
  isVoiceManager?: boolean;
  triggerAttack?(note: number, velocity: number, voiceIndex: number): { 
    noteData: NoteData; 
    controlledSources: string[]; 
    controlledEnvelopes: Array<{id: string}> 
  } | null;
  getControlledModules?(): { sources: string[]; envelopes: Array<{id: string}> };
  releaseAll?(): Array<{note: number; voiceIndex: number}>;
  releaseAllPending?(): Array<{note: number; voiceIndex: number}>;
  getVoiceForNote?(note: number): number;
  pendingReleasedNotes?: Array<{note: number; voiceIndex: number}>;
  pedalOff?: boolean;
}

// Union type for all runtimes
export type Runtime = SourceRuntime | EnvelopeRuntime | EffectRuntime | InputRuntime;

// Voice state
export type VoiceState = 'idle' | 'active' | 'releasing';

export interface Voice {
  initialized: boolean;
  state: VoiceState;
  note: number | null;
  voiceIndex: number;
}
