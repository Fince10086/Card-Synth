/**
 * EdgeScrollManager - 拖动边缘自动滚动管理器
 * 当拖动操作靠近视口边缘时，自动滚动页面
 */
export class EdgeScrollManager {
  constructor() {
    this.isScrolling = false;
    this.scrollSpeed = 0;
    this.animationFrame = 0;
    this.edgeThreshold = 80; // 边缘触发阈值（像素）
    this.maxScrollSpeed = 15; // 最大滚动速度
  }

  /**
   * 根据指针位置更新滚动
   * @param {PointerEvent} event - 指针事件
   */
  update(event) {
    const viewportHeight = window.innerHeight;
    const clientY = event.clientY;

    // 计算距离顶部和底部的距离
    const distanceFromTop = clientY;
    const distanceFromBottom = viewportHeight - clientY;

    let targetSpeed = 0;

    if (distanceFromTop < this.edgeThreshold) {
      // 靠近顶部，向上滚动（负值）
      const ratio = 1 - distanceFromTop / this.edgeThreshold;
      targetSpeed = -this.maxScrollSpeed * ratio;
    } else if (distanceFromBottom < this.edgeThreshold) {
      // 靠近底部，向下滚动（正值）
      const ratio = 1 - distanceFromBottom / this.edgeThreshold;
      targetSpeed = this.maxScrollSpeed * ratio;
    }

    if (targetSpeed !== 0) {
      this.scrollSpeed = targetSpeed;
      if (!this.isScrolling) {
        this.isScrolling = true;
        this.startScrolling();
      }
    } else {
      this.stopScrolling();
    }
  }

  /**
   * 开始滚动动画
   */
  startScrolling() {
    const scroll = () => {
      if (!this.isScrolling) return;
      window.scrollBy(0, this.scrollSpeed);
      this.animationFrame = requestAnimationFrame(scroll);
    };
    this.animationFrame = requestAnimationFrame(scroll);
  }

  /**
   * 停止滚动
   */
  stopScrolling() {
    this.isScrolling = false;
    this.scrollSpeed = 0;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
  }
}
