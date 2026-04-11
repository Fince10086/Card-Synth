export function createSampleDataUrl({ mode = "pluck", frequency = 220, duration = 0.28, sampleRate = 11025 } = {}) {
  const frameCount = Math.max(1, Math.floor(duration * sampleRate));
  const bytesPerSample = 2;
  const dataSize = frameCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let seed = 173;
  for (let index = 0; index < frameCount; index += 1) {
    const t = index / sampleRate;
    const progress = index / frameCount;
    const decay = Math.exp(-4.5 * progress);
    let sample = 0;

    if (mode === "bell") {
      sample =
        Math.sin(Math.PI * 2 * frequency * t) * 0.56
        + Math.sin(Math.PI * 2 * frequency * 2.73 * t) * 0.24
        + Math.sin(Math.PI * 2 * frequency * 4.19 * t) * 0.12;
      sample *= Math.exp(-3.2 * progress);
    } else if (mode === "texture") {
      seed = (seed * 16807) % 2147483647;
      const noise = (seed / 2147483647) * 2 - 1;
      sample =
        Math.sin(Math.PI * 2 * frequency * 0.5 * t) * 0.22
        + Math.sin(Math.PI * 2 * frequency * 1.5 * t) * 0.1
        + noise * 0.24;
      sample *= Math.exp(-2.4 * progress);
    } else {
      sample =
        Math.sin(Math.PI * 2 * frequency * t)
        + Math.sin(Math.PI * 2 * frequency * 2 * t) * 0.38
        + Math.sin(Math.PI * 2 * frequency * 3.4 * t) * 0.18;
      sample *= decay;
    }

    const clamped = Math.max(-1, Math.min(1, sample * 0.72));
    view.setInt16(44 + index * 2, Math.round(clamped * 32767), true);
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read audio file."));
    reader.readAsDataURL(file);
  });
}

export const DEFAULT_SAMPLE_LIBRARY = {
  pluck: createSampleDataUrl({ mode: "pluck", frequency: 196, duration: 0.24 }),
  bell: createSampleDataUrl({ mode: "bell", frequency: 440, duration: 0.62 }),
  texture: createSampleDataUrl({ mode: "texture", frequency: 140, duration: 0.46 }),
};
