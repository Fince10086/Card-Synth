import { createBasePreset, BUILTIN_PRESET_TEMPLATES, normalizePreset, importPresetFromFile, exportPresetToFile } from "../preset/preset.js";
import { AudioEngine } from "../audio/AudioEngine.js";
import { InputManager } from "../input/InputManager.js";
import { ModulationManager } from "../interactions/modulation/ModulationManager.js";
import { ModuleDragManager } from "../interactions/drag/ModuleDragManager.js";
import {
  createModuleCard,
  renderKeyboard,
  resizeScopeCanvas,
  drawOscilloscope,
  renderMainCard,
  renderMainCardContent,
  cacheDynamicElements as cacheDynamicElementsFn,
} from "../ui/components/index.js";
import { renderModuleCard, renderModuleControl } from "../ui/rendering/ModuleRenderer.js";
import { layoutModuleMasonry } from "../ui/layout/MasonryLayout.js";
import { createSelectControl, createToggleControl, createSliderControl, createAudioImportControl } from "../ui/controls/index.js";
import {
  deepClone,
  getByPath,
  setByPath,
  createModule,
  getAddableModuleOptions,
  clamp,
} from "../utils/helpers.js";
import { formatDb } from "../core/formatters.js";

export class ModularSynthApp {
  constructor() {
    this.state = createBasePreset();
    this.selectedPresetId = "init";
    this.audioBooted = false;

    this.heldPointerNotes = new Set();

    this.controlBindings = new Map();
    this.scopeZoom = {
      horizontal: 1,
      vertical: 1,
    };

    this.modulationManager = new ModulationManager(this);
    this.dragManager = new ModuleDragManager(this);
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
        this.selectedPresetId = "custom";
      },
    });

    this.cacheElements();
    this.bindEvents();

    this.renderAll();

    const scopeEl = document.getElementById("oscilloscope");
    if (scopeEl) {
      this.elements.oscilloscope = scopeEl;
      this.scopeContext = scopeEl.getContext("2d") || null;
    }

    this.resizeScopeCanvas();
    this.drawOscilloscope();

    window.addEventListener("resize", () => {
      this.resizeScopeCanvas();
      this.layoutModuleMasonry();
      this.modulationManager.renderModulationOverlay();
    });
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
      scopeZoomInH: document.getElementById("scopeZoomInH"),
      scopeZoomOutH: document.getElementById("scopeZoomOutH"),
      scopeZoomInV: document.getElementById("scopeZoomInV"),
      scopeZoomOutV: document.getElementById("scopeZoomOutV"),
      scopeHLabel: document.getElementById("scopeHLabel"),
      scopeVLabel: document.getElementById("scopeVLabel"),
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
        const preset = await importPresetFromFile(file);
        const previousState = deepClone(this.state);
        this.state = preset;
        this.selectedPresetId = "custom";
        this.renderAll(previousState);
        this.engine.fullSync(this.state);
        this.setStatus(`Imported preset from ${file.name}.`, "live");
      } catch (error) {
        this.setStatus(`Import failed: ${error.message}`, "error");
      } finally {
        event.target.value = "";
      }
    });

    this.elements.scopeZoomInH?.addEventListener("click", () => {
      this.scopeZoom.horizontal = Math.min(8, this.scopeZoom.horizontal * 2);
      this.updateScopeZoomLabels();
    });
    this.elements.scopeZoomOutH?.addEventListener("click", () => {
      this.scopeZoom.horizontal = Math.max(0.25, this.scopeZoom.horizontal / 2);
      this.updateScopeZoomLabels();
    });
    this.elements.scopeZoomInV?.addEventListener("click", () => {
      this.scopeZoom.vertical = Math.min(4, this.scopeZoom.vertical * 1.5);
      this.updateScopeZoomLabels();
    });
    this.elements.scopeZoomOutV?.addEventListener("click", () => {
      this.scopeZoom.vertical = Math.max(0.25, this.scopeZoom.vertical / 1.5);
      this.updateScopeZoomLabels();
    });
    this.updateScopeZoomLabels();

    this.modulationManager.bindEvents();
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
    this.state.modules.push(newModule);
    this.selectedPresetId = "custom";
    this.renderAll();
    this.engine.fullSync(this.state);
  }

  renderAll(previousState = null) {
    this.populateAddModuleDropdown();
    this.controlBindings = new Map();

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
    }

    this.resizeScopeCanvas();

    this.layoutModuleMasonry();
    this.modulationManager.renderModulationOverlay();

    if (previousState) {
      this.animateControlTransition(previousState, this.state);
    }
  }

  layoutModuleMasonry() {
    const container = this.elements.signalFlow;
    if (!container) {
      return;
    }

    const addCard = container.querySelector(".add-module-card");
    const mainCard = container.querySelector('.module-card[data-main-card="true"]');

    layoutModuleMasonry({ container, modules: this.state.modules, addCard, mainCard });
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

  updateScopeZoomLabels() {
    if (this.elements.scopeHLabel) {
      this.elements.scopeHLabel.textContent = `${this.scopeZoom.horizontal}x`;
    }
    if (this.elements.scopeVLabel) {
      this.elements.scopeVLabel.textContent = `${this.scopeZoom.vertical.toFixed(1)}x`;
    }
  }

  renderModulesRack() {
    const container = this.elements.signalFlow;
    if (!container) {
      return;
    }

    const addCard = container.querySelector(".add-module-card");
    container.innerHTML = "";
    if (addCard) {
      container.appendChild(addCard);
    }

    const mainCard = renderMainCard({
      selectedPresetId: this.selectedPresetId,
      state: this.state,
      audioBooted: this.audioBooted,
      onPresetChange: (value) => this.applyBuiltinPreset(value),
      onImportClick: () => this.elements.presetFileInput?.click(),
      onExportClick: (state, audioBooted) => {
        const filename = exportPresetToFile(state);
        this.setStatus(`Exported ${filename}.`, audioBooted ? "live" : "neutral");
      },
      onResetClick: () => this.applyBuiltinPreset("init"),
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
        this.selectedPresetId = "custom";
        this.engine.updateGlobal(this.state.global);
      },
      onVelocityEnabledChange: (value) => {
        this.state.global.velocityEnabled = value;
        this.selectedPresetId = "custom";
        this.engine.updateGlobal(this.state.global);
      },
    });
    if (mainCard) {
      container.insertBefore(mainCard, addCard);
    }

    const modules = this.state.modules || [];
    modules.forEach((module, index) => {
      const card = renderModuleCard(module, index, this);
      if (card) {
        container.insertBefore(card, addCard);
      }
    });
  }

  renderKeyboard() {
    renderKeyboard(
      this.elements.keyboard,
      this.state,
      this.inputManager,
      () => this.ensureAudioStarted(),
      this.heldPointerNotes
    );
  }

  resizeScopeCanvas() {
    const canvas = this.elements.oscilloscope;
    const context = this.scopeContext;
    if (canvas && context) {
      resizeScopeCanvas(canvas, context);
    }
  }

  drawOscilloscope() {
    drawOscilloscope({
      getCanvasFn: () => this.elements.oscilloscope,
      getContextFn: () => this.scopeContext,
      getAnalyserFn: () => this.engine.getAnalyser(),
      getAudioBootedFn: () => this.audioBooted,
    });
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

  async applyBuiltinPreset(presetId) {
    const template = BUILTIN_PRESET_TEMPLATES[presetId];
    if (!template) {
      return;
    }

    const previousState = deepClone(this.state);
    this.state = normalizePreset(template);
    this.selectedPresetId = presetId;
    this.renderAll(previousState);
    this.engine.fullSync(this.state);
    this.setStatus(`LOADED PRESET: ${this.state.name}.`, this.audioBooted ? "live" : "neutral");
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

    const modules = this.state.modules || [];
    modules.forEach((module) => {
      const definition = require("../utils/helpers").getModuleDefinition(module);
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

    this.selectedPresetId = "custom";
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
