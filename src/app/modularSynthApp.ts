import type { Analyser } from "tone";
import {
  createBasePreset,
  createDefaultMacroChainState,
  normalizeCurrentPresetData,
  normalizePreset,
  importPresetFromFile,
  exportCurrentPresetToFile,
  exportAllPresetToFile,
  isAllTypePreset,
} from "../preset/preset";
import {
  loadAllPresets,
  getBuiltinPresets,
  getUserPresets,
  getPresetById,
  addUserPreset,
  removeUserPreset,
  generateUserPresetId,
  getLastSelectedId,
  saveLastSelectedId,
  isBuiltinPreset,
} from "../preset/presetLoader";
import { AudioEngine } from "../audio/audio";
import { InputManager } from "../input/inputManager";
import { ModulationManager } from "../interactions/modulation/modulationManager";
import { MacroManager } from "../interactions/macro/macroManager";
import { GestureManager, type GestureManagerApp } from "../interactions/gesture/gestureManager";
import { ModuleDragManager } from "../interactions/drag/moduleDragManager";
import { ENABLED as SOURCE_MONITOR_ENABLED, SourceOutputMonitor } from "../debug/sourceOutputMonitor";
import { KeyboardNavigationManager } from "../input/keyboardNavigation";
import {
  renderKeyboard,
  resizeScopeCanvas,
  startScopeRendering,
  stopScopeRendering,
  renderMainCard,
  renderMainCardContent,
  cacheDynamicElements as cacheDynamicElementsFn,
} from "../ui/components";
import { renderModuleCard } from "../ui/rendering/moduleRenderer";
import { layoutModuleMasonry } from "../ui/layout/masonryLayout";
import { createSelectControl } from "../ui/controls";
import {
  deepClone,
  getByPath,
  setByPath,
  createModule,
  getAddableModuleOptions,
  clamp,
  getModuleDefinition,
} from "../utils/helpers";
import { formatDb } from "../core/formatters";
import { t, setLanguage, getLanguage, subscribeToLanguageChange, type Language } from "../i18n";
import type {
  Preset,
  ChainState,
  ModuleConfig,
  ModulationConnection,
  ControlBinding,
  ModuleCategory,
  ModuleType,
} from "../types";

const CHAIN_COUNT = 4;

interface ModularSynthAppElements {
  statusText: HTMLElement | null;
  statusDot: HTMLElement | null;
  signalFlow: HTMLElement | null;
  signalFlowShell: HTMLElement | null;
  addModuleCard: HTMLElement | null;
  addModuleDropdown: HTMLElement | null;
  keyboard: HTMLElement | null;
  oscilloscope: HTMLCanvasElement | null;
  presetFileInput: HTMLInputElement | null;
  transportInfo: HTMLElement | null;
  presetSelect: HTMLSelectElement | null;
  importBtn: HTMLElement | null;
  exportBtn: HTMLElement | null;
  resetBtn: HTMLElement | null;
  randomBtn: HTMLElement | null;
  midiBtn: HTMLElement | null;
  masterReadout: HTMLElement | null;
  midiSelecter: HTMLElement | null;
}

interface PresetWithName extends Preset {
  name?: string;
}

export class ModularSynthApp {
  state: Preset;
  selectedPresetId: string | null;
  hasUnsavedChanges: boolean;
  audioBooted: boolean;

  heldPointerNotes: Set<string>;
  keyboardResizeObserver: ResizeObserver | null;
  _keyboardLastWidth: number;

  controlBindings: Map<string, ControlBinding>;

  scopeMode: "scope" | "spectrum";

  macroManager: MacroManager;
  gestureManager: GestureManager;
  modulationManager: ModulationManager;
  dragManager: ModuleDragManager;
  keyboardNavigation: KeyboardNavigationManager;
  engine: AudioEngine;

  inputManager: InputManager;

  elements: ModularSynthAppElements;
  scopeContext: CanvasRenderingContext2D | null;

  sourceMonitor: SourceOutputMonitor | undefined;

  selectedChainIndex: number;

  constructor() {
    this.state = createBasePreset();
    this.ensureChainsState();
    this.selectedPresetId = null;
    this.hasUnsavedChanges = false;
    this.audioBooted = false;

    this.heldPointerNotes = new Set();
    this.keyboardResizeObserver = null;
    this._keyboardLastWidth = 0;

    this.controlBindings = new Map();

    this.scopeMode = "scope";

    this.macroManager = new MacroManager(this as unknown as any);
    this.gestureManager = new GestureManager(this as unknown as GestureManagerApp);
    this.modulationManager = new ModulationManager(this);
    this.dragManager = new ModuleDragManager(this as unknown as unknown as Record<string, unknown>);
    this.keyboardNavigation = new KeyboardNavigationManager();
    this.engine = new AudioEngine(this as unknown as unknown as Record<string, unknown>);

    this.inputManager = new InputManager({
      onAttack: (note, velocity) => this.engine.attack(note as unknown as number, velocity),
      onRelease: (note) => this.engine.release(note as unknown as number),
      onEnsureAudioStarted: () => this.ensureAudioStarted(),
      onOctaveChange: (octave) => {
        this.state.global.octave = octave;
        this.renderKeyboard();
      },
      onVelocityChange: (velocity) => {
        this.state.global.velocity = velocity;
      },
      onUpdateKeyboardKeyState: (key, active) => this.updateKeyboardKeyState(key, active),
      onRenderMainCardContent: () => this.updateMainCardContent(),
      getGlobalState: () => this.state.global,
      getKeyboardElement: () => this.elements.keyboard,
      getTransportInfoElement: () => this.elements.transportInfo,
      onSetCustomPreset: () => {
        this.markUnsaved();
      },
    });

    this.cacheElements();
    this.bindEvents();
    subscribeToLanguageChange(() => this.renderAll());

    window.addEventListener("resize", () => {
      this.resizeScopeCanvas();
      this.layoutModuleMasonry();
      this.modulationManager.renderModulationOverlay();
      this.macroManager.renderMacroOverlay();
    });

    if (SOURCE_MONITOR_ENABLED) {
      this.sourceMonitor = new SourceOutputMonitor(this as unknown as unknown as Record<string, unknown>);
      this.sourceMonitor.start();
    }
  }

  ensureChainsState(): void {
    this.state = normalizePreset(this.state);
    this.selectedChainIndex = clamp(Number(this.state.selectedChainIndex ?? 0), 0, CHAIN_COUNT - 1);
    this.state.selectedChainIndex = this.selectedChainIndex;
  }

  getChainCount(): number {
    return CHAIN_COUNT;
  }

  getSelectedChainIndex(): number {
    return this.selectedChainIndex;
  }

  setSelectedChainIndex(index: number): void {
    this.selectedChainIndex = clamp(Number(index || 0), 0, CHAIN_COUNT - 1);
    this.state.selectedChainIndex = this.selectedChainIndex;
    this.engine.refreshCurrentRuntimeAlias();
  }

  getChain(chainIndex = this.selectedChainIndex): ChainState {
    const index = clamp(Number(chainIndex || 0), 0, CHAIN_COUNT - 1);
    if (!Array.isArray(this.state.chains)) {
      this.state.chains = [];
    }
    if (!this.state.chains[index]) {
      this.state.chains[index] = { enabled: false, modules: [], modulations: [] };
    }
    const chain = this.state.chains[index];
    if (!Array.isArray(chain.modules)) {
      chain.modules = [];
    }
    if (!Array.isArray(chain.modulations)) {
      chain.modulations = [];
    }
    chain.enabled = Boolean(chain.enabled);
    return chain;
  }

  getCurrentChain(): ChainState {
    return this.getChain(this.selectedChainIndex);
  }

  getCurrentModules(): ModuleConfig[] {
    return this.getCurrentChain().modules;
  }

  getCurrentModulations(): ModulationConnection[] {
    return this.getCurrentChain().modulations;
  }

  setCurrentModulations(nextModulations: ModulationConnection[]): void {
    this.getCurrentChain().modulations = Array.isArray(nextModulations) ? nextModulations : [];
  }

  isChainEnabled(chainIndex: number): boolean {
    return Boolean(this.getChain(chainIndex).enabled);
  }

  setChainEnabled(chainIndex: number, enabled: boolean): void {
    const chain = this.getChain(chainIndex);
    chain.enabled = Boolean(enabled);
  }

  cacheElements(): void {
    this.elements = {
      statusText: document.getElementById("statusText"),
      statusDot: document.getElementById("statusDot"),
      signalFlow: document.querySelector(".signal-flow"),
      signalFlowShell: document.querySelector(".signal-flow-shell"),
      addModuleCard: document.getElementById("addModuleCard"),
      addModuleDropdown: document.getElementById("addModuleDropdown"),
      keyboard: document.getElementById("virtualKeyboard"),
      oscilloscope: document.getElementById("oscilloscope") as HTMLCanvasElement | null,
      presetFileInput: document.getElementById("presetFileInput") as HTMLInputElement | null,
      transportInfo: document.getElementById("transportInfo"),
      presetSelect: document.getElementById("presetSelect") as HTMLSelectElement | null,
      importBtn: document.getElementById("importBtn"),
      exportBtn: document.getElementById("exportBtn"),
      resetBtn: document.getElementById("resetBtn"),
      randomBtn: document.getElementById("randomBtn"),
      midiBtn: document.getElementById("midiBtn"),
      masterReadout: document.getElementById("masterReadout"),
      midiSelecter: document.getElementById("midiSelecter"),
    };
    this.scopeContext = this.elements.oscilloscope?.getContext("2d") || null;
    if (this.elements.addModuleCard) {
      this.elements.addModuleCard.setAttribute("aria-label", t("Add module"));
    }
    document.title = t("Card Synth");
  }

  bindEvents(): void {
    const wakeAudio = () => {
      this.ensureAudioStarted();
    };

    document.addEventListener("pointerdown", wakeAudio, { passive: true });
    document.addEventListener("keydown", wakeAudio);

    this.inputManager.bindEvents();
    this.keyboardNavigation.bind();

    this.populateAddModuleDropdown();
    this.elements.addModuleCard?.addEventListener("click", (e) => {
      if (e.target instanceof Element && e.target.closest(".add-module-dropdown-item")) {
        return;
      }
      this.toggleAddModuleDropdown();
    });
    document.addEventListener("click", (e) => {
      if (e.target instanceof Element && !e.target.closest(".add-module-card")) {
        this.hideAddModuleDropdown();
      }
    });

    this.elements.presetFileInput?.addEventListener("change", async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        return;
      }

      try {
        const imported = await importPresetFromFile(file);
        const previousState = deepClone(this.state);

        if (imported.type === "all") {
          this.state = normalizePreset(imported.preset);
          this.setSelectedChainIndex(this.state.selectedChainIndex ?? 0);
        } else {
          const chain = this.getCurrentChain();
          chain.modules = imported.chain.modules as unknown as ModuleConfig[];
          chain.modulations = imported.chain.modulations as unknown as ModulationConnection[];

          this.macroManager.ensureMacroState();
          this.state.macro.chains[this.getSelectedChainIndex()] = imported.chain.macro || createDefaultMacroChainState();
        }

        const baseName = file.name.replace(/\.json$/i, "");
        const presetId = generateUserPresetId(baseName || "imported");
        addUserPreset(presetId, imported.type === "all" ? imported.preset : imported.chain);
        this.selectedPresetId = presetId;
        this.hasUnsavedChanges = false;
        saveLastSelectedId(presetId);

        this.renderAll(previousState);
        this.engine.fullSync(this.state);
        this.setStatus(
          imported.type === "all"
            ? t("Imported all chains from {{filename}}.", { filename: file.name })
            : t("Imported current chain from {{filename}}.", { filename: file.name }),
          "live",
        );
      } catch (error: unknown) {
        this.setStatus(t("Import failed: {{error}}", { error: error instanceof Error ? error.message : String(error) }), "error");
      } finally {
        (event.target as HTMLInputElement).value = "";
      }
    });

    this.modulationManager.bindEvents();
    this.macroManager.bindEvents();
  }

  setStatus(message: string, tone = "neutral"): void {
    if (this.elements.statusText) {
      this.elements.statusText.textContent = message;
    }
    if (this.elements.statusDot) {
      this.elements.statusDot.classList.remove("live", "error");
      if (tone === "live") {
        this.elements.statusDot.classList.add("live");
      }
      if (tone === "error") {
        this.elements.statusDot.classList.add("error");
      }
    }
  }

  async ensureAudioStarted(): Promise<void> {
    if (this.audioBooted) {
      return;
    }
    try {
      await this.engine.start(this.state);
      this.audioBooted = true;
      this.setStatus(t("Audio ready."), "live");
    } catch (error: unknown) {
      this.setStatus(t("Audio failed: {{error}}", { error: error instanceof Error ? error.message : String(error) }), "error");
    }
  }

  populateAddModuleDropdown(): void {
    const dropdown = this.elements.addModuleDropdown;
    if (!dropdown) {
      return;
    }

    dropdown.innerHTML = "";

    const options = getAddableModuleOptions();

    const groups: Record<string, { title: string; items: ReturnType<typeof getAddableModuleOptions> }> = {
      input: { title: t("Input"), items: [] },
      source: { title: t("Source"), items: [] },
      component: { title: t("Envelope"), items: [] },
      effect: { title: t("Effect"), items: [] },
    };

    options.forEach((option) => {
      const kind = option.category;
      if (groups[kind]) {
        groups[kind].items.push(option);
      }
    });

    Object.entries(groups).forEach(([kind, group]) => {
      if (group.items.length === 0) {
        return;
      }

      const groupEl = document.createElement("div");
      groupEl.className = "add-module-dropdown-group";

      const titleEl = document.createElement("div");
      titleEl.className = "add-module-dropdown-group-title";
      titleEl.textContent = group.title;
      groupEl.appendChild(titleEl);

      group.items.forEach((option) => {
        const itemEl = document.createElement("div");
        itemEl.className = "add-module-dropdown-item";
        itemEl.dataset.value = option.value;
        itemEl.textContent = option.label;
        itemEl.addEventListener("click", (e) => {
          e.stopPropagation();
          this.handleAddModule(option.value);
          this.hideAddModuleDropdown();
        });
        groupEl.appendChild(itemEl);
      });

      dropdown.appendChild(groupEl);
    });
  }

  toggleAddModuleDropdown(): void {
    const dropdown = this.elements.addModuleDropdown;
    const card = this.elements.addModuleCard;
    if (!dropdown || !card) {
      return;
    }

    const isVisible = dropdown.classList.contains("visible");
    if (isVisible) {
      this.hideAddModuleDropdown();
    } else {
      this.positionDropdown(dropdown, card);
      dropdown.classList.add("visible");
      card.classList.add("active");
    }
  }

  positionDropdown(dropdown: HTMLElement, anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const dropdownHeight = 300;
    const dropdownWidth = 180;
    const gap = 4;

    dropdown.style.left = "";
    dropdown.style.top = "";
    dropdown.style.right = "";
    dropdown.style.bottom = "";
    dropdown.classList.remove("above");

    let top: number;
    const spaceBelow = viewportHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;

    if (spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove) {
      top = rect.bottom + gap;
    } else {
      top = rect.top - gap - dropdownHeight;
      dropdown.classList.add("above");
    }

    let left = rect.left;
    if (left + dropdownWidth > viewportWidth) {
      left = viewportWidth - dropdownWidth - 10;
    }
    if (left < 10) {
      left = 10;
    }

    dropdown.style.left = `${left}px`;
    dropdown.style.top = `${top}px`;
    dropdown.style.width = `${Math.max(rect.width, dropdownWidth)}px`;
  }

  hideAddModuleDropdown(): void {
    const dropdown = this.elements.addModuleDropdown;
    const card = this.elements.addModuleCard;
    if (dropdown) {
      dropdown.classList.remove("visible");
      dropdown.classList.remove("above");
    }
    if (card) {
      card.classList.remove("active");
    }
  }

  handleAddModule(value: string): void {
    if (!value) {
      return;
    }

    const [category, type] = value.split(":");
    const newModule = createModule(category as ModuleCategory, type as ModuleType);
    this.getCurrentModules().push(newModule);
    this.markUnsaved();
    this.renderAll();
    this.engine.fullSync(this.state);
  }

  renderAll(previousState: Preset | null = null): void {
    this.keyboardNavigation.saveFocusState();
    this.populateAddModuleDropdown();
    this.controlBindings = new Map();
    this.macroManager.applyAllMappings();

    const sections: [string, () => void][] = [
      ["main-card content", () => this.updateMainCardContent()],
      ["modules", () => this.renderModulesRack()],
      ["keyboard", () => this.renderKeyboard()],
      ["transport", () => this.inputManager.updateTransportInfo()],
    ];

    for (const [label, task] of sections) {
      try {
        task();
      } catch (error: unknown) {
        console.error(`Render error in ${label}:`, error);
        this.setStatus(t("Render error in {{label}}: {{error}}", { label, error: error instanceof Error ? error.message : String(error) }), "error");
      }
    }

    const dynamicElements = cacheDynamicElementsFn();
    Object.assign(this.elements, dynamicElements);

    if (dynamicElements.oscilloscope) {
      this.scopeContext = dynamicElements.scopeContext || null;

      dynamicElements.oscilloscope.addEventListener("click", () => {
        this.toggleScopeMode();
      });
    }

    this.resizeScopeCanvas();

    this.layoutModuleMasonry();
    this.modulationManager.renderModulationOverlay();
    this.macroManager.renderMacroOverlay();

    if (previousState) {
      this.animateControlTransition(previousState, this.state);
    }

    this.keyboardNavigation.restoreFocusState(this.elements.signalFlow);
  }

  layoutModuleMasonry(): void {
    const container = this.elements.signalFlow;
    if (!container) {
      return;
    }

    const addCard = container.querySelector(".add-module-card");
    const mainCard = container.querySelector('.module-card[data-main-card="true"]');

    layoutModuleMasonry({ container, modules: this.getCurrentModules(), addCard: addCard as HTMLElement | null, mainCard: mainCard as HTMLElement | null });
  }

  updateMainCardContent(): void {
    renderMainCardContent({
      updatePresetSelect: () => this.updatePresetSelect(),
      updateMasterReadout: (value) => this.updateMasterReadout(value),
      updateMidiStatus: () => this.updateMidiStatus(),
      volume: this.state.global.volume,
    });
  }

  updatePresetSelect(): void {
    if (this.elements.presetSelect) {
      this.elements.presetSelect.value = this.selectedPresetId ?? "";
    }
  }

  updateMasterReadout(value: number): void {
    if (this.elements.masterReadout) {
      this.elements.masterReadout.textContent = formatDb(value);
    }
  }

  updateMidiStatus(): void {
    const container = this.elements.midiSelecter;
    if (!container) return;

    const supported = this.inputManager.getMidiSupported();
    const inputs = this.inputManager.getMidiInputs();
    const selectedId = this.inputManager.getMidiSelectedInputId();

    if (this.elements.midiBtn) {
      this.elements.midiBtn.textContent = inputs.length > 0 ? t("MIDI Off") : t("MIDI On");
    }

    const options = inputs.map((input) => ({
      value: input.id,
      label: input.name || input.id,
    }));

    const selectControl = createSelectControl({
      label: t("MIDI"),
      options: options.length > 0 ? options : [{ value: "", label: supported ? t("No devices") : t("Unsupported") }],
      value: selectedId || "",
      onChange: (value) => {
        if (value) {
          this.inputManager.selectMidiInput(value);
        }
      },
    });

    selectControl.classList.add("midi-selecter-control");
    const selectEl = selectControl.querySelector(".select-input");
    if (!supported || inputs.length === 0) {
      (selectEl as HTMLSelectElement).disabled = true;
    }

    container.innerHTML = "";
    container.appendChild(selectControl);
  }

  renderModulesRack(): void {
    const container = this.elements.signalFlow;
    if (!container) {
      return;
    }

    const addCard = container.querySelector(".add-module-card");
    const existingMainCard = container.querySelector('.module-card[data-main-card="true"]');

    const oldModuleCards = container.querySelectorAll('.module-card:not([data-main-card="true"])');
    oldModuleCards.forEach((card) => card.remove());

    if (existingMainCard) {
      existingMainCard.remove();
    }

    const mainCardOptions = {
      selectedPresetId: this.selectedPresetId,
      hasUnsavedChanges: this.hasUnsavedChanges,
      builtinPresets: getBuiltinPresets(),
      userPresets: getUserPresets(),
      state: this.state,
      selectedChainIndex: this.getSelectedChainIndex(),
      chains: this.state.chains,
      macro: this.macroManager.getMainCardViewModel(),
      audioBooted: this.audioBooted,
      onPresetChange: (value: string) => this.applyPresetById(value),
      onChainIndexClick: (chainIndex: number, isSelected: boolean) => {
        if (!isSelected) {
          this.setSelectedChainIndex(chainIndex);
          this.renderAll();
          return;
        }

        this.setChainEnabled(chainIndex, !this.isChainEnabled(chainIndex));
        this.markUnsaved();
        this.renderAll();
        this.engine.fullSync(this.state);
      },
      onImportClick: () => this.elements.presetFileInput?.click(),
      onExportCurrentClick: () => {
        const currentPreset = getPresetById(this.selectedPresetId) as PresetWithName | null;
        const presetName = currentPreset?.name || this.selectedPresetId || "preset";
        const filename = exportCurrentPresetToFile(this.state, this.getSelectedChainIndex(), presetName);
        this.setStatus(t("Exported {{filename}}.", { filename }), this.audioBooted ? "live" : "neutral");
      },
      onExportAllClick: () => {
        const currentPreset = getPresetById(this.selectedPresetId) as PresetWithName | null;
        const presetName = currentPreset?.name || this.selectedPresetId || "preset";
        const filename = exportAllPresetToFile(this.state, presetName);
        this.setStatus(t("Exported {{filename}}.", { filename }), this.audioBooted ? "live" : "neutral");
      },
      onResetClick: () => {
        const builtins = getBuiltinPresets();
        const firstId = Object.keys(builtins)[0];
        if (firstId) this.applyPresetById(firstId);
      },
      onRandomClick: () => this.randomizeCurrentPatch(),
      midiEnabled: this.inputManager.getMidiInputs().length > 0,
      onMidiToggle: (enabled: boolean) => {
        const isOn = this.inputManager.getMidiInputs().length > 0;
        if (enabled && !isOn) {
          this.inputManager.requestMidiAccess();
        } else if (!enabled && isOn) {
          this.inputManager.closeMidi();
        }
      },
      onMasterVolumeChange: (value: number) => {
        this.state.global.volume = value;
        this.markUnsaved();
        this.engine.updateGlobal(this.state.global);
      },
      onVelocityEnabledChange: (value: boolean) => {
        this.state.global.velocityEnabled = value;
        this.markUnsaved();
        this.engine.updateGlobal(this.state.global);
      },
      onPolyVoiceChange: (value: number) => {
        this.state.global.polyVoice = clamp(Number(value), 2, 8);
        this.markUnsaved();
        this.engine.updateGlobal(this.state.global);
      },
      onMacroPointPointerDown: (event: PointerEvent, chainIndex: number, padElement: HTMLElement) => {
        this.macroManager.startPointDrag({ event, chainIndex, padElement });
      },
      onMacroAxisPointerDown: (event: PointerEvent, axis: string) => {
        this.macroManager.startAxisBindingDrag({
          event,
          axis: axis as "x" | "y" | "z",
          chainIndex: this.getSelectedChainIndex(),
        });
      },
      onGestureClick: () => {
        this.gestureManager.activate();
      },
      onDeleteUserPreset: (id: string) => {
        removeUserPreset(id);
        if (this.selectedPresetId === id) {
          const builtins = getBuiltinPresets();
          const firstId = Object.keys(builtins)[0];
          if (firstId) this.applyPresetById(firstId);
        } else {
          this.renderAll();
        }
      },
      onLanguageChange: (lang: Language) => {
        setLanguage(lang);
      },
    };

    const mainCard = renderMainCard(mainCardOptions);
    if (mainCard) {
      if (addCard) {
        container.insertBefore(mainCard, addCard);
      } else {
        container.appendChild(mainCard);
      }
    }

    const modules = this.getCurrentModules();
    modules.forEach((module, index) => {
      const card = renderModuleCard(module, index, this as unknown as any);
      if (card) {
        if (addCard) {
          container.insertBefore(card, addCard);
        } else {
          container.appendChild(card);
        }
      }
    });
  }

  renderKeyboard(): void {
    const keyboard = document.getElementById("virtualKeyboard");
    if (!keyboard) {
      return;
    }

    const onOctaveChange = (octave: number) => {
      this.state.global.octave = octave;
      this.renderKeyboard();
      this.inputManager.updateTransportInfo();
      this.markUnsaved();
    };

    const doRender = () =>
      renderKeyboard(
        keyboard,
        this.state,
        this.inputManager,
        () => this.ensureAudioStarted(),
        this.heldPointerNotes,
        onOctaveChange
      );

    doRender();

    if (!this.keyboardResizeObserver) {
      this.keyboardResizeObserver = new ResizeObserver((entries) => {
        const newWidth = entries[0]?.contentRect?.width;
        if (newWidth && newWidth !== this._keyboardLastWidth) {
          this._keyboardLastWidth = newWidth;
          const kb = document.getElementById("virtualKeyboard");
          if (kb) {
            renderKeyboard(
              kb,
              this.state,
              this.inputManager,
              () => this.ensureAudioStarted(),
              this.heldPointerNotes,
              onOctaveChange
            );
          }
        }
      });
    }

    this._keyboardLastWidth = keyboard.clientWidth;
    this.keyboardResizeObserver.disconnect();
    this.keyboardResizeObserver.observe(keyboard);
  }

  resizeScopeCanvas(): void {
    const canvas = this.elements.oscilloscope;
    const context = this.scopeContext;
    if (canvas && context) {
      resizeScopeCanvas(canvas, context);
    }
  }

  drawOscilloscope(): void {
    stopScopeRendering();
    startScopeRendering({
      getCanvasFn: () => this.elements.oscilloscope,
      getContextFn: () => this.scopeContext,
      getAnalyserFn: () => this.engine.getAnalyser() as unknown as Analyser,
      getSpectrumAnalyserFn: () => this.engine.getSpectrumAnalyser() as unknown as Analyser,
      getAudioBootedFn: () => this.audioBooted,
      getModeFn: () => this.scopeMode,
    });
  }

  toggleScopeMode(): void {
    this.scopeMode = this.scopeMode === "scope" ? "spectrum" : "scope";
  }

  isModulationSource(module: ModuleConfig): boolean {
    return this.modulationManager.isModulationSource(module);
  }

  getModulations(): ModulationConnection[] {
    return this.modulationManager.getModulations();
  }

  getOutgoingModulations(sourceModuleId: string): ModulationConnection[] {
    return this.modulationManager.getOutgoingModulations(sourceModuleId);
  }

  getModulationByTarget(targetModuleId: string, targetParamPath: string): ModulationConnection | undefined {
    return this.modulationManager.getModulationByTarget(targetModuleId, targetParamPath);
  }

  startModulationDrag(options: unknown): void {
    this.modulationManager.startModulationDrag(options as any);
  }

  removeModulationById(connectionId: string): void {
    this.modulationManager.removeModulationById(connectionId);
  }

  removeOutgoingModulations(sourceModuleId: string): void {
    this.modulationManager.removeOutgoingModulations(sourceModuleId);
  }

  removeModuleModulations(moduleId: string): void {
    this.modulationManager.removeModuleModulations(moduleId);
  }

  initModuleDrag(event: PointerEvent, card: HTMLElement, moduleIndex: number): void {
    this.dragManager.initModuleDrag(event, card, moduleIndex);
  }

  async init(): Promise<void> {
    await loadAllPresets();

    const lastId = getLastSelectedId();
    if (lastId && getPresetById(lastId)) {
      this.applyPresetById(lastId, false);
    } else {
      const builtins = getBuiltinPresets();
      const defaultId = "default";
      const targetId = builtins[defaultId] ? defaultId : Object.keys(builtins)[0];
      if (targetId) {
        this.applyPresetById(targetId, false);
      }
    }

    this.renderAll();

    const scopeEl = document.getElementById("oscilloscope");
    if (scopeEl) {
      this.elements.oscilloscope = scopeEl as HTMLCanvasElement;
      this.scopeContext = (scopeEl as HTMLCanvasElement).getContext("2d") || null;
    }
    this.resizeScopeCanvas();
    this.drawOscilloscope();
  }

  applyPresetById(presetId: string, shouldRender = true): void {
    const preset = getPresetById(presetId);
    if (!preset) {
      return;
    }

    const previousState = deepClone(this.state);

    if (isAllTypePreset(preset)) {
      this.state = normalizePreset(preset);
      this.setSelectedChainIndex(this.state.selectedChainIndex ?? 0);
    } else {
      const chainPreset = normalizeCurrentPresetData(preset as any);
      const chain = this.getCurrentChain();

      chain.modules = chainPreset.modules as unknown as ModuleConfig[];
      chain.modulations = chainPreset.modulations as unknown as ModulationConnection[];
      chain.enabled = true;
      this.state.macro.chains[this.getSelectedChainIndex()] = chainPreset.macro || createDefaultMacroChainState();
    }

    this.selectedPresetId = presetId;
    this.hasUnsavedChanges = false;
    saveLastSelectedId(presetId);

    if (shouldRender) {
      this.renderAll(previousState);
      this.engine.fullSync(this.state);
    }

    const loadedPreset = getPresetById(presetId) as PresetWithName | null;
    const presetName = loadedPreset?.name || presetId;
    this.setStatus(t("LOADED PRESET: {{name}}.", { name: presetName }), this.audioBooted ? "live" : "neutral");
  }

  markUnsaved(): void {
    if (!this.hasUnsavedChanges) {
      this.hasUnsavedChanges = true;
      this.renderAll();
    }
  }

  syncControlsFromState(): void {
    this.controlBindings.forEach((binding, path) => {
      const value = getByPath(this.state as unknown as unknown as Record<string, unknown>, path);
      if (typeof value === "number" && Number.isFinite(value)) {
        binding.setVisual(value);
      }
    });
  }

  animateControlTransition(fromState: Preset, toState: Preset): void {
    const animations: Array<{ binding: ControlBinding; startValue: number; endValue: number }> = [];

    this.controlBindings.forEach((binding, path) => {
      const startValue = getByPath(fromState as unknown as unknown as Record<string, unknown>, path);
      const endValue = getByPath(toState as unknown as unknown as Record<string, unknown>, path);

      if (
        typeof startValue === "number" &&
        Number.isFinite(startValue) &&
        typeof endValue === "number" &&
        Number.isFinite(endValue)
      ) {
        binding.setVisual(startValue);
        animations.push({ binding, startValue, endValue });
      }
    });

    if (!animations.length) {
      return;
    }

    const duration = 360;
    const startTime = performance.now();
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    const frame = (now: number) => {
      const progress = clamp((now - startTime) / duration, 0, 1);
      const eased = easeOut(progress);

      animations.forEach(({ binding, startValue, endValue }) => {
        binding.setVisual(startValue + (endValue - startValue) * eased);
      });

      if (progress < 1) {
        requestAnimationFrame(frame);
      }
    };

    requestAnimationFrame(frame);
  }

  randomizeCurrentPatch(): void {
    const randomChoice = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
    const randomRange = (min: number, max: number, step = 0.01): number => {
      const steps = Math.round((max - min) / step);
      return min + Math.floor(Math.random() * (steps + 1)) * step;
    };

    const previousState = deepClone(this.state);
    this.state.global.volume = randomRange(-16, -4, 0.1);
    this.state.global.velocity = randomRange(0.55, 1, 0.01);

    const modules = this.getCurrentModules();
    modules.forEach((module) => {
      const definition = getModuleDefinition(module);
      if (module.category === "source") {
        module.volume = randomRange(-18, -4, 0.1);
        module.pan = randomRange(-0.45, 0.45, 0.01);
      }
      definition.controls.forEach((control) => {
        if (control.kind === "select") {
          setByPath(module, control.path, randomChoice(control.options!).value);
        } else {
          setByPath(module, control.path, randomRange(control.min!, control.max!, control.step!));
        }
      });
    });

    this.markUnsaved();
    this.renderAll(previousState);
    this.engine.fullSync(this.state);
    this.setStatus(t("Randomized the current patch."), this.audioBooted ? "live" : "neutral");
  }

  updateKeyboardKeyState(boundKey: string, active: boolean): void {
    const visualKey = this.elements.keyboard?.querySelector(`[data-key="${boundKey}"]`);
    if (!visualKey) {
      return;
    }
    (visualKey as HTMLElement).classList.toggle("active", active);
  }
}
