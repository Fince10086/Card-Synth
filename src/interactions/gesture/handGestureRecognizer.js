/**
 * @fileoverview handGestureRecognizer.js
 * 手势识别主控类，负责封装 Web Worker 通信、摄像头管理以及视频帧检测循环。
 * 作为 gestureManager 与 handLandmarker.worker 之间的桥梁，将 MediaPipe 检测结果
 * 通过回调传递给上层业务逻辑。
 */

import visionBundleUrl from "@mediapipe/tasks-vision?url";

/** WASM 文件在 CDN 上的路径 */
const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";
/** 通过 Vite 构建获取的 tasks-vision 库 URL */
const VISION_LIBRARY_URL = visionBundleUrl;
/** HandLandmarker 模型文件的 CDN 路径（float16 轻量化版本） */
const MODEL_ASSET_PATH =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class HandGestureRecognizer {
  constructor() {
    // ==================== Worker 相关 ====================
    /** @type {Worker|null} Web Worker 实例 */
    this.worker = null;
    /** Worker 是否已完成初始化并就绪 */
    this.workerReady = false;
    /** 初始化过程的 Promise，用于防止重复初始化 */
    this.initializingPromise = null;
    /** 初始化成功的 resolve 句柄 */
    this.resolveInit = null;
    /** 初始化失败的 reject 句柄 */
    this.rejectInit = null;

    // ==================== 摄像头相关 ====================
    /** @type {HTMLVideoElement|null} 视频元素，用于接收摄像头流 */
    this.video = null;
    /** @type {MediaStream|null} 摄像头媒体流 */
    this.stream = null;
    /** 检测循环是否正在运行 */
    this.running = false;
    /** requestAnimationFrame 返回的帧 ID */
    this.detectRaf = 0;
    /** 上一帧视频的 currentTime，用于判断是否有新帧 */
    this.lastVideoTime = -1;

    // ==================== 回调与状态 ====================
    /** 当 Worker 返回检测结果时的回调函数 ({landmarks, handedness, gestures}) => void */
    this.onResults = null;
    /** 标记当前是否有推理请求正在等待 Worker 返回，防止单帧重复投递 */
    this.inferencePending = false;

    /**
     * 处理 Worker 发来的 message 事件。
     * 根据消息类型分发：ready / result / error。
     */
    this.handleWorkerMessage = (event) => {
      const message = event.data || {};

      if (message.type === "ready") {
        this.workerReady = true;
        this.initializingPromise = null;
        const usedDelegate = message.payload?.delegate || "CPU";
        console.info(`[HandGestureRecognizer] Initialized with ${usedDelegate} delegate.`);
        if (this.resolveInit) {
          this.resolveInit();
          this.resolveInit = null;
          this.rejectInit = null;
        }
        return;
      }

      if (message.type === "result") {
        this.inferencePending = false;
        if (this.onResults) {
          this.onResults(message.payload || { landmarks: [], handedness: [], gestures: null });
        }
        return;
      }

      if (message.type === "error") {
        this.inferencePending = false;
        const workerError = new Error(message.payload?.message || "Worker inference failed.");
        if (this.rejectInit) {
          this.rejectInit(workerError);
          this.resolveInit = null;
          this.rejectInit = null;
          this.initializingPromise = null;
          return;
        }
        console.error("Gesture worker error:", workerError);
      }
    };

    /**
     * 处理 Worker 未捕获的 error 事件（如脚本加载失败、运行时崩溃）。
     * 若正处于初始化阶段，则将错误传递给初始化 Promise；否则输出到控制台。
     */
    this.handleWorkerError = (event) => {
      this.inferencePending = false;
      this.workerReady = false;
      const workerError =
        event?.error instanceof Error
          ? event.error
          : new Error(event?.message || "Unknown worker error.");

      if (this.rejectInit) {
        this.rejectInit(workerError);
        this.resolveInit = null;
        this.rejectInit = null;
        this.initializingPromise = null;
        return;
      }

      console.error("Gesture worker crashed:", workerError);
    };
  }

  // ==================== 初始化 ====================

  /**
   * 初始化 HandGestureRecognizer。
   * 创建 Web Worker 并向其发送 init 消息，等待 Worker 加载模型并返回 ready。
   * 若已初始化则直接返回，支持并发调用时复用同一个 Promise。
   *
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.workerReady && this.worker) {
      return;
    }

    // 避免并发重复初始化：若已有初始化中的 Promise，直接返回
    if (this.initializingPromise) {
      return this.initializingPromise;
    }

    if (typeof Worker === "undefined") {
      throw new Error("Current browser does not support Web Worker.");
    }

    if (!this.worker) {
      this.worker = new Worker(new URL("./handLandmarker.worker.js", import.meta.url));
      this.worker.addEventListener("message", this.handleWorkerMessage);
      this.worker.addEventListener("error", this.handleWorkerError);
    }

    this.initializingPromise = new Promise((resolve, reject) => {
      this.resolveInit = resolve;
      this.rejectInit = reject;
      this.worker.postMessage({
        type: "init",
        payload: {
          libraryUrl: VISION_LIBRARY_URL,
          wasmPath: WASM_PATH,
          modelAssetPath: MODEL_ASSET_PATH,
          preferredDelegate: "GPU",
        },
      });
    });

    return this.initializingPromise;
  }

  // ==================== 摄像头管理 ====================

  /**
   * 请求用户摄像头权限并开始预览。
   * 限制分辨率为 960×540、帧率 30fps，使用前置摄像头。
   * 视频流挂载到隐藏的 video 元素上，不直接显示在 DOM 中。
   *
   * @returns {Promise<void>}
   */
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

  /**
   * 停止摄像头采集并清理相关资源。
   * 同时中断正在进行的 detect RAF 循环。
   */
  stopCamera() {
    this.running = false;
    this.inferencePending = false;
    this.lastVideoTime = -1;

    if (this.detectRaf) {
      cancelAnimationFrame(this.detectRaf);
      this.detectRaf = 0;
    }

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

  // ==================== 检测循环 ====================

  /**
   * 启动视频帧检测循环。
   * 通过 requestAnimationFrame 持续检查 video 是否有新帧，
   * 若有则将当前帧转为 ImageBitmap 并 Transfer 给 Worker 进行推理。
   * 使用 inferencePending 保证同一时间仅有一帧在推理中。
   */
  startDetection() {
    if (!this.workerReady || !this.worker) {
      return;
    }

    this.running = true;

    const detect = async () => {
      if (!this.running || !this.video || !this.workerReady || !this.worker) {
        this.detectRaf = 0;
        return;
      }

      // 仅在 video 推进到新帧、且无未完成的推理请求时才投递
      if (
        this.video.currentTime !== this.lastVideoTime &&
        !this.inferencePending &&
        this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        this.lastVideoTime = this.video.currentTime;

        try {
          this.inferencePending = true;
          const frame = await createImageBitmap(this.video);

          // 创建 ImageBitmap 后若已停止，则直接释放避免泄漏
          if (!this.running || !this.worker) {
            frame.close();
            this.inferencePending = false;
          } else {
            // 将 ImageBitmap Transfer 给 Worker，实现零拷贝传输
            this.worker.postMessage(
              {
                type: "detect",
                payload: {
                  frame,
                  timestamp: performance.now(),
                },
              },
              [frame]
            );
          }
        } catch (error) {
          this.inferencePending = false;
          console.error("Failed to transfer video frame to gesture worker:", error);
        }
      }

      this.detectRaf = requestAnimationFrame(detect);
    };
    this.detectRaf = requestAnimationFrame(detect);
  }

  // ==================== 销毁 ====================

  /**
   * 彻底释放所有资源：停止摄像头、向 Worker 发送 dispose、终止 Worker。
   * 调用后实例不可再用，需重新 new HandGestureRecognizer()。
   */
  dispose() {
    this.stopCamera();
    if (this.worker) {
      this.worker.removeEventListener("message", this.handleWorkerMessage);
      this.worker.removeEventListener("error", this.handleWorkerError);

      try {
        this.worker.postMessage({ type: "dispose" });
      } catch (error) {
        console.warn("Failed to dispose gesture worker cleanly:", error);
      }

      this.worker.terminate();
      this.worker = null;
    }

    this.workerReady = false;
    this.initializingPromise = null;
    this.resolveInit = null;
    this.rejectInit = null;
  }
}
