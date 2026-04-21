import { HandGestureRecognizer } from "./handGestureRecognizer.js";
import { createComponentModule, clamp } from "../../utils/helpers.js";

const MARGIN_RATIO = 0.1;
const BASE_RADIUS = 16;
const CONTROL_RANGE_MULTIPLIER = 2;
const MIN_DISTANCE_RATIO = 0.08;
const PINCH_HOLD_MS = 100;
const FPS_SAMPLE_WINDOW_MS = 500;

export class GestureManager {
  constructor(app) {
    this.app = app;
    this.recognizer = new HandGestureRecognizer();
    this.active = false;
    this.overlay = null;
    this.canvas = null;
    this.ctx = null;

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

    this.smoothedLandmarks = [];
    this.smoothAlpha = 0.4;

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

    this.lastLandmarks = [];
    this.lastGestures = null;
    this.renderPending = false;

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
  }

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

  pauseDetection() {
    if (!this.active) return;
    this.recognizer.stopCamera();
  }

  resumeDetection() {
    if (!this.active) return;
    this.recognizer.startCamera().then(() => {
      this.recognizer.startDetection();
    });
  }

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

  createOverlay() {
    this.overlay = document.createElement("div");
    this.overlay.className = "gesture-overlay";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "gesture-canvas";
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
    this.draw();
  }

  destroyOverlay() {
    if (this.onResize) {
      window.removeEventListener("resize", this.onResize);
      this.onResize = null;
    }
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
      this.canvas = null;
      this.ctx = null;
    }
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx = this.canvas.getContext("2d");
    this.ctx.scale(dpr, dpr);
  }

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

  cameraToCanvas(cx, cy) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = (1 - cx) * w;
    const y = cy * h;
    return { x, y };
  }

  canvasToMacro(x, y) {
    const area = this.getControlArea();
    const mx = clamp((x - area.x) / area.width, 0, 1);
    const my = clamp(1 - (y - area.y) / area.height, 0, 1);
    return { x: mx, y: my };
  }

  getChainPoint(chainIndex) {
    const chainMacro = this.app.macroManager.getChainMacro(chainIndex);
    const area = this.getControlArea();
    return {
      x: area.x + chainMacro.point.x * area.width,
      y: area.y + (1 - chainMacro.point.y) * area.height,
    };
  }

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

  findFirstAvailableChain() {
    for (let i = 0; i < this.app.getChainCount(); i++) {
      if (!this.app.isChainEnabled(i)) return i;
    }
    return -1;
  }

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

  setChainGainValue(chainIndex, value) {
    const gainModule = this.ensureGainMapped(chainIndex);
    const chainMacro = this.app.macroManager.getChainMacro(chainIndex);
    chainMacro.point.z = clamp(value / 2, 0, 1);
    this.app.macroManager.applyMappingsForChain(
      chainIndex,
      chainIndex === this.app.getSelectedChainIndex()
    );
    this.app.selectedPresetId = "custom";
  }

  handleResults({ landmarks, gestures }) {
    this.tickFps("detect");
    this.lastLandmarks = this.smoothLandmarks(landmarks);
    this.lastGestures = gestures;
    if (!this.renderPending) {
      this.renderPending = true;
      requestAnimationFrame(() => {
        this.renderPending = false;
        this.draw(this.lastLandmarks, this.lastGestures);
      });
    }

    const now = performance.now();

    if (gestures.xGesture && gestures.xCenter) {
      const pos = this.cameraToCanvas(gestures.xCenter.x, gestures.xCenter.y);
      const chainIndex = this.findChainAtPosition(pos.x, pos.y);
      if (chainIndex >= 0) {
        this.app.setChainEnabled(chainIndex, false);
        this.app.macroManager.resetChainMacro(chainIndex);
        this.app.selectedPresetId = "custom";
        this.app.renderAll();
      }
      return;
    }

    if (gestures.leftPinch && gestures.leftPinchPos) {
      const pos = this.cameraToCanvas(gestures.leftPinchPos.x, gestures.leftPinchPos.y);

      if (this.gestureState.leftPinchChainIndex >= 0 && this.gestureState.leftPinchConfirmed) {
        const chainIndex = this.gestureState.leftPinchChainIndex;
        const dy = this.gestureState.leftPinchStartY - pos.y;
        const area = this.getControlArea();
        const delta = (dy / area.height) * 4;
        const newGain = clamp(this.gestureState.leftPinchStartGain + delta, 0, 2);
        this.setChainGainValue(chainIndex, newGain);
      } else if (!this.gestureState.leftPinchConfirmed) {
        if (this.gestureState.leftPinchHoldStart === 0) {
          this.gestureState.leftPinchHoldStart = now;
          const chainIndex = this.findChainAtPosition(pos.x, pos.y);
          if (chainIndex >= 0) {
            this.gestureState.leftPinchChainIndex = chainIndex;
            this.gestureState.leftPinchStartY = pos.y;
            this.gestureState.leftPinchStartGain = this.getChainGainValue(chainIndex);
          } else {
            const available = this.findFirstAvailableChain();
            if (available >= 0 && now - this.gestureState.lastPinchTime > 300) {
              this.gestureState.leftPinchChainIndex = -2;
            }
          }
        } else if (now - this.gestureState.leftPinchHoldStart >= PINCH_HOLD_MS) {
          this.gestureState.leftPinchConfirmed = true;
          if (this.gestureState.leftPinchChainIndex === -2) {
            const macro = this.canvasToMacro(pos.x, pos.y);
            const available = this.findFirstAvailableChain();
            if (available >= 0) {
              this.app.setChainEnabled(available, true);
              const chainMacro = this.app.macroManager.getChainMacro(available);
              chainMacro.point.x = macro.x;
              chainMacro.point.y = macro.y;
              this.app.selectedPresetId = "custom";
              this.gestureState.lastPinchTime = now;
              this.gestureState.leftPinchChainIndex = available;
            }
          }
        }
      }
    } else {
      this.gestureState.leftPinchChainIndex = -1;
      this.gestureState.leftPinchHoldStart = 0;
      this.gestureState.leftPinchConfirmed = false;
    }

    if (gestures.rightPinch && gestures.rightPinchPos) {
      const pos = this.cameraToCanvas(gestures.rightPinchPos.x, gestures.rightPinchPos.y);

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
      } else if (!this.gestureState.rightPinchConfirmed) {
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
      this.gestureState.rightPinchChainIndex = -1;
      this.gestureState.rightPinchHoldStart = 0;
      this.gestureState.rightPinchConfirmed = false;
    }
  }

  draw(landmarks = [], gestures = null) {
    if (!this.ctx || !this.canvas) return;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);

    const area = this.getControlArea();
    this.ctx.strokeStyle = "rgba(0,0,0,0.15)";
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(area.x, area.y, area.width, area.height);

    for (let i = 0; i < this.app.getChainCount(); i++) {
      if (!this.app.isChainEnabled(i)) continue;
      this.drawControlPoint(i);
    }

    landmarks.forEach((hand) => {
      this.drawHandLandmarks(hand);
    });

    this.drawFpsBadge();
  }

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

  drawControlPoint(chainIndex) {
    const pos = this.getChainPoint(chainIndex);
    const gain = this.getChainGainValue(chainIndex);
    const radiusScale = 0.5 + (gain / 2) * 1.0;
    const radius = BASE_RADIUS * radiusScale;
    const rangeRadius = BASE_RADIUS * CONTROL_RANGE_MULTIPLIER;

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
