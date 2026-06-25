/**
 * Application type definitions
 */
import type { Preset, GlobalState, ChainState, ModuleConfig, ModulationConnection } from './core';

// Audio engine interface (forward declaration)
export interface AudioEngine {
  start(state: Preset): Promise<void>;
  fullSync(state: Preset): void;
  updateGlobal(globalState: GlobalState): void;
  getAnalyser(): AnalyserNode | null;
  getSpectrumAnalyser(): AnalyserNode | null;
  updateModule(moduleId: string, updates: Partial<ModuleConfig>, chainIndex?: number): void;
  getModuleRuntime(chainIndex: number, moduleId: string): Record<string, unknown> | null;
  play(): void;
  pause(): void;
  stop(): void;
  togglePlay(): void;
  seek(seconds: number): void;
  getProgress(): number;
  getDuration(): number;
  isTransportPlaying(): boolean;
  onProgress(callback: () => void): void;
}

// Modulation manager interface
export interface ModulationManager {
  isModulationSource(module: ModuleConfig): boolean;
  getModulations(): ModulationConnection[];
  getOutgoingModulations(sourceModuleId: string): ModulationConnection[];
  getModulationByTarget(targetModuleId: string, targetParamPath: string): ModulationConnection | undefined;
  startModulationDrag(options: unknown): void;
  removeModulationById(connectionId: string): void;
  removeOutgoingModulations(sourceModuleId: string): void;
  removeModuleModulations(moduleId: string): void;
  connectAllModulations(): void;
  renderModulationOverlay(): void;
  bindEvents(): void;
}

// Macro manager interface
export interface MacroManager {
  getMainCardViewModel(): unknown;
  getMacroPoint(pointIndex: number): Record<string, unknown>;
  applyAllMappings(): void;
  applyMappingsForPoint(pointIndex: number, animate: boolean): void;
  ensureMacroState(): void;
  startPointDrag(options: unknown): void;
  startAxisBindingDrag(options: unknown): void;
  renderMacroOverlay(): void;
  bindEvents(): void;
}

// Drag manager interface
export interface DragManager {
  initModuleDrag(event: PointerEvent, card: HTMLElement, moduleIndex: number): void;
}

// Gesture manager interface
export interface GestureManager {
  activate(): void;
}

// Source output monitor
export interface SourceOutputMonitor {
  start(): void;
  stop(): void;
}

// Edge scroll manager
export interface EdgeScrollOptions {
  container: HTMLElement;
  onScroll: (deltaX: number, deltaY: number) => void;
}
