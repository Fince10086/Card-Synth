/**
 * @fileoverview gestureManager.ts
 * 手势管理器：将 MediaPipe 手部检测结果映射到全局 9 点宏控制。
 * 主要功能包括：
 *   - 激活/停用手势控制界面（摄像头 + 覆盖层）
 *   - 双手同逻辑：任意一只手捏合，即移动当前键盘选中的宏控制点
 *   - 键盘 1-9 选择当前控制点
 *   - 在覆盖层上渲染最近 3 个控制点、手部关键点及 FPS 信息
 */

import { HandGestureRecognizer, type GestureResults } from "./handGestureRecognizer";
import { WaterRenderer } from "./waterRenderer";
import { SpectrogramRenderer } from "./spectrogramRenderer";
import { clamp } from "../../utils/helpers";
import type { Preset, MacroPointState } from "../../types";

const MARGIN_RATIO = 0.1;
const BASE_RADIUS = 16;
const CONTROL_RANGE_MULTIPLIER = 2;
const FPS_SAMPLE_WINDOW_MS = 500;
const DEFAULT_DETECT_FRAME_MS = 1000 / 30;
const HAND_CONFIRMATION_MS = 100;

interface PinchInfo {
  handIndex: number;
  pinching: boolean;
  x: number;
  y: number;
}

interface ParsedGestures {
  pinches: PinchInfo[];
}

interface Landmark {
  x: number;
  y: number;
  z: number;
}

type HandLandmarks = Landmark[];

interface HandConfirmation {
  firstSeenAt: number;
  confirmed: boolean;
}

interface FpsStats {
  render: { frames: number; lastSampleAt: number; value: number };
  detect: { frames: number; lastSampleAt: number; value: number };
}

interface ControlPointVisual {
  pointIndex: number;
  x: number;
  y: number;
  radius: number;
  rangeRadius: number;
  opacity: number;
  scale: number;
}

interface ControlArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GestureManagerApp {
  state: Preset;
  getMacroPoint(pointIndex: number): MacroPointState;
  getMacroPointCount(): number;
  getSelectedMacroPointIndex(): number;
  setSelectedMacroPointIndex(index: number): void;
  updateMacroPointFromGesture(pointIndex: number, x: number, y: number): void;
  macroManager: {
    applyMappingsForPoint(pointIndex: number, syncControls: boolean): void;
    getMainCardViewModel(): {
      pointCount: number;
      selectedPointIndex: number;
      recentSelection: number[];
      points: Array<{ pointIndex: number; visible: boolean; selected: boolean; recentRank: number; x: number; y: number; color: string }>;
    };
  };
  renderAll(): void;
  markUnsaved(): void;
  setStatus?(message: string, tone?: string): void;
}

export class GestureManager {
  app: GestureManagerApp;
  recognizer: HandGestureRecognizer;
  active: boolean;
  activating: boolean;

  overlay: HTMLDivElement | null;
  waterCanvas: HTMLCanvasElement | null;
  waterRenderer: WaterRenderer | null;
  spectrogramCanvas: HTMLCanvasElement | null;
  spectrogramRenderer: SpectrogramRenderer | null;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;

  smoothedLandmarks: HandLandmarks[];
  smoothAlpha: number;
  lastLandmarks: HandLandmarks[];
  lastGestures: ParsedGestures | null;

  renderPending: boolean;
  renderFrame: number;
  prevLandmarks: HandLandmarks[];
  currentLandmarks: HandLandmarks[];
  interpolatedLandmarks: HandLandmarks[];
  frameBlend: { startAt: number; duration: number };
  lastDetectAt: number;

  controlPointVisuals: ControlPointVisual[];

  handConfirmation: Map<number, HandConfirmation>;

  fpsStats: FpsStats;

  onEsc: (e: KeyboardEvent) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onVisibilityChange: () => void;
  onResize: (() => void) | null;

  constructor(app: GestureManagerApp) {
    this.app = app;
    this.recognizer = new HandGestureRecognizer();
    this.active = false;
    this.activating = false;

    this.overlay = null;
    this.waterCanvas = null;
    this.waterRenderer = null;
    this.spectrogramCanvas = null;
    this.spectrogramRenderer = null;
    this.canvas = null;
    this.ctx = null;

    this.smoothedLandmarks = [];
    this.smoothAlpha = 0.4;
    this.lastLandmarks = [];
    this.lastGestures = null;

    this.renderPending = false;
    this.renderFrame = 0;
    this.prevLandmarks = [];
    this.currentLandmarks = [];
    this.interpolatedLandmarks = [];
    this.frameBlend = { startAt: 0, duration: DEFAULT_DETECT_FRAME_MS };
    this.lastDetectAt = 0;

    this.controlPointVisuals = [];
    this.handConfirmation = new Map();

    const now = performance.now();
    this.fpsStats = {
      render: { frames: 0, lastSampleAt: now, value: 0 },
      detect: { frames: 0, lastSampleAt: now, value: 0 },
    };

    this.onEsc = (e) => {
      if (e.key === "Escape") {
        this.deactivate();
      }
    };

    this.onKeyDown = (e) => {
      if (e.repeat) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      if (e.key >= "1" && e.key <= "9") {
        const index = Number(e.key) - 1;
        if (index < this.app.getMacroPointCount()) {
          this.app.setSelectedMacroPointIndex(index);
          this.app.renderAll();
        }
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

  async activate(analyser?: { getValue(): Float32Array }): Promise<void> {
    if (this.active || this.activating) return;
    this.activating = true;
    try {
      await this.recognizer.initialize();
      await this.recognizer.startCamera();
      this.active = true;

      this.createOverlay(analyser ?? null);
      this.recognizer.onResults = (results) => this.handleResults(results);
      this.recognizer.startDetection();
      document.addEventListener("keydown", this.onEsc);
      document.addEventListener("keydown", this.onKeyDown);
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
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.destroyOverlay();
    this.app.renderAll();
  }

  createOverlay(analyser: { getValue(): Float32Array } | null): void {
    this.overlay = document.createElement("div");
    this.overlay.className = "gesture-overlay";

    // Spectrogram layer (bottom)
    this.spectrogramCanvas = document.createElement("canvas");
    this.spectrogramCanvas.className = "gesture-canvas gesture-canvas-spectrogram";
    this.overlay.appendChild(this.spectrogramCanvas);
    this.spectrogramRenderer = new SpectrogramRenderer(this.spectrogramCanvas);
    if (analyser) {
      this.spectrogramRenderer.setAnalyser(analyser);
    }

    // Water ripple layer (middle)
    this.waterCanvas = document.createElement("canvas");
    this.waterCanvas.className = "gesture-canvas gesture-canvas-webgl";
    this.overlay.appendChild(this.waterCanvas);

    // Hand landmark layer (top)
    this.canvas = document.createElement("canvas");
    this.canvas.className = "gesture-canvas gesture-canvas-dynamic";
    this.overlay.appendChild(this.canvas);

    try {
      this.waterRenderer = new WaterRenderer(this.waterCanvas);
    } catch (err) {
      console.error("Water renderer initialization failed:", err);
    }

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
    if (this.spectrogramRenderer) {
      this.spectrogramRenderer.dispose();
      this.spectrogramRenderer = null;
    }
    if (this.waterRenderer) {
      this.waterRenderer.dispose();
      this.waterRenderer = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
      this.spectrogramCanvas = null;
      this.waterCanvas = null;
      this.canvas = null;
      this.ctx = null;
    }
  }

  resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (this.spectrogramCanvas) {
      this.spectrogramCanvas.style.width = `${w}px`;
      this.spectrogramCanvas.style.height = `${h}px`;
      this.spectrogramRenderer?.resize(w, h);
    }

    if (this.waterCanvas) {
      this.waterCanvas.width = w;
      this.waterCanvas.height = h;
      this.waterCanvas.style.width = `${w}px`;
      this.waterCanvas.style.height = `${h}px`;
      this.waterRenderer?.resize(w, h);
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

  cameraToWaterUV(cx: number, cy: number): { x: number; y: number } {
    // Convert MediaPipe normalized camera coords into the control-area UV space.
    // Mirror horizontally for selfie view, flip vertically (MediaPipe y is top-down),
    // and respect the same 10% margin control area used for macro points.
    const area = this.getControlArea();
    const screenX = (1 - cx) * window.innerWidth;
    const screenY = (1 - cy) * window.innerHeight;
    const x = (screenX - area.x) / area.width;
    const y = (screenY - area.y) / area.height;
    return { x: clamp(x, 0, 1), y: clamp(y, 0, 1) };
  }

  canvasToMacro(x: number, y: number): { x: number; y: number } {
    const area = this.getControlArea();
    const mx = clamp((x - area.x) / area.width, 0, 1);
    const my = clamp(1 - (y - area.y) / area.height, 0, 1);
    return { x: mx, y: my };
  }

  getPointVisualPosition(pointIndex: number): { x: number; y: number } {
    const point = this.app.getMacroPoint(pointIndex);
    const area = this.getControlArea();
    return {
      x: area.x + point.x * area.width,
      y: area.y + (1 - point.y) * area.height,
    };
  }

  updateHandConfirmation(landmarks: unknown[][], now: number): void {
    const detected = new Set<number>();
    landmarks.forEach((_, i) => detected.add(i));

    this.handConfirmation.forEach((state, handIndex) => {
      if (!detected.has(handIndex)) {
        this.handConfirmation.delete(handIndex);
      }
    });

    detected.forEach((handIndex) => {
      let state = this.handConfirmation.get(handIndex);
      if (!state) {
        state = { firstSeenAt: now, confirmed: false };
        this.handConfirmation.set(handIndex, state);
      }
      state.confirmed = now - state.firstSeenAt >= HAND_CONFIRMATION_MS;
    });
  }

  handleResults({ landmarks, gestures }: GestureResults): void {
    const now = performance.now();

    this.updateHandConfirmation(landmarks, now);

    const parsed = (gestures as ParsedGestures) || { pinches: [] };
    const confirmedPinches = parsed.pinches.filter((p) => this.handConfirmation.get(p.handIndex)?.confirmed);

    this.tickFps("detect");
    const smoothedLandmarks = this.smoothLandmarks(landmarks as HandLandmarks[]);
    this.lastLandmarks = smoothedLandmarks;
    this.pushDetectionFrame(smoothedLandmarks);
    this.lastGestures = parsed;

    // Feed pinch positions to the water ripple renderer
    const waterTips = confirmedPinches
      .filter((p) => p.pinching)
      .map((p) => {
        const uv = this.cameraToWaterUV(p.x, p.y);
        return { id: `pinch_${p.handIndex}`, x: uv.x, y: uv.y };
      });
    this.waterRenderer?.setTips(waterTips);

    // Move the selected point with active pinches
    const activePinches = confirmedPinches.filter((p) => p.pinching);
    if (activePinches.length > 0) {
      const selectedPointIndex = this.app.getSelectedMacroPointIndex();
      const avg = activePinches.reduce(
        (acc, p) => {
          const pos = this.cameraToCanvas(p.x, p.y);
          return { x: acc.x + pos.x, y: acc.y + pos.y, count: acc.count + 1 };
        },
        { x: 0, y: 0, count: 0 }
      );
      const avgPos = { x: avg.x / avg.count, y: avg.y / avg.count };
      const macro = this.canvasToMacro(avgPos.x, avgPos.y);
      this.app.updateMacroPointFromGesture(selectedPointIndex, macro.x, macro.y);
    }
  }

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

      // Render spectrogram and use it as water background
      this.spectrogramRenderer?.render();
      if (this.spectrogramCanvas && this.waterRenderer) {
        this.waterRenderer.setBackground(this.spectrogramCanvas);
      }

      this.waterRenderer?.render();
      this.draw(this.getInterpolatedLandmarks(now), this.lastGestures);
      this.renderFrame = requestAnimationFrame(frame);
    };

    this.renderFrame = requestAnimationFrame(frame);
  }

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
    if (!this.currentLandmarks.length) return [];
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
    return (landmarks || []).map((hand) => hand.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z })));
  }

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

  tickFps(kind: "render" | "detect"): void {
    const stats = this.fpsStats[kind];
    if (!stats) return;

    stats.frames += 1;
    const now = performance.now();
    const elapsed = now - stats.lastSampleAt;
    if (elapsed < FPS_SAMPLE_WINDOW_MS) return;

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

  updateControlPointVisuals(): void {
    const viewModel = this.app.macroManager.getMainCardViewModel();
    const recentRankMap = new Map(viewModel.recentSelection.map((index, rank) => [index, rank]));
    const pointCount = viewModel.pointCount;

    const newVisuals: ControlPointVisual[] = [];
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
      const rank = recentRankMap.get(pointIndex);
      if (rank === undefined) continue;

      const targetPos = this.getPointVisualPosition(pointIndex);
      const isSelected = pointIndex === viewModel.selectedPointIndex;
      const baseScale = rank === 0 ? 1.2 : rank === 1 ? 0.95 : 0.75;
      const opacity = rank === 0 ? 1 : rank === 1 ? 0.6 : 0.3;
      const targetRadius = BASE_RADIUS * baseScale * (isSelected ? 1.25 : 1);
      const rangeRadius = BASE_RADIUS * CONTROL_RANGE_MULTIPLIER * baseScale;

      const existing = this.controlPointVisuals.find((v) => v.pointIndex === pointIndex);
      const damping = 0.2;

      const visual: ControlPointVisual = existing
        ? {
            pointIndex,
            x: existing.x + (targetPos.x - existing.x) * damping,
            y: existing.y + (targetPos.y - existing.y) * damping,
            radius: existing.radius + (targetRadius - existing.radius) * damping,
            rangeRadius: existing.rangeRadius + (rangeRadius - existing.rangeRadius) * damping,
            opacity: existing.opacity + (opacity - existing.opacity) * damping,
            scale: existing.scale + (baseScale - existing.scale) * damping,
          }
        : {
            pointIndex,
            x: targetPos.x,
            y: targetPos.y,
            radius: targetRadius,
            rangeRadius,
            opacity,
            scale: baseScale,
          };

      newVisuals.push(visual);
    }

    this.controlPointVisuals = newVisuals;
  }

  drawControlPoints(): void {
    this.controlPointVisuals.forEach((visual) => this.drawControlPoint(visual));
  }

  drawControlPoint(visual: ControlPointVisual): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const viewModel = this.app.macroManager.getMainCardViewModel();
    const isSelected = visual.pointIndex === viewModel.selectedPointIndex;

    ctx.fillStyle = `rgba(0,0,0,${0.08 * visual.opacity})`;
    ctx.beginPath();
    ctx.arc(visual.x, visual.y, visual.rangeRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = `rgba(0,0,0,${visual.opacity})`;
    ctx.beginPath();
    ctx.arc(visual.x, visual.y, visual.radius, 0, Math.PI * 2);
    ctx.fill();

    if (isSelected) {
      ctx.strokeStyle = "rgba(0, 120, 255, 0.8)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(visual.x, visual.y, visual.radius + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.round(visual.radius)}px "IBM Plex Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(visual.pointIndex + 1), visual.x, visual.y + 1);
  }

  smoothLandmarks(landmarks: HandLandmarks[]): HandLandmarks[] {
    if (!landmarks || landmarks.length === 0) {
      this.smoothedLandmarks = [];
      return landmarks;
    }
    if (this.smoothedLandmarks.length !== landmarks.length) {
      this.smoothedLandmarks = landmarks.map((hand) => hand.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z })));
      return landmarks;
    }
    const alpha = this.smoothAlpha;
    for (let h = 0; h < landmarks.length; h++) {
      for (let i = 0; i < landmarks[h].length; i++) {
        this.smoothedLandmarks[h][i].x = alpha * landmarks[h][i].x + (1 - alpha) * this.smoothedLandmarks[h][i].x;
        this.smoothedLandmarks[h][i].y = alpha * landmarks[h][i].y + (1 - alpha) * this.smoothedLandmarks[h][i].y;
        this.smoothedLandmarks[h][i].z = alpha * landmarks[h][i].z + (1 - alpha) * this.smoothedLandmarks[h][i].z;
      }
    }
    return this.smoothedLandmarks;
  }

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
