/**
 * UI type definitions
 */
import type { ModuleConfig, Preset, ChainState, MacroChainState } from './core';

// Main card options
export interface MainCardOptions {
  selectedPresetId: string | null;
  hasUnsavedChanges: boolean;
  builtinPresets: Record<string, Preset>;
  userPresets: Record<string, Preset>;
  state: Preset;
  selectedChainIndex: number;
  chains: ChainState[];
  macro: {
    selectedChainEnabled: boolean;
    points: Array<{
      chainIndex: number;
      visible: boolean;
      selected: boolean;
      x: number;
      y: number;
      color: string;
    }>;
  };
  audioBooted: boolean;
  onPresetChange: (value: string) => void;
  onChainIndexClick: (chainIndex: number, isSelected: boolean) => void;
  onImportClick: () => void;
  onExportCurrentClick: () => void;
  onExportAllClick: () => void;
  onResetClick: () => void;
  onRandomClick: () => void;
  onMidiClick: () => void;
  onMasterVolumeChange: (value: number) => void;
  onVelocityEnabledChange: (value: boolean) => void;
  onPolyVoiceChange: (value: number) => void;
  onMacroPointPointerDown: (event: PointerEvent, chainIndex: number, padElement: HTMLElement) => void;
  onMacroAxisPointerDown: (event: PointerEvent, axis: string) => void;
  onGestureClick: () => void;
  onDeleteUserPreset: (id: string) => void;
}

// Module renderer options
export interface ModuleRendererOptions {
  module: ModuleConfig;
  index: number;
  app: unknown; // Will be typed as ModularSynthApp when migrated
}

// Slider control options
export interface SliderControlOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  onPointerDown?: () => void;
  disabled?: boolean;
}

// Select control options
export interface SelectControlOptions {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

// Toggle control options
export interface ToggleControlOptions {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

// Switch control options
export interface SwitchControlOptions {
  options: Array<{ value: string | number; label: string }>;
  value: string | number;
  onChange: (value: string | number) => void;
  disabled?: boolean;
}

// Masonry layout options
export interface MasonryLayoutOptions {
  container: HTMLElement;
  modules: ModuleConfig[];
  addCard: HTMLElement | null;
  mainCard: HTMLElement | null;
}

// Scope rendering options
export interface ScopeRenderingOptions {
  getCanvasFn: () => HTMLCanvasElement | null;
  getContextFn: () => CanvasRenderingContext2D | null;
  getAnalyserFn: () => AnalyserNode | null;
  getSpectrumAnalyserFn: () => AnalyserNode | null;
  getAudioBootedFn: () => boolean;
  getModeFn: () => 'scope' | 'spectrum';
}

// Modulation drag state
export interface ModulationDragState {
  active: boolean;
  pointerId: number;
  sourceModuleId: string;
  updateConnectionId: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
}

// Macro drag state
export interface MacroDragState {
  active: boolean;
  axis: string | null;
  chainIndex: number;
  startX: number;
  startY: number;
}

// Gesture control mapping
export interface GestureMapping {
  hand: 'left' | 'right';
  gesture: string;
  action: string;
}
