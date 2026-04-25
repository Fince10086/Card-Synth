import {
  createBasePreset,
  createDefaultMacroChainState,
  normalizeCurrentPresetData,
  normalizePreset,
  importPresetFromFile,
  exportCurrentPresetToFile,
  exportAllPresetToFile,
  isAllTypePreset,
} from "../preset/preset.js";
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
} from "../preset/presetLoader.js";
import { AudioEngine } from "../audio/audio.js";
import { InputManager } from "../input/inputManager.js";
import { ModulationManager } from "../interactions/modulation/modulationManager.js";
import { MacroManager } from "../interactions/macro/macroManager.js";
import { GestureManager } from "../interactions/gesture/gestureManager.js";
import { ModuleDragManager } from "../interactions/drag/moduleDragManager.js";
import { ENABLED as SOURCE_MONITOR_ENABLED, SourceOutputMonitor } from "../debug/sourceOutputMonitor.js";
import { KeyboardNavigationManager } from "../input/keyboardNavigation.js";
import {
  renderKeyboard,
  resizeScopeCanvas,
  startScopeRendering,
  stopScopeRendering,
  renderMainCard,
  renderMainCardContent,
  cacheDynamicElements as cacheDynamicElementsFn,
} from "../ui/components/index.js";
import { renderModuleCard } from "../ui/rendering/moduleRenderer.js";
import { layoutModuleMasonry } from "../ui/layout/masonryLayout.js";
import { createSelectControl } from "../ui/controls/index.js";
import {
  deepClone,
  getByPath,
  setByPath,
  createModule,
  getAddableModuleOptions,
  clamp,
  getModuleDefinition,
} from "../utils/helpers.js";
import { formatDb } from "../core/formatters.js";

const CHAIN_COUNT = 4;

export class ModularSynthApp {
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

    this.macroManager = new MacroManager(this);
    this.gestureManager = new GestureManager(this);
    this.modulationManager = new ModulationManager(this);
    this.dragManager = new ModuleDragManager(this);
    this.keyboardNavigation = new KeyboardNavigationManager();
    this.engine = new AudioEngine(this);

    this.inputManager = new InputManager({
      onAttack: (note, velocity) => this.engine.attack(note, velocity),
      onRelease: (note) => this.engine.release(note),
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

    window.addEventListener("resize", () => {
      this.resizeScopeCanvas();
      this.layoutModuleMasonry();
      this.modulationManager.renderModulationOverlay();
      this.macroManager.renderMacroOverlay();
    });

    // Debug: 启动 Source 输出监控（如已启用）
    if (SOURCE_MONITOR_ENABLED) {
      this.sourceMonitor = new SourceOutputMonitor(this);
      this.sourceMonitor.start();
    }
  }

  ensureChainsState() {
    this.state = normalizePreset(this.state);
    this.selectedChainIndex = clamp(Number(this.state.selectedChainIndex ?? 0), 0, CHAIN_COUNT - 1);
    this.state.selectedChainIndex = this.selectedChainIndex;
  }

  getChainCount() {
    return CHAIN_COUNT;
  }

  getSelectedChainIndex() {
    return this.selectedChainIndex;
  }

  setSelectedChainIndex(index) {
    this.selectedChainIndex = clamp(Number(index || 0), 0, CHAIN_COUNT - 1);
    this.state.selectedChainIndex = this.selectedChainIndex;
    this.engine?.refreshCurrentRuntimeAlias?.();
  }

  getChain(chainIndex = this.selectedChainIndex) {
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

  getCurrentChain() {
    return this.getChain(this.selectedChainIndex);
  }

  getCurrentModules() {
    return this.getCurrentChain().modules;
  }

  getCurrentModulations() {
    return this.getCurrentChain().modulations;
  }

  setCurrentModulations(nextModulations) {
    this.getCurrentChain().modulations = Array.isArray(nextModulations) ? nextModulations : [];
  }

  isChainEnabled(chainIndex) {
    return Boolean(this.getChain(chainIndex).enabled);
  }

  setChainEnabled(chainIndex, enabled) {
    const chain = this.getChain(chainIndex);
    chain.enabled = Boolean(enabled);
  }

  cacheElements() {
    this.elements = {
      statusText: document.getElementById("statusText"),
      statusDot: document.getElementById("statusDot"),
      signalFlow: document.querySelector(".signal-flow"),
      signalFlowShell: document.querySelector(".signal-flow-shell"),
      addModuleCard: document.getElementById("addModuleCard"),
      addModuleDropdown: document.getElementById("addModuleDropdown"),
      keyboard: document.getElementById("virtualKeyboard"),
      oscilloscope: document.getElementById("oscilloscope"),
      presetFileInput: document.getElementById("presetFileInput"),
      transportInfo: document.getElementById("transportInfo"),
      presetSelect: document.getElementById("presetSelect"),
      importBtn: document.getElementById("importBtn"),
      exportBtn: document.getElementById("exportBtn"),
      resetBtn: document.getElementById("resetBtn"),
      randomBtn: document.getElementById("randomBtn"),
      midiBtn: document.getElementById("midiBtn"),
      masterReadout: document.getElementById("masterReadout"),
      midiSelecter: document.getElementById("midiSelecter"),
    };
    this.scopeContext = this.elements.oscilloscope?.getContext("2d") || null;
  }

  bindEvents() {
    const wakeAudio = () => {
      this.ensureAudioStarted();
    };

    document.addEventListener("pointerdown", wakeAudio, { passive: true });
    document.addEventListener("keydown", wakeAudio);

    this.inputManager.bindEvents();
    this.keyboardNavigation.bind();

    this.populateAddModuleDropdown();
    this.elements.addModuleCard?.addEventListener("click", (e) => {
      if (e.target.closest(".add-module-dropdown-item")) {
        return;
      }
      this.toggleAddModuleDropdown();
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".add-module-card")) {
        this.hideAddModuleDropdown();
      }
    });

    this.elements.presetFileInput?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
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
          chain.modules = imported.chain.modules;
          chain.modulations = imported.chain.modulations;

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
            ? `Imported all chains from ${file.name}.`
            : `Imported current chain from ${file.name}.`,
          "live",
        );
      } catch (error) {
        this.setStatus(`Import failed: ${error.message}`, "error");
      } finally {
        event.target.value = "";
      }
    });

    this.modulationManager.bindEvents();
    this.macroManager.bindEvents();
  }

  setStatus(message, tone = "neutral") {
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

  async ensureAudioStarted() {
    if (this.audioBooted) {
      return;
    }
    try {
      await this.engine.start(this.state);
      this.audioBooted = true;
      this.setStatus("Audio ready.", "live");
    } catch (error) {
      this.setStatus(`Audio failed: ${error.message}`, "error");
    }
  }

  populateAddModuleDropdown() {
    const dropdown = this.elements.addModuleDropdown;
    if (!dropdown) {
      return;
    }

    dropdown.innerHTML = "";

    const options = getAddableModuleOptions();

    const groups = {
      source: { title: "声源", items: [] },
      component: { title: "组件", items: [] },
      effect: { title: "效果器", items: [] },
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

  toggleAddModuleDropdown() {
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

  positionDropdown(dropdown, anchor) {
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

    let top;
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

  hideAddModuleDropdown() {
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

  handleAddModule(value) {
    if (!value) {
      return;
    }

    const [category, type] = value.split(":");
    const newModule = createModule(category, type);
    this.getCurrentModules().push(newModule);
    this.markUnsaved();
    this.renderAll();
    this.engine.fullSync(this.state);
  }

  renderAll(previousState = null) {
    this.keyboardNavigation.saveFocusState();
    this.populateAddModuleDropdown();
    this.controlBindings = new Map();
    this.macroManager.applyAllMappings();

    const sections = [
      ["main-card content", () => this.updateMainCardContent()],
      ["modules", () => this.renderModulesRack()],
      ["keyboard", () => this.renderKeyboard()],
      ["transport", () => this.inputManager.updateTransportInfo()],
    ];

    for (const [label, task] of sections) {
      try {
        task();
      } catch (error) {
        console.error(`Render error in ${label}:`, error);
        this.setStatus(`Render error in ${label}: ${error.message}`, "error");
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

  layoutModuleMasonry() {
    const container = this.elements.signalFlow;
    if (!container) {
      return;
    }

    const addCard = container.querySelector(".add-module-card");
    const mainCard = container.querySelector('.module-card[data-main-card="true"]');

    layoutModuleMasonry({ container, modules: this.getCurrentModules(), addCard, mainCard });
  }

  updateMainCardContent() {
    renderMainCardContent({
      updatePresetSelect: () => this.updatePresetSelect(),
      updateMasterReadout: (value) => this.updateMasterReadout(value),
      updateMidiStatus: () => this.updateMidiStatus(),
      volume: this.state.global.volume,
    });
  }

  updatePresetSelect() {
    if (this.elements.presetSelect) {
      this.elements.presetSelect.value = this.selectedPresetId;
    }
  }

  updateMasterReadout(value) {
    if (this.elements.masterReadout) {
      this.elements.masterReadout.textContent = formatDb(value);
    }
  }

  updateMidiStatus() {
    const container = this.elements.midiSelecter;
    if (!container) return;

    const supported = this.inputManager.getMidiSupported();
    const inputs = this.inputManager.getMidiInputs();
    const selectedId = this.inputManager.getMidiSelectedInputId();

    if (this.elements.midiBtn) {
      this.elements.midiBtn.textContent = inputs.length > 0 ? "MIDI Off" : "MIDI On";
    }

    const options = inputs.map((input) => ({
      value: input.id,
      label: input.name || input.id,
    }));

    const selectControl = createSelectControl({
      label: "MIDI",
      options: options.length > 0 ? options : [{ value: "", label: supported ? "No devices" : "Unsupported" }],
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
      selectEl.disabled = true;
    }

    container.innerHTML = "";
    container.appendChild(selectControl);
  }

  renderModulesRack() {
    const container = this.elements.signalFlow;
    if (!container) {
      return;
    }

    const addCard = container.querySelector(".add-module-card");
    const existingMainCard = container.querySelector('.module-card[data-main-card="true"]');

    // 删除所有普通模块卡（保留主卡和添加卡）
    const oldModuleCards = container.querySelectorAll('.module-card:not([data-main-card="true"])');
    oldModuleCards.forEach((card) => card.remove());

    // 主卡包含动态内容（preset select、删除按钮等），每次重建以确保状态正确
    if (existingMainCard) {
      existingMainCard.remove();
    }

    // 创建主卡
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
        onPresetChange: (value) => this.applyPresetById(value),
        onChainIndexClick: (chainIndex, isSelected) => {
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
          const currentPreset = getPresetById(this.selectedPresetId);
          const presetName = currentPreset?.name || this.selectedPresetId || "preset";
          const filename = exportCurrentPresetToFile(this.state, this.getSelectedChainIndex(), presetName);
          this.setStatus(`Exported ${filename}.`, this.audioBooted ? "live" : "neutral");
        },
        onExportAllClick: () => {
          const currentPreset = getPresetById(this.selectedPresetId);
          const presetName = currentPreset?.name || this.selectedPresetId || "preset";
          const filename = exportAllPresetToFile(this.state, presetName);
          this.setStatus(`Exported ${filename}.`, this.audioBooted ? "live" : "neutral");
        },
        onResetClick: () => {
          const builtins = getBuiltinPresets();
          const firstId = Object.keys(builtins)[0];
          if (firstId) this.applyPresetById(firstId);
        },
        onRandomClick: () => this.randomizeCurrentPatch(),
        onMidiClick: () => {
          if (this.inputManager.getMidiInputs().length > 0) {
            this.inputManager.closeMidi();
          } else {
            this.inputManager.requestMidiAccess();
          }
        },
        onMasterVolumeChange: (value) => {
          this.state.global.volume = value;
          this.markUnsaved();
          this.engine.updateGlobal(this.state.global);
        },
        onVelocityEnabledChange: (value) => {
          this.state.global.velocityEnabled = value;
          this.markUnsaved();
          this.engine.updateGlobal(this.state.global);
        },
        onMacroPointPointerDown: (event, chainIndex, padElement) => {
          this.macroManager.startPointDrag({ event, chainIndex, padElement });
        },
        onMacroAxisPointerDown: (event, axis) => {
          this.macroManager.startAxisBindingDrag({
            event,
            axis,
            chainIndex: this.getSelectedChainIndex(),
          });
        },
        onGestureClick: () => {
          this.gestureManager.activate();
        },
        onDeleteUserPreset: (id) => {
          removeUserPreset(id);
          if (this.selectedPresetId === id) {
            const builtins = getBuiltinPresets();
            const firstId = Object.keys(builtins)[0];
            if (firstId) this.applyPresetById(firstId);
          } else {
            this.renderAll();
          }
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

    // 重建普通模块
    const modules = this.getCurrentModules();
    modules.forEach((module, index) => {
      const card = renderModuleCard(module, index, this);
      if (card) {
        if (addCard) {
          container.insertBefore(card, addCard);
        } else {
          container.appendChild(card);
        }
      }
    });
  }

  renderKeyboard() {
    const keyboard = document.getElementById("virtualKeyboard");
    if (!keyboard) {
      return;
    }

    const doRender = () =>
      renderKeyboard(
        keyboard,
        this.state,
        this.inputManager,
        () => this.ensureAudioStarted(),
        this.heldPointerNotes
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
              this.heldPointerNotes
            );
          }
        }
      });
    }

    this._keyboardLastWidth = keyboard.clientWidth;
    this.keyboardResizeObserver.disconnect();
    this.keyboardResizeObserver.observe(keyboard);
  }

  resizeScopeCanvas() {
    const canvas = this.elements.oscilloscope;
    const context = this.scopeContext;
    if (canvas && context) {
      resizeScopeCanvas(canvas, context);
    }
  }

  drawOscilloscope() {
    stopScopeRendering();
    startScopeRendering({
      getCanvasFn: () => this.elements.oscilloscope,
      getContextFn: () => this.scopeContext,
      getAnalyserFn: () => this.engine.getAnalyser(),
      getSpectrumAnalyserFn: () => this.engine.getSpectrumAnalyser(),
      getAudioBootedFn: () => this.audioBooted,
      getModeFn: () => this.scopeMode,
    });
  }

  toggleScopeMode() {
    this.scopeMode = this.scopeMode === "scope" ? "spectrum" : "scope";
  }

  isModulationSource(module) {
    return this.modulationManager.isModulationSource(module);
  }

  getModulations() {
    return this.modulationManager.getModulations();
  }

  getOutgoingModulations(sourceModuleId) {
    return this.modulationManager.getOutgoingModulations(sourceModuleId);
  }

  getModulationByTarget(targetModuleId, targetParamPath) {
    return this.modulationManager.getModulationByTarget(targetModuleId, targetParamPath);
  }

  startModulationDrag(options) {
    this.modulationManager.startModulationDrag(options);
  }

  removeModulationById(connectionId) {
    this.modulationManager.removeModulationById(connectionId);
  }

  removeOutgoingModulations(sourceModuleId) {
    this.modulationManager.removeOutgoingModulations(sourceModuleId);
  }

  removeModuleModulations(moduleId) {
    this.modulationManager.removeModuleModulations(moduleId);
  }

  initModuleDrag(event, card, moduleIndex) {
    this.dragManager.initModuleDrag(event, card, moduleIndex);
  }

  async init() {
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
      this.elements.oscilloscope = scopeEl;
      this.scopeContext = scopeEl.getContext("2d") || null;
    }
    this.resizeScopeCanvas();
    this.drawOscilloscope();
  }

  applyPresetById(presetId, shouldRender = true) {
    const preset = getPresetById(presetId);
    if (!preset) {
      return;
    }

    const previousState = deepClone(this.state);

    if (isAllTypePreset(preset)) {
      this.state = normalizePreset(preset);
      this.setSelectedChainIndex(this.state.selectedChainIndex ?? 0);
    } else {
      const chainPreset = normalizeCurrentPresetData(preset);
      const chain = this.getCurrentChain();

      chain.modules = chainPreset.modules;
      chain.modulations = chainPreset.modulations;
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

    const loadedPreset = getPresetById(presetId);
    const presetName = loadedPreset?.name || presetId;
    this.setStatus(`LOADED PRESET: ${presetName}.`, this.audioBooted ? "live" : "neutral");
  }

  markUnsaved() {
    if (!this.hasUnsavedChanges) {
      this.hasUnsavedChanges = true;
      this.renderAll();
    }
  }

  syncControlsFromState() {
    this.controlBindings.forEach((binding, path) => {
      const value = getByPath(this.state, path);
      if (typeof value === "number" && Number.isFinite(value)) {
        binding.setVisual(value);
      }
    });
  }

  animateControlTransition(fromState, toState) {
    const animations = [];

    this.controlBindings.forEach((binding, path) => {
      const startValue = getByPath(fromState, path);
      const endValue = getByPath(toState, path);

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
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    const frame = (now) => {
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

  randomizeCurrentPatch() {
    const randomChoice = (list) => list[Math.floor(Math.random() * list.length)];
    const randomRange = (min, max, step = 0.01) => {
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
          setByPath(module, control.path, randomChoice(control.options).value);
        } else {
          setByPath(module, control.path, randomRange(control.min, control.max, control.step));
        }
      });
    });

    this.markUnsaved();
    this.renderAll(previousState);
    this.engine.fullSync(this.state);
    this.setStatus("Randomized the current patch.", this.audioBooted ? "live" : "neutral");
  }

  updateKeyboardKeyState(boundKey, active) {
    const visualKey = this.elements.keyboard.querySelector(`[data-key="${boundKey}"]`);
    if (!visualKey) {
      return;
    }
    visualKey.classList.toggle("active", active);
  }
}
