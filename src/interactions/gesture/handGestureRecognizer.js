import visionBundleUrl from "@mediapipe/tasks-vision?url";

const WASM_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";
const VISION_LIBRARY_URL = visionBundleUrl;
const MODEL_ASSET_PATH =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export class HandGestureRecognizer {
  constructor() {
    this.worker = null;
    this.workerReady = false;
    this.initializingPromise = null;
    this.resolveInit = null;
    this.rejectInit = null;

    this.video = null;
    this.stream = null;
    this.running = false;
    this.detectRaf = 0;
    this.lastVideoTime = -1;
    this.onResults = null;
    this.inferencePending = false;

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

  async initialize() {
    if (this.workerReady && this.worker) {
      return;
    }

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

      if (
        this.video.currentTime !== this.lastVideoTime &&
        !this.inferencePending &&
        this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        this.lastVideoTime = this.video.currentTime;

        try {
          this.inferencePending = true;
          const frame = await createImageBitmap(this.video);

          if (!this.running || !this.worker) {
            frame.close();
            this.inferencePending = false;
          } else {
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
