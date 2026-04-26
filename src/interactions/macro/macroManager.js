import { clamp, getByPath, setByPath } from "../../utils/helpers.js";
import {
  createDefaultMacroChainState,
  normalizeMacroChain,
  normalizeMacroState,
} from "../../preset/preset.js";
import { EdgeScrollManager } from "../edgeScrollManager.js";

const AXES = ["x", "y", "z"];
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
      startX: 0,
      startY: 0,
      x: 0,
      y: 0,
    };

    // SVG element for rendering macro binding cables
    this.macroSvg = null;
    // requestAnimationFrame id
    this.macroFrame = 0;

    // 边缘滚动管理器
    this.edgeScroll = new EdgeScrollManager();
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
      this.app.markUnsaved();
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
      this.app.markUnsaved();
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

    this.app.markUnsaved();
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
      const axisValue = axis === "x" ? chainMacro.point.x : axis === "y" ? chainMacro.point.y : chainMacro.point.z;
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
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
    };

    this.updateBindingHover(event);
    this.renderMacroOverlay();
  }

  handlePointerMove(event) {
    if (this.pointDrag.active && event.pointerId === this.pointDrag.pointerId) {
      this.edgeScroll.update(event);
      this.updatePointFromPointer(event);
      return;
    }

    if (this.bindingDrag.active && event.pointerId === this.bindingDrag.pointerId) {
      this.edgeScroll.update(event);
      this.updateBindingHover(event);
      this.bindingDrag.x = event.clientX;
      this.bindingDrag.y = event.clientY;
      this.renderMacroOverlay();
    }
  }

  handlePointerUp(event) {
    // 停止边缘滚动
    this.edgeScroll.stopScrolling();

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
      startX: 0,
      startY: 0,
      x: 0,
      y: 0,
    };
    this.renderMacroOverlay();
  }

  cancelAllDrags() {
    this.edgeScroll.stopScrolling();
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

    this.app.markUnsaved();
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

    this.app.markUnsaved();
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
    const targetEl = document.elementFromPoint(event.clientX, event.clientY);
    const control = targetEl?.closest?.(TARGET_SELECTOR);
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

  /**
   * Get the position of an element relative to the signal-flow-shell
   * @param {HTMLElement} element
   * @returns {{x:number, y:number}|null}
   */
  getPointInSignalFlowShell(element) {
    const shell = this.app.elements.signalFlowShell;
    if (!shell || !element) {
      return null;
    }
    const shellRect = shell.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left - shellRect.left + rect.width / 2,
      y: rect.top - shellRect.top + rect.height / 2,
    };
  }

  /**
   * Render macro binding drag cable overlay
   * Only shows the ghost cable while dragging; no persistent cables.
   */
  renderMacroOverlay() {
    const shell = this.app.elements.signalFlowShell;
    if (!shell) return;

    // Create SVG if not exists
    if (!this.macroSvg) {
      this.macroSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.macroSvg.classList.add("macro-cables");
      shell.appendChild(this.macroSvg);
    }

    const svg = this.macroSvg;
    const shellRect = shell.getBoundingClientRect();
    svg.setAttribute("width", String(Math.max(1, shellRect.width)));
    svg.setAttribute("height", String(Math.max(1, shellRect.height)));
    svg.innerHTML = "";

    // Only render when dragging
    if (!this.bindingDrag.active) {
      if (this.macroFrame) {
        cancelAnimationFrame(this.macroFrame);
        this.macroFrame = 0;
      }
      return;
    }

    const fromEl = document.querySelector(
      `.macro-axis-handle[aria-label="${this.bindingDrag.axis === "x" ? "Bind Macro X Axis" : "Bind Macro Y Axis"}"]`,
    );

    const from = this.getPointInSignalFlowShell(fromEl);

    if (from) {
      const toX = this.bindingDrag.x - shellRect.left;
      const toY = this.bindingDrag.y - shellRect.top;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const horizontalDist = Math.abs(toX - from.x);
      const cx = (from.x + toX) / 2;
      const sag = 15 + horizontalDist * 0.25;
      const cy = Math.max(from.y, toY) + sag;

      path.setAttribute("d", `M ${from.x} ${from.y} Q ${cx} ${cy} ${toX} ${toY}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "rgba(0, 0, 0, 0.4)");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-dasharray", "6 4");
      path.setAttribute("opacity", "0.7");

      svg.appendChild(path);

      // Draw start socket dot
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", String(from.x));
      dot.setAttribute("cy", String(from.y));
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", "rgba(0, 0, 0, 0.4)");
      dot.setAttribute("opacity", "0.7");
      svg.appendChild(dot);
    }

    // Schedule next frame for smooth updates (no lerp needed for simple ghost line)
    this.macroFrame = requestAnimationFrame(() => this.renderMacroOverlay());
  }
}
