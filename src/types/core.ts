/**
 * Core type definitions for Card Synth
 * These are the fundamental types used throughout the application
 */

// Module categories
export type ModuleCategory = 'input' | 'source' | 'component' | 'effect';

// Source module types
export type SourceType = 
  | 'Oscillator' 
  | 'PulseOscillator' 
  | 'Noise' 
  | 'Player';

// Input module types
export type InputType = 
  | 'Voices' 
  | 'Pitch' 
  | 'Pedal';

// Envelope type
export type EnvelopeType = 'Envelope';

// Effect module types
export type EffectType = 
  | 'Filter' 
  | 'Compressor' 
  | 'Gain' 
  | 'EQ3' 
  | 'Chorus' 
  | 'Reverb' 
  | 'AutoFilter' 
  | 'Delay' 
  | 'Distortion' 
  | 'Phaser' 
  | 'Tremolo' 
  | 'Vibrato';

// All module types
export type ModuleType = SourceType | InputType | EnvelopeType | EffectType;

// Control types for UI
export type ControlKind = 'slider' | 'select' | 'toggle' | 'switch' | 'audioImport';

export interface ControlOption {
  value: string | number | boolean;
  label: string;
}

export interface ControlDefinition {
  kind: ControlKind;
  path: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  options?: ControlOption[];
  defaultValue?: unknown;
}

// Module definition from library
export interface ModuleDefinition {
  type: ModuleType;
  category: ModuleCategory;
  label: string;
  color: string;
  controls: ControlDefinition[];
  options: Record<string, unknown>;
  runtime: string;
}

// Module instance in state
export interface ModuleConfig {
  id: string;
  type: ModuleType;
  category: ModuleCategory;
  enabled: boolean;
  modulationMode?: boolean;
  options?: Record<string, unknown>;
  // Additional dynamic properties
  [key: string]: unknown;
}

// Modulation connection
export interface ModulationConnection {
  id: string;
  sourceModuleId: string;
  targetModuleId: string;
  targetParamPath: string;
  depth: number;
}

// Macro axis binding
export interface MacroAxisBinding {
  paramPath: string;
  min: number;
  max: number;
}

// Macro chain state
export interface MacroChainState {
  x: number;
  y: number;
  z: number;
  bindings: Record<string, MacroAxisBinding[]>;
}

// Macro state
export interface MacroState {
  chains: MacroChainState[];
}

// Chain state
export interface ChainState {
  enabled: boolean;
  modules: ModuleConfig[];
  modulations: ModulationConnection[];
  macro?: MacroChainState;
}

// Global state
export interface GlobalState {
  volume: number;
  velocityEnabled: boolean;
  velocity: number;
  polyVoice: number;
  octave: number;
}

// Complete preset
export interface Preset {
  global: GlobalState;
  chains: ChainState[];
  selectedChainIndex: number;
  macro: MacroState;
}

// Preset metadata
export interface PresetMetadata {
  id: string;
  name: string;
  builtin?: boolean;
}

// Voice data
export interface NoteData {
  frequency: number;
  note: number;
  velocity: number;
}

// Control binding for UI
export interface ControlBinding {
  setVisual(value: number): void;
}

// Add module option
export interface AddableModuleOption {
  category: ModuleCategory;
  type: ModuleType;
  value: string;
  label: string;
}
