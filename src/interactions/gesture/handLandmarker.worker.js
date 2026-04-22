/**
 * @fileoverview handLandmarker.worker.js
 * 基于 MediaPipe HandLandmarker 的 Web Worker，负责在独立线程中执行手部关键点检测与手势解析。
 * 通过 postMessage 与主线程通信，支持 GPU 优先、失败回退 CPU 的加速策略。
 */

// ==================== 常量配置 ====================

/** 捏合进入阈值（拇指与食指指尖归一化距离） */
const PINCH_ENTER_THRESHOLD = 0.08;
/** 捏合退出阈值（大于此值则判定为松开，采用迟滞逻辑避免抖动） */
const PINCH_EXIT_THRESHOLD = 0.12;
/** 各类手势触发后的最小冷却时间（毫秒），防止高频重复触发 */
const COOLDOWN_MS = 10;
/** MediaPipe tasks-vision 库的 CDN 根地址 */
const VISION_LIBRARY_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

// ==================== 全局状态 ====================

/** HandLandmarker 实例引用 */
let handLandmarker = null;
/** 是否已完成初始化 */
let initialized = false;
/** 延迟加载的 FilesetResolver 类引用 */
let FilesetResolverRef = null;
/** 延迟加载的 HandLandmarker 类引用 */
let HandLandmarkerRef = null;

/** 手势冷却计时器（leftPinch / rightPinch / xGesture） */
const cooldowns = {
  leftPinch: 0,
  rightPinch: 0,
  xGesture: 0,
};

/** 当前捏合位置缓存（用于平滑插值） */
const pinchPos = { left: null, right: null };
/** 当前捏合状态（left / right 是否处于捏合中） */
const pinchState = { left: false, right: false };
/** 捏合位置平滑系数（一阶低通滤波，值越大越跟手） */
const pinchSmoothAlpha = 0.2;

// ==================== 消息处理 ====================

/**
 * Worker 主入口：监听来自主线程的消息并分发到对应处理函数。
 * 支持的消息类型：
 *   - "init"   : 初始化 HandLandmarker
 *   - "detect" : 对单帧图像执行检测
 *   - "dispose": 释放资源
 */
self.onmessage = async (event) => {
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

// ==================== 初始化 ====================

/**
 * 初始化 HandLandmarker。
 * 若已初始化则直接返回 ready；否则按 "GPU → CPU" 顺序尝试创建实例，
 * 成功后将实际使用的 delegate 通过 "ready" 消息回传主线程。
 *
 * @param {Object} payload - 初始化参数
 * @param {string} [payload.wasmPath] - WASM 文件路径
 * @param {string} [payload.modelAssetPath] - 模型文件路径
 * @param {string} [payload.preferredDelegate="GPU"] - 优先使用的计算后端（"GPU" 或 "CPU"）
 */
async function initialize(payload) {
  // 已初始化则跳过，避免重复创建
  if (initialized && handLandmarker) {
    self.postMessage({ type: "ready", payload: { delegate: payload.activeDelegate || "CPU" } });
    return;
  }

  // 默认路径回退到 CDN
  const wasmPath =
    payload.wasmPath ||
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";
  const modelAssetPath =
    payload.modelAssetPath ||
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

  // 优先 GPU，失败自动回退 CPU
  const preferred = payload.preferredDelegate || "GPU";
  const delegatesToTry = preferred === "GPU" ? ["GPU", "CPU"] : [preferred];

  try {
    await ensureVisionLoaded(payload);
    const vision = await FilesetResolverRef.forVisionTasks(wasmPath);

    let lastError = null;
    for (const delegate of delegatesToTry) {
      try {
        // 清理上一次尝试失败时可能残留的半初始化实例
        if (handLandmarker) {
          handLandmarker.close();
          handLandmarker = null;
        }

        handLandmarker = await HandLandmarkerRef.createFromOptions(vision, {
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
        // 将实际生效的后端通知主线程，方便日志与调试
        self.postMessage({ type: "ready", payload: { delegate } });
        return;
      } catch (delegateError) {
        lastError = delegateError;
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

/**
 * 确保 @mediapipe/tasks-vision 库已加载。
 * 优先使用 ES Module 动态 import；若失败且当前环境支持 importScripts，则回退到传统脚本加载。
 *
 * @param {Object} payload - 包含 libraryUrl 等参数
 */
async function ensureVisionLoaded(payload) {
  // 已加载则直接返回，避免重复请求
  if (FilesetResolverRef && HandLandmarkerRef) {
    return;
  }

  const libraryUrl = payload.libraryUrl || VISION_LIBRARY_URL;
  const looksLikeModuleBundle = typeof libraryUrl === "string" && /\.mjs(?:$|\?)/.test(libraryUrl);

  try {
    // 尝试 ESM 方式加载
    const visionApi = await import(/* @vite-ignore */ libraryUrl);
    FilesetResolverRef = visionApi.FilesetResolver;
    HandLandmarkerRef = visionApi.HandLandmarker;
  } catch (importError) {
    // ESM 失败时，在 Worker 环境中尝试 importScripts
    if (!looksLikeModuleBundle && typeof importScripts === "function") {
      importScripts(libraryUrl);
      const visionApi = self.vision || self;
      FilesetResolverRef = visionApi.FilesetResolver;
      HandLandmarkerRef = visionApi.HandLandmarker;
    } else {
      throw importError;
    }
  }

  if (!FilesetResolverRef || !HandLandmarkerRef) {
    throw new Error("Failed to load @mediapipe/tasks-vision in worker context.");
  }
}

// ==================== 检测帧 ====================

/**
 * 对单帧视频图像执行手部关键点检测，并解析手势结果返回主线程。
 *
 * @param {Object} payload - 检测参数
 * @param {ImageBitmap|VideoFrame} payload.frame - 待检测的图像帧
 * @param {number} payload.timestamp - 当前帧的时间戳（毫秒）
 */
async function detectFrame(payload) {
  if (!initialized || !handLandmarker) {
    self.postMessage({
      type: "error",
      payload: { message: "HandLandmarker worker is not initialized." },
    });
    return;
  }

  const frame = payload.frame;
  const timestamp = payload.timestamp ?? performance.now();

  if (!frame) {
    self.postMessage({
      type: "error",
      payload: { message: "Missing frame payload for detection." },
    });
    return;
  }

  try {
    const results = handLandmarker.detectForVideo(frame, timestamp);
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
    // 释放 ImageBitmap / VideoFrame，避免内存泄漏
    if (typeof frame.close === "function") {
      frame.close();
    }
  }
}

// ==================== 手势解析 ====================

/**
 * 从 MediaPipe 检测结果中解析高级手势：
 * - 左右手捏合（拇指与食指靠近）
 * - 双手食指交叉（X 手势）
 *
 * 同时维护捏合状态机与冷却计时，保证输出稳定。
 *
 * @param {Object} results - MediaPipe detectForVideo 的返回结果
 * @param {number} [now=performance.now()] - 当前时间戳
 * @returns {Object} 手势状态对象，包含 leftPinch / rightPinch / xGesture 等字段
 */
function parseGestures(results, now = performance.now()) {
  const landmarks = results.landmarks || [];
  const handedness = results.handedness || [];

  // 将 landmarks 与 handedness 按手配对，方便后续按左右手查找
  const hands = landmarks.map((lm, i) => ({
    landmarks: lm,
    handedness: handedness[i]?.[0]?.categoryName || "Unknown",
    score: handedness[i]?.[0]?.score || 0,
  }));

  // 注意：MediaPipe 的 handedness 基于镜像视角，"Right" 对应用户的左手，"Left" 对应用户的右手
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

  // ----- 左手捏合检测（控制增益） -----
  if (leftHand && now > cooldowns.leftPinch) {
    const pinchDist = getPinchDistance(leftHand.landmarks);
    const wasPinching = pinchState.left;
    const isPinching = updatePinchState("left", pinchDist);
    if (isPinching) {
      gestures.leftPinch = true;
      const center = getPinchCenter(leftHand.landmarks);
      gestures.leftPinchPos = smoothPinch("left", center);
      cooldowns.leftPinch = now + COOLDOWN_MS;
    } else if (!isPinching && wasPinching) {
      // 从捏合状态松开，清除缓存
      pinchPos.left = null;
    }
  } else {
    pinchState.left = false;
    pinchPos.left = null;
  }

  // ----- 右手捏合检测（控制位置） -----
  if (rightHand && now > cooldowns.rightPinch) {
    const pinchDist = getPinchDistance(rightHand.landmarks);
    const wasPinching = pinchState.right;
    const isPinching = updatePinchState("right", pinchDist);
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

  // ----- 双手 X 手势检测（禁用链） -----
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

// ==================== 几何与状态辅助函数 ====================

/**
 * 计算拇指指尖（landmark 4）与食指指尖（landmark 8）的欧几里得距离。
 * @param {Array<{x:number, y:number}>} landmarks - 单手的 21 个关键点
 * @returns {number} 归一化距离
 */
function getPinchDistance(landmarks) {
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const dx = thumbTip.x - indexTip.x;
  const dy = thumbTip.y - indexTip.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 计算捏合中心点（拇指与食指指尖的中点）。
 * @param {Array<{x:number, y:number}>} landmarks - 单手的 21 个关键点
 * @returns {{x:number, y:number}} 中心坐标
 */
function getPinchCenter(landmarks) {
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  return {
    x: (thumbTip.x + indexTip.x) / 2,
    y: (thumbTip.y + indexTip.y) / 2,
  };
}

/**
 * 更新捏合状态机，采用迟滞阈值避免在临界值附近抖动。
 * @param {"left"|"right"} hand - 手别名
 * @param {number} distance - 当前拇指与食指距离
 * @returns {boolean} 当前是否处于捏合状态
 */
function updatePinchState(hand, distance) {
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

/**
 * 检测双手食指是否交叉形成 "X" 手势。
 * 通过判断两只手的食指指尖（8）与近端指间关节（6）所在线段是否相交实现。
 * @param {Array<{landmarks:Array, handedness:string}>} hands - 手部数组
 * @returns {{x:number, y:number}|null} 若检测到则返回交叉中心点，否则返回 null
 */
function detectXGesture(hands) {
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

/**
 * 判断两条线段是否严格相交（不包含端点接触）。
 * 使用二维叉积符号法（orientation test）。
 * @param {{x:number,y:number}} a1 - 线段 A 起点
 * @param {{x:number,y:number}} a2 - 线段 A 终点
 * @param {{x:number,y:number}} b1 - 线段 B 起点
 * @param {{x:number,y:number}} b2 - 线段 B 终点
 * @returns {boolean}
 */
function segmentsIntersect(a1, a2, b1, b2) {
  const cross = (p, q, r) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * 对捏合位置进行一阶低通平滑，减少检测抖动带来的视觉跳动。
 * @param {"left"|"right"} hand - 手别名
 * @param {{x:number,y:number}} pos - 当前检测到的原始位置
 * @returns {{x:number,y:number}} 平滑后的位置
 */
function smoothPinch(hand, pos) {
  const prev = pinchPos[hand];
  if (!prev) {
    pinchPos[hand] = { x: pos.x, y: pos.y };
    return pos;
  }
  prev.x = pinchSmoothAlpha * pos.x + (1 - pinchSmoothAlpha) * prev.x;
  prev.y = pinchSmoothAlpha * pos.y + (1 - pinchSmoothAlpha) * prev.y;
  return { x: prev.x, y: prev.y };
}

// ==================== 生命周期 ====================

/** 重置所有状态变量（冷却计时、捏合状态、捏合位置）。 */
function resetState() {
  cooldowns.leftPinch = 0;
  cooldowns.rightPinch = 0;
  cooldowns.xGesture = 0;
  pinchPos.left = null;
  pinchPos.right = null;
  pinchState.left = false;
  pinchState.right = false;
}

/**
 * 释放 HandLandmarker 实例并通知主线程。
 * 关闭后 Worker 仍存活，可重新执行 init。
 */
function dispose() {
  if (handLandmarker) {
    handLandmarker.close();
    handLandmarker = null;
  }
  initialized = false;
  resetState();
  self.postMessage({ type: "disposed" });
}
