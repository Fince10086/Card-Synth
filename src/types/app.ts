/**
 * Application type definitions
 */
import type { Preset, GlobalState, ChainState, ModuleConfig, ModulationConnection } from './core';
import type { Runtime } from './audio';

// Audio engine interface (forward declaration)
export interface AudioEngine {
  start(state: Preset): Promise<void>;
  fullSync(state: Preset): void;
  updateGlobal(globalState: GlobalState): void;
  getAnalyser(): AnalyserNode | null;
  getSpectrumAnalyser(): AnalyserNode | null;
  updateModule(moduleId: string, updates: Partial<ModuleConfig>, chainIndex?: number): void;
  updateSource(module: ModuleConfig, chainIndex?: number): void;
  updateComponent(module: ModuleConfig, chainIndex?: number): void;
  updateEffect(module: ModuleConfig, chainIndex?: number): void;
  attack(note: number, velocity: number): void;
  release(note: number): void;
  getModuleRuntime(chainIndex: number, moduleId: string): Runtime | null;
}

// Input manager options
export interface InputManagerOptions {
  onAttack: (note: number, velocity: number) => void;
  onRelease: (note: number) => void;
  onEnsureAudioStarted: () => void;
  onOctaveChange: (octave: number) => void;
  onVelocityChange: (velocity: number) => void;
  onUpdateKeyboardKeyState: (key: string, active: boolean) => void;
  onRenderMainCardContent: () => void;
  getGlobalState: () => GlobalState;
  getKeyboardElement: () => HTMLElement | null;
  getTransportInfoElement: () => HTMLElement | null;
  onSetCustomPreset: () => void;
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
  disconnectVoiceModulations(chainIndex: number, moduleId: string, voiceIndex: number): void;
  connectVoiceModulations(chainIndex: number, moduleId: string, voiceIndex: number): void;
  renderModulationOverlay(): void;
  bindEvents(): void;
}

// Macro manager interface
export interface MacroManager {
  getMainCardViewModel(): unknown;
  applyAllMappings(): void;
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

// Keyboard navigation interface
export interface KeyboardNavigationManager {
  saveFocusState(): void;
  restoreFocusState(container: HTMLElement | null): void;
  bind(): void;
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
