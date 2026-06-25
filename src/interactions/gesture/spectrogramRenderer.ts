/**
 * SpectrogramRenderer - renders a real-time scrolling spectrogram
 * inspired by Chrome Music Lab's Spectrogram.
 *
 * Each frame, FFT frequency data is drawn as a vertical column of
 * colored pixels on the right edge of the canvas, then shifted left.
 */

interface AnalyserLike {
  getValue(): Float32Array;
}

export class SpectrogramRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private analyser: AnalyserLike | null = null;
  private imageData: ImageData | null = null;
  private width: number = 0;
  private height: number = 0;
  private disposed: boolean = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  setAnalyser(analyser: AnalyserLike): void {
    this.analyser = analyser;
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.imageData = this.ctx.createImageData(this.width, this.height);
    // Pre-fill with dark blue background
    const data = this.imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 8;
      data[i + 1] = 16;
      data[i + 2] = 40;
      data[i + 3] = 255;
    }
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  render(): void {
    if (this.disposed || !this.analyser || !this.imageData) return;

    if (this.width !== this.imageData.width || this.height !== this.imageData.height) {
      this.imageData = this.ctx.createImageData(this.width, this.height);
      const data = this.imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 8;
        data[i + 1] = 16;
        data[i + 2] = 40;
        data[i + 3] = 255;
      }
    }

    const freqData = this.analyser.getValue();
    const bins = freqData.length;

    const data = this.imageData.data;

    // Shift existing pixels one column left
    for (let y = 0; y < this.height; y++) {
      const row = y * this.width * 4;
      for (let x = 1; x < this.width; x++) {
        const srcIdx = row + x * 4;
        const dstIdx = row + (x - 1) * 4;
        data[dstIdx] = data[srcIdx];
        data[dstIdx + 1] = data[srcIdx + 1];
        data[dstIdx + 2] = data[srcIdx + 2];
        data[dstIdx + 3] = 255;
      }
    }

    // Draw new frequency column on the right edge (logarithmic frequency scale)
    const drawX = this.width - 1;
    const logMin = Math.log10(20);
    const logMax = Math.log10(22050);
    const logRange = logMax - logMin;
    for (let i = 0; i < this.height; i++) {
      const t = 1 - i / (this.height - 1 || 1);
      const freq = 10 ** (logMin + t * logRange);
      const binIndex = Math.min(bins - 1, Math.max(0, Math.floor((freq / 22050) * bins)));
      const db = Math.max(-100, Math.min(0, freqData[binIndex]));
      const amp = (db + 100) / 100; // normalize to 0..1

      const [r, g, b] = this.amplitudeToColor(amp);

      const idx = (i * this.width + drawX) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }

    this.ctx.putImageData(this.imageData, 0, 0);
  }

  private amplitudeToColor(amp: number): [number, number, number] {
    if (amp <= 0.01) return [8, 16, 40];
    if (amp <= 0.15) {
      const t = (amp - 0.01) / 0.14;
      return [0, Math.round(20 + 40 * t), Math.round(60 + 195 * t)];
    }
    if (amp <= 0.35) {
      const t = (amp - 0.15) / 0.2;
      return [0, Math.round(60 + 195 * t), 255];
    }
    if (amp <= 0.55) {
      const t = (amp - 0.35) / 0.2;
      return [Math.round(100 * t), 255, Math.round(255 * (1 - t))];
    }
    if (amp <= 0.75) {
      const t = (amp - 0.55) / 0.2;
      return [Math.round(100 + 155 * t), 255, Math.round(60 * t)];
    }
    const t = (amp - 0.75) / 0.25;
    return [255, Math.round(255 * (1 - t)), Math.round(60 + 195 * t)];
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  dispose(): void {
    this.disposed = true;
    this.analyser = null;
    this.imageData = null;
  }
}
