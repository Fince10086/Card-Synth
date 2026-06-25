import { clamp, getByPath, setByPath } from "../../utils/helpers";
import {
  createDefaultMacroPointState,
  normalizeMacroPoint,
  normalizeMacroState,
} from "../../preset/preset";
import { EdgeScrollManager } from "../edgeScrollManager";
import type { MacroMappingItem } from "../../preset/preset";

const AXES = ["x", "y"] as const;
type Axis = (typeof AXES)[number];

const POINT_OPACITY = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25] as const;
const TARGET_SELECTOR = ".control.control-slider[data-module-id][data-param-path]";
const HOVER_CLASS = "macro-target-hover";
const VALUE_EPSILON = 1e-6;

interface MacroPointStateRuntime {
  x: number;
  y: number;
  bindings: {
    x: MacroMappingItem[];
    y: MacroMappingItem[];
  };
}

interface PointDragState {
  active: boolean;
  pointerId: number;
  pointIndex: number;
  padElement: Element | null;
  pointElement: HTMLElement | null;
}

interface BindingDragState {
  active: boolean;
  pointerId: number;
  pointIndex: number;
  axis: Axis;
  startX: number;
  startY: number;
  x: number;
  y: number;
}

interface MacroPointViewModel {
  pointIndex: number;
  visible: boolean;
  selected: boolean;
  recentRank: number;
  x: number;
  y: number;
  color: string;
}

interface MainCardViewModel {
  pointCount: number;
  selectedPointIndex: number;
  recentSelection: number[];
  points: MacroPointViewModel[];
}

interface BindingResult extends MacroMappingItem {
  axis: Axis;
  color: string;
}

interface AppState {
  macro: {
    pointCount: number;
    selectedPointIndex: number;
    recentSelection: number[];
    points: Array<MacroPointStateRuntime | undefined>;
  };
  chains: Array<{ macro?: { x?: number; y?: number; bindings?: Record<string, MacroMappingItem[]> } } | undefined>;
}

interface MacroManagerApp {
  state: AppState;
  getSelectedChainIndex(): number;
  getChainCount(): number;
  isChainEnabled(index: number): boolean;
  getChain(index: number): { modules?: Array<{ id: string } & Record<string, unknown>> };
  markUnsaved(): void;
  syncControlsFromState(): void;
  renderAll(): void;
  engine: {
    updateModule(moduleId: string, module: Record<string, unknown>, chainIndex: number): void;
  };
  elements: {
    signalFlowShell: HTMLElement | null;
  };
}

function normalizeStep(min: number, max: number, step: number): number {
  if (Number.isFinite(step) && step > 0) {
    return step;
  }
  return Math.max((max - min) / 1000, 0.000001);
}

function snapByStep(value: number, min: number, max: number, step: number): number {
  const safeStep = normalizeStep(min, max, step);
  const snapped = min + Math.round((value - min) / safeStep) * safeStep;
  return clamp(Number(snapped.toFixed(6)), min, max);
}

export class MacroManager {
  app: MacroManagerApp;
  pointDrag: PointDragState;
  bindingDrag: BindingDragState;
  macroSvg: SVGSVGElement | null;
  macroFrame: number;
  edgeScroll: EdgeScrollManager;

  constructor(app: MacroManagerApp) {
    this.app = app;

    this.pointDrag = {
      active: false,
      pointerId: 0,
      pointIndex: -1,
      padElement: null,
      pointElement: null,
    };

    this.bindingDrag = {
      active: false,
      pointerId: 0,
      pointIndex: -1,
      axis: "x",
      startX: 0,
      startY: 0,
      x: 0,
      y: 0,
    };

    this.macroSvg = null;
    this.macroFrame = 0;

    this.edgeScroll = new EdgeScrollManager();
  }

  bindEvents(): void {
    document.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    document.addEventListener("pointerup", (event) => this.handlePointerUp(event));
    document.addEventListener("pointercancel", () => this.cancelAllDrags());
  }

  ensureMacroState(): void {
    this.app.state.macro = normalizeMacroState(
      this.app.state?.macro as unknown as Parameters<typeof normalizeMacroState>[0]
    ) as unknown as AppState["macro"];
  }

  getMacroPoint(pointIndex: number): MacroPointStateRuntime {
    this.ensureMacroState();

    const count = this.app.state.macro.points.length;
    const index = clamp(Number(pointIndex || 0), 0, Math.max(0, count - 1));
    if (!this.app.state.macro.points[index]) {
      const normalized = createDefaultMacroPointState();
      const runtime: MacroPointStateRuntime = {
        x: normalized.x,
        y: normalized.y,
        bindings: {
          x: normalized.bindings.x,
          y: normalized.bindings.y,
        },
      };
      this.app.state.macro.points[index] = runtime as unknown as (typeof this.app.state.macro.points)[number];
    }

    const normalized = normalizeMacroPoint(
      this.app.state.macro.points[index] as unknown as Parameters<typeof normalizeMacroPoint>[0]
    );

    const runtime: MacroPointStateRuntime = {
      x: normalized.x,
      y: normalized.y,
      bindings: {
        x: normalized.bindings.x,
        y: normalized.bindings.y,
      },
    };

    this.app.state.macro.points[index] = runtime as unknown as (typeof this.app.state.macro.points)[number];
    return runtime;
  }

  resetMacroPoint(pointIndex: number): void {
    this.ensureMacroState();
    const index = clamp(Number(pointIndex || 0), 0, this.app.state.macro.points.length - 1);
    const normalized = createDefaultMacroPointState();
    const runtime: MacroPointStateRuntime = {
      x: normalized.x,
      y: normalized.y,
      bindings: {
        x: normalized.bindings.x,
        y: normalized.bindings.y,
      },
    };
    this.app.state.macro.points[index] = runtime as unknown as (typeof this.app.state.macro.points)[number];
  }

  getPointColor(pointIndex: number, opacityScale = 1): string {
    const opacity = (POINT_OPACITY[pointIndex] ?? 0.7) * opacityScale;
    const alpha = clamp(opacity, 0, 1).toFixed(2);
    return `rgba(42, 36, 27, ${alpha})`;
  }

  getMainCardViewModel(): MainCardViewModel {
    const pointCount = 4;
    const selectedPointIndex = clamp(this.app.state.macro.selectedPointIndex, 0, pointCount - 1);
    const recentSelection = this.app.state.macro.recentSelection.slice(0, 4);
    const recentRankMap = new Map(recentSelection.map((index, rank) => [index, rank]));

    return {
      pointCount,
      selectedPointIndex,
      recentSelection,
      points: Array.from({ length: pointCount }, (_, pointIndex) => {
        const point = this.getMacroPoint(pointIndex);
        const rank = recentRankMap.get(pointIndex);
        const recentRank = rank === undefined ? 3 : rank;
        return {
          pointIndex,
          visible: true,
          selected: pointIndex === selectedPointIndex,
          recentRank,
          x: point.x,
          y: point.y,
          color: this.getPointColor(pointIndex),
        };
      }),
    };
  }

  getBindingForTarget(moduleId: string, paramPath: string, chainIndex: number = this.app.getSelectedChainIndex()): BindingResult | null {
    for (let pointIndex = 0; pointIndex < this.app.state.macro.points.length; pointIndex++) {
      const point = this.getMacroPoint(pointIndex);
      for (const axis of AXES) {
        const match = point.bindings[axis].find(
          (item) => item.targetChainIndex === chainIndex && item.targetModuleId === moduleId && item.targetParamPath === paramPath,
        );
        if (match) {
          return {
            ...match,
            axis,
            color: this.getPointColor(pointIndex),
          };
        }
      }
    }

    return null;
  }

  removeBindingsForTarget(moduleId: string, paramPath: string, chainIndex: number = this.app.getSelectedChainIndex()): boolean {
    let changed = false;

    for (let pointIndex = 0; pointIndex < this.app.state.macro.points.length; pointIndex++) {
      const point = this.getMacroPoint(pointIndex);
      AXES.forEach((axis) => {
        const before = point.bindings[axis].length;
        point.bindings[axis] = point.bindings[axis].filter(
          (item) => !(item.targetChainIndex === chainIndex && item.targetModuleId === moduleId && item.targetParamPath === paramPath),
        );
        if (point.bindings[axis].length !== before) {
          changed = true;
        }
      });
    }

    if (changed) {
      this.app.markUnsaved();
    }

    return changed;
  }

  removeBindingsForModule(moduleId: string): boolean {
    this.ensureMacroState();
    let changed = false;

    for (let pointIndex = 0; pointIndex < this.app.state.macro.points.length; pointIndex++) {
      const point = this.getMacroPoint(pointIndex);
      AXES.forEach((axis) => {
        const before = point.bindings[axis].length;
        point.bindings[axis] = point.bindings[axis].filter((item) => item.targetModuleId !== moduleId);
        if (point.bindings[axis].length !== before) {
          changed = true;
        }
      });
    }

    if (changed) {
      this.app.markUnsaved();
    }

    return changed;
  }

  updateBindingRange(options: {
    pointIndex: number;
    axis: Axis;
    moduleId: string;
    paramPath: string;
    rangeStart: number;
    rangeEnd: number;
  }): boolean {
    const { pointIndex, axis, moduleId, paramPath, rangeStart, rangeEnd } = options;

    if (!AXES.includes(axis)) {
      return false;
    }

    const point = this.getMacroPoint(pointIndex);
    const item = point.bindings[axis].find(
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
    this.applyMappingsForPoint(pointIndex, false);

    return true;
  }

  applyAllMappings(): void {
    for (let pointIndex = 0; pointIndex < this.app.state.macro.points.length; pointIndex += 1) {
      this.applyMappingsForPoint(pointIndex, false);
    }
  }

  applyMappingsForPoint(pointIndex: number, syncControls: boolean = false): boolean {
    const point = this.getMacroPoint(pointIndex);
    const dirtyChains = new Map<number, Set<string>>();

    AXES.forEach((axis) => {
      const axisValue = axis === "x" ? point.x : point.y;
      point.bindings[axis].forEach((mapping) => {
        const chainIndex = mapping.targetChainIndex;
        const chain = this.app.getChain(chainIndex);
        const modules = Array.isArray(chain.modules) ? chain.modules : [];
        const module = modules.find((m) => m.id === mapping.targetModuleId);
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
        if (!dirtyChains.has(chainIndex)) {
          dirtyChains.set(chainIndex, new Set<string>());
        }
        dirtyChains.get(chainIndex)!.add(module.id);
      });
    });

    if (!dirtyChains.size) {
      return false;
    }

    dirtyChains.forEach((moduleIds, chainIndex) => {
      const chain = this.app.getChain(chainIndex);
      const modules = Array.isArray(chain.modules) ? chain.modules : [];
      moduleIds.forEach((moduleId) => {
        const module = modules.find((m) => m.id === moduleId);
        if (module) {
          this.app.engine.updateModule(module.id, module, chainIndex);
        }
      });
    });

    if (syncControls) {
      this.app.syncControlsFromState();
    }

    return true;
  }

  startPointDrag(options: {
    event: PointerEvent;
    pointIndex: number;
    padElement: Element | null;
  }): void {
    const { event, pointIndex, padElement } = options;

    if (pointIndex < 0 || pointIndex >= 4) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    this.pointDrag = {
      active: true,
      pointerId: event.pointerId,
      pointIndex,
      padElement,
      pointElement: (event.currentTarget as HTMLElement | null) || (event.target as HTMLElement | null)?.closest(".macro-point") || null,
    };

    this.updatePointFromPointer(event);
  }

  startAxisBindingDrag(options: {
    event: PointerEvent;
    axis: Axis;
    pointIndex?: number;
  }): void {
    const { event, axis, pointIndex = this.app.state.macro.selectedPointIndex } = options;

    if (!AXES.includes(axis) || pointIndex < 0 || pointIndex >= this.app.state.macro.pointCount) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    this.bindingDrag = {
      active: true,
      pointerId: event.pointerId,
      pointIndex,
      axis,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
    };

    this.updateBindingHover(event);
    this.renderMacroOverlay();
  }

  handlePointerMove(event: PointerEvent): void {
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

  handlePointerUp(event: PointerEvent): void {
    this.edgeScroll.stopScrolling();

    if (this.pointDrag.active && event.pointerId === this.pointDrag.pointerId) {
      this.app.markUnsaved();
      this.cancelPointDrag();
      return;
    }

    if (this.bindingDrag.active && event.pointerId === this.bindingDrag.pointerId) {
      this.handleBindingDrop(event);
      this.cancelAxisBindingDrag();
    }
  }

  cancelPointDrag(): void {
    this.pointDrag = {
      active: false,
      pointerId: 0,
      pointIndex: -1,
      padElement: null,
      pointElement: null,
    };
  }

  cancelAxisBindingDrag(): void {
    this.clearHoverTargets();
    this.bindingDrag = {
      active: false,
      pointerId: 0,
      pointIndex: -1,
      axis: "x",
      startX: 0,
      startY: 0,
      x: 0,
      y: 0,
    };
    this.renderMacroOverlay();
  }

  cancelAllDrags(): void {
    this.edgeScroll.stopScrolling();
    this.cancelPointDrag();
    this.cancelAxisBindingDrag();
  }

  updatePointFromPointer(event: PointerEvent): void {
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

    const point = this.getMacroPoint(this.pointDrag.pointIndex);
    if (
      Math.abs(point.x - nextX) <= VALUE_EPSILON
      && Math.abs(point.y - nextY) <= VALUE_EPSILON
    ) {
      return;
    }

    point.x = nextX;
    point.y = nextY;

    this.applyMappingsForPoint(this.pointDrag.pointIndex, this.app.getSelectedChainIndex() === this.app.getSelectedChainIndex());

    const pointEl = this.pointDrag.pointElement;
    if (pointEl) {
      pointEl.style.left = `${nextX * 100}%`;
      pointEl.style.top = `${(1 - nextY) * 100}%`;
    }
  }

  handleBindingDrop(event: PointerEvent): void {
    const targetControl = this.findTargetControl(event);
    if (!targetControl) {
      return;
    }

    const committed = this.commitBinding({
      pointIndex: this.bindingDrag.pointIndex,
      axis: this.bindingDrag.axis,
      targetControl,
    });

    if (!committed) {
      return;
    }

    this.app.markUnsaved();
    this.applyMappingsForPoint(this.bindingDrag.pointIndex, false);
    this.app.renderAll();
  }

  commitBinding(options: {
    pointIndex: number;
    axis: Axis;
    targetControl: HTMLElement;
  }): boolean {
    const { pointIndex, axis, targetControl } = options;

    const targetModuleId = String(targetControl.dataset.moduleId || "");
    const targetParamPath = String(targetControl.dataset.paramPath || "");
    if (!targetModuleId || !targetParamPath || !AXES.includes(axis)) {
      return false;
    }

    const sliderInput = targetControl.querySelector(".slider-input") as HTMLInputElement | null;
    const min = Number(targetControl.dataset.sliderMin ?? sliderInput?.min);
    const max = Number(targetControl.dataset.sliderMax ?? sliderInput?.max);
    const step = Number(targetControl.dataset.sliderStep ?? sliderInput?.step);

    if (!Number.isFinite(min) || !Number.isFinite(max) || Math.abs(max - min) <= VALUE_EPSILON) {
      return false;
    }

    const point = this.getMacroPoint(pointIndex);
    const mappings = point.bindings[axis];
    const targetChainIndex = this.app.getSelectedChainIndex();
    const existingIndex = mappings.findIndex(
      (item) => item.targetChainIndex === targetChainIndex && item.targetModuleId === targetModuleId && item.targetParamPath === targetParamPath,
    );

    const previous = existingIndex >= 0 ? mappings[existingIndex] : null;

    const next: MacroMappingItem = {
      targetChainIndex,
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

  findTargetControl(event: PointerEvent): HTMLElement | null {
    const targetEl = document.elementFromPoint(event.clientX, event.clientY);
    const control = targetEl?.closest(TARGET_SELECTOR);
    return control && !control.closest(".module-card[data-main-card='true']") ? (control as HTMLElement) : null;
  }

  updateBindingHover(event: PointerEvent): void {
    this.clearHoverTargets();

    const target = this.findTargetControl(event);
    if (target) {
      target.classList.add(HOVER_CLASS);
    }
  }

  clearHoverTargets(): void {
    document.querySelectorAll(`.${HOVER_CLASS}`).forEach((node) => {
      node.classList.remove(HOVER_CLASS);
    });
  }

  getPointInSignalFlowShell(element: Element | null): { x: number; y: number } | null {
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

  renderMacroOverlay(): void {
    const shell = this.app.elements.signalFlowShell;
    if (!shell) return;

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

      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", String(from.x));
      dot.setAttribute("cy", String(from.y));
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", "rgba(0, 0, 0, 0.4)");
      dot.setAttribute("opacity", "0.7");
      svg.appendChild(dot);
    }

    this.macroFrame = requestAnimationFrame(() => this.renderMacroOverlay());
  }
}
