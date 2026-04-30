/**
 * @fileoverview gestureManager.ts
 * 手势管理器：负责将 MediaPipe 手部检测结果映射到合成器的链（Chain）控制上。
 * 主要功能包括：
 *   - 激活/停用手势控制界面（摄像头 + 覆盖层）
 *   - 解析左右手捏合手势，分别控制链的增益（Z轴）和位置（X/Y轴）
 *   - 解析双手 X 手势，用于禁用当前链
 *   - 在覆盖层上渲染手部关键点、控制点（ControlPoint）及 FPS 信息
 *   - 通过时间插值和平滑滤波保证渲染流畅度
 */

import { HandGestureRecognizer, type GestureResults } from "./handGestureRecognizer";
import { createEffectModule, clamp } from "../../utils/helpers";
import type { Preset, ChainState, ModuleConfig } from "../../types";
import type { MacroMappingItem } from "../../preset/preset";

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

// ==================== 类型定义 ====================

interface ChainMacroState {
  point: {
    x: number;
    y: number;
    z: number;
  };
  mappings: Record<string, MacroMappingItem[]>;
}

export interface GestureManagerApp {
  state: Preset;
  getChainCount(): number;
  getSelectedChainIndex(): number;
  isChainEnabled(index: number): boolean;
  getChain(index: number): ChainState;
  setChainEnabled(index: number, enabled: boolean): void;
  macroManager: {
    getChainMacro(chainIndex: number): ChainMacroState;
    resetChainMacro(chainIndex: number): void;
    applyMappingsForChain(chainIndex: number, syncControls: boolean): void;
  };
  engine: {
    fullSync(state: Preset): void;
  };
  renderAll(): void;
  markUnsaved(): void;
  setStatus?(message: string, tone?: string): void;
}

interface ParsedGestures {
  leftPinch: boolean;
  rightPinch: boolean;
  xGesture: boolean;
  leftPinchPos: { x: number; y: number } | null;
  rightPinchPos: { x: number; y: number } | null;
  xCenter: { x: number; y: number } | null;
  hands?: unknown;
}

interface Landmark {
  x: number;
  y: number;
  z: number;
}

type HandLandmarks = Landmark[];

interface GestureState {
  leftPinchChainIndex: number;
  rightPinchChainIndex: number;
  leftPinchStartY: number;
  leftPinchStartGain: number;
  lastPinchTime: number;
  leftPinchHoldStart: number;
  rightPinchHoldStart: number;
  leftPinchConfirmed: boolean;
  rightPinchConfirmed: boolean;
}

interface FrameBlend {
  startAt: number;
  duration: number;
}

interface HandConfirmation {
  left: { firstSeenAt: number; confirmed: boolean };
  right: { firstSeenAt: number; confirmed: boolean };
}

interface FpsStats {
  render: { frames: number; lastSampleAt: number; value: number };
  detect: { frames: number; lastSampleAt: number; value: number };
}

interface ControlPointVisual {
  x: number;
  y: number;
  radius: number;
  rangeRadius: number;
}

interface ControlArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ==================== 类定义 ====================

export class GestureManager {
  app: GestureManagerApp;
  recognizer: HandGestureRecognizer;
  active: boolean;
  activating: boolean;

  overlay: HTMLDivElement | null;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  staticCanvas: HTMLCanvasElement | null;
  staticCtx: CanvasRenderingContext2D | null;
  staticLayerDirty: boolean;

  gestureState: GestureState;

  smoothedLandmarks: HandLandmarks[];
  smoothAlpha: number;
  lastLandmarks: HandLandmarks[];
  lastGestures: ParsedGestures | null;

  renderPending: boolean;
  renderFrame: number;
  prevLandmarks: HandLandmarks[];
  currentLandmarks: HandLandmarks[];
  interpolatedLandmarks: HandLandmarks[];
  frameBlend: FrameBlend;
  lastDetectAt: number;

  controlPointVisuals: (ControlPointVisual | null)[];

  handConfirmation: HandConfirmation;

  fpsStats: FpsStats;

  onEsc: (e: KeyboardEvent) => void;
  onVisibilityChange: () => void;
  onResize: (() => void) | null;

  constructor(app: GestureManagerApp) {
    this.app = app;
    this.recognizer = new HandGestureRecognizer();
    this.active = false;
    this.activating = false;

    // ==================== DOM 与画布 ====================
    this.overlay = null;
    this.canvas = null;
    this.ctx = null;
    this.staticCanvas = null;
    this.staticCtx = null;
    this.staticLayerDirty = true;

    // ==================== 手势状态机 ====================
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
    this.smoothedLandmarks = [];
    this.smoothAlpha = 0.4;
    this.lastLandmarks = [];
    this.lastGestures = null;

    // ==================== 渲染循环状态 ====================
    this.renderPending = false;
    this.renderFrame = 0;
    this.prevLandmarks = [];
    this.currentLandmarks = [];
    this.interpolatedLandmarks = [];
    this.frameBlend = {
      startAt: 0,
      duration: DEFAULT_DETECT_FRAME_MS,
    };
    this.lastDetectAt = 0;

    // ==================== ControlPoint 视觉状态 ====================
    this.controlPointVisuals = [];

    // ==================== 手部确认防抖 ====================
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

    this.onEsc = (e) => {
      if (e.key === "Escape") {
        this.deactivate();
      }
    };

    this.onVisibilityChange = () => {
      if (document.hidden) {
        this.pauseDetection();
      } else {
        this.resumeDetection();
      }
    };

    this.onResize = null;
  }

  // ==================== 生命周期 ====================

  async activate(): Promise<void> {
    if (this.active || this.activating) return;
    this.activating = true;
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
      this.app.setStatus?.(`Gesture failed: ${(err as Error).message}`, "error");
    } finally {
      this.activating = false;
    }
  }

  ensureAllChainsHaveGain(): void {
    let added = false;
    for (let i = 0; i < this.app.getChainCount(); i++) {
      if (!this.app.isChainEnabled(i)) continue;
      const chain = this.app.getChain(i);
      const modules = chain.modules || [];
      const hasGain = modules.some((m) => m.type === "Gain");
      if (!hasGain) {
        const gainModule = createEffectModule("Gain");
        modules.push(gainModule);
        added = true;
      }
      this.ensureGainMapped(i);
    }
    if (added) {
      this.app.engine.fullSync(this.app.state);
      this.app.renderAll();
    }
    this.app.markUnsaved();
  }

  pauseDetection(): void {
    if (!this.active) return;
    this.recognizer.stopCamera();
  }

  resumeDetection(): void {
    if (!this.active) return;
    this.recognizer.startCamera().then(() => {
      this.recognizer.startDetection();
    });
  }

  deactivate(): void {
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

  createOverlay(): void {
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
    const closeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    closeSvg.setAttribute("width", "42");
    closeSvg.setAttribute("height", "42");
    closeSvg.setAttribute("viewBox", "0 0 42 42");
    const closeUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
    closeUse.setAttribute("href", "/icons.svg#gesture-close");
    closeSvg.appendChild(closeUse);
    closeBtn.appendChild(closeSvg);
    closeBtn.addEventListener("click", () => this.deactivate());
    this.overlay.appendChild(closeBtn);

    document.body.appendChild(this.overlay);

    this.onResize = () => this.resizeCanvas();
    window.addEventListener("resize", this.onResize);

    this.resizeCanvas();
    this.drawStaticLayer();
    this.startRenderLoop();
  }

  destroyOverlay(): void {
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

  resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (this.staticCanvas) {
      this.staticCanvas.width = w * dpr;
      this.staticCanvas.height = h * dpr;
      this.staticCanvas.style.width = `${w}px`;
      this.staticCanvas.style.height = `${h}px`;
      this.staticCtx = this.staticCanvas.getContext("2d");
      this.staticCtx!.scale(dpr, dpr);
      this.markStaticLayerDirty();
    }

    if (this.canvas) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
      this.ctx = this.canvas.getContext("2d");
      this.ctx!.scale(dpr, dpr);
    }
  }

  // ==================== 坐标与几何 ====================

  getControlArea(): ControlArea {
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

  cameraToCanvas(cx: number, cy: number): { x: number; y: number } {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = 1.1;
    const offsetX = (w * (scale - 1)) / 2;
    const offsetY = (h * (scale - 1)) / 2;
    const x = (1 - cx) * w * scale - offsetX;
    const y = cy * h * scale - offsetY;
    return { x, y };
  }

  canvasToMacro(x: number, y: number): { x: number; y: number } {
    const area = this.getControlArea();
    const mx = clamp((x - area.x) / area.width, 0, 1);
    const my = clamp(1 - (y - area.y) / area.height, 0, 1);
    return { x: mx, y: my };
  }

  getChainPoint(chainIndex: number): { x: number; y: number } {
    const chainMacro = this.app.macroManager.getChainMacro(chainIndex);
    const area = this.getControlArea();
    return {
      x: area.x + chainMacro.point.x * area.width,
      y: area.y + (1 - chainMacro.point.y) * area.height,
    };
  }

  findChainAtPosition(x: number, y: number): number {
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

  findFirstAvailableChain(): number {
    for (let i = 0; i < this.app.getChainCount(); i++) {
      if (!this.app.isChainEnabled(i)) return i;
    }
    return -1;
  }

  // ==================== 手部确认防抖 ====================

  updateHandConfirmation(handedness: unknown[][], now: number): void {
    const detected = { left: false, right: false };
    for (const h of handedness || []) {
      const name = ((h as Array<{ categoryName: string }> | undefined)?.[0]?.categoryName);
      // MediaPipe 的 handedness 基于镜像视角：
      // "Right" 对应用户的左手，"Left" 对应用户的右手
      if (name === "Right") detected.left = true;
      if (name === "Left") detected.right = true;
    }

    for (const side of ["left", "right"] as const) {
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

  filterConfirmedLandmarks(landmarks: unknown[][], handedness: unknown[][]): HandLandmarks[] {
    if (!landmarks || !handedness || landmarks.length !== handedness.length) {
      return [];
    }
    return (landmarks as HandLandmarks[]).filter((_, i) => {
      const name = ((handedness[i] as Array<{ categoryName: string }> | undefined)?.[0]?.categoryName);
      const side = name === "Right" ? "left" : name === "Left" ? "right" : null;
      return side ? this.handConfirmation[side].confirmed : false;
    });
  }

  // ==================== 增益读写 ====================

  getChainGainValue(chainIndex: number): number {
    const chain = this.app.getChain(chainIndex);
    const modules = chain.modules || [];
    for (let i = modules.length - 1; i >= 0; i--) {
      if (modules[i].type === "Gain") {
        return ((modules[i].options as { gain?: number } | undefined)?.gain) ?? 1;
      }
    }
    return 1;
  }

  ensureGainMapped(chainIndex: number): ModuleConfig {
    const chain = this.app.getChain(chainIndex);
    const modules = chain.modules || [];
    let gainModule: ModuleConfig | null = null;
    for (let i = modules.length - 1; i >= 0; i--) {
      if (modules[i].type === "Gain") {
        gainModule = modules[i];
        break;
      }
    }
    if (!gainModule) {
      gainModule = createEffectModule("Gain");
      modules.push(gainModule);
      this.app.engine.fullSync(this.app.state);
      this.app.renderAll();
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
      this.app.markUnsaved();
    }
    return gainModule;
  }

  setChainGainValue(chainIndex: number, value: number): void {
    const gainModule = this.ensureGainMapped(chainIndex);
    const chainMacro = this.app.macroManager.getChainMacro(chainIndex);
    chainMacro.point.z = clamp(value / 2, 0, 1);
    this.app.macroManager.applyMappingsForChain(
      chainIndex,
      chainIndex === this.app.getSelectedChainIndex()
    );
    this.app.markUnsaved();
    // Visual smoothing handled by updateControlPointVisuals in render loop
  }

  // ==================== 手势结果处理 ====================

  handleResults({ landmarks, handedness, gestures }: GestureResults): void {
    const now = performance.now();

    // 更新手部确认状态：只有持续检测到手超过 HAND_CONFIRMATION_MS 后才生效
    this.updateHandConfirmation(handedness, now);

    // 过滤未确认的手部 landmark
    const confirmedLandmarks = this.filterConfirmedLandmarks(landmarks, handedness);

    // 过滤 gestures：未确认的手部对应手势不生效
    const parsedGestures = gestures as ParsedGestures;
    const confirmedGestures: ParsedGestures = {
      ...parsedGestures,
      leftPinch: this.handConfirmation.left.confirmed ? parsedGestures.leftPinch : false,
      leftPinchPos: this.handConfirmation.left.confirmed ? parsedGestures.leftPinchPos : null,
      rightPinch: this.handConfirmation.right.confirmed ? parsedGestures.rightPinch : false,
      rightPinchPos: this.handConfirmation.right.confirmed ? parsedGestures.rightPinchPos : null,
    };
    const confirmedHandCount = (["left", "right"] as const).filter((s) => this.handConfirmation[s].confirmed).length;
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
        this.app.markUnsaved();
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
              this.app.markUnsaved();
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
        this.app.markUnsaved();
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

  startRenderLoop(): void {
    if (this.renderFrame) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = 0;
    }

    const frame = (now: number) => {
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

  pushDetectionFrame(landmarks: HandLandmarks[]): void {
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

  getInterpolatedLandmarks(now: number): HandLandmarks[] {
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

  interpolateLandmarks(from: HandLandmarks[], to: HandLandmarks[], t: number): HandLandmarks[] {
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

  cloneLandmarks(landmarks: HandLandmarks[]): HandLandmarks[] {
    return (landmarks || []).map((hand) =>
      hand.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z }))
    );
  }

  // ==================== 绘制方法 ====================

  draw(landmarks: HandLandmarks[] = [], gestures: ParsedGestures | null = null): void {
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

  drawStaticLayer(): void {
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

  markStaticLayerDirty(): void {
    this.staticLayerDirty = true;
  }

  // ==================== FPS 统计 ====================

  tickFps(kind: "render" | "detect"): void {
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

  drawFpsBadge(): void {
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

  updateControlPointVisuals(): void {
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

  drawControlPoints(): void {
    for (let i = 0; i < this.app.getChainCount(); i++) {
      if (!this.app.isChainEnabled(i)) continue;
      const visual = this.controlPointVisuals[i];
      if (!visual) continue;
      this.drawControlPoint(i, visual);
    }
  }

  drawControlPoint(chainIndex: number, visual: ControlPointVisual): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const pos = { x: visual.x, y: visual.y };
    const radius = visual.radius;
    const rangeRadius = visual.rangeRadius || BASE_RADIUS * CONTROL_RANGE_MULTIPLIER;

    ctx.fillStyle = "rgba(0,0,0,0.1)";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, rangeRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(radius)}px "IBM Plex Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labels = ["I", "II", "III", "IV"];
    ctx.fillText(labels[chainIndex], pos.x, pos.y + 1);
  }

  // ==================== Landmark 空间平滑 ====================

  smoothLandmarks(landmarks: HandLandmarks[]): HandLandmarks[] {
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

  drawHandLandmarks(landmarks: HandLandmarks): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
      [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20],
      [0, 17],
    ];

    ctx.strokeStyle = "rgba(0, 120, 255, 0.4)";
    ctx.lineWidth = 1.5;
    connections.forEach(([a, b]) => {
      const pa = this.cameraToCanvas(landmarks[a].x, landmarks[a].y);
      const pb = this.cameraToCanvas(landmarks[b].x, landmarks[b].y);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    });

    ctx.fillStyle = "rgba(0, 120, 255, 0.6)";
    landmarks.forEach((lm) => {
      const pos = this.cameraToCanvas(lm.x, lm.y);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
