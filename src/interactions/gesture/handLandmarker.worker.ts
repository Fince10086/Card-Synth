/**
 * handLandmarker.worker.ts
 * Web Worker for MediaPipe HandLandmarker hand detection
 */

declare function importScripts(...urls: string[]): void;

const PINCH_ENTER_THRESHOLD = 0.08;
const PINCH_EXIT_THRESHOLD = 0.12;
const COOLDOWN_MS = 10;
const VISION_LIBRARY_URL = "/mediapipe/vision_bundle.mjs";

let handLandmarker: unknown = null;
let initialized = false;
let FilesetResolverRef: unknown = null;
let HandLandmarkerRef: unknown = null;

const cooldowns = {
  leftPinch: 0,
  rightPinch: 0,
  xGesture: 0,
};

const pinchPos: Record<string, { x: number; y: number } | null> = { left: null, right: null };
const pinchState: Record<string, boolean> = { left: false, right: false };
const pinchSmoothAlpha = 0.2;

self.onmessage = async (event: MessageEvent) => {
  const message = event.data || {};

  if (message.type === "init") {
    await initialize(message.payload || {});
    return;
  }

  if (message.type === "detect") {
    await detectFrame(message.payload || {});
    return;
  }

  if (message.type === "dispose") {
    dispose();
  }
};

async function initialize(payload: Record<string, unknown>): Promise<void> {
  if (initialized && handLandmarker) {
    self.postMessage({ type: "ready", payload: { delegate: (payload.activeDelegate as string) || "CPU" } });
    return;
  }

  const wasmPath =
    (payload.wasmPath as string) || "/mediapipe/wasm";
  const modelAssetPath =
    (payload.modelAssetPath as string) || "/mediapipe/hand_landmarker.task";

  const preferred = (payload.preferredDelegate as string) || "GPU";
  const delegatesToTry = preferred === "GPU" ? ["GPU", "CPU"] : [preferred];

  try {
    await ensureVisionLoaded(payload);
    const vision = await (FilesetResolverRef as { forVisionTasks(path: string): Promise<unknown> }).forVisionTasks(wasmPath);

    let lastError: Error | null = null;
    for (const delegate of delegatesToTry) {
      try {
        if (handLandmarker) {
          (handLandmarker as { close(): void }).close();
          handLandmarker = null;
        }

        handLandmarker = await (HandLandmarkerRef as {
          createFromOptions(vision: unknown, options: unknown): Promise<unknown>;
        }).createFromOptions(vision, {
          baseOptions: {
            modelAssetPath,
            delegate,
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.8,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        initialized = true;
        self.postMessage({ type: "ready", payload: { delegate } });
        return;
      } catch (delegateError) {
        lastError = delegateError as Error;
        const msg = delegateError instanceof Error ? delegateError.message : String(delegateError);
        console.warn(`[HandLandmarkerWorker] ${delegate} delegate failed, falling back...`, msg);
      }
    }

    throw lastError || new Error("All delegates failed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: "error", payload: { message } });
  }
}

async function ensureVisionLoaded(payload: Record<string, unknown>): Promise<void> {
  if (FilesetResolverRef && HandLandmarkerRef) {
    return;
  }

  const libraryUrl = (payload.libraryUrl as string) || VISION_LIBRARY_URL;
  const looksLikeModuleBundle = typeof libraryUrl === "string" && /\.mjs(?:$|\?)/.test(libraryUrl);

  try {
    const visionApi = await import(/* @vite-ignore */ libraryUrl);
    FilesetResolverRef = visionApi.FilesetResolver;
    HandLandmarkerRef = visionApi.HandLandmarker;
  } catch (importError) {
    if (!looksLikeModuleBundle && typeof importScripts === "function") {
      importScripts(libraryUrl);
      const visionApi = (self as unknown as unknown as Record<string, unknown>).vision || self;
      FilesetResolverRef = (visionApi as unknown as Record<string, unknown>).FilesetResolver;
      HandLandmarkerRef = (visionApi as unknown as Record<string, unknown>).HandLandmarker;
    } else {
      throw importError;
    }
  }

  if (!FilesetResolverRef || !HandLandmarkerRef) {
    throw new Error("Failed to load @mediapipe/tasks-vision in worker context.");
  }
}

async function detectFrame(payload: Record<string, unknown>): Promise<void> {
  if (!initialized || !handLandmarker) {
    self.postMessage({
      type: "error",
      payload: { message: "HandLandmarker worker is not initialized." },
    });
    return;
  }

  const frame = payload.frame as ImageBitmap;
  const timestamp = (payload.timestamp as number) ?? performance.now();

  if (!frame) {
    self.postMessage({
      type: "error",
      payload: { message: "Missing frame payload for detection." },
    });
    return;
  }

  try {
    const results = (handLandmarker as { detectForVideo(frame: ImageBitmap, timestamp: number): { landmarks: unknown[]; handedness: unknown[] } }).detectForVideo(frame, timestamp);
    const gestures = parseGestures(results, timestamp);

    self.postMessage({
      type: "result",
      payload: {
        landmarks: results.landmarks || [],
        handedness: results.handedness || [],
        gestures,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: "error", payload: { message } });
  } finally {
    if (typeof (frame as { close?(): void }).close === "function") {
      (frame as { close(): void }).close();
    }
  }
}

function parseGestures(results: { landmarks: unknown[]; handedness: unknown[] }, now = performance.now()) {
  const landmarks = results.landmarks || [];
  const handedness = results.handedness || [];

  const hands = landmarks.map((lm, i) => ({
    landmarks: lm as Array<{ x: number; y: number; z: number }>,
    handedness: (handedness[i] as Array<{ categoryName: string; score: number }>)?.[0]?.categoryName || "Unknown",
    score: (handedness[i] as Array<{ categoryName: string; score: number }>)?.[0]?.score || 0,
  }));

  const leftHand = hands.find((h) => h.handedness === "Right");
  const rightHand = hands.find((h) => h.handedness === "Left");

  const gestures: Record<string, unknown> = {
    leftPinch: false,
    rightPinch: false,
    xGesture: false,
    leftPinchPos: null,
    rightPinchPos: null,
    xCenter: null,
    hands,
  };

  if (leftHand && now > cooldowns.leftPinch) {
    const pinchDist = getPinchDistance(leftHand.landmarks);
    const wasPinching = pinchState.left;
    let isPinching = updatePinchState("left", pinchDist);
    if (isPinching && !wasPinching && !isPalmFacing(leftHand.landmarks)) {
      pinchState.left = false;
      isPinching = false;
    }
    if (isPinching) {
      gestures.leftPinch = true;
      const center = getPinchCenter(leftHand.landmarks);
      gestures.leftPinchPos = smoothPinch("left", center);
      cooldowns.leftPinch = now + COOLDOWN_MS;
    } else if (!isPinching && wasPinching) {
      pinchPos.left = null;
    }
  } else {
    pinchState.left = false;
    pinchPos.left = null;
  }

  if (rightHand && now > cooldowns.rightPinch) {
    const pinchDist = getPinchDistance(rightHand.landmarks);
    const wasPinching = pinchState.right;
    let isPinching = updatePinchState("right", pinchDist);
    if (isPinching && !wasPinching && !isPalmFacing(rightHand.landmarks)) {
      pinchState.right = false;
      isPinching = false;
    }
    if (isPinching) {
      gestures.rightPinch = true;
      const center = getPinchCenter(rightHand.landmarks);
      gestures.rightPinchPos = smoothPinch("right", center);
      cooldowns.rightPinch = now + COOLDOWN_MS;
    } else if (!isPinching && wasPinching) {
      pinchPos.right = null;
    }
  } else {
    pinchState.right = false;
    pinchPos.right = null;
  }

  if (hands.length >= 2 && now > cooldowns.xGesture) {
    const x = detectXGesture(hands);
    if (x) {
      gestures.xGesture = true;
      gestures.xCenter = x;
      cooldowns.xGesture = now + COOLDOWN_MS;
    }
  }

  return gestures;
}

function isPalmFacing(landmarks: Array<{ x: number; y: number; z: number }>): boolean {
  return landmarks[9].z >= 0;
}

function getPinchDistance(landmarks: Array<{ x: number; y: number }>): number {
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const dx = thumbTip.x - indexTip.x;
  const dy = thumbTip.y - indexTip.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getPinchCenter(landmarks: Array<{ x: number; y: number }>): { x: number; y: number } {
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  return {
    x: (thumbTip.x + indexTip.x) / 2,
    y: (thumbTip.y + indexTip.y) / 2,
  };
}

function updatePinchState(hand: string, distance: number): boolean {
  const isPinching = pinchState[hand];
  if (!isPinching && distance < PINCH_ENTER_THRESHOLD) {
    pinchState[hand] = true;
    return true;
  }
  if (isPinching && distance < PINCH_EXIT_THRESHOLD) {
    return true;
  }
  if (isPinching && distance >= PINCH_EXIT_THRESHOLD) {
    pinchState[hand] = false;
    return false;
  }
  return false;
}

function detectXGesture(hands: Array<{ landmarks: Array<{ x: number; y: number }> }>): { x: number; y: number } | null {
  if (hands.length < 2) return null;
  const idxTips = hands.map((h) => h.landmarks[8]);
  const idxPips = hands.map((h) => h.landmarks[6]);

  for (let i = 0; i < idxTips.length; i++) {
    for (let j = i + 1; j < idxTips.length; j++) {
      if (
        segmentsIntersect(
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

function segmentsIntersect(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number }
): boolean {
  const cross = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function smoothPinch(hand: string, pos: { x: number; y: number }): { x: number; y: number } {
  const prev = pinchPos[hand];
  if (!prev) {
    pinchPos[hand] = { x: pos.x, y: pos.y };
    return pos;
  }
  prev.x = pinchSmoothAlpha * pos.x + (1 - pinchSmoothAlpha) * prev.x;
  prev.y = pinchSmoothAlpha * pos.y + (1 - pinchSmoothAlpha) * prev.y;
  return { x: prev.x, y: prev.y };
}

function resetState(): void {
  cooldowns.leftPinch = 0;
  cooldowns.rightPinch = 0;
  cooldowns.xGesture = 0;
  pinchPos.left = null;
  pinchPos.right = null;
  pinchState.left = false;
  pinchState.right = false;
}

function dispose(): void {
  if (handLandmarker) {
    (handLandmarker as { close(): void }).close();
    handLandmarker = null;
  }
  initialized = false;
  resetState();
  self.postMessage({ type: "disposed" });
}
