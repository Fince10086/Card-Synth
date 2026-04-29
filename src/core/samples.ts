/**
 * Audio sample utilities
 */

export interface SampleDataUrlOptions {
  mode?: string;
  frequency?: number;
  duration?: number;
  sampleRate?: number;
}

export function createSampleDataUrl({
  mode = "pluck",
  frequency = 220,
  duration = 0.28,
  sampleRate = 11025,
}: SampleDataUrlOptions = {}): string {
  const frameCount = Math.max(1, Math.floor(duration * sampleRate));
  const bytesPerSample = 2;
  const dataSize = frameCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string): void => {
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

  let binary = "";
  const bytes = new Uint8Array(buffer);
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read audio file."));
    reader.readAsDataURL(file);
  });
}

export interface SampleLibrary {
  pluck: string;
}

export const DEFAULT_SAMPLE_LIBRARY: SampleLibrary = {
  pluck: createSampleDataUrl({ mode: "pluck", frequency: 196, duration: 0.24 }),
};
