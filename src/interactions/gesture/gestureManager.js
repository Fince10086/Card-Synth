import { HandGestureRecognizer } from "./handGestureRecognizer.js";
import { createComponentModule, clamp } from "../../utils/helpers.js";

const MARGIN_RATIO = 0.1;
const BASE_RADIUS = 16;
const CONTROL_RANGE_MULTIPLIER = 2;
const MIN_DISTANCE_RATIO = 0.08;

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
    };

    this.onEsc = (e) => {
      if (e.key === "Escape") {
        this.deactivate();
      }
    };
  }

  async activate() {
    if (this.active) return;
    try {
      await this.recognizer.initialize();
      await this.recognizer.startCamera();
      this.active = true;
      this.createOverlay();
      this.recognizer.onResults = (results) => this.handleResults(results);
      this.recognizer.startDetection();
      document.addEventListener("keydown", this.onEsc);
    } catch (err) {
      console.error("Gesture activation failed:", err);
      this.app.setStatus?.(`Gesture failed: ${err.message}`, "error");
    }
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    this.recognizer.stopCamera();
    this.recognizer.onResults = null;
    document.removeEventListener("keydown", this.onEsc);
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
    closeBtn.innerHTML = "<span>◥</span><span class=\"gesture-close-x\">✕</span>";
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
    const area = this.getControlArea();
    const x = area.x + (1 - cx) * area.width;
    const y = area.y + cy * area.height;
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

  setChainGainValue(chainIndex, value) {
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
    }
    gainModule.options.gain = clamp(value, 0, 2);
    this.app.engine.updateModule(gainModule.id, gainModule, chainIndex);
    this.app.selectedPresetId = "custom";
  }

  handleResults({ landmarks, gestures }) {
    this.draw(landmarks, gestures);

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
      const chainIndex = this.findChainAtPosition(pos.x, pos.y);

      if (chainIndex >= 0) {
        if (this.gestureState.leftPinchChainIndex !== chainIndex) {
          this.gestureState.leftPinchChainIndex = chainIndex;
          this.gestureState.leftPinchStartY = pos.y;
          this.gestureState.leftPinchStartGain = this.getChainGainValue(chainIndex);
        } else {
          const dy = this.gestureState.leftPinchStartY - pos.y;
          const area = this.getControlArea();
          const delta = (dy / area.height) * 4;
          const newGain = clamp(this.gestureState.leftPinchStartGain + delta, 0, 2);
          this.setChainGainValue(chainIndex, newGain);
          this.app.renderAll();
        }
      } else {
        const available = this.findFirstAvailableChain();
        if (available >= 0 && now - this.gestureState.lastPinchTime > 300) {
          const macro = this.canvasToMacro(pos.x, pos.y);
          this.app.setChainEnabled(available, true);
          const chainMacro = this.app.macroManager.getChainMacro(available);
          chainMacro.point.x = macro.x;
          chainMacro.point.y = macro.y;
          this.app.selectedPresetId = "custom";
          this.app.renderAll();
          this.gestureState.lastPinchTime = now;
        }
        this.gestureState.leftPinchChainIndex = -1;
      }
    } else {
      this.gestureState.leftPinchChainIndex = -1;
    }

    if (gestures.rightPinch && gestures.rightPinchPos) {
      const pos = this.cameraToCanvas(gestures.rightPinchPos.x, gestures.rightPinchPos.y);
      const chainIndex = this.findChainAtPosition(pos.x, pos.y);

      if (chainIndex >= 0) {
        if (this.gestureState.rightPinchChainIndex !== chainIndex) {
          this.gestureState.rightPinchChainIndex = chainIndex;
        }
        const macro = this.canvasToMacro(pos.x, pos.y);
        const chainMacro = this.app.macroManager.getChainMacro(chainIndex);
        chainMacro.point.x = macro.x;
        chainMacro.point.y = macro.y;
        this.app.selectedPresetId = "custom";
        this.app.macroManager.applyMappingsForChain(
          chainIndex,
          chainIndex === this.app.getSelectedChainIndex()
        );
        this.app.renderAll();
      } else {
        this.gestureState.rightPinchChainIndex = -1;
      }
    } else {
      this.gestureState.rightPinchChainIndex = -1;
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
  }

  drawControlPoint(chainIndex) {
    const pos = this.getChainPoint(chainIndex);
    const gain = this.getChainGainValue(chainIndex);
    const radiusScale = 0.5 + (gain / 2) * 1.0;
    const radius = BASE_RADIUS * radiusScale;
    const rangeRadius = radius * CONTROL_RANGE_MULTIPLIER;

    this.ctx.strokeStyle = "rgba(0,0,0,0.2)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.arc(pos.x, pos.y, rangeRadius, 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.strokeStyle = "#000000";
    this.ctx.lineWidth = 2;
    this.ctx.fillStyle = "transparent";
    this.ctx.beginPath();
    this.ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.fillStyle = "#000000";
    this.ctx.font = `bold ${Math.round(radius)}px sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    const labels = ["I", "II", "III", "IV"];
    this.ctx.fillText(labels[chainIndex], pos.x, pos.y);
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
