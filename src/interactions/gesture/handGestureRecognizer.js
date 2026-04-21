import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const PINCH_ENTER_THRESHOLD = 0.08;
const PINCH_EXIT_THRESHOLD = 0.12;
const COOLDOWN_MS = 10;

export class HandGestureRecognizer {
  constructor() {
    this.handLandmarker = null;
    this.video = null;
    this.stream = null;
    this.running = false;
    this.lastVideoTime = -1;
    this.onResults = null;
    this.cooldowns = {
      leftPinch: 0,
      rightPinch: 0,
      xGesture: 0,
    };
    this.pinchPos = { left: null, right: null };
    this.pinchSmoothAlpha = 0.2;
    this.pinchState = { left: false, right: false };
  }

  async initialize() {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.8,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }

  async startCamera() {
    if (this.stream) {
      return;
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 960, max: 960 },
        height: { ideal: 540, max: 960 },
        frameRate: { ideal: 30, max: 30 },
        facingMode: "user",
      },
    });

    this.video = document.createElement("video");
    this.video.srcObject = this.stream;
    this.video.autoplay = true;
    this.video.playsInline = true;
    this.video.muted = true;

    await new Promise((resolve) => {
      this.video.onloadeddata = resolve;
    });
    await this.video.play();
  }

  stopCamera() {
    this.running = false;
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
      this.video = null;
    }
  }

  startDetection() {
    this.running = true;
    const detect = () => {
      if (!this.running || !this.video || !this.handLandmarker) {
        return;
      }
      if (this.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.video.currentTime;
        const results = this.handLandmarker.detectForVideo(
          this.video,
          performance.now()
        );
        const gestures = this.parseGestures(results);
        if (this.onResults) {
          this.onResults({
            landmarks: results.landmarks || [],
            handedness: results.handedness || [],
            gestures,
          });
        }
      }
      requestAnimationFrame(detect);
    };
    requestAnimationFrame(detect);
  }

  parseGestures(results) {
    const now = performance.now();
    const landmarks = results.landmarks || [];
    const handedness = results.handedness || [];

    const hands = landmarks.map((lm, i) => ({
      landmarks: lm,
      handedness: handedness[i]?.[0]?.categoryName || "Unknown",
      score: handedness[i]?.[0]?.score || 0,
    }));

    const leftHand = hands.find((h) => h.handedness === "Right");
    const rightHand = hands.find((h) => h.handedness === "Left");

    const gestures = {
      leftPinch: false,
      rightPinch: false,
      xGesture: false,
      leftPinchPos: null,
      rightPinchPos: null,
      xCenter: null,
      hands,
    };

    if (leftHand && now > this.cooldowns.leftPinch) {
      const pinchDist = this.getPinchDistance(leftHand.landmarks);
      const wasPinching = this.pinchState.left;
      const isPinching = this.updatePinchState("left", pinchDist);
      if (isPinching) {
        gestures.leftPinch = true;
        const pinchPos = this.getPinchCenter(leftHand.landmarks);
        gestures.leftPinchPos = this.smoothPinch("left", pinchPos);
        this.cooldowns.leftPinch = now + COOLDOWN_MS;
      } else if (!isPinching && wasPinching) {
        this.pinchPos.left = null;
      }
    } else {
      this.pinchState.left = false;
      this.pinchPos.left = null;
    }

    if (rightHand && now > this.cooldowns.rightPinch) {
      const pinchDist = this.getPinchDistance(rightHand.landmarks);
      const wasPinching = this.pinchState.right;
      const isPinching = this.updatePinchState("right", pinchDist);
      if (isPinching) {
        gestures.rightPinch = true;
        const pinchPos = this.getPinchCenter(rightHand.landmarks);
        gestures.rightPinchPos = this.smoothPinch("right", pinchPos);
        this.cooldowns.rightPinch = now + COOLDOWN_MS;
      } else if (!isPinching && wasPinching) {
        this.pinchPos.right = null;
      }
    } else {
      this.pinchState.right = false;
      this.pinchPos.right = null;
    }

    if (hands.length >= 2 && now > this.cooldowns.xGesture) {
      const x = this.detectXGesture(hands);
      if (x) {
        gestures.xGesture = true;
        gestures.xCenter = x;
        this.cooldowns.xGesture = now + COOLDOWN_MS;
      }
    }

    return gestures;
  }

  getPinchDistance(landmarks) {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const dx = thumbTip.x - indexTip.x;
    const dy = thumbTip.y - indexTip.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  getPinchCenter(landmarks) {
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    return {
      x: (thumbTip.x + indexTip.x) / 2,
      y: (thumbTip.y + indexTip.y) / 2,
    };
  }

  updatePinchState(hand, distance) {
    const isPinching = this.pinchState[hand];
    if (!isPinching && distance < PINCH_ENTER_THRESHOLD) {
      this.pinchState[hand] = true;
      return true;
    }
    if (isPinching && distance < PINCH_EXIT_THRESHOLD) {
      return true;
    }
    if (isPinching && distance >= PINCH_EXIT_THRESHOLD) {
      this.pinchState[hand] = false;
      return false;
    }
    return false;
  }

  detectXGesture(hands) {
    if (hands.length < 2) return null;
    const idxTips = hands.map((h) => h.landmarks[8]);
    const idxPips = hands.map((h) => h.landmarks[6]);

    for (let i = 0; i < idxTips.length; i++) {
      for (let j = i + 1; j < idxTips.length; j++) {
        if (
          this.segmentsIntersect(
            idxTips[i],
            idxPips[i],
            idxTips[j],
            idxPips[j]
          )
        ) {
          return {
            x: (idxTips[i].x + idxTips[j].x) / 2,
            y: (idxTips[i].y + idxTips[j].y) / 2,
          };
        }
      }
    }
    return null;
  }

  segmentsIntersect(a1, a2, b1, b2) {
    const cross = (p, q, r) =>
      (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = cross(b1, b2, a1);
    const d2 = cross(b1, b2, a2);
    const d3 = cross(a1, a2, b1);
    const d4 = cross(a1, a2, b2);
    return d1 * d2 < 0 && d3 * d4 < 0;
  }

  smoothPinch(hand, pos) {
    const prev = this.pinchPos[hand];
    if (!prev) {
      this.pinchPos[hand] = { x: pos.x, y: pos.y };
      return pos;
    }
    const alpha = this.pinchSmoothAlpha;
    prev.x = alpha * pos.x + (1 - alpha) * prev.x;
    prev.y = alpha * pos.y + (1 - alpha) * prev.y;
    return { x: prev.x, y: prev.y };
  }

  dispose() {
    this.stopCamera();
    if (this.handLandmarker) {
      this.handLandmarker.close();
      this.handLandmarker = null;
    }
  }
}
