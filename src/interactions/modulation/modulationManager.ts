import * as Tone from "tone";
import { getByPath, getModuleDefinition } from "../../utils/helpers";
import { MODULATION_BLACKLIST } from "./modulationBlacklist";
import { EdgeScrollManager } from "../edgeScrollManager";
import type {
  ModuleConfig,
  ModulationConnection,
  ModuleDefinition,
} from "../../types";
import type { ModularSynthApp } from "../../app/modularSynthApp";
import type { SourceVoice, SourceRuntime } from "../../audio/runtimes/sourceRuntime";

interface ChainModulation extends ModulationConnection {
  sourceVoiceIndex: number | string;
  radius?: number;
}

interface ModulationTargetParam {
  param: unknown;
  voiceIndex: number | null;
}

interface ModulationRuntime {
  id: string;
  chainIndex: number;
  modulationId: string;
  sourceVoiceIndex: number;
  targetParamPath: string;
  targetParam: unknown;
  targetModuleId: string;
  targetVoiceIndex: number | null;
  sourceOutput: AudioNode | null;
  audioHalf: Tone.Multiply | null;
  audioOffset: Tone.Add | null;
  scale: Tone.Scale;
}

interface CableVisualState {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface InitRangePayload {
  modulationId: string;
  radius: number;
  currentSliderValue: number;
  paramMin: number;
  paramMax: number;
}

interface SourceTargetProfile {
  hasSourceTargets: boolean;
  hasNonSourceTargets: boolean;
}

interface CommitModulationTargetParams {
  sourceModuleId: string;
  targetModuleId: string;
  targetParamPath: string;
  updateConnectionId?: string;
}

interface StartModulationDragParams {
  event: PointerEvent;
  sourceModuleId: string;
  updateConnectionId?: string;
}

/**
 * ModulationManager - 调制连接管理器
 * 负责处理模块间调制连接的创建、编辑、删除和可视化
 * 支持拖拽方式建立调制连接，实时渲染连接线
 * 管理调制运行时和音频连接
 */
export class ModulationManager {
  app: ModularSynthApp;

  modulationDrag: {
    active: boolean;
    pointerId: number;
    sourceModuleId: string;
    updateConnectionId: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
  };

  modulationSvg: SVGSVGElement | null;
  cableVisuals: Map<string, CableVisualState>;
  modulationFrame: number;
  modulationRuntimes: ModulationRuntime[];
  isConnectingModulations: boolean;
  cableElements: Map<string, SVGElement>;
  edgeScroll: EdgeScrollManager;

  private _lastSvgSize: string | undefined;

  /**
   * 构造函数
   * @param app - 应用实例
   */
  constructor(app: ModularSynthApp) {
    this.app = app;

    this.modulationDrag = {
      active: false,
      pointerId: 0,
      sourceModuleId: "",
      updateConnectionId: "",
      startX: 0,
      startY: 0,
      x: 0,
      y: 0,
    };

    this.modulationSvg = null;
    this.cableVisuals = new Map();
    this.modulationFrame = 0;
    this.modulationRuntimes = [];
    this.isConnectingModulations = false;
    this.cableElements = new Map();
    this.edgeScroll = new EdgeScrollManager();
  }

  /**
   * 绑定全局事件监听器
   */
  bindEvents(): void {
    document.addEventListener("pointermove", (event) => this.handleModulationPointerMove(event));
    document.addEventListener("pointerup", (event) => this.handleModulationPointerUp(event));
    document.addEventListener("pointercancel", () => this.cancelModulationDrag());
  }

  /**
   * 判断一个模块是否可以作为调制源
   * @param module - 模块对象
   * @returns 是否为有效的调制源
   */
  isModulationSource(module: ModuleConfig | undefined | null): boolean {
    if (!module) {
      return false;
    }
    if (module.type === "Envelope" && module.modulationMode) {
      return true;
    }
    return module.category === "source" && Boolean(module.modulationMode);
  }

  getModules(chainIndex: number = this.app.getSelectedChainIndex()): ModuleConfig[] {
    return this.app.getChain(chainIndex).modules;
  }

  /**
   * 获取目标参数的 min/max 范围
   * @param targetModuleId - 目标模块ID
   * @param targetParamPath - 目标参数路径
   * @param chainIndex - 链索引
   * @returns 参数范围
   */
  getParamRange(
    targetModuleId: string,
    targetParamPath: string,
    chainIndex: number = this.app.getSelectedChainIndex(),
  ): { min: number; max: number } {
    const targetModule = this.getModules(chainIndex).find((m) => m.id === targetModuleId);
    if (!targetModule) {
      return { min: -Infinity, max: Infinity };
    }
    const definition = getModuleDefinition(targetModule) as ModuleDefinition | undefined;
    const controls = definition?.controls || [];
    const control = controls.find((c) => c.path === targetParamPath);
    if (control && typeof control.min === "number" && typeof control.max === "number") {
      return { min: control.min, max: control.max };
    }
    return { min: -Infinity, max: Infinity };
  }

  /**
   * 获取指定链的调制连接
   * @returns 调制连接数组
   */
  getModulations(chainIndex: number = this.app.getSelectedChainIndex()): ChainModulation[] {
    const chain = this.app.getChain(chainIndex);
    if (!Array.isArray(chain.modulations)) {
      chain.modulations = [];
    }
    return chain.modulations as ChainModulation[];
  }

  setModulations(nextModulations: ChainModulation[], chainIndex: number = this.app.getSelectedChainIndex()): void {
    this.app.getChain(chainIndex).modulations = Array.isArray(nextModulations) ? nextModulations : [];
  }

  /**
   * 获取指定模块作为源的所有输出调制连接
   * @param sourceModuleId - 源模块ID
   * @returns 输出调制连接数组
   */
  getOutgoingModulations(sourceModuleId: string, chainIndex: number = this.app.getSelectedChainIndex()): ChainModulation[] {
    return this.getModulations(chainIndex).filter((item) => item.sourceModuleId === sourceModuleId);
  }

  /**
   * 根据目标模块和参数路径查找调制连接
   * @param targetModuleId - 目标模块ID
   * @param targetParamPath - 目标参数路径
   * @returns 找到的调制连接或null
   */
  getModulationByTarget(
    targetModuleId: string,
    targetParamPath: string,
    chainIndex: number = this.app.getSelectedChainIndex(),
  ): ChainModulation | null {
    return (
      this.getModulations(chainIndex).find(
        (item) => item.targetModuleId === targetModuleId && item.targetParamPath === targetParamPath,
      ) || null
    );
  }

  /**
   * 根据连接ID查找调制连接
   * @param connectionId - 连接ID
   * @returns 找到的调制连接或null
   */
  getModulationById(connectionId: string, chainIndex: number = this.app.getSelectedChainIndex()): ChainModulation | null {
    return this.getModulations(chainIndex).find((item) => item.id === connectionId) || null;
  }

  /**
   * 获取下一个可用的调制声道索引（0-7）
   * @param sourceModuleId - 源模块ID
   * @returns 可用的声道索引，无可用则返回-1
   */
  getNextModulationVoiceIndex(sourceModuleId: string, chainIndex: number = this.app.getSelectedChainIndex()): number {
    const used = new Set(
      this.getOutgoingModulations(sourceModuleId, chainIndex).map((item) => Number(item.sourceVoiceIndex)),
    );
    for (let i = 0; i < 8; i += 1) {
      if (!used.has(i)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 开始调制连接拖拽
   * @param params - 参数对象
   */
  startModulationDrag({ event, sourceModuleId, updateConnectionId = "" }: StartModulationDragParams): void {
    event.preventDefault();
    this.modulationDrag = {
      active: true,
      pointerId: event.pointerId,
      sourceModuleId,
      updateConnectionId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
    };
    this.renderModulationOverlay();
  }

  /**
   * 处理调制拖拽过程中的指针移动事件
   * @param event - 指针移动事件
   */
  handleModulationPointerMove(event: PointerEvent): void {
    if (!this.modulationDrag.active) {
      return;
    }
    this.modulationDrag.x = event.clientX;
    this.modulationDrag.y = event.clientY;

    this.edgeScroll.update(event);

    this._clearHoverStyles();

    const targetEl = document.elementFromPoint(event.clientX, event.clientY);
    const slider = targetEl?.closest(".control.control-slider[data-module-id][data-param-path]") as HTMLElement | null;
    if (slider) {
      const mainCard = slider.closest(".module-card[data-main-card='true']");
      const paramPath = slider.dataset.paramPath;
      const isBlacklisted = paramPath ? MODULATION_BLACKLIST.includes(paramPath) : false;

      if (!mainCard && !isBlacklisted) {
        slider.classList.add("mod-target-hover");
      }
    }

    this.renderModulationOverlay();
  }

  /**
   * 处理调制拖拽结束时的指针抬起事件
   * @param event - 指针抬起事件
   */
  handleModulationPointerUp(event: PointerEvent): void {
    if (!this.modulationDrag.active) {
      return;
    }

    this.edgeScroll.stopScrolling();

    const drag = { ...this.modulationDrag };
    const targetEl = document.elementFromPoint(event.clientX, event.clientY);
    const targetControl = targetEl?.closest(".control.control-slider[data-module-id][data-param-path]") as HTMLElement | null;

    if (targetControl) {
      const mainCard = targetControl.closest(".module-card[data-main-card='true']");
      if (mainCard) {
        this._clearHoverStyles();
        this.app.setStatus("Main Card parameters cannot be modulated.", "error");
        this.cancelModulationDrag();
        return;
      }

      const paramPath = targetControl.dataset.paramPath;
      if (paramPath && MODULATION_BLACKLIST.includes(paramPath)) {
        this._clearHoverStyles();
        this.app.setStatus(`Parameter "${paramPath}" cannot be modulated.`, "error");
        this.cancelModulationDrag();
        return;
      }
    }

    this._clearHoverStyles();

    if (!targetControl) {
      if (drag.updateConnectionId) {
        this.removeModulationById(drag.updateConnectionId);
        this.app.engine.fullSync(this.app.state);
        this.app.renderAll();
      }
      this.cancelModulationDrag();
      return;
    }

    const targetModuleId = targetControl.dataset.moduleId;
    const targetParamPath = targetControl.dataset.paramPath;
    if (targetModuleId && targetParamPath) {
      this.commitModulationTarget({
        sourceModuleId: drag.sourceModuleId,
        targetModuleId,
        targetParamPath,
        updateConnectionId: drag.updateConnectionId,
      });
    }
    this.cancelModulationDrag();
  }

  /**
   * 提交并创建/更新调制连接
   * @param params - 参数对象
   */
  commitModulationTarget({
    sourceModuleId,
    targetModuleId,
    targetParamPath,
    updateConnectionId = "",
  }: CommitModulationTargetParams): void {
    if (!sourceModuleId || !targetModuleId || !targetParamPath || sourceModuleId === targetModuleId) {
      return;
    }

    const chainIndex = this.app.getSelectedChainIndex();

    const targetModuleCard = document.querySelector(
      `.module-card[data-module-id="${targetModuleId}"][data-main-card='true']`,
    );
    if (targetModuleCard) {
      this.app.setStatus("Main Card parameters cannot be modulated.", "error");
      return;
    }

    if (MODULATION_BLACKLIST.includes(targetParamPath)) {
      this.app.setStatus(`Parameter "${targetParamPath}" cannot be modulated.`, "error");
      return;
    }

    const modules = this.getModules(chainIndex);
    const sourceModule = modules.find((item) => item.id === sourceModuleId);
    const targetModule = modules.find((item) => item.id === targetModuleId);
    if (!sourceModule || !targetModule) {
      return;
    }
    if (!this.isModulationSource(sourceModule)) {
      return;
    }

    const existingTarget = this.getModulationByTarget(targetModuleId, targetParamPath, chainIndex);
    if (existingTarget && existingTarget.id !== updateConnectionId) {
      this.app.setStatus("A target parameter can only have one modulation connection.", "error");
      return;
    }

    if (updateConnectionId) {
      const current = this.getModulationById(updateConnectionId, chainIndex);
      if (!current) {
        return;
      }
      current.targetModuleId = targetModuleId;
      current.targetParamPath = targetParamPath;
    } else {
      if (this.getOutgoingModulations(sourceModuleId, chainIndex).length >= 8) {
        this.app.setStatus("Each modulation source can connect up to 8 targets.", "error");
        return;
      }
      const voiceIndex = this.getNextModulationVoiceIndex(sourceModuleId, chainIndex);
      if (voiceIndex < 0) {
        return;
      }
      this.getModulations(chainIndex).push({
        id: `${sourceModuleId}-mod-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        sourceModuleId,
        sourceVoiceIndex: voiceIndex,
        targetModuleId,
        targetParamPath,
        radius: undefined,
      } as ChainModulation);
    }

    this.app.markUnsaved();
    this.app.engine.fullSync(this.app.state);
    this.app.renderAll();
  }

  /**
   * 清除所有调制目标悬停样式
   */
  _clearHoverStyles(): void {
    document.querySelectorAll(".control.mod-target-hover").forEach((node) => {
      node.classList.remove("mod-target-hover");
    });
  }

  /**
   * 根据ID删除调制连接
   * @param connectionId - 连接ID
   */
  removeModulationById(connectionId: string): void {
    this.setModulations(this.getModulations().filter((item) => item.id !== connectionId));
    this.app.markUnsaved();
  }

  /**
   * 删除指定模块的所有输出调制连接
   * @param sourceModuleId - 源模块ID
   */
  removeOutgoingModulations(sourceModuleId: string): void {
    this.setModulations(this.getModulations().filter((item) => item.sourceModuleId !== sourceModuleId));
    this.app.markUnsaved();
  }

  /**
   * 删除与指定模块相关的所有调制连接（作为源或目标）
   * @param moduleId - 模块ID
   */
  removeModuleModulations(moduleId: string): void {
    this.setModulations(
      this.getModulations().filter((item) => item.sourceModuleId !== moduleId && item.targetModuleId !== moduleId),
    );
    this.app.markUnsaved();
  }

  /**
   * 初始化所有调制范围
   * @param ranges - 调制范围配置数组
   */
  initAllModulationRanges(ranges: InitRangePayload[] | unknown): void {
    if (!Array.isArray(ranges)) {
      return;
    }
    ranges.forEach(({ modulationId, radius, currentSliderValue, paramMin, paramMax }) => {
      const centerValue = currentSliderValue;
      this.updateModulationRange(modulationId, centerValue, radius, this.app.getSelectedChainIndex(), paramMin, paramMax);
    });
  }

  /**
   * 应用调制范围：从调制对象读取参数并更新音频层
   * @param mod - 调制对象
   * @param chainIndex - 链索引
   */
  _applyModulationRange(mod: ChainModulation, chainIndex: number = this.app.getSelectedChainIndex()): void {
    const targetModule = this.getModules(chainIndex).find((m) => m.id === mod.targetModuleId);
    let centerValue = 0.5;
    if (targetModule) {
      const currentSliderValue = getByPath(targetModule as Record<string, unknown>, mod.targetParamPath);
      if (typeof currentSliderValue === "number" && Number.isFinite(currentSliderValue)) {
        centerValue = currentSliderValue;
      }
    }
    const radius = mod.radius ?? 0.15;
    const { min: paramMin, max: paramMax } = this.getParamRange(mod.targetModuleId, mod.targetParamPath, chainIndex);
    this.updateModulationRange(mod.id, centerValue, radius, chainIndex, paramMin, paramMax);
  }

  /**
   * 更新调制范围
   * @param modulationId - 调制ID
   * @param centerValue - 中心值
   * @param radius - 范围半径
   * @param paramMin - 参数最小值（用于钳制）
   * @param paramMax - 参数最大值（用于钳制）
   * @param chainIndex - 链索引
   */
  updateModulationRange(
    modulationId: string,
    centerValue: number,
    radius: number,
    chainIndex: number = this.app.getSelectedChainIndex(),
    paramMin: number = -Infinity,
    paramMax: number = Infinity,
  ): void {
    const items = this.modulationRuntimes.filter(
      (item) => item.modulationId === modulationId && item.chainIndex === chainIndex,
    );
    if (!items.length) {
      return;
    }

    const modulation = this.getModulationById(modulationId, chainIndex);
    const sourceModule = modulation
      ? this.getModules(chainIndex).find((m) => m.id === modulation.sourceModuleId)
      : null;
    const isEnvelopeSource = sourceModule?.type === "Envelope";

    items.forEach(({ scale, targetParamPath }) => {
      let minVal: number;
      let maxVal: number;

      if (isEnvelopeSource) {
        minVal = centerValue;
        maxVal = centerValue + Math.abs(radius);
        minVal = Math.max(paramMin, Math.min(paramMax, minVal));
        maxVal = Math.max(paramMin, Math.min(paramMax, maxVal));
      } else {
        minVal = Math.max(paramMin, Math.min(paramMax, centerValue - radius));
        maxVal = Math.max(paramMin, Math.min(paramMax, centerValue + radius));
      }

      const finalMin = Math.min(minVal, maxVal);
      const finalMax = Math.max(minVal, maxVal);

      if (targetParamPath === "volume") {
        minVal = Tone.dbToGain(finalMin);
        maxVal = Tone.dbToGain(finalMax);
      } else {
        minVal = finalMin;
        maxVal = finalMax;
      }

      scale.min = minVal;
      scale.max = maxVal;
    });
  }

  /**
   * 连接调制
   */
  connectModulations(): void {
    this.connectAllModulations();
  }

  connectAllModulations(): void {
    if (this.isConnectingModulations) {
      console.log("[ModulationManager] connectAllModulations already in progress, skipping...");
      return;
    }
    this.isConnectingModulations = true;

    this.clearModulationRuntimes();
    this.resetSourceVoiceAlignmentHints();

    const chainCount = this.app.getChainCount();
    for (let chainIndex = 0; chainIndex < chainCount; chainIndex += 1) {
      this.connectChainModulations(chainIndex);
    }

    this.isConnectingModulations = false;
  }

  resetSourceVoiceAlignmentHints(): void {
    const chainCount = this.app.getChainCount();
    for (let chainIndex = 0; chainIndex < chainCount; chainIndex += 1) {
      const runtimeMap = this.app.engine.getChainRuntimeMap(chainIndex);
      if (!runtimeMap) {
        continue;
      }
      runtimeMap.forEach((runtime) => {
        const r = runtime as Record<string, unknown>;
        if (r?.category === "source") {
          r.preserveVoiceSlotsForSourceTargets = false;
        }
      });
    }
  }

  connectChainModulations(chainIndex: number): void {
    const chain = this.app.getChain(chainIndex);
    if (!chain.enabled) {
      return;
    }

    const modulations = this.getModulations(chainIndex);
    if (!modulations.length) {
      return;
    }

    const sourceTargetProfile = new Map<string, SourceTargetProfile>();

    modulations.forEach((mod) => {
      const targets = this.getModulationTargetParams(mod, chainIndex);
      if (!targets.length) {
        return;
      }

      const hasSourceVoiceTargets = targets.some(({ voiceIndex }) => Number.isFinite(voiceIndex));
      const profile: SourceTargetProfile = sourceTargetProfile.get(mod.sourceModuleId) || {
        hasSourceTargets: false,
        hasNonSourceTargets: false,
      };
      if (hasSourceVoiceTargets) {
        profile.hasSourceTargets = true;
      } else {
        profile.hasNonSourceTargets = true;
      }
      sourceTargetProfile.set(mod.sourceModuleId, profile);

      targets.forEach(({ param, voiceIndex }, targetIndex) => {
        const sourceRuntime = this.app.engine.getModuleRuntime(chainIndex, mod.sourceModuleId) as unknown as SourceRuntime | null;
        const isSourceMono = sourceRuntime?.category === "source" && sourceRuntime.isMono;
        const sourceVoiceIndex = isSourceMono
          ? 0
          : Number.isFinite(voiceIndex as number)
            ? (voiceIndex as number)
            : Number(mod.sourceVoiceIndex ?? 0);

        this._createModulationConnection(mod, chainIndex, sourceVoiceIndex, param, targetIndex, voiceIndex);
      });

      this._applyModulationRange(mod, chainIndex);
    });

    sourceTargetProfile.forEach((profile, sourceModuleId) => {
      const sourceRuntime = this.app.engine.getModuleRuntime(chainIndex, sourceModuleId) as unknown as SourceRuntime | null;
      if (!sourceRuntime || sourceRuntime.category !== "source") {
        return;
      }
      const moduleState = (sourceRuntime.moduleState || {}) as Record<string, unknown>;
      sourceRuntime.preserveVoiceSlotsForSourceTargets = Boolean(
        profile.hasSourceTargets && !profile.hasNonSourceTargets && moduleState.modulationMode && moduleState.midiOn,
      );
    });
  }

  /**
   * 创建单个调制连接
   */
  _createModulationConnection(
    mod: ChainModulation,
    chainIndex: number,
    sourceVoiceIndex: number,
    param: unknown,
    targetIndex: number,
    targetVoiceIndex: number | null,
  ): boolean {
    const existingRuntime = this.modulationRuntimes.find(
      (r) =>
        r.chainIndex === chainIndex &&
        r.modulationId === mod.id &&
        r.sourceVoiceIndex === sourceVoiceIndex &&
        r.targetParam === param,
    );
    if (existingRuntime) {
      return false;
    }

    const sourceOutput = this.getModulationSourceOutput(mod, sourceVoiceIndex, chainIndex);
    if (!sourceOutput) {
      return false;
    }

    const sourceModule = this.getModules(chainIndex).find((m) => m.id === mod.sourceModuleId);
    const isEnvelopeSource = sourceModule?.type === "Envelope";

    const isFrequencyParam = mod.targetParamPath === "options.frequency";
    const audioHalf = isFrequencyParam ? null : new Tone.Multiply(0.5);
    const audioOffset = new Tone.Add(0.5);
    const scale = new Tone.Scale();

    if (isEnvelopeSource) {
      (sourceOutput as any).connect(scale);
    } else if (isFrequencyParam) {
      (sourceOutput as any).connect(audioOffset);
      audioOffset.connect(scale);
    } else {
      (sourceOutput as any).connect(audioHalf);
      audioHalf.connect(audioOffset);
      audioOffset.connect(scale);
    }
    scale.connect(param as any);

    this.modulationRuntimes.push({
      id: `${chainIndex}-${mod.id}-${sourceVoiceIndex}-${targetIndex}`,
      chainIndex,
      modulationId: mod.id,
      sourceVoiceIndex,
      targetParamPath: mod.targetParamPath,
      targetParam: param,
      targetModuleId: mod.targetModuleId,
      targetVoiceIndex,
      sourceOutput,
      audioHalf,
      audioOffset,
      scale,
    });

    return true;
  }

  /**
   * 连接指定 voice 的调制（增量更新）
   * 只建立涉及该 voice 作为 source 或 target 的调制连接，避免全量重建
   */
  connectVoiceModulations(chainIndex: number, moduleId: string, voiceIndex: number): void {
    const chain = this.app.getChain(chainIndex);
    if (!chain?.enabled) {
      return;
    }

    const modulations = this.getModulations(chainIndex);
    if (!modulations.length) {
      return;
    }

    let connectedCount = 0;

    modulations.forEach((mod) => {
      if (mod.sourceModuleId === moduleId) {
        const targets = this.getModulationTargetParams(mod, chainIndex);
        const sourceRuntime = this.app.engine.getModuleRuntime(chainIndex, mod.sourceModuleId) as unknown as SourceRuntime | null;
        const isSourceMono = sourceRuntime?.category === "source" && sourceRuntime.isMono;

        targets.forEach(({ param, voiceIndex: targetVoiceIndex }, targetIndex) => {
          const expectedSourceVoiceIndex = Number.isFinite(targetVoiceIndex as number)
            ? targetVoiceIndex
            : Number(mod.sourceVoiceIndex ?? 0);

          if (!isSourceMono && expectedSourceVoiceIndex !== voiceIndex) {
            return;
          }

          const sourceVoiceIndex = isSourceMono ? 0 : expectedSourceVoiceIndex;
          const created = this._createModulationConnection(
            mod,
            chainIndex,
            sourceVoiceIndex,
            param,
            targetIndex,
            targetVoiceIndex,
          );
          if (created) {
            connectedCount++;
            this._applyModulationRange(mod, chainIndex);
          }
        });
      }

      if (mod.targetModuleId === moduleId) {
        const targets = this.getModulationTargetParams(mod, chainIndex);
        const target = targets.find((t) => t.voiceIndex === voiceIndex);
        if (!target) {
          return;
        }

        const sourceRuntime = this.app.engine.getModuleRuntime(chainIndex, mod.sourceModuleId) as unknown as SourceRuntime | null;
        const isSourceMono = sourceRuntime?.category === "source" && sourceRuntime.isMono;

        const sourceVoiceIndex = isSourceMono
          ? 0
          : Number.isFinite(target.voiceIndex as number)
            ? target.voiceIndex
            : Number(mod.sourceVoiceIndex ?? 0);
        const targetIndex = targets.findIndex((t) => t.voiceIndex === voiceIndex);

        const created = this._createModulationConnection(
          mod,
          chainIndex,
          sourceVoiceIndex,
          target.param,
          targetIndex,
          voiceIndex,
        );
        if (created) {
          connectedCount++;
          this._applyModulationRange(mod, chainIndex);
        }
      }
    });
  }

  /**
   * 断开指定 voice 的调制连接（增量清理）
   * 只清理涉及该 voice 作为 source 或 target 的调制连接
   */
  disconnectVoiceModulations(chainIndex: number, moduleId: string, voiceIndex: number): void {
    const toRemove: number[] = [];

    this.modulationRuntimes.forEach((runtime, index) => {
      if (runtime.chainIndex !== chainIndex) {
        return;
      }

      const mod = this.getModulations(chainIndex).find((m) => m.id === runtime.modulationId);
      if (!mod) return;

      const sourceRuntime = this.app.engine.getModuleRuntime(chainIndex, mod.sourceModuleId) as unknown as SourceRuntime | null;
      const isSourceMono = sourceRuntime?.category === "source" && sourceRuntime.isMono;

      const isSourceMatch =
        (runtime.sourceVoiceIndex === voiceIndex || (isSourceMono && voiceIndex === 0)) &&
        mod.sourceModuleId === moduleId;

      const isTargetMatch = runtime.targetVoiceIndex === voiceIndex && runtime.targetModuleId === moduleId;

      if (!isSourceMatch && !isTargetMatch) {
        return;
      }

      toRemove.push(index);

      if (runtime.sourceOutput && runtime.audioHalf) {
        try {
          (runtime.sourceOutput as any).disconnect(runtime.audioHalf);
        } catch {
          // ignore
        }
      }

      if (runtime.scale && runtime.targetParam) {
        try {
          runtime.scale.disconnect(runtime.targetParam as any);
        } catch {
          // ignore
        }
      }

      if (runtime.scale && typeof runtime.scale.dispose === "function") {
        runtime.scale.dispose();
      }
      if (runtime.audioHalf && typeof runtime.audioHalf.dispose === "function") {
        runtime.audioHalf.dispose();
      }
      if (runtime.audioOffset && typeof runtime.audioOffset.dispose === "function") {
        runtime.audioOffset.dispose();
      }
    });

    toRemove
      .sort((a, b) => b - a)
      .forEach((index) => {
        this.modulationRuntimes.splice(index, 1);
      });
  }

  /**
   * 清除调制运行时
   * 手动断开所有音频连接，然后 dispose 节点
   */
  clearModulationRuntimes(): void {
    this.modulationRuntimes.forEach((item) => {
      if (item.sourceOutput) {
        try {
          if (item.audioHalf) {
            (item.sourceOutput as any).disconnect(item.audioHalf);
          } else if (item.scale) {
            (item.sourceOutput as any).disconnect(item.scale);
          }
        } catch {
          // 连接可能已断开，忽略错误
        }
      }

      if (item.scale && item.targetParam) {
        try {
          item.scale.disconnect(item.targetParam as any);
        } catch {
          // 连接可能已断开，忽略错误
        }
      }

      if (item.scale && typeof item.scale.dispose === "function") {
        item.scale.dispose();
      }
      if (item.audioHalf && typeof item.audioHalf.dispose === "function") {
        item.audioHalf.dispose();
      }
      if (item.audioOffset && typeof item.audioOffset.dispose === "function") {
        item.audioOffset.dispose();
      }
    });
    this.modulationRuntimes = [];
  }

  /**
   * 获取调制源输出
   * @param modulation - 调制对象
   * @returns 调制源输出节点
   */
  getModulationSourceOutput(
    modulation: ChainModulation,
    sourceVoiceIndex: number = 0,
    chainIndex: number = this.app.getSelectedChainIndex(),
  ): AudioNode | null {
    const sourceRuntime = this.app.engine.getModuleRuntime(chainIndex, modulation.sourceModuleId) as unknown as SourceRuntime | null;
    if (!sourceRuntime) {
      return null;
    }
    if (!sourceRuntime.getModulationOutput) {
      return null;
    }

    const voiceIndex = Number.isFinite(Number(sourceVoiceIndex))
      ? Number(sourceVoiceIndex)
      : Number(modulation.sourceVoiceIndex ?? 0);
    return sourceRuntime.getModulationOutput(voiceIndex);
  }

  /**
   * 获取调制目标参数
   * @param modulation - 调制对象
   * @returns 调制目标参数
   */
  getModulationTargetParams(
    modulation: ChainModulation,
    chainIndex: number = this.app.getSelectedChainIndex(),
  ): ModulationTargetParam[] {
    const targetModule = this.getModules(chainIndex).find((m) => m.id === modulation.targetModuleId);
    if (!targetModule) {
      return [];
    }

    const runtime = this.app.engine.getModuleRuntime(chainIndex, targetModule.id) as Record<string, unknown> | null;
    if (!runtime) {
      return [];
    }

    if (runtime.category === "source" && Array.isArray(runtime.voices)) {
      const targets = (runtime.voices as SourceVoice[])
        .map((voice, voiceIndex) => {
          const param = this.getSourceVoiceTargetParam(voice, modulation.targetParamPath);
          if (!param || typeof param === "number") {
            return null;
          }
          return { param, voiceIndex };
        })
        .filter(Boolean) as ModulationTargetParam[];

      if (!targets.length) {
        return [];
      }

      return targets;
    }

    const node = runtime.node as Record<string, unknown> | undefined;
    if (!node) {
      return [];
    }
    const paramPath = modulation.targetParamPath.replace(/^options\./, "");
    const param = getByPath(node, paramPath);
    if (!param) {
      return [];
    }
    if (typeof param === "number") {
      return [];
    }

    return [{ param: param as AudioParam | Tone.ToneAudioNode, voiceIndex: null }];
  }

  /**
   * 获取 Source 模块单个 voice 的目标参数
   * @param voice - Source voice 运行时
   * @param targetParamPath - 目标参数路径
   * @returns 可连接参数
   */
  getSourceVoiceTargetParam(voice: SourceVoice, targetParamPath: string): unknown {
    if (!voice || !targetParamPath) {
      return null;
    }

    if (targetParamPath === "volume") {
      return voice.volumeNode?.gain || null;
    }

    if (targetParamPath === "pan") {
      return voice.panNode?.pan || null;
    }

    if (targetParamPath === "options.gain") {
      return voice.volumeNode?.gain || null;
    }

    if (targetParamPath === "options.frequencyOffset") {
      return voice.frequencyOffsetParam || null;
    }

    if (targetParamPath === "options.frequency") {
      return voice.frequencyBaseSignal || null;
    }

    const paramPath = targetParamPath.replace(/^options\./, "");
    const param = getByPath(voice.node as unknown as Record<string, unknown>, paramPath);
    if (!param || typeof param === "number") {
      return null;
    }

    return param;
  }

  /**
   * 取消调制拖拽，重置拖拽状态
   */
  cancelModulationDrag(): void {
    this.modulationDrag = {
      active: false,
      pointerId: 0,
      sourceModuleId: "",
      updateConnectionId: "",
      startX: 0,
      startY: 0,
      x: 0,
      y: 0,
    };
    this.renderModulationOverlay();
  }

  /**
   * 获取元素在信号流容器中的相对坐标（中心点）
   * @param element - DOM元素
   * @returns 包含x和y坐标的对象，或null
   */
  getPointInSignalFlowShell(element: Element | null): { x: number; y: number } | null {
    const shell = this.app.elements.signalFlowShell;
    if (!shell || !element) {
      return null;
    }
    const shellRect = shell.getBoundingClientRect();
    const rect = (element as HTMLElement).getBoundingClientRect();
    return {
      x: rect.left - shellRect.left + rect.width / 2,
      y: rect.top - shellRect.top + rect.height / 2,
    };
  }

  /**
   * 线性插值平滑移动点
   * @param current - 当前点坐标
   * @param target - 目标点坐标
   * @param damping - 阻尼系数（0-1）
   * @returns 是否还在移动中
   */
  lerpPoint(
    current: { x: number; y: number },
    target: { x: number; y: number },
    damping: number,
  ): boolean {
    current.x += (target.x - current.x) * damping;
    current.y += (target.y - current.y) * damping;
    const dx = Math.abs(target.x - current.x);
    const dy = Math.abs(target.y - current.y);
    const settled = dx < 0.5 && dy < 0.5;
    if (settled) {
      current.x = target.x;
      current.y = target.y;
    }
    return !settled;
  }

  /**
   * 渲染调制连接线覆盖层
   * 使用SVG绘制平滑的贝塞尔曲线连接线
   */
  renderModulationOverlay(): void {
    const shell = this.app.elements.signalFlowShell;
    if (!shell) return;

    if (!this.modulationSvg) {
      this.modulationSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.modulationSvg.classList.add("modulation-cables");
      shell.appendChild(this.modulationSvg);
    }

    const shellRect = shell.getBoundingClientRect();
    const svg = this.modulationSvg;
    svg.setAttribute("width", String(Math.max(1, shellRect.width)));
    svg.setAttribute("height", String(Math.max(1, shellRect.height)));

    const sizeKey = `${shellRect.width}x${shellRect.height}`;
    if (this._lastSvgSize !== sizeKey) {
      this._lastSvgSize = sizeKey;
      svg.innerHTML = "";
      this.cableElements.clear();
    }

    const color = "var(--modulation)";
    const activeKeys = new Set<string>();

    const getOrCreateElement = (id: string, tag: string, parent: SVGElement = svg): SVGElement => {
      const key = id;
      let el = this.cableElements.get(key);
      if (!el) {
        el = document.createElementNS("http://www.w3.org/2000/svg", tag);
        this.cableElements.set(key, el);
        parent.appendChild(el);
      }
      return el;
    };

    const removeUnusedElements = (): void => {
      this.cableElements.forEach((el, key) => {
        if (!activeKeys.has(key)) {
          el.remove();
          this.cableElements.delete(key);
        }
      });
    };

    const updateCablePath = (
      from: { x: number; y: number },
      to: { x: number; y: number },
      isGhost = false,
      id: string,
    ): void => {
      const path = getOrCreateElement(id, "path") as SVGPathElement;
      const horizontalDist = Math.abs(to.x - from.x);

      const cx = (from.x + to.x) / 2;
      const sag = 15 + horizontalDist * 0.25;
      const cy = Math.max(from.y, to.y) + sag;

      path.setAttribute("d", `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("opacity", isGhost ? "0.5" : "0.6");

      if (isGhost) {
        path.setAttribute("stroke-dasharray", "6 4");
      } else {
        path.removeAttribute("stroke-dasharray");
      }

      activeKeys.add(id);
    };

    const updateSocket = (point: { x: number; y: number }, id: string): void => {
      const dot = getOrCreateElement(id, "circle") as SVGCircleElement;
      dot.setAttribute("cx", String(point.x));
      dot.setAttribute("cy", String(point.y));
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", color);
      dot.setAttribute("opacity", "0.6");
      activeKeys.add(id);
    };

    const renderCable = (route: { id: string; from: { x: number; y: number }; to: { x: number; y: number } }, isGhost = false): void => {
      const pathId = `path-${route.id}`;
      const fromSocketId = `from-${route.id}`;
      const toSocketId = `to-${route.id}`;

      updateCablePath(route.from, route.to, isGhost, pathId);
      updateSocket(route.from, fromSocketId);
      updateSocket(route.to, toSocketId);
    };

    this.getModulations().forEach((connection) => {
      const fromEl = this.app.elements.signalFlow?.querySelector(
        `.module-mod-anchor[data-module-id="${connection.sourceModuleId}"]`,
      );
      const toEl = this.app.elements.signalFlow?.querySelector(
        `.modulation-target[data-module-id="${connection.targetModuleId}"][data-param-path="${connection.targetParamPath}"]`,
      );

      const from = this.getPointInSignalFlowShell(fromEl);
      const to = this.getPointInSignalFlowShell(toEl);

      if (from && to) {
        renderCable({ id: connection.id, from, to }, false);
      }
    });

    if (this.modulationDrag.active) {
      const fromEl = this.app.elements.signalFlow?.querySelector(
        `.module-mod-anchor[data-module-id="${this.modulationDrag.sourceModuleId}"]`,
      );
      const from = this.getPointInSignalFlowShell(fromEl);

      if (from) {
        renderCable(
          {
            id: "drag",
            from,
            to: { x: this.modulationDrag.x - shellRect.left, y: this.modulationDrag.y - shellRect.top },
          },
          true,
        );
      }
    }

    removeUnusedElements();

    if (this.modulationDrag.active) {
      this.modulationFrame = requestAnimationFrame(() => this.renderModulationOverlay());
    } else {
      this.modulationFrame = 0;
    }
  }
}
