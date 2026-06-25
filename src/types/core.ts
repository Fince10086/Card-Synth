/**
 * Core type definitions for Card Synth
 * These are the fundamental types used throughout the application
 */

// Module categories
export type ModuleCategory = 'source' | 'effect';

// Source module types
export type SourceType = 'TrackPlayer';

// Effect module types
export type EffectType = 
  | 'Filter' 
  | 'Compressor' 
  | 'Gain' 
  | 'EQ3' 
  | 'Chorus' 
  | 'Reverb' 
  | 'AutoFilter' 
  | 'AutoPanner'
  | 'AutoWah'
  | 'BitCrusher'
  | 'Chebyshev'
  | 'FeedbackDelay'
  | 'Freeverb'
  | 'FrequencyShifter'
  | 'JCReverb'
  | 'Phaser' 
  | 'PingPongDelay'
  | 'PitchShift'
  | 'StereoWidener'
  | 'Tremolo' 
  | 'Vibrato'
  | 'Limiter'
  | 'PanVol';

// All module types
export type ModuleType = SourceType | EffectType;

// Control types for UI (matches the actual values used in libraries)
export type ControlKind = 'range' | 'select' | 'toggle' | 'switch' | 'audioImport';

export interface ControlOption {
  value: string | number | boolean;
  label: string;
}

export type FormatterFunction = (value: number) => string;

export interface ControlDefinition {
  kind: ControlKind;
  path: string;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  options?: ControlOption[];
  defaultValue?: unknown;
  formatter?: FormatterFunction | ((value: number) => string);
  conditional?: (module: ModuleConfig) => boolean;
}

// Module definition from library
export interface ModuleDefinition {
  type?: ModuleType;
  category?: ModuleCategory;
  label?: string;
  color?: string;
  accent?: string;
  tag?: string;
  controls: ControlDefinition[];
  options: Record<string, unknown>;
  runtime?: string;
  moduleDefaults?: Record<string, unknown>;
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
  sourceVoiceIndex?: number | string;
  targetModuleId: string;
  targetParamPath: string;
  depth?: number;
  radius?: number;
  scaleMin?: number;
  scaleMax?: number;
}

// Macro axis binding
export interface MacroAxisBinding {
  targetModuleId?: string;
  targetParamPath?: string;
  paramPath?: string;
  min: number;
  max: number;
  step?: number;
  rangeStart?: number;
  rangeEnd?: number;
}

// Macro mapping item (cross-chain)
export interface MacroMappingItem {
  targetChainIndex: number;
  targetModuleId: string;
  targetParamPath: string;
  min: number;
  max: number;
  step: number;
  rangeStart: number;
  rangeEnd: number;
}

// Macro point state (cross-chain control point)
export interface MacroPointState {
  x: number;
  y: number;
  bindings: {
    x: MacroMappingItem[];
    y: MacroMappingItem[];
  };
}

// Macro state
export interface MacroState {
  pointCount: number;
  selectedPointIndex: number;
  recentSelection: number[];
  points: MacroPointState[];
}

// Chain state
export interface ChainState {
  enabled: boolean;
  modules: ModuleConfig[];
  modulations: ModulationConnection[];
}

// Global state
export interface GlobalState {
  volume: number;
}

// Complete preset
export interface Preset {
  name?: string;
  presetType?: string;
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
