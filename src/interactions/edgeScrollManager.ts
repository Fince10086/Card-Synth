/**
 * EdgeScrollManager - auto-scroll during drag operations
 */

export class EdgeScrollManager {
  isScrolling: boolean;
  scrollSpeed: number;
  animationFrame: number;
  edgeThreshold: number;
  maxScrollSpeed: number;

  constructor() {
    this.isScrolling = false;
    this.scrollSpeed = 0;
    this.animationFrame = 0;
    this.edgeThreshold = 80;
    this.maxScrollSpeed = 15;
  }

  update(event: PointerEvent): void {
    const viewportHeight = window.innerHeight;
    const clientY = event.clientY;

    const distanceFromTop = clientY;
    const distanceFromBottom = viewportHeight - clientY;

    let targetSpeed = 0;

    if (distanceFromTop < this.edgeThreshold) {
      const ratio = 1 - distanceFromTop / this.edgeThreshold;
      targetSpeed = -this.maxScrollSpeed * ratio;
    } else if (distanceFromBottom < this.edgeThreshold) {
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

  startScrolling(): void {
    const scroll = () => {
      if (!this.isScrolling) return;
      window.scrollBy(0, this.scrollSpeed);
      this.animationFrame = requestAnimationFrame(scroll);
    };
    this.animationFrame = requestAnimationFrame(scroll);
  }

  stopScrolling(): void {
    this.isScrolling = false;
    this.scrollSpeed = 0;
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
  }
}
