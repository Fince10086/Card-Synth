/**
 * Audio runtime type definitions
 */

import type { ModuleConfig } from './core';

// Base runtime interface
export interface BaseRuntime {
  type: string;
  category?: string;
  moduleState: ModuleConfig;
  apply(moduleState: ModuleConfig): void;
  dispose(): void;
}

// Effect runtime
export interface EffectRuntime extends BaseRuntime {
  category: 'effect';
  input: AudioNode;
  output: AudioNode;
}

// Union type for all runtimes
export type Runtime = EffectRuntime;

// Voice state
export type VoiceState = 'idle' | 'active' | 'releasing';

export interface Voice {
  initialized: boolean;
  state: VoiceState;
  note: number | null;
  voiceIndex: number;
}
