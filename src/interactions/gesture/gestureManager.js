/**
 * @fileoverview gestureManager.js
 * 手势管理器：负责将 MediaPipe 手部检测结果映射到合成器的链（Chain）控制上。
 * 主要功能包括：
 *   - 激活/停用手势控制界面（摄像头 + 覆盖层）
 *   - 解析左右手捏合手势，分别控制链的增益（Z轴）和位置（X/Y轴）
 *   - 解析双手 X 手势，用于禁用当前链
 *   - 在覆盖层上渲染手部关键点、控制点（ControlPoint）及 FPS 信息
 *   - 通过时间插值和平滑滤波保证渲染流畅度
 */

import { HandGestureRecognizer } from "./handGestureRecognizer.js";
import { createComponentModule, clamp } from "../../utils/helpers.js";

// ==================== 常量配置 ====================

/** 控制区域相对于屏幕的边距比例（左右各 10%） */
const MARGIN_RATIO = 0.1;
/** ControlPoint 的基础圆点半径（像素） */
const BASE_RADIUS = 16;
/** ControlPoint 外圈范围半径相对于基础半径的倍数 */
const CONTROL_RANGE_MULTIPLIER = 2;
/** 查找最近链时的最小距离阈值（相对于控制区域短边的比例） */
const MIN_DISTANCE_RATIO = 0.08;
/** 捏合手势确认所需的最短保持时间（毫秒），用于区分点击与拖拽 */
const PINCH_HOLD_MS = 100;
/** FPS 统计的采样窗口时长（毫秒） */
const FPS_SAMPLE_WINDOW_MS = 500;
/** 默认检测帧间隔，用于初始化 landmark 插值时长（约 30fps） */
const DEFAULT_DETECT_FRAME_MS = 1000 / 30;
/** 手部被持续检测到后才生效的防抖时间（毫秒） */
const HAND_CONFIRMATION_MS = 100;

export class GestureManager {
  /**
   * @param {Object} app - ModularSynthApp 实例引用，用于操作链、模块、宏控制等
   */
  constructor(app) {
    /** @type {Object} 主应用实例 */
    this.app = app;
    /** @type {HandGestureRecognizer} 手势识别器实例 */
    this.recognizer = new HandGestureRecognizer();
    /** 手势系统是否处于激活状态 */
    this.active = false;

    // ==================== DOM 与画布 ====================
    /** @type {HTMLDivElement|null} 覆盖层容器 */
    this.overlay = null;
    /** @type {HTMLCanvasElement|null} 动态绘制画布（手部关键点、ControlPoint、FPS） */
    this.canvas = null;
    /** @type {CanvasRenderingContext2D|null} 动态画布 2D 上下文 */
    this.ctx = null;
    /** @type {HTMLCanvasElement|null} 静态绘制画布（控制区域边框等不常变化的内容） */
    this.staticCanvas = null;
    /** @type {CanvasRenderingContext2D|null} 静态画布 2D 上下文 */
    this.staticCtx = null;
    /** 静态层是否需要重绘 */
    this.staticLayerDirty = true;

    // ==================== 手势状态机 ====================
    /**
     * 捏合手势的内部状态。
     * - leftPinchChainIndex / rightPinchChainIndex: 当前捏合关联的链索引，-1 表示无
     * - leftPinchStartY: 左手捏合开始时的 Y 坐标，用于计算垂直拖拽增量
     * - leftPinchStartGain: 左手捏合开始时链的增益值
     * - lastPinchTime: 上一次捏合触发时间，用于去抖
     * - leftPinchHoldStart / rightPinchHoldStart: 捏合开始按压的时间戳
     * - leftPinchConfirmed / rightPinchConfirmed: 是否已满足 PINCH_HOLD_MS 确认条件
     */
    this.gestureState = {
      leftPinchChainIndex: -1,
      rightPinchChainIndex: -1,
      leftPinchStartY: 0,
      leftPinchStartGain: 0,
      lastPinchTime: 0,
      leftPinchHoldStart: 0,
      rightPinchHoldStart: 0,
      leftPinchConfirmed: false,
      rightPinchConfirmed: false,
    };

    // ==================== Landmark 平滑与插值 ====================
    /** 经一阶低通滤波后的 landmark 缓存 */
    this.smoothedLandmarks = [];
    /** landmark 平滑系数（越大越跟手，越小越平滑） */
    this.smoothAlpha = 0.4;
    /** 上一帧收到的 landmark 数据 */
    this.lastLandmarks = [];
    /** 上一帧解析出的手势结果 */
    this.lastGestures = null;

    // ==================== 渲染循环状态 ====================
    /** 是否有渲染请求正在等待执行 */
    this.renderPending = false;
    /** requestAnimationFrame 返回的帧 ID */
    this.renderFrame = 0;
    /** 插值用的上一检测帧 landmark */
    this.prevLandmarks = [];
    /** 插值用的当前检测帧 landmark */
    this.currentLandmarks = [];
    /** 经时间插值后用于渲染的 landmark */
    this.interpolatedLandmarks = [];
    /**
     * 帧混合时间参数。
     * startAt: 当前检测帧开始时间；duration: 相邻两检测帧的间隔。
     */
    this.frameBlend = {
      startAt: 0,
      duration: DEFAULT_DETECT_FRAME_MS,
    };
    /** 上一次收到检测结果的绝对时间戳 */
    this.lastDetectAt = 0;

    // ==================== ControlPoint 视觉状态 ====================
    /**
     * 每个链对应的 ControlPoint 视觉属性缓存。
     * 数组索引对应链索引，值为 {x, y, radius, rangeRadius} 或 null（链未启用）。
     * 用于实现位置与半径的阻尼平滑。
     */
    this.controlPointVisuals = [];

    // ==================== 手部确认防抖 ====================
    /**
     * 每只手的确认状态。
     * firstSeenAt: 首次检测到该手的时间戳（0 表示未检测到）；
     * confirmed: 是否已通过持续检测确认。
     */
    this.handConfirmation = {
      left: { firstSeenAt: 0, confirmed: false },
      right: { firstSeenAt: 0, confirmed: false },
    };

    // ==================== FPS 统计 ====================
    const now = performance.now();
    this.fpsStats = {
      render: {
        frames: 0,
        lastSampleAt: now,
        value: 0,
      },
      detect: {
        frames: 0,
        lastSampleAt: now,
        value: 0,
      },
    };

    // ==================== 事件绑定 ====================

    /** ESC 键监听：按 Escape 时停用手势系统 */
    this.onEsc = (e) => {
      if (e.key === "Escape") {
        this.deactivate();
      }
    };

    /** 页面可见性监听：切出标签页时暂停检测以节省资源 */
    this.onVisibilityChange = () => {
      if (document.hidden) {
        this.pauseDetection();
      } else {
        this.resumeDetection();
      }
    };
  }

  // ==================== 生命周期 ====================

  /**
   * 激活手势控制系统。
   * 顺序执行：初始化 Worker → 启动摄像头 → 创建覆盖层 → 开始检测。
   * 若过程中出错，将在控制台打印错误并在应用状态栏提示。
   */
  async activate() {
    if (this.active) return;
    try {
      await this.recognizer.initialize();
      await this.recognizer.startCamera();
      this.active = true;
      this.ensureAllChainsHaveGain();
      this.createOverlay();
      this.recognizer.onResults = (results) => this.handleResults(results);
      this.recognizer.startDetection();
      document.addEventListener("keydown", this.onEsc);
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      if (document.hidden) {
        this.pauseDetection();
      }
    } catch (err) {
      console.error("Gesture activation failed:", err);
      this.app.setStatus?.(`Gesture failed: ${err.message}`, "error");
    }
  }

  /**
   * 确保所有已启用的音频链末尾都包含一个 Gain 模块。
   * 该模块作为手势控制的目标（捏合调节音量）。
   * 若新增模块，会自动调用引擎同步并将预设标记为自定义。
   */
  ensureAllChainsHaveGain() {
    let added = false;
    for (let i = 0; i < this.app.getChainCount(); i++) {
      if (!this.app.isChainEnabled(i)) continue;
      const chain = this.app.getChain(i);
      const modules = chain.modules || [];
      const hasGain = modules.some((m) => m.type === "Gain");
      if (!hasGain) {
        const gainModule = createComponentModule("Gain");
        modules.push(gainModule);
        added = true;
      }
      this.ensureGainMapped(i);
    }
    if (added) {
      this.app.engine.fullSync(this.app.state);
    }
    this.app.selectedPresetId = "custom";
  }

  /** 暂停检测：仅停止摄像头采集，保留覆盖层与手势状态。 */
  pauseDetection() {
    if (!this.active) return;
    this.recognizer.stopCamera();
  }

  /** 恢复检测：重新启动摄像头并在就绪后继续检测循环。 */
  resumeDetection() {
    if (!this.active) return;
    this.recognizer.startCamera().then(() => {
      this.recognizer.startDetection();
    });
  }

  /**
   * 停用手势控制系统。
   * 停止摄像头、移除事件监听、销毁覆盖层，并触发一次全量 UI 重绘。
   */
  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.recognizer.stopCamera();
    this.recognizer.onResults = null;
    document.removeEventListener("keydown", this.onEsc);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.destroyOverlay();
    this.app.renderAll();
  }

  // ==================== 覆盖层与画布 ====================

  /**
   * 创建手势覆盖层 DOM 结构。
   * 包含两层 canvas：staticCanvas（背景与控制区域边框）和 canvas（动态内容），
   * 以及一个关闭按钮。创建完成后启动渲染循环。
   */
  createOverlay() {
    this.overlay = document.createElement("div");
    this.overlay.className = "gesture-overlay";

    this.staticCanvas = document.createElement("canvas");
    this.staticCanvas.className = "gesture-canvas gesture-canvas-static";
    this.overlay.appendChild(this.staticCanvas);

    this.canvas = document.createElement("canvas");
    this.canvas.className = "gesture-canvas gesture-canvas-dynamic";
    this.overlay.appendChild(this.canvas);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "gesture-close-btn";
    closeBtn.innerHTML = "<span>◥</span><span class=\"gesture-close-x\">×</span>";
    closeBtn.addEventListener("click", () => this.deactivate());
    this.overlay.appendChild(closeBtn);

    document.body.appendChild(this.overlay);

    this.onResize = () => this.resizeCanvas();
    window.addEventListener("resize", this.onResize);

    this.resizeCanvas();
    this.drawStaticLayer();
    this.startRenderLoop();
  }

  /** 销毁覆盖层并清理相关资源（ RAF、resize 监听）。 */
  destroyOverlay() {
    if (this.onResize) {
      window.removeEventListener("resize", this.onResize);
      this.onResize = null;
    }
    if (this.renderFrame) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = 0;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
      this.canvas = null;
      this.ctx = null;
      this.staticCanvas = null;
      this.staticCtx = null;
    }
  }

  /**
   * 响应式调整两层 canvas 的分辨率。
   * 根据 devicePixelRatio 进行缩放，保证在高 DPI 屏幕上绘制清晰。
   * 尺寸变化后会标记 staticLayer 为 dirty，触发重绘。
   */
  resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (this.staticCanvas) {
      this.staticCanvas.width = w * dpr;
      this.staticCanvas.height = h * dpr;
      this.staticCanvas.style.width = `${w}px`;
      this.staticCanvas.style.height = `${h}px`;
      this.staticCtx = this.staticCanvas.getContext("2d");
      this.staticCtx.scale(dpr, dpr);
      this.markStaticLayerDirty();
    }

    if (this.canvas) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.ctx = this.canvas.getContext("2d");
      this.ctx.scale(dpr, dpr);
    }
  }

  // ==================== 坐标与几何 ====================

  /**
   * 计算屏幕中央可供手势交互的控制区域。
   * 四周留出 MARGIN_RATIO 的边距，避免手指触及屏幕边缘时误操作。
   * @returns {{x:number, y:number, width:number, height:number}}
   */
  getControlArea() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const marginX = w * MARGIN_RATIO;
    const marginY = h * MARGIN_RATIO;
    return {
      x: marginX,
      y: marginY,
      width: w - marginX * 2,
      height: h - marginY * 2,
    };
  }

  /**
   * 将摄像头归一化坐标（0~1）转换为画布像素坐标。
   * X 轴做水平镜像翻转（1 - cx），并带有轻微 overscale 使手边缘也能被看到。
   * @param {number} cx - 摄像头空间 X（0~1）
   * @param {number} cy - 摄像头空间 Y（0~1）
   * @returns {{x:number, y:number}} 画布像素坐标
   */
  cameraToCanvas(cx, cy) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = 1.1;
    const offsetX = (w * (scale - 1)) / 2;
    const offsetY = (h * (scale - 1)) / 2;
    const x = (1 - cx) * w * scale - offsetX;
    const y = cy * h * scale - offsetY;
    return { x, y };
  }

  /**
   * 将画布像素坐标映射到宏观控制空间的归一化坐标（0~1）。
   * Y 轴做翻转，使屏幕上方对应宏控制的高值。
   * @param {number} x - 画布像素 X
   * @param {number} y - 画布像素 Y
   * @returns {{x:number, y:number}} 归一化宏坐标
   */
  canvasToMacro(x, y) {
    const area = this.getControlArea();
    const mx = clamp((x - area.x) / area.width, 0, 1);
    const my = clamp(1 - (y - area.y) / area.height, 0, 1);
    return { x: mx, y: my };
  }

  /**
   * 获取指定链在当前画布上的目标像素位置。
   * 位置由链的 macroManager 中存储的宏坐标映射到控制区域得到。
   * @param {number} chainIndex - 链索引
   * @returns {{x:number, y:number}} 画布像素坐标
   */
  getChainPoint(chainIndex) {
    const chainMacro = this.app.macroManager.getChainMacro(chainIndex);
    const area = this.getControlArea();
    return {
      x: area.x + chainMacro.point.x * area.width,
      y: area.y + (1 - chainMacro.point.y) * area.height,
    };
  }

  /**
   * 查找距离给定坐标最近的已启用链。
   * 仅在距离小于 MIN_DISTANCE_RATIO 阈值时返回有效结果，避免远距离误吸附。
   * @param {number} x - 画布像素 X
   * @param {number} y - 画布像素 Y
   * @returns {number} 链索引，未找到返回 -1
   */
  findChainAtPosition(x, y) {
    const area = this.getControlArea();
    const minDist = Math.min(area.width, area.height) * MIN_DISTANCE_RATIO;
    let found = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.app.getChainCount(); i++) {
      if (!this.app.isChainEnabled(i)) continue;
      const p = this.getChainPoint(i);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < minDist && d < bestDist) {
        bestDist = d;
        found = i;
      }
    }
    return found;
  }

  /**
   * 查找第一个未启用的链，用于新建 ControlPoint。
   * @returns {number} 链索引，全部启用则返回 -1
   */
  findFirstAvailableChain() {
    for (let i = 0; i < this.app.getChainCount(); i++) {
      if (!this.app.isChainEnabled(i)) return i;
    }
    return -1;
  }

  // ==================== 手部确认防抖 ====================

  /**
   * 根据 handedness 更新左右手的确认状态。
   * 只有当手部被持续检测到超过 HAND_CONFIRMATION_MS 后，confirmed 才置为 true。
   * 手一旦消失，立即重置。
   * @param {Array} handedness - Worker 返回的手部类别数组
   * @param {number} now - 当前时间戳
   */
  updateHandConfirmation(handedness, now) {
    const detected = { left: false, right: false };
    for (const h of handedness || []) {
      const name = h?.[0]?.categoryName;
      // MediaPipe 的 handedness 基于镜像视角：
      // "Right" 对应用户的左手，"Left" 对应用户的右手
      if (name === "Right") detected.left = true;
      if (name === "Left") detected.right = true;
    }

    for (const side of ["left", "right"]) {
      if (detected[side]) {
        if (this.handConfirmation[side].firstSeenAt === 0) {
          this.handConfirmation[side].firstSeenAt = now;
        }
        this.handConfirmation[side].confirmed =
          now - this.handConfirmation[side].firstSeenAt >= HAND_CONFIRMATION_MS;
      } else {
        this.handConfirmation[side].firstSeenAt = 0;
        this.handConfirmation[side].confirmed = false;
      }
    }
  }

  /**
   * 过滤 landmark 数组，仅保留已确认的手部。
   * @param {Array} landmarks - 原始 landmark
   * @param {Array} handedness - 与 landmark 一一对应的类别数组
   * @returns {Array} 已确认的 landmark
   */
  filterConfirmedLandmarks(landmarks, handedness) {
    if (!landmarks || !handedness || landmarks.length !== handedness.length) {
      return [];
    }
    return landmarks.filter((_, i) => {
      const name = handedness[i]?.[0]?.categoryName;
      const side = name === "Right" ? "left" : name === "Left" ? "right" : null;
      return side ? this.handConfirmation[side].confirmed : false;
    });
  }

  // ==================== 增益读写 ====================

  /**
   * 获取指定链末尾 Gain 模块的当前增益值。
   * 若未找到 Gain 模块则返回默认值 1。
   * @param {number} chainIndex - 链索引
   * @returns {number} 增益值
   */
  getChainGainValue(chainIndex) {
    const chain = this.app.getChain(chainIndex);
    const modules = chain.modules || [];
    for (let i = modules.length - 1; i >= 0; i--) {
      if (modules[i].type === "Gain") {
        return modules[i].options?.gain ?? 1;
      }
    }
    return 1;
  }

  /**
   * 确保指定链末尾存在 Gain 模块，且该模块的 gain 参数已被映射到链宏控制的 Z 轴。
   * 若缺失则自动创建并同步引擎。
   * @param {number} chainIndex - 链索引
   * @returns {Object} Gain 模块对象
   */
  ensureGainMapped(chainIndex) {
    const chain = this.app.getChain(chainIndex);
    const modules = chain.modules || [];
    let gainModule = null;
    for (let i = modules.length - 1; i >= 0; i--) {
      if (modules[i].type === "Gain") {
        gainModule = modules[i];
        break;
      }
    }
    if (!gainModule) {
      gainModule = createComponentModule("Gain");
      modules.push(gainModule);
      this.app.engine.fullSync(this.app.state);
    }

    const chainMacro = this.app.macroManager.getChainMacro(chainIndex);
    const zMappings = chainMacro.mappings.z;
    const alreadyMapped = zMappings.some(
      (m) => m.targetModuleId === gainModule.id && m.targetParamPath === "options.gain"
    );
    if (!alreadyMapped) {
      zMappings.push({
        targetModuleId: gainModule.id,
        targetParamPath: "options.gain",
        min: 0,
        max: 2,
        step: 0.01,
        rangeStart: 0,
        rangeEnd: 1,
      });
      this.app.selectedPresetId = "custom";
    }
    return gainModule;
  }

  /**
   * 设置指定链的增益值，并触发宏控制映射更新。
   * 注意：视觉渲染平滑由 render loop 中的 updateControlPointVisuals 负责，此处不直接操作 DOM/Canvas。
   * @param {number} chainIndex - 链索引
   * @param {number} value - 增益值（0~2）
   */
  setChainGainValue(chainIndex, value) {
    const gainModule = this.ensureGainMapped(chainIndex);
    const chainMacro = this.app.macroManager.getChainMacro(chainIndex);
    chainMacro.point.z = clamp(value / 2, 0, 1);
    this.app.macroManager.applyMappingsForChain(
      chainIndex,
      chainIndex === this.app.getSelectedChainIndex()
    );
    this.app.selectedPresetId = "custom";
    // Visual smoothing handled by updateControlPointVisuals in render loop
  }

  // ==================== 手势结果处理 ====================

  /**
   * 核心手势处理入口。
   * 每次 Worker 返回检测结果时调用，负责：
   *   1. 统计检测 FPS
   *   2. 对 landmark 做平滑滤波并推入插值队列
   *   3. 解析 X 手势（禁用链）
   *   4. 解析左手捏合（控制增益 / 新建链）
   *   5. 解析右手捏合（控制链位置）
   *
   * @param {Object} param0
   * @param {Array} param0.landmarks - 检测到的手部关键点数组
   * @param {Object} param0.gestures - 解析后的手势状态
   */
  handleResults({ landmarks, handedness, gestures }) {
    const now = performance.now();

    // 更新手部确认状态：只有持续检测到手超过 HAND_CONFIRMATION_MS 后才生效
    this.updateHandConfirmation(handedness, now);

    // 过滤未确认的手部 landmark
    const confirmedLandmarks = this.filterConfirmedLandmarks(landmarks, handedness);

    // 过滤 gestures：未确认的手部对应手势不生效
    const confirmedGestures = {
      ...gestures,
      leftPinch: this.handConfirmation.left.confirmed ? gestures.leftPinch : false,
      leftPinchPos: this.handConfirmation.left.confirmed ? gestures.leftPinchPos : null,
      rightPinch: this.handConfirmation.right.confirmed ? gestures.rightPinch : false,
      rightPinchPos: this.handConfirmation.right.confirmed ? gestures.rightPinchPos : null,
    };
    const confirmedHandCount = ["left", "right"].filter((s) => this.handConfirmation[s].confirmed).length;
    if (confirmedHandCount < 2) {
      confirmedGestures.xGesture = false;
      confirmedGestures.xCenter = null;
    }

    this.tickFps("detect");
    const smoothedLandmarks = this.smoothLandmarks(confirmedLandmarks);
    this.lastLandmarks = smoothedLandmarks;
    this.pushDetectionFrame(smoothedLandmarks);
    this.lastGestures = confirmedGestures;

    // ----- X 手势：禁用当前指向的链 -----
    if (confirmedGestures.xGesture && confirmedGestures.xCenter) {
      const pos = this.cameraToCanvas(confirmedGestures.xCenter.x, confirmedGestures.xCenter.y);
      const chainIndex = this.findChainAtPosition(pos.x, pos.y);
      if (chainIndex >= 0) {
        this.app.setChainEnabled(chainIndex, false);
        this.app.macroManager.resetChainMacro(chainIndex);
        this.app.selectedPresetId = "custom";
        this.app.renderAll();
      }
      return;
    }

    // ----- 左手捏合：增益控制 & 新建链 -----
    if (confirmedGestures.leftPinch && confirmedGestures.leftPinchPos) {
      const pos = this.cameraToCanvas(confirmedGestures.leftPinchPos.x, confirmedGestures.leftPinchPos.y);

      // 已确认捏合且已绑定链：进入拖拽调节增益模式
      if (this.gestureState.leftPinchChainIndex >= 0 && this.gestureState.leftPinchConfirmed) {
        const chainIndex = this.gestureState.leftPinchChainIndex;
        const dy = this.gestureState.leftPinchStartY - pos.y;
        const area = this.getControlArea();
        const delta = (dy / area.height) * 4;
        const newGain = clamp(this.gestureState.leftPinchStartGain + delta, 0, 2);
        this.setChainGainValue(chainIndex, newGain);
      } else if (!this.gestureState.leftPinchConfirmed) {
        // 首次按压：记录时间与候选链
        if (this.gestureState.leftPinchHoldStart === 0) {
          this.gestureState.leftPinchHoldStart = now;
          const chainIndex = this.findChainAtPosition(pos.x, pos.y);
          if (chainIndex >= 0) {
            this.gestureState.leftPinchChainIndex = chainIndex;
            this.gestureState.leftPinchStartY = pos.y;
            this.gestureState.leftPinchStartGain = this.getChainGainValue(chainIndex);
          } else {
            // 未命中已有链：标记为待新建（-2），但需与上次触发间隔大于 300ms
            const available = this.findFirstAvailableChain();
            if (available >= 0 && now - this.gestureState.lastPinchTime > 300) {
              this.gestureState.leftPinchChainIndex = -2;
            }
          }
        } else if (now - this.gestureState.leftPinchHoldStart >= PINCH_HOLD_MS) {
          // 达到确认时间：若此前标记为待新建，则实际创建链并定位
          this.gestureState.leftPinchConfirmed = true;
          if (this.gestureState.leftPinchChainIndex === -2) {
            const macro = this.canvasToMacro(pos.x, pos.y);
            const available = this.findFirstAvailableChain();
            if (available >= 0) {
              this.app.setChainEnabled(available, true);
              const chainMacro = this.app.macroManager.getChainMacro(available);
              chainMacro.point.x = macro.x;
              chainMacro.point.y = macro.y;
              chainMacro.point.z = 0.5;
              this.app.selectedPresetId = "custom";
              this.gestureState.lastPinchTime = now;
              this.gestureState.leftPinchChainIndex = available;
              this.gestureState.leftPinchStartY = pos.y;
              this.gestureState.leftPinchStartGain = 1;
              // Visual smoothing handled by updateControlPointVisuals in render loop
            }
          }
        }
      }
    } else {
      // 左手松开：重置状态
      this.gestureState.leftPinchChainIndex = -1;
      this.gestureState.leftPinchHoldStart = 0;
      this.gestureState.leftPinchConfirmed = false;
    }

    // ----- 右手捏合：链位置控制 -----
    if (confirmedGestures.rightPinch && confirmedGestures.rightPinchPos) {
      const pos = this.cameraToCanvas(confirmedGestures.rightPinchPos.x, confirmedGestures.rightPinchPos.y);

      // 已确认且已绑定链：将链宏坐标更新为当前捏合位置
      if (this.gestureState.rightPinchChainIndex >= 0 && this.gestureState.rightPinchConfirmed) {
        const chainIndex = this.gestureState.rightPinchChainIndex;
        const macro = this.canvasToMacro(pos.x, pos.y);
        const chainMacro = this.app.macroManager.getChainMacro(chainIndex);
        chainMacro.point.x = macro.x;
        chainMacro.point.y = macro.y;
        this.app.selectedPresetId = "custom";
        this.app.macroManager.applyMappingsForChain(
          chainIndex,
          chainIndex === this.app.getSelectedChainIndex()
        );
        // Visual smoothing handled by updateControlPointVisuals in render loop
      } else if (!this.gestureState.rightPinchConfirmed) {
        // 首次按压：记录候选链
        if (this.gestureState.rightPinchHoldStart === 0) {
          this.gestureState.rightPinchHoldStart = now;
          const chainIndex = this.findChainAtPosition(pos.x, pos.y);
          if (chainIndex >= 0) {
            this.gestureState.rightPinchChainIndex = chainIndex;
          }
        } else if (now - this.gestureState.rightPinchHoldStart >= PINCH_HOLD_MS) {
          this.gestureState.rightPinchConfirmed = true;
        }
      }
    } else {
      // 右手松开：重置状态
      this.gestureState.rightPinchChainIndex = -1;
      this.gestureState.rightPinchHoldStart = 0;
      this.gestureState.rightPinchConfirmed = false;
    }
  }

  // ==================== 渲染循环 ====================

  /**
   * 启动覆盖层的渲染循环。
   * 每帧执行：绘制静态层 → 获取时间插值后的 landmark → 绘制动态层。
   * 使用 requestAnimationFrame 保证与显示器刷新率同步。
   */
  startRenderLoop() {
    if (this.renderFrame) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = 0;
    }

    const frame = (now) => {
      if (!this.active || !this.canvas) {
        this.renderFrame = 0;
        return;
      }
      this.tickFps("render");
      this.drawStaticLayer();
      this.draw(this.getInterpolatedLandmarks(now), this.lastGestures);
      this.renderFrame = requestAnimationFrame(frame);
    };

    this.renderFrame = requestAnimationFrame(frame);
  }

  // ==================== Landmark 时间插值 ====================

  /**
   * 将新的检测结果推入插值队列，更新前后帧缓存与混合时间参数。
   * 用于在两次检测之间生成平滑过渡，弥补检测帧率（~30fps）与渲染帧率（~60fps）的差距。
   * @param {Array} landmarks - 当前检测帧的 landmark
   */
  pushDetectionFrame(landmarks) {
    const now = performance.now();
    if (this.lastDetectAt > 0) {
      this.frameBlend.duration = Math.max(8, now - this.lastDetectAt);
    }
    this.frameBlend.startAt = now;
    this.lastDetectAt = now;

    const next = this.cloneLandmarks(landmarks);
    if (!this.currentLandmarks.length || this.currentLandmarks.length !== next.length) {
      this.prevLandmarks = this.cloneLandmarks(next);
    } else {
      this.prevLandmarks = this.cloneLandmarks(this.currentLandmarks);
    }
    this.currentLandmarks = next;
  }

  /**
   * 基于当前渲染时间计算 landmark 的插值结果。
   * 使用线性插值（lerp）在 prevLandmarks 与 currentLandmarks 之间过渡，
   * t 的范围由检测帧间隔动态计算并 clamp 到 [0, 1]。
   * @param {number} now - 当前时间戳（performance.now）
   * @returns {Array} 插值后的 landmark
   */
  getInterpolatedLandmarks(now) {
    if (!this.currentLandmarks.length) {
      return [];
    }
    if (!this.prevLandmarks.length || this.prevLandmarks.length !== this.currentLandmarks.length) {
      return this.currentLandmarks;
    }
    const duration = Math.max(1, this.frameBlend.duration);
    const t = clamp((now - this.frameBlend.startAt) / duration, 0, 1);
    return this.interpolateLandmarks(this.prevLandmarks, this.currentLandmarks, t);
  }

  /**
   * 对两组 landmark 执行逐点线性插值。
   * 复用 interpolatedLandmarks 缓存数组以减少 GC。
   * @param {Array} from - 上一帧 landmark
   * @param {Array} to - 当前帧 landmark
   * @param {number} t - 插值因子 [0, 1]
   * @returns {Array} 插值后的 landmark
   */
  interpolateLandmarks(from, to, t) {
    if (this.interpolatedLandmarks.length !== to.length) {
      this.interpolatedLandmarks = this.cloneLandmarks(to);
    }

    for (let h = 0; h < to.length; h++) {
      if (!this.interpolatedLandmarks[h] || this.interpolatedLandmarks[h].length !== to[h].length) {
        this.interpolatedLandmarks[h] = to[h].map((lm) => ({ x: lm.x, y: lm.y, z: lm.z }));
      }
      for (let i = 0; i < to[h].length; i++) {
        const fromLm = from[h]?.[i] || to[h][i];
        const toLm = to[h][i];
        this.interpolatedLandmarks[h][i].x = fromLm.x + (toLm.x - fromLm.x) * t;
        this.interpolatedLandmarks[h][i].y = fromLm.y + (toLm.y - fromLm.y) * t;
        this.interpolatedLandmarks[h][i].z = fromLm.z + (toLm.z - fromLm.z) * t;
      }
    }

    return this.interpolatedLandmarks;
  }

  /**
   * 深拷贝 landmark 数据（仅复制 x, y, z）。
   * @param {Array} landmarks - 原始 landmark
   * @returns {Array} 深拷贝后的 landmark
   */
  cloneLandmarks(landmarks) {
    return (landmarks || []).map((hand) =>
      hand.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z }))
    );
  }

  // ==================== 绘制方法 ====================

  /**
   * 动态层绘制入口。
   * 每帧清空画布后依次绘制：ControlPoint（含平滑插值）→ 手部 landmark → FPS 角标。
   * @param {Array} [landmarks=[]] - 经插值后的手部关键点
   * @param {Object|null} [gestures=null] - 当前手势状态（预留扩展）
   */
  draw(landmarks = [], gestures = null) {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);

    this.updateControlPointVisuals();
    this.drawControlPoints();

    landmarks.forEach((hand) => {
      this.drawHandLandmarks(hand);
    });

    this.drawFpsBadge();
  }

  /**
   * 静态层绘制。
   * 仅当 staticLayerDirty 为 true 时执行，减少不必要的重绘。
   * 当前绘制内容：控制区域外边框。
   * ControlPoint 已迁移到动态层以支持平滑动画。
   */
  drawStaticLayer() {
    if (!this.staticCtx || !this.staticCanvas) return;
    if (!this.staticLayerDirty) return;

    const w = this.staticCanvas.width;
    const h = this.staticCanvas.height;
    this.staticCtx.clearRect(0, 0, w, h);

    const area = this.getControlArea();
    this.staticCtx.strokeStyle = "rgba(0,0,0,0.15)";
    this.staticCtx.lineWidth = 1;
    this.staticCtx.strokeRect(area.x, area.y, area.width, area.height);

    // Control points moved to dynamic canvas with interpolation smoothing
    // for (let i = 0; i < this.app.getChainCount(); i++) {
    //   if (!this.app.isChainEnabled(i)) continue;
    //   this.drawControlPointStatic(i);
    // }

    this.staticLayerDirty = false;
  }

  /** 标记静态层为 dirty，触发下一帧重绘。 */
  markStaticLayerDirty() {
    this.staticLayerDirty = true;
  }

  // ==================== FPS 统计 ====================

  /**
   * 统计指定类型的帧率。
   * 在 FPS_SAMPLE_WINDOW_MS 时间窗口内计数，到期后计算并更新 fpsStats.value。
   * @param {"render"|"detect"} kind - 统计类型
   */
  tickFps(kind) {
    const stats = this.fpsStats[kind];
    if (!stats) return;

    stats.frames += 1;
    const now = performance.now();
    const elapsed = now - stats.lastSampleAt;
    if (elapsed < FPS_SAMPLE_WINDOW_MS) {
      return;
    }

    stats.value = (stats.frames * 1000) / elapsed;
    stats.frames = 0;
    stats.lastSampleAt = now;
  }

  /** 在画布左上角绘制渲染 FPS 与检测 FPS 的角标。 */
  drawFpsBadge() {
    if (!this.ctx) return;

    const renderFps = Math.round(this.fpsStats.render.value);
    const detectFps = Math.round(this.fpsStats.detect.value);

    this.ctx.save();
    this.ctx.font = '600 12px "IBM Plex Sans", sans-serif';
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "middle";

    const text = `FPS R:${renderFps} D:${detectFps}`;
    const padX = 10;
    const padY = 7;
    const x = 14;
    const y = 14;
    const textWidth = this.ctx.measureText(text).width;
    const width = textWidth + padX * 2;
    const height = 26;

    this.ctx.fillStyle = "rgba(0, 0, 0, 0.68)";
    this.ctx.fillRect(x, y, width, height);

    this.ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    this.ctx.fillText(text, x + padX, y + height / 2 + 0.5);
    this.ctx.restore();
  }

  // ==================== ControlPoint 视觉平滑 ====================

  /**
   * 更新每个 ControlPoint 的视觉属性（位置、半径）。
   * 使用阻尼系数 damping = 0.2 进行一阶低通平滑，使 ControlPoint 在链位置/增益变化时流畅过渡，
   * 而非直接跳变。
   */
  updateControlPointVisuals() {
    const chainCount = this.app.getChainCount();
    while (this.controlPointVisuals.length < chainCount) {
      this.controlPointVisuals.push(null);
    }

    const damping = 0.2;

    for (let i = 0; i < chainCount; i++) {
      if (!this.app.isChainEnabled(i)) {
        this.controlPointVisuals[i] = null;
        continue;
      }

      const targetPos = this.getChainPoint(i);
      const gain = this.getChainGainValue(i);
      const radiusScale = 0.5 + (gain / 2) * 1.0;
      const targetRadius = BASE_RADIUS * radiusScale;
      const rangeRadius = BASE_RADIUS * CONTROL_RANGE_MULTIPLIER;

      let visual = this.controlPointVisuals[i];
      if (!visual) {
        // 首次出现时直接定位到目标位置，避免从 (0,0) 飞入
        visual = { x: targetPos.x, y: targetPos.y, radius: targetRadius, rangeRadius };
        this.controlPointVisuals[i] = visual;
      }

      visual.x += (targetPos.x - visual.x) * damping;
      visual.y += (targetPos.y - visual.y) * damping;
      visual.radius += (targetRadius - visual.radius) * damping;
      visual.rangeRadius = rangeRadius;
    }
  }

  /** 遍历所有已启用的链，在动态画布上绘制对应的 ControlPoint。 */
  drawControlPoints() {
    for (let i = 0; i < this.app.getChainCount(); i++) {
      if (!this.app.isChainEnabled(i)) continue;
      const visual = this.controlPointVisuals[i];
      if (!visual) continue;
      this.drawControlPoint(i, visual);
    }
  }

  /**
   * 绘制单个 ControlPoint。
   * 由外到内依次绘制：半透明外圈范围 → 黑色实心圆 → 白色罗马数字标签。
   * @param {number} chainIndex - 链索引
   * @param {Object} visual - 视觉属性 {x, y, radius, rangeRadius}
   */
  drawControlPoint(chainIndex, visual) {
    if (!this.ctx) return;

    const pos = { x: visual.x, y: visual.y };
    const radius = visual.radius;
    const rangeRadius = visual.rangeRadius || BASE_RADIUS * CONTROL_RANGE_MULTIPLIER;

    this.ctx.fillStyle = "rgba(0,0,0,0.1)";
    this.ctx.beginPath();
    this.ctx.arc(pos.x, pos.y, rangeRadius, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = "#000000";
    this.ctx.beginPath();
    this.ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = `bold ${Math.round(radius)}px "IBM Plex Sans", sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    const labels = ["I", "II", "III", "IV"];
    this.ctx.fillText(labels[chainIndex], pos.x, pos.y + 1);
  }

  // ==================== Landmark 空间平滑 ====================

  /**
   * 对原始 landmark 进行一阶低通滤波，减少检测噪声引起的抖动。
   * 每帧以 smoothAlpha = 0.4 向新值靠拢。
   * @param {Array} landmarks - 原始检测 landmark
   * @returns {Array} 平滑后的 landmark
   */
  smoothLandmarks(landmarks) {
    if (!landmarks || landmarks.length === 0) {
      this.smoothedLandmarks = [];
      return landmarks;
    }
    if (this.smoothedLandmarks.length !== landmarks.length) {
      this.smoothedLandmarks = landmarks.map((hand) =>
        hand.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z }))
      );
      return landmarks;
    }
    const alpha = this.smoothAlpha;
    for (let h = 0; h < landmarks.length; h++) {
      for (let i = 0; i < landmarks[h].length; i++) {
        this.smoothedLandmarks[h][i].x =
          alpha * landmarks[h][i].x + (1 - alpha) * this.smoothedLandmarks[h][i].x;
        this.smoothedLandmarks[h][i].y =
          alpha * landmarks[h][i].y + (1 - alpha) * this.smoothedLandmarks[h][i].y;
        this.smoothedLandmarks[h][i].z =
          alpha * landmarks[h][i].z + (1 - alpha) * this.smoothedLandmarks[h][i].z;
      }
    }
    return this.smoothedLandmarks;
  }

  // ==================== 手部 landmark 绘制 ====================

  /**
   * 在动态画布上绘制单只手的 landmark 连线与关节点。
   * 连线使用半透明蓝色，关节点使用蓝色实心圆。
   * @param {Array} landmarks - 单只手的 21 个关键点
   */
  drawHandLandmarks(landmarks) {
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
      [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20],
      [0, 17],
    ];

    this.ctx.strokeStyle = "rgba(0, 120, 255, 0.4)";
    this.ctx.lineWidth = 1.5;
    connections.forEach(([a, b]) => {
      const pa = this.cameraToCanvas(landmarks[a].x, landmarks[a].y);
      const pb = this.cameraToCanvas(landmarks[b].x, landmarks[b].y);
      this.ctx.beginPath();
      this.ctx.moveTo(pa.x, pa.y);
      this.ctx.lineTo(pb.x, pb.y);
      this.ctx.stroke();
    });

    this.ctx.fillStyle = "rgba(0, 120, 255, 0.6)";
    landmarks.forEach((lm) => {
      const pos = this.cameraToCanvas(lm.x, lm.y);
      this.ctx.beginPath();
      this.ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
      this.ctx.fill();
    });
  }
}
