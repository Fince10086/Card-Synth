export function resizeScopeCanvas(canvas, context) {
  if (!canvas || !context) {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;

  if (rect.width === 0 || rect.height === 0) {
    return;
  }

  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function drawOscilloscope({
  canvas,
  context,
  getAnalyserFn,
  getAudioBootedFn,
}) {
  requestAnimationFrame(() => drawOscilloscope({ canvas, context, getAnalyserFn, getAudioBootedFn }));

  if (!canvas || !context) {
    return;
  }

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (width === 0 || height === 0) {
    return;
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  const analyser = getAnalyserFn();
  const audioBooted = getAudioBootedFn();

  if (!analyser || !audioBooted) {
    return;
  }

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
  context.strokeStyle = "#4B0082";
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
