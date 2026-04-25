let currentAnimationId = null;
let currentMode = null;
let canvasMetrics = { width: 0, height: 0 };
let cachedMainColor = null;

function getMainColor() {
  if (cachedMainColor) return cachedMainColor;
  const style = getComputedStyle(document.documentElement);
  cachedMainColor = style.getPropertyValue("--main").trim() || "#4b0082";
  return cachedMainColor;
}

export function resizeScopeCanvas(canvas, context) {
  if (!canvas || !context) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  const computedStyle = getComputedStyle(canvas);
  const borderLeft = parseFloat(computedStyle.borderLeftWidth) || 0;
  const borderRight = parseFloat(computedStyle.borderRightWidth) || 0;
  const borderTop = parseFloat(computedStyle.borderTopWidth) || 0;
  const borderBottom = parseFloat(computedStyle.borderBottomWidth) || 0;

  const width = rect.width - borderLeft - borderRight;
  const height = rect.height - borderTop - borderBottom;

  if (width <= 0 || height <= 0) {
    return;
  }

  canvasMetrics = { width, height };
  cachedMainColor = null; // 窗口变化时刷新颜色缓存

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function startScopeRendering({
  getCanvasFn,
  getContextFn,
  getAnalyserFn,
  getSpectrumAnalyserFn,
  getAudioBootedFn,
  getModeFn,
}) {
  stopScopeRendering();

  function render() {
    currentAnimationId = requestAnimationFrame(render);

    const canvas = getCanvasFn();
    const context = getContextFn();
    const mode = getModeFn();
    currentMode = mode;

    if (!canvas || !context) {
      return;
    }

    const { width, height } = canvasMetrics;
    if (width <= 0 || height <= 0) {
      return;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);

    const analyser = getAnalyserFn();
    const audioBooted = getAudioBootedFn();

    if (!analyser || !audioBooted) {
      return;
    }

    if (mode === "spectrum") {
      const spectrumAnalyser = getSpectrumAnalyserFn ? getSpectrumAnalyserFn() : null;
      renderSpectrum(canvas, context, width, height, analyser, spectrumAnalyser);
    } else {
      renderOscilloscope(canvas, context, width, height, analyser);
    }
  }

  render();
}

function renderOscilloscope(canvas, context, width, height, analyser) {
  const waveform = analyser.getValue();
  if (!waveform || waveform.length === 0) {
    return;
  }

  const bufferLength = waveform.length;
  const scale = 4.0;

  let triggerIndex = 0;

  for (let i = 1; i < bufferLength / 2; i++) {
    if (waveform[i - 1] < 0 && waveform[i] >= 0) {
      triggerIndex = i;
      break;
    }
  }

  const validLength = bufferLength - triggerIndex;
  if (validLength <= 0) {
    return;
  }

  context.lineWidth = 1.5;
  context.strokeStyle = getMainColor();
  context.beginPath();

  const sliceWidth = width / validLength;
  let x = 0;

  for (let i = triggerIndex; i < bufferLength; i++) {
    const v = waveform[i] * scale;
    const y = (0.5 - v / 2) * height;

    if (i === triggerIndex) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
    x += sliceWidth;
    if (x > width) break;
  }

  context.stroke();
}

function renderSpectrum(canvas, context, width, height, analyser, spectrumAnalyser) {
  if (spectrumAnalyser) {
    const fftData = spectrumAnalyser.getValue();
    if (!fftData || fftData.length === 0) {
      return;
    }

    const bufferLength = fftData.length;
    const sampleRate = analyser.context.sampleRate || 44100;
    const nyquist = sampleRate / 2;
    const targetFreq = 12000;

    const binsToRender = Math.floor((targetFreq / nyquist) * bufferLength);
    const safeBinsToRender = Math.min(bufferLength, Math.max(1, binsToRender));

    const binWidth = width / safeBinsToRender;
    const gap = binWidth > 2 ? 1 : 0;
    const barWidth = Math.max(0.5, binWidth - gap);

    for (let i = 0; i < safeBinsToRender; i++) {
      const db = fftData[i];
      if (typeof db === "number" && !isNaN(db)) {
        const normalized = Math.min(Math.max((db + 100) / 100, 0), 1);
        if (normalized > 0.01) {
          const barHeight = normalized * height;
          const x = i * binWidth;
          const y = height - barHeight;

          context.fillStyle = getMainColor();
          context.fillRect(x, y, barWidth, barHeight);
        }
      }
    }
  } else {
    const waveform = analyser.getValue();
    if (!waveform || waveform.length === 0) {
      return;
    }

    const bufferLength = waveform.length;
    const binWidth = width / bufferLength;
    const barWidth = Math.max(0.5, binWidth - (binWidth > 2 ? 1 : 0));

    for (let i = 0; i < bufferLength; i++) {
      const value = Math.abs(waveform[i]);
      if (value > 0.01) {
        const barHeight = value * height * 0.8;
        const x = i * binWidth;
        const y = height - barHeight;

        context.fillStyle = getMainColor();
        context.fillRect(x, y, barWidth, barWidth);
      }
    }
  }
}

export function stopScopeRendering() {
  if (currentAnimationId !== null) {
    cancelAnimationFrame(currentAnimationId);
    currentAnimationId = null;
  }
}

export function getCurrentMode() {
  return currentMode;
}
