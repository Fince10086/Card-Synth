/**
 * Audio transport scheduler - 使用 Tone.js Transport 精确调度音频事件
 * 替代 setTimeout，确保与 Web Audio clock 同步
 */

import * as Tone from "tone";

/**
 * 音频资源生命周期管理器
 * 统一处理：Transport 调度、Timeout 管理、资源释放
 *
 * 注意：Tone.Draw 不支持按 ID 取消单个事件，
 * 因此 UI 更新建议在 Transport 回调中通过 Tone.Draw.schedule 触发
 */
export class AudioResourceManager {
  private transportEvents = new Map<string, number>();
  private timeouts = new Map<string, number>();
  private disposables: Array<() => void> = [];
  private isDisposed = false;

  /**
   * 使用 Tone Transport 调度未来事件（音频线程）
   * 与 Web Audio clock 精确同步
   */
  schedule(
    key: string,
    delaySeconds: number,
    callback: (time: number) => void
  ): void {
    if (this.isDisposed) return;
    this.clear(key);

    const eventId = Tone.Transport.scheduleOnce((time) => {
      this.transportEvents.delete(key);
      callback(time);
    }, `+${delaySeconds}`);

    this.transportEvents.set(key, eventId);
  }

  /**
   * 调度一次性事件，返回取消函数
   */
  scheduleOnce(
    delaySeconds: number,
    callback: (time: number) => void
  ): () => void {
    if (this.isDisposed) return () => {};

    const eventId = Tone.Transport.scheduleOnce((time) => {
      callback(time);
    }, `+${delaySeconds}`);

    return () => {
      Tone.Transport.clear(eventId);
    };
  }

  /**
   * 回退：使用 setTimeout 调度非音频事件（如重建信号链）
   * 这些操作不需要与音频时钟同步
   */
  setTimeout(
    key: string,
    delayMs: number,
    callback: () => void
  ): void {
    if (this.isDisposed) return;
    this.clearTimeout(key);

    const id = window.setTimeout(() => {
      this.timeouts.delete(key);
      callback();
    }, delayMs);

    this.timeouts.set(key, id);
  }

  /**
   * 清除指定 key 的所有调度
   */
  clear(key: string): void {
    const transportId = this.transportEvents.get(key);
    if (transportId !== undefined) {
      Tone.Transport.clear(transportId);
      this.transportEvents.delete(key);
    }

    this.clearTimeout(key);
  }

  private clearTimeout(key: string): void {
    const timeoutId = this.timeouts.get(key);
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      this.timeouts.delete(key);
    }
  }

  /**
   * 注册可释放资源
   */
  addDisposable(disposeFn: () => void): void {
    if (this.isDisposed) {
      disposeFn();
      return;
    }
    this.disposables.push(disposeFn);
  }

  /**
   * 释放所有资源并清理所有调度
   */
  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    // 清理 Transport 事件
    this.transportEvents.forEach((id) => {
      Tone.Transport.clear(id);
    });
    this.transportEvents.clear();

    // 清理 timeouts
    this.timeouts.forEach((id) => {
      clearTimeout(id);
    });
    this.timeouts.clear();

    // 释放注册的资源
    this.disposables.forEach((fn) => {
      try {
        fn();
      } catch {
        // 忽略释放失败
      }
    });
    this.disposables = [];
  }
}

/**
 * 为每个 source runtime 创建独立的资源管理器
 */
export function createAudioResourceManager(): AudioResourceManager {
  return new AudioResourceManager();
}
