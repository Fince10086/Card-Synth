export function findAutocorrelationPeak(waveform, minPeriod = 32, maxPeriod = 512) {
  const n = waveform.length;
  const searchMin = Math.max(1, minPeriod);
  const searchMax = Math.min(n / 2, maxPeriod);

  let bestCorrelation = -Infinity;
  let bestOffset = 0;

  for (let lag = searchMin; lag < searchMax; lag++) {
    let correlation = 0;
    for (let i = 0; i < n - lag; i++) {
      correlation += waveform[i] * waveform[i + lag];
    }
    correlation /= n - lag;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = lag;
    }
  }

  return bestOffset;
}

export function resizeScopeCanvas(canvas, context) {
  if (!canvas || !context) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function drawOscilloscope({
  canvas,
  context,
  getAnalyserFn,
  audioBooted,
  scopeZoom,
}) {
  requestAnimationFrame(() => drawOscilloscope({ canvas, context, getAnalyserFn, audioBooted, scopeZoom }));

  if (!canvas || !context) {
    return;
  }
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#f5f7fb";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "rgba(42, 36, 27, 0.08)";
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += width / 12) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y <= height; y += height / 6) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.strokeStyle = "rgba(61, 127, 184, 0.22)";
  context.beginPath();
  context.moveTo(0, height / 2);
  context.lineTo(width, height / 2);
  context.stroke();

  const analyser = getAnalyserFn();
  if (!analyser || !audioBooted) {
    context.fillStyle = "rgba(114, 103, 87, 0.78)";
    context.font = '500 14px "IBM Plex Sans"';
    context.fillText("点击任意位置启动音频", 24, height / 2 + 5);
    return;
  }

  const waveform = analyser.getValue();
  const zoomH = scopeZoom.horizontal;
  const zoomV = scopeZoom.vertical;

  const period = findAutocorrelationPeak(waveform);
  const startOffset = period > 0 ? period : 0;

  const samplesPerScreen = Math.floor(waveform.length / zoomH);
  const visibleSamples = Math.min(samplesPerScreen, waveform.length - startOffset);

  context.strokeStyle = "#2e8ea7";
  context.lineWidth = Math.max(1.5, 2.5 / zoomH);
  context.beginPath();

  for (let i = 0; i < visibleSamples; i++) {
    const sampleIndex = (startOffset + i) % waveform.length;
    const x = (i / (visibleSamples - 1)) * width;
    const sample = waveform[sampleIndex];
    const y = height * 0.5 + sample * height * 0.4 * zoomV;
    if (i === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();
}
