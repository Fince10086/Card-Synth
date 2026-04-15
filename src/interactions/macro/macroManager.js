import { clamp, getByPath, setByPath } from "../../utils/helpers.js";
import {
  createDefaultMacroChainState,
  normalizeMacroChain,
  normalizeMacroState,
} from "../../preset/preset.js";

const AXES = ["x", "y"];
const POINT_OPACITY = [1, 0.9, 0.8, 0.7];
const TARGET_SELECTOR = ".control.control-slider[data-module-id][data-param-path]";
const HOVER_CLASS = "macro-target-hover";
const VALUE_EPSILON = 1e-6;

function normalizeStep(min, max, step) {
  if (Number.isFinite(step) && step > 0) {
    return step;
  }
  return Math.max((max - min) / 1000, 0.000001);
}

function snapByStep(value, min, max, step) {
  const safeStep = normalizeStep(min, max, Number(step));
  const snapped = min + Math.round((value - min) / safeStep) * safeStep;
  return clamp(Number(snapped.toFixed(6)), min, max);
}

export class MacroManager {
  constructor(app) {
    this.app = app;

    this.pointDrag = {
      active: false,
      pointerId: 0,
      chainIndex: -1,
      padElement: null,
      pointElement: null,
    };

    this.bindingDrag = {
      active: false,
      pointerId: 0,
      chainIndex: -1,
      axis: "x",
    };
  }

  bindEvents() {
    document.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    document.addEventListener("pointerup", (event) => this.handlePointerUp(event));
    document.addEventListener("pointercancel", () => this.cancelAllDrags());
  }

  ensureMacroState() {
    this.app.state.macro = normalizeMacroState(this.app.state?.macro, this.app.state?.chains);
  }

  getChainMacro(chainIndex = this.app.getSelectedChainIndex()) {
    this.ensureMacroState();

    const index = clamp(Number(chainIndex || 0), 0, this.app.getChainCount() - 1);
    if (!this.app.state.macro.chains[index]) {
      this.app.state.macro.chains[index] = createDefaultMacroChainState();
    }

    this.app.state.macro.chains[index] = normalizeMacroChain(this.app.state.macro.chains[index]);
    return this.app.state.macro.chains[index];
  }

  resetChainMacro(chainIndex = this.app.getSelectedChainIndex()) {
    this.ensureMacroState();
    const index = clamp(Number(chainIndex || 0), 0, this.app.getChainCount() - 1);
    this.app.state.macro.chains[index] = createDefaultMacroChainState();
  }

  getPointColor(chainIndex) {
    const opacity = POINT_OPACITY[chainIndex] ?? 0.7;
    const percent = Math.round(opacity * 100);
    return `color-mix(in srgb, var(--ink) ${percent}%, transparent)`;
  }

  getMainCardViewModel() {
    const selectedChainIndex = this.app.getSelectedChainIndex();

    return {
      selectedChainEnabled: this.app.isChainEnabled(selectedChainIndex),
      points: Array.from({ length: this.app.getChainCount() }, (_, chainIndex) => {
        const chainMacro = this.getChainMacro(chainIndex);
        return {
          chainIndex,
          visible: this.app.isChainEnabled(chainIndex),
          selected: chainIndex === selectedChainIndex,
          x: chainMacro.point.x,
          y: chainMacro.point.y,
          color: this.getPointColor(chainIndex),
        };
      }),
    };
  }

  getBindingForTarget(moduleId, paramPath, chainIndex = this.app.getSelectedChainIndex()) {
    const chainMacro = this.getChainMacro(chainIndex);

    for (const axis of AXES) {
      const match = chainMacro.mappings[axis].find(
        (item) => item.targetModuleId === moduleId && item.targetParamPath === paramPath,
      );
      if (match) {
        return {
          ...match,
          axis,
          color: this.getPointColor(chainIndex),
        };
      }
    }

    return null;
  }

  removeBindingsForTarget(moduleId, paramPath, chainIndex = this.app.getSelectedChainIndex()) {
    const chainMacro = this.getChainMacro(chainIndex);
    let changed = false;

    AXES.forEach((axis) => {
      const before = chainMacro.mappings[axis].length;
      chainMacro.mappings[axis] = chainMacro.mappings[axis].filter(
        (item) => !(item.targetModuleId === moduleId && item.targetParamPath === paramPath),
      );
      if (chainMacro.mappings[axis].length !== before) {
        changed = true;
      }
    });

    if (changed) {
      this.app.selectedPresetId = "custom";
    }

    return changed;
  }

  removeBindingsForModule(moduleId) {
    this.ensureMacroState();
    let changed = false;

    this.app.state.macro.chains.forEach((_, chainIndex) => {
      const normalized = this.getChainMacro(chainIndex);
      AXES.forEach((axis) => {
        const before = normalized.mappings[axis].length;
        normalized.mappings[axis] = normalized.mappings[axis].filter((item) => item.targetModuleId !== moduleId);
        if (normalized.mappings[axis].length !== before) {
          changed = true;
        }
      });
    });

    if (changed) {
      this.app.selectedPresetId = "custom";
    }

    return changed;
  }

  updateBindingRange({ chainIndex, axis, moduleId, paramPath, rangeStart, rangeEnd }) {
    if (!AXES.includes(axis)) {
      return false;
    }

    const chainMacro = this.getChainMacro(chainIndex);
    const item = chainMacro.mappings[axis].find(
      (mapping) => mapping.targetModuleId === moduleId && mapping.targetParamPath === paramPath,
    );
    if (!item) {
      return false;
    }

    const nextStart = clamp(Number(rangeStart), 0, 1);
    const nextEnd = clamp(Number(rangeEnd), 0, 1);

    if (Math.abs(item.rangeStart - nextStart) <= VALUE_EPSILON && Math.abs(item.rangeEnd - nextEnd) <= VALUE_EPSILON) {
      return false;
    }

    item.rangeStart = nextStart;
    item.rangeEnd = nextEnd;

    this.app.selectedPresetId = "custom";
    this.applyMappingsForChain(chainIndex, chainIndex === this.app.getSelectedChainIndex());

    return true;
  }

  applyAllMappings() {
    for (let chainIndex = 0; chainIndex < this.app.getChainCount(); chainIndex += 1) {
      this.applyMappingsForChain(chainIndex, false);
    }
  }

  applyMappingsForChain(chainIndex, syncControls = false) {
    const chain = this.app.getChain(chainIndex);
    const modules = Array.isArray(chain.modules) ? chain.modules : [];
    if (!modules.length) {
      return false;
    }

    const chainMacro = this.getChainMacro(chainIndex);
    const moduleMap = new Map(modules.map((module) => [module.id, module]));
    const dirtyModules = new Set();

    AXES.forEach((axis) => {
      const axisValue = axis === "x" ? chainMacro.point.x : chainMacro.point.y;
      chainMacro.mappings[axis].forEach((mapping) => {
        const module = moduleMap.get(mapping.targetModuleId);
        if (!module) {
          return;
        }

        const currentValue = Number(getByPath(module, mapping.targetParamPath));
        if (!Number.isFinite(currentValue)) {
          return;
        }

        const normValue = clamp(
          Number(mapping.rangeStart) + axisValue * (Number(mapping.rangeEnd) - Number(mapping.rangeStart)),
          0,
          1,
        );
        const mappedValue = mapping.min + (mapping.max - mapping.min) * normValue;
        const nextValue = snapByStep(mappedValue, mapping.min, mapping.max, mapping.step);

        if (Math.abs(nextValue - currentValue) <= VALUE_EPSILON) {
          return;
        }

        setByPath(module, mapping.targetParamPath, nextValue);
        dirtyModules.add(module.id);
      });
    });

    if (!dirtyModules.size) {
      return false;
    }

    dirtyModules.forEach((moduleId) => {
      const module = moduleMap.get(moduleId);
      if (module) {
        this.app.engine.updateModule(module.id, module, chainIndex);
      }
    });

    if (syncControls && chainIndex === this.app.getSelectedChainIndex()) {
      this.app.syncControlsFromState();
    }

    return true;
  }

  startPointDrag({ event, chainIndex, padElement }) {
    if (!this.app.isChainEnabled(chainIndex)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    this.pointDrag = {
      active: true,
      pointerId: event.pointerId,
      chainIndex,
      padElement,
      pointElement: event.currentTarget || event.target?.closest?.(".macro-point") || null,
    };

    this.updatePointFromPointer(event);
  }

  startAxisBindingDrag({ event, axis, chainIndex = this.app.getSelectedChainIndex() }) {
    if (!AXES.includes(axis) || !this.app.isChainEnabled(chainIndex)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    this.bindingDrag = {
      active: true,
      pointerId: event.pointerId,
      chainIndex,
      axis,
    };

    this.updateBindingHover(event);
  }

  handlePointerMove(event) {
    if (this.pointDrag.active && event.pointerId === this.pointDrag.pointerId) {
      this.updatePointFromPointer(event);
      return;
    }

    if (this.bindingDrag.active && event.pointerId === this.bindingDrag.pointerId) {
      this.updateBindingHover(event);
    }
  }

  handlePointerUp(event) {
    if (this.pointDrag.active && event.pointerId === this.pointDrag.pointerId) {
      this.cancelPointDrag();
      return;
    }

    if (this.bindingDrag.active && event.pointerId === this.bindingDrag.pointerId) {
      this.handleBindingDrop(event);
      this.cancelAxisBindingDrag();
    }
  }

  cancelPointDrag() {
    this.pointDrag = {
      active: false,
      pointerId: 0,
      chainIndex: -1,
      padElement: null,
      pointElement: null,
    };
  }

  cancelAxisBindingDrag() {
    this.clearHoverTargets();
    this.bindingDrag = {
      active: false,
      pointerId: 0,
      chainIndex: -1,
      axis: "x",
    };
  }

  cancelAllDrags() {
    this.cancelPointDrag();
    this.cancelAxisBindingDrag();
  }

  updatePointFromPointer(event) {
    const pad = this.pointDrag.padElement || document.querySelector(".macro-pad");
    if (!pad) {
      return;
    }

    const rect = pad.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const nextX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const nextY = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1);

    const chainMacro = this.getChainMacro(this.pointDrag.chainIndex);
    if (
      Math.abs(chainMacro.point.x - nextX) <= VALUE_EPSILON
      && Math.abs(chainMacro.point.y - nextY) <= VALUE_EPSILON
    ) {
      return;
    }

    chainMacro.point.x = nextX;
    chainMacro.point.y = nextY;

    this.app.selectedPresetId = "custom";
    this.applyMappingsForChain(this.pointDrag.chainIndex, this.pointDrag.chainIndex === this.app.getSelectedChainIndex());

    const point = this.pointDrag.pointElement;
    if (point) {
      point.style.left = `${nextX * 100}%`;
      point.style.top = `${(1 - nextY) * 100}%`;
    }
  }

  handleBindingDrop(event) {
    const targetControl = this.findTargetControl(event);
    if (!targetControl) {
      return;
    }

    const committed = this.commitBinding({
      chainIndex: this.bindingDrag.chainIndex,
      axis: this.bindingDrag.axis,
      targetControl,
    });

    if (!committed) {
      return;
    }

    this.app.selectedPresetId = "custom";
    this.applyMappingsForChain(this.bindingDrag.chainIndex, this.bindingDrag.chainIndex === this.app.getSelectedChainIndex());
    this.app.renderAll();
  }

  commitBinding({ chainIndex, axis, targetControl }) {
    const targetModuleId = String(targetControl.dataset.moduleId || "");
    const targetParamPath = String(targetControl.dataset.paramPath || "");
    if (!targetModuleId || !targetParamPath || !AXES.includes(axis)) {
      return false;
    }

    const sliderInput = targetControl.querySelector(".slider-input");
    const min = Number(targetControl.dataset.sliderMin ?? sliderInput?.min);
    const max = Number(targetControl.dataset.sliderMax ?? sliderInput?.max);
    const step = Number(targetControl.dataset.sliderStep ?? sliderInput?.step);

    if (!Number.isFinite(min) || !Number.isFinite(max) || Math.abs(max - min) <= VALUE_EPSILON) {
      return false;
    }

    const chainMacro = this.getChainMacro(chainIndex);
    const mappings = chainMacro.mappings[axis];
    const existingIndex = mappings.findIndex(
      (item) => item.targetModuleId === targetModuleId && item.targetParamPath === targetParamPath,
    );

    const previous = existingIndex >= 0 ? mappings[existingIndex] : null;

    const next = {
      targetModuleId,
      targetParamPath,
      min: Math.min(min, max),
      max: Math.max(min, max),
      step: normalizeStep(Math.min(min, max), Math.max(min, max), step),
      rangeStart: previous ? previous.rangeStart : 0,
      rangeEnd: previous ? previous.rangeEnd : 1,
    };

    if (existingIndex >= 0) {
      mappings[existingIndex] = next;
    } else {
      mappings.push(next);
    }

    return true;
  }

  findTargetControl(event) {
    const control = event.target?.closest?.(TARGET_SELECTOR);
    return control && !control.closest(".module-card[data-main-card='true']") ? control : null;
  }

  updateBindingHover(event) {
    this.clearHoverTargets();

    const target = this.findTargetControl(event);
    if (target) {
      target.classList.add(HOVER_CLASS);
    }
  }

  clearHoverTargets() {
    document.querySelectorAll(`.${HOVER_CLASS}`).forEach((node) => {
      node.classList.remove(HOVER_CLASS);
    });
  }
}
