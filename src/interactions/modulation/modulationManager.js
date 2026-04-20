import * as Tone from "tone";
import { getByPath } from "../../utils/helpers.js";
import { MODULATION_BLACKLIST } from "./modulationBlacklist.js";

/**
 * ModulationManager - 调制连接管理器
 * 负责处理模块间调制连接的创建、编辑、删除和可视化
 * 支持拖拽方式建立调制连接，实时渲染连接线
 * 管理调制运行时和音频连接
 */
export class ModulationManager {
  /**
   * 构造函数
   * @param {Object} app - 应用实例
   */
  constructor(app) {
    this.app = app;
    
    // 调制拖拽状态
    this.modulationDrag = {
      active: false,         // 是否正在拖拽
      pointerId: 0,          // 指针ID
      sourceModuleId: "",    // 源模块ID
      updateConnectionId: "",// 正在更新的连接ID
      startX: 0,             // 起始X坐标
      startY: 0,             // 起始Y坐标
      x: 0,                  // 当前X坐标
      y: 0,                  // 当前Y坐标
    };
    
    // SVG元素用于渲染调制连接线
    this.modulationSvg = null;
    
    // 存储连接线的视觉状态，用于平滑动画
    this.cableVisuals = new Map();
    
    // requestAnimationFrame的帧ID
    this.modulationFrame = 0;
    
    // 调制运行时，存储音频连接和缩放器
    this.modulationRuntimes = [];

    // 防止递归连接调制的标志
    this.isConnectingModulations = false;
  }

  /**
   * 绑定全局事件监听器
   */
  bindEvents() {
    document.addEventListener("pointermove", (event) => this.handleModulationPointerMove(event));
    document.addEventListener("pointerup", (event) => this.handleModulationPointerUp(event));
    document.addEventListener("pointercancel", () => this.cancelModulationDrag());
  }

  /**
   * 判断一个模块是否可以作为调制源
   * @param {Object} module - 模块对象
   * @returns {boolean} 是否为有效的调制源
   */
  isModulationSource(module) {
    if (!module) {
      return false;
    }
    // Envelope类型的模块总是作为调制源
    if (module.type === "Envelope") {
      return true;
    }
    // 或者是source类别且开启了modulationMode的模块
    return module.category === "source" && Boolean(module.modulationMode);
  }

  getModules(chainIndex = this.app.getSelectedChainIndex()) {
    return this.app.getChain(chainIndex).modules;
  }

  /**
   * 获取指定链的调制连接
   * @returns {Array} 调制连接数组
   */
  getModulations(chainIndex = this.app.getSelectedChainIndex()) {
    const chain = this.app.getChain(chainIndex);
    if (!Array.isArray(chain.modulations)) {
      chain.modulations = [];
    }
    return chain.modulations;
  }

  setModulations(nextModulations, chainIndex = this.app.getSelectedChainIndex()) {
    this.app.getChain(chainIndex).modulations = Array.isArray(nextModulations) ? nextModulations : [];
  }

  /**
   * 获取指定模块作为源的所有输出调制连接
   * @param {string} sourceModuleId - 源模块ID
   * @returns {Array} 输出调制连接数组
   */
  getOutgoingModulations(sourceModuleId, chainIndex = this.app.getSelectedChainIndex()) {
    return this.getModulations(chainIndex).filter((item) => item.sourceModuleId === sourceModuleId);
  }

  /**
   * 根据目标模块和参数路径查找调制连接
   * @param {string} targetModuleId - 目标模块ID
   * @param {string} targetParamPath - 目标参数路径
   * @returns {Object|null} 找到的调制连接或null
   */
  getModulationByTarget(targetModuleId, targetParamPath, chainIndex = this.app.getSelectedChainIndex()) {
    return (
      this.getModulations(chainIndex).find(
        (item) => item.targetModuleId === targetModuleId && item.targetParamPath === targetParamPath,
      ) || null
    );
  }

  /**
   * 根据连接ID查找调制连接
   * @param {string} connectionId - 连接ID
   * @returns {Object|null} 找到的调制连接或null
   */
  getModulationById(connectionId, chainIndex = this.app.getSelectedChainIndex()) {
    return this.getModulations(chainIndex).find((item) => item.id === connectionId) || null;
  }

  /**
   * 获取下一个可用的调制声道索引（0-7）
   * @param {string} sourceModuleId - 源模块ID
   * @returns {number} 可用的声道索引，无可用则返回-1
   */
  getNextModulationVoiceIndex(sourceModuleId, chainIndex = this.app.getSelectedChainIndex()) {
    const used = new Set(this.getOutgoingModulations(sourceModuleId, chainIndex).map((item) => Number(item.sourceVoiceIndex)));
    for (let i = 0; i < 8; i += 1) {
      if (!used.has(i)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 开始调制连接拖拽
   * @param {Object} params - 参数对象
   * @param {PointerEvent} params.event - 指针事件
   * @param {string} params.sourceModuleId - 源模块ID
   * @param {string} params.updateConnectionId - 要更新的连接ID（可选）
   */
  startModulationDrag({ event, sourceModuleId, updateConnectionId = "" }) {
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
   * @param {PointerEvent} event - 指针移动事件
   */
  handleModulationPointerMove(event) {
    if (!this.modulationDrag.active) {
      return;
    }
    this.modulationDrag.x = event.clientX;
    this.modulationDrag.y = event.clientY;

    // 清除之前的悬停样式
    document.querySelectorAll(".control.mod-target-hover").forEach((node) => {
      node.classList.remove("mod-target-hover");
    });
    
    // 检查是否悬停在有效的滑块控件上
    const slider = event.target?.closest?.(".control.control-slider[data-module-id][data-param-path]");
    if (slider) {
      const mainCard = slider.closest(".module-card[data-main-card='true']");
      const paramPath = slider.dataset.paramPath;
      const isBlacklisted = MODULATION_BLACKLIST.includes(paramPath);
      
      if (!mainCard && !isBlacklisted) {
        slider.classList.add("mod-target-hover");
      }
    }

    this.renderModulationOverlay();
  }

  /**
   * 处理调制拖拽结束时的指针抬起事件
   * @param {PointerEvent} event - 指针抬起事件
   */
  handleModulationPointerUp(event) {
    if (!this.modulationDrag.active) {
      return;
    }

    const drag = { ...this.modulationDrag };
    const targetControl = event.target?.closest?.(".control.control-slider[data-module-id][data-param-path]");

    // 检查目标是否是主卡（主卡参数不能被调制）
    if (targetControl) {
      const mainCard = targetControl.closest(".module-card[data-main-card='true']");
      if (mainCard) {
        document.querySelectorAll(".control.mod-target-hover").forEach((node) => {
          node.classList.remove("mod-target-hover");
        });
        this.app.setStatus("Main Card parameters cannot be modulated.", "error");
        this.cancelModulationDrag();
        return;
      }

      const paramPath = targetControl.dataset.paramPath;
      if (MODULATION_BLACKLIST.includes(paramPath)) {
        document.querySelectorAll(".control.mod-target-hover").forEach((node) => {
          node.classList.remove("mod-target-hover");
        });
        this.app.setStatus(`Parameter "${paramPath}" cannot be modulated.`, "error");
        this.cancelModulationDrag();
        return;
      }
    }

    // 清除所有悬停样式
    document.querySelectorAll(".control.mod-target-hover").forEach((node) => {
      node.classList.remove("mod-target-hover");
    });

    // 如果没有找到有效的目标控件
    if (!targetControl) {
      // 如果是在更新现有连接，则删除该连接
      if (drag.updateConnectionId) {
        this.removeModulationById(drag.updateConnectionId);
        this.app.engine.fullSync(this.app.state);
        this.app.renderAll();
      }
      this.cancelModulationDrag();
      return;
    }

    // 提交新的调制连接
    const targetModuleId = targetControl.dataset.moduleId;
    const targetParamPath = targetControl.dataset.paramPath;
    this.commitModulationTarget({
      sourceModuleId: drag.sourceModuleId,
      targetModuleId,
      targetParamPath,
      updateConnectionId: drag.updateConnectionId,
    });
    this.cancelModulationDrag();
  }

  /**
   * 提交并创建/更新调制连接
   * @param {Object} params - 参数对象
   * @param {string} params.sourceModuleId - 源模块ID
   * @param {string} params.targetModuleId - 目标模块ID
   * @param {string} params.targetParamPath - 目标参数路径
   * @param {string} params.updateConnectionId - 要更新的连接ID（可选）
   */
  commitModulationTarget({ sourceModuleId, targetModuleId, targetParamPath, updateConnectionId = "" }) {
    if (!sourceModuleId || !targetModuleId || !targetParamPath || sourceModuleId === targetModuleId) {
      return;
    }

    const chainIndex = this.app.getSelectedChainIndex();

    const targetModuleCard = document.querySelector(`.module-card[data-module-id="${targetModuleId}"][data-main-card='true']`);
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
      });
    }

    this.app.selectedPresetId = "custom";
    this.app.engine.fullSync(this.app.state);
    this.app.renderAll();
  }

  /**
   * 根据ID删除调制连接
   * @param {string} connectionId - 连接ID
   */
  removeModulationById(connectionId) {
    this.setModulations(this.getModulations().filter((item) => item.id !== connectionId));
    this.app.selectedPresetId = "custom";
  }

  /**
   * 删除指定模块的所有输出调制连接
   * @param {string} sourceModuleId - 源模块ID
   */
  removeOutgoingModulations(sourceModuleId) {
    this.setModulations(this.getModulations().filter((item) => item.sourceModuleId !== sourceModuleId));
    this.app.selectedPresetId = "custom";
  }

  /**
   * 删除与指定模块相关的所有调制连接（作为源或目标）
   * @param {string} moduleId - 模块ID
   */
  removeModuleModulations(moduleId) {
    this.setModulations(this.getModulations().filter(
      (item) => item.sourceModuleId !== moduleId && item.targetModuleId !== moduleId,
    ));
    this.app.selectedPresetId = "custom";
  }

  /**
   * 初始化所有调制范围
   * @param {Array} ranges - 调制范围配置数组
   */
  initAllModulationRanges(ranges) {
    if (!Array.isArray(ranges)) {
      return;
    }
    ranges.forEach(({ modulationId, radius, currentSliderValue, paramMin, paramMax }) => {
      const centerValue = currentSliderValue;
      this.updateModulationRange(modulationId, centerValue, radius);
    });
  }

  /**
   * 更新调制范围
   * @param {string} modulationId - 调制ID
   * @param {number} centerValue - 中心值
   * @param {number} radius - 范围半径
   */
  updateModulationRange(modulationId, centerValue, radius, chainIndex = this.app.getSelectedChainIndex()) {
    const items = this.modulationRuntimes.filter(
      (item) => item.modulationId === modulationId && item.chainIndex === chainIndex,
    );
    if (!items.length) {
      return;
    }

    items.forEach(({ scale, targetParamPath }) => {
      let minVal = centerValue - radius;
      let maxVal = centerValue + radius;

      if (targetParamPath === "volume") {
        minVal = Tone.dbToGain(minVal);
        maxVal = Tone.dbToGain(maxVal);
      }

      scale.min = minVal;
      scale.max = maxVal;
    });
  }

  /**
   * 连接调制
   */
  connectModulations() {
    this.connectAllModulations();
  }

  connectAllModulations() {
    // 防止递归调用：如果正在连接调制，直接返回
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

  resetSourceVoiceAlignmentHints() {
    const chainCount = this.app.getChainCount();
    for (let chainIndex = 0; chainIndex < chainCount; chainIndex += 1) {
      const runtimeMap = this.app.engine.getChainRuntimeMap(chainIndex);
      if (!runtimeMap) {
        continue;
      }
      runtimeMap.forEach((runtime) => {
        if (runtime?.category === "source") {
          runtime.preserveVoiceSlotsForSourceTargets = false;
        }
      });
    }
  }

  connectChainModulations(chainIndex) {
    const chain = this.app.getChain(chainIndex);
    if (!chain.enabled) {
      return;
    }

    const modulations = this.getModulations(chainIndex);
    if (!modulations.length) {
      return;
    }

    const sourceTargetProfile = new Map();

    modulations.forEach((mod) => {
      const targets = this.getModulationTargetParams(mod, chainIndex);
      if (!targets.length) {
        return;
      }

      const hasSourceVoiceTargets = targets.some(({ voiceIndex }) => Number.isFinite(voiceIndex));
      const profile = sourceTargetProfile.get(mod.sourceModuleId) || { hasSourceTargets: false, hasNonSourceTargets: false };
      if (hasSourceVoiceTargets) {
        profile.hasSourceTargets = true;
      } else {
        profile.hasNonSourceTargets = true;
      }
      sourceTargetProfile.set(mod.sourceModuleId, profile);

      targets.forEach(({ param, voiceIndex }) => {
        const sourceVoiceIndex = Number.isFinite(voiceIndex)
          ? voiceIndex
          : Number(mod.sourceVoiceIndex ?? 0);
        const sourceOutput = this.getModulationSourceOutput(mod, sourceVoiceIndex, chainIndex);
        if (!sourceOutput) {
          return;
        }

        // 检查是否已存在相同的调制连接，防止重复连接导致调制值翻倍
        const existingRuntime = this.modulationRuntimes.find(
          (r) => r.chainIndex === chainIndex
            && r.modulationId === mod.id
            && r.sourceVoiceIndex === sourceVoiceIndex
            && r.targetParam === param
        );
        if (existingRuntime) {
          console.log(`[ModulationManager] Skipping duplicate modulation connection: ${mod.id} -> ${mod.targetParamPath} (voice ${sourceVoiceIndex})`);
          return;
        }

        const audioHalf = new Tone.Multiply(0.5);
        const audioOffset = new Tone.Add(0.5);
        const scale = new Tone.Scale();

        sourceOutput.connect(audioHalf);
        audioHalf.connect(audioOffset);
        audioOffset.connect(scale);
        scale.connect(param);

        this.modulationRuntimes.push({
          id: `${chainIndex}-${mod.id}-${sourceVoiceIndex}`,
          chainIndex,
          modulationId: mod.id,
          sourceVoiceIndex,
          targetParamPath: mod.targetParamPath,
          targetParam: param,  // 存储目标参数引用，用于重复检测
          sourceOutput,
          audioHalf,
          audioOffset,
          scale,
        });
      });

      // 立即应用当前滑块值作为调制范围中心
      const targetModule = this.getModules(chainIndex).find((m) => m.id === mod.targetModuleId);
      let centerValue = 0.5; // 默认中心值
      if (targetModule) {
        const currentSliderValue = getByPath(targetModule, mod.targetParamPath);
        if (typeof currentSliderValue === "number" && Number.isFinite(currentSliderValue)) {
          centerValue = currentSliderValue;
        }
      }
      const radius = mod.radius ?? 0.15;
      this.updateModulationRange(mod.id, centerValue, radius, chainIndex)
    });

    sourceTargetProfile.forEach((profile, sourceModuleId) => {
      const sourceRuntime = this.app.engine.getModuleRuntime(chainIndex, sourceModuleId);
      if (!sourceRuntime || sourceRuntime.category !== "source") {
        return;
      }
      const moduleState = sourceRuntime.moduleState || {};
      sourceRuntime.preserveVoiceSlotsForSourceTargets = Boolean(
        profile.hasSourceTargets
        && !profile.hasNonSourceTargets
        && moduleState.modulationMode
        && moduleState.midiOn,
      );
    });
  }

  /**
   * 清除调制运行时
   * 手动断开所有音频连接，然后 dispose 节点
   */
  clearModulationRuntimes() {
    this.modulationRuntimes.forEach((item) => {
      // 手动断开 sourceOutput 到 audioHalf 的连接
      if (item.sourceOutput && item.audioHalf) {
        try {
          item.sourceOutput.disconnect(item.audioHalf);
        } catch (e) {
          // 连接可能已断开，忽略错误
        }
      }

      // 手动断开 scale 到目标参数的连接，防止残留连接导致调制值叠加
      if (item.scale && item.targetParam) {
        try {
          item.scale.disconnect(item.targetParam);
        } catch (e) {
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
   * @param {Object} modulation - 调制对象
   * @returns {Object|null} 调制源输出节点
   */
  getModulationSourceOutput(modulation, sourceVoiceIndex = 0, chainIndex = this.app.getSelectedChainIndex()) {
    const sourceRuntime = this.app.engine.getModuleRuntime(chainIndex, modulation.sourceModuleId);
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
   * @param {Object} modulation - 调制对象
   * @returns {Object|null} 调制目标参数
   */
  getModulationTargetParams(modulation, chainIndex = this.app.getSelectedChainIndex()) {
    const targetModule = this.getModules(chainIndex).find((m) => m.id === modulation.targetModuleId);
    if (!targetModule) {
      return [];
    }

    const runtime = this.app.engine.getModuleRuntime(chainIndex, targetModule.id);
    if (!runtime) {
      return [];
    }

    if (runtime.category === "source" && Array.isArray(runtime.voices)) {
      const targets = runtime.voices
        .map((voice, voiceIndex) => {
          const param = this.getSourceVoiceTargetParam(voice, modulation.targetParamPath);
          if (!param || typeof param === "number") {
            return null;
          }
          return { param, voiceIndex };
        })
        .filter(Boolean);

      if (!targets.length) {
        return [];
      }

      return targets;
    }

    if (!runtime.node) {
      return [];
    }
    const paramPath = modulation.targetParamPath.replace(/^options\./, "");
    const param = getByPath(runtime.node, paramPath);
    if (!param) {
      return [];
    }
    if (typeof param === "number") {
      return [];
    }

    return [{ param, voiceIndex: null }];
  }

  /**
   * 获取 Source 模块单个 voice 的目标参数
   * @param {Object} voice - Source voice 运行时
   * @param {string} targetParamPath - 目标参数路径
   * @returns {Object|null} 可连接参数
   */
  getSourceVoiceTargetParam(voice, targetParamPath) {
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

    const paramPath = targetParamPath.replace(/^options\./, "");
    const param = getByPath(voice.node, paramPath);
    if (!param || typeof param === "number") {
      return null;
    }

    return param;
  }

  /**
   * 取消调制拖拽，重置拖拽状态
   */
  cancelModulationDrag() {
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
   * @param {HTMLElement} element - DOM元素
   * @returns {Object|null} 包含x和y坐标的对象，或null
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
   * 线性插值平滑移动点
   * @param {Object} current - 当前点坐标
   * @param {Object} target - 目标点坐标
   * @param {number} damping - 阻尼系数（0-1）
   * @returns {boolean} 是否还在移动中
   */
  lerpPoint(current, target, damping) {
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
  renderModulationOverlay() {
    const shell = this.app.elements.signalFlowShell;
    if (!shell) return;

    // 创建SVG元素（如果不存在）
    if (!this.modulationSvg) {
      this.modulationSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.modulationSvg.classList.add("modulation-cables");
      shell.appendChild(this.modulationSvg);
    }

    // 设置SVG尺寸
    const shellRect = shell.getBoundingClientRect();
    const svg = this.modulationSvg;
    svg.setAttribute("width", String(Math.max(1, shellRect.width)));
    svg.setAttribute("height", String(Math.max(1, shellRect.height)));
    svg.innerHTML = "";

    const color = "var(--modulation)";
    const damping = 0.05;
    const activeKeys = new Set();
    let shouldContinue = Boolean(this.modulationDrag.active);

    /**
     * 创建连接线SVG路径
     * @param {Object} from - 起点坐标
     * @param {Object} to - 终点坐标
     * @param {boolean} isGhost - 是否为幽灵线（拖拽预览）
     */
    const createCablePath = (from, to, isGhost = false) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const horizontalDist = Math.abs(to.x - from.x);

      // 计算二次贝塞尔曲线的控制点
      const cx = (from.x + to.x) / 2;
      const sag = 15 + horizontalDist * 0.25;
      const cy = Math.max(from.y, to.y) + sag;

      path.setAttribute("d", `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("opacity", isGhost ? "0.5" : "0.6");

      if (isGhost) path.setAttribute("stroke-dasharray", "6 4");

      svg.appendChild(path);
    };

    /**
     * 创建连接点（圆形节点）
     * @param {Object} point - 点坐标
     * @param {boolean} interactive - 是否可交互
     * @param {Object|null} meta - 元数据
     */
    const createSocket = (point, interactive = false, meta = null) => {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", String(point.x));
      dot.setAttribute("cy", String(point.y));
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", color);
      dot.setAttribute("opacity", "0.6");

      if (interactive && meta) {
        dot.setAttribute("class", "cable-socket is-interactive");
        dot.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.startModulationDrag({
            event,
            sourceModuleId: meta.sourceModuleId,
            updateConnectionId: meta.connectionId,
          });
        });
      }

      svg.appendChild(dot);
    };

    /**
     * 渲染单条连接线
     * @param {Object} route - 路由信息
     * @param {boolean} interactive - 是否可交互
     * @param {boolean} isGhost - 是否为幽灵线
     */
    const renderCable = (route, interactive = true, isGhost = false) => {
      activeKeys.add(route.id);

      // 获取或初始化视觉状态
      const visual = this.cableVisuals.get(route.id) || {
        from: { x: route.from.x, y: route.from.y },
        to: { x: route.to.x, y: route.to.y },
      };

      // 平滑移动
      const movingFrom = this.lerpPoint(visual.from, route.from, damping);
      const movingTo = this.lerpPoint(visual.to, route.to, damping);

      this.cableVisuals.set(route.id, visual);

      if (movingFrom || movingTo) shouldContinue = true;

      // 绘制连接线和连接点
      createCablePath(visual.from, visual.to, isGhost);

      if (interactive) {
        createSocket(visual.from, false, { sourceModuleId: route.sourceModuleId, connectionId: route.id });
        createSocket(visual.to, false);
      } else {
        createSocket(visual.from, false);
        createSocket(visual.to, false);
      }
    };

    // 渲染所有已建立的调制连接
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
        renderCable(
          { id: connection.id, sourceModuleId: connection.sourceModuleId, from, to },
          true,
          false,
        );
      }
    });

    // 渲染正在拖拽的连接线预览
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
          false,
          true,
        );
      }
    }

    // 清理不再使用的视觉状态
    this.cableVisuals.forEach((_, key) => {
      if (!activeKeys.has(key)) this.cableVisuals.delete(key);
    });

    // 如果需要继续动画，请求下一帧
    if (shouldContinue) {
      this.modulationFrame = requestAnimationFrame(() => this.renderModulationOverlay());
    } else {
      this.modulationFrame = 0;
    }
  }
}
