const Tone = window.Tone || null;

/* -------------------------------------------------------------------------- */
/* Module library and preset templates                                         */
/*                                                                            */
/* 这一段定义了整个应用可被实例化的“模块清单”。                               */
/* 每个 definition 都尽量直接兼容 Tone.js 的构造参数结构，                    */
/* 这样导出的 JSON 可以较容易复用到别的 Tone.js 项目中。                      */
/* -------------------------------------------------------------------------- */

// 12 平均律音名表，用于把键盘偏移量映射成真实音名。
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// 虚拟键盘布局描述：
// key 是电脑键盘按键，offset 是相对当前八度的半音偏移，
// whiteIndex 用于计算白键/黑键的可视位置。
const KEYBOARD_LAYOUT = [
  { key: "a", offset: 0, whiteIndex: 0, black: false },
  { key: "w", offset: 1, whiteIndex: 0, black: true },
  { key: "s", offset: 2, whiteIndex: 1, black: false },
  { key: "e", offset: 3, whiteIndex: 1, black: true },
  { key: "d", offset: 4, whiteIndex: 2, black: false },
  { key: "f", offset: 5, whiteIndex: 3, black: false },
  { key: "t", offset: 6, whiteIndex: 3, black: true },
  { key: "g", offset: 7, whiteIndex: 4, black: false },
  { key: "y", offset: 8, whiteIndex: 4, black: true },
  { key: "h", offset: 9, whiteIndex: 5, black: false },
  { key: "u", offset: 10, whiteIndex: 5, black: true },
  { key: "j", offset: 11, whiteIndex: 6, black: false },
  { key: "k", offset: 12, whiteIndex: 7, black: false },
];

// 在多个模块间复用的波形选项，避免重复定义。
const SHARED_WAVE_OPTIONS = [
  { label: "Sine", value: "sine" },
  { label: "Triangle", value: "triangle" },
  { label: "Saw", value: "sawtooth" },
  { label: "Square", value: "square" },
];

const NOISE_TYPE_OPTIONS = [
  { label: "White", value: "white" },
  { label: "Pink", value: "pink" },
  { label: "Brown", value: "brown" },
];

const ROOT_NOTE_OPTIONS = Array.from({ length: 6 * 12 }, (_, index) => {
  const octave = 1 + Math.floor(index / 12);
  const note = `${NOTE_NAMES[index % 12]}${octave}`;
  return { label: note, value: note };
});

function createSampleDataUrl({ mode = "pluck", frequency = 220, duration = 0.28, sampleRate = 11025 } = {}) {
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read audio file."));
    reader.readAsDataURL(file);
  });
}

const DEFAULT_SAMPLE_LIBRARY = {
  pluck: createSampleDataUrl({ mode: "pluck", frequency: 196, duration: 0.24 }),
  bell: createSampleDataUrl({ mode: "bell", frequency: 440, duration: 0.62 }),
  texture: createSampleDataUrl({ mode: "texture", frequency: 140, duration: 0.46 }),
};

// 声源库：
// runtime 用来描述当前 source 在 AudioEngine 中该如何实例化和触发。
// controls 只负责 UI 层暴露哪些参数，不直接参与 Tone.js 节点创建。
const SOURCE_LIBRARY = {
  AMOscillator: {
    accent: "source",
    tag: "Osc",
    runtime: "pitchedSource",
    voiceClass: "AMOscillator",
    options: { type: "sawtooth", modulationType: "square", harmonicity: 1.5, detune: 0, phase: 0 },
    ampEnvelope: { attack: 0.01, decay: 0.12, sustain: 0.84, release: 0.6 },
    controls: [
      { path: "options.type", kind: "select", label: "Carrier", options: SHARED_WAVE_OPTIONS },
      { path: "options.modulationType", kind: "select", label: "Mod Wave", options: SHARED_WAVE_OPTIONS },
      { path: "options.harmonicity", kind: "range", label: "Ratio", min: 0.25, max: 8, step: 0.01, formatter: formatRatio },
      { path: "options.phase", kind: "range", label: "Phase", min: 0, max: 360, step: 1, formatter: (value) => `${Math.round(value)}deg` },
      { path: "options.detune", kind: "range", label: "Detune", min: -1200, max: 1200, step: 1, formatter: formatCents },
    ],
  },
  FMOscillator: {
    accent: "source",
    tag: "Osc",
    runtime: "pitchedSource",
    voiceClass: "FMOscillator",
    options: { type: "sine", modulationType: "triangle", harmonicity: 1.8, modulationIndex: 4, detune: 0 },
    ampEnvelope: { attack: 0.01, decay: 0.16, sustain: 0.78, release: 0.7 },
    controls: [
      { path: "options.type", kind: "select", label: "Carrier", options: SHARED_WAVE_OPTIONS },
      { path: "options.modulationType", kind: "select", label: "Mod Wave", options: SHARED_WAVE_OPTIONS },
      { path: "options.harmonicity", kind: "range", label: "Ratio", min: 0.25, max: 8, step: 0.01, formatter: formatRatio },
      { path: "options.modulationIndex", kind: "range", label: "Index", min: 0, max: 40, step: 0.1, formatter: formatPlain },
      { path: "options.phase", kind: "range", label: "Phase", min: 0, max: 360, step: 1, formatter: (value) => `${Math.round(value)}deg` },
      { path: "options.detune", kind: "range", label: "Detune", min: -1200, max: 1200, step: 1, formatter: formatCents },
    ],
  },
  FatOscillator: {
    accent: "source",
    tag: "Osc",
    runtime: "pitchedSource",
    voiceClass: "FatOscillator",
    options: { type: "sawtooth", spread: 24, count: 3, detune: 0, phase: 0 },
    ampEnvelope: { attack: 0.01, decay: 0.14, sustain: 0.8, release: 0.7 },
    controls: [
      { path: "options.type", kind: "select", label: "Wave", options: SHARED_WAVE_OPTIONS },
      { path: "options.spread", kind: "range", label: "Spread", min: 0, max: 60, step: 1, formatter: (value) => `${Math.round(value)}deg` },
      { path: "options.count", kind: "range", label: "Count", min: 1, max: 6, step: 1, formatter: formatPlain },
      { path: "options.phase", kind: "range", label: "Phase", min: 0, max: 360, step: 1, formatter: (value) => `${Math.round(value)}deg` },
      { path: "options.detune", kind: "range", label: "Detune", min: -1200, max: 1200, step: 1, formatter: formatCents },
    ],
  },
  GrainPlayer: {
    accent: "source",
    tag: "Osc",
    runtime: "grainPlayer",
    voiceClass: "GrainPlayer",
    moduleDefaults: { rootNote: "C4", assetName: "Factory Texture" },
    options: { url: DEFAULT_SAMPLE_LIBRARY.texture, grainSize: 0.18, overlap: 0.08, playbackRate: 1, detune: 0, loop: true, reverse: false },
    ampEnvelope: { attack: 0.02, decay: 0.12, sustain: 0.86, release: 0.8 },
    controls: [
      { path: "rootNote", kind: "select", label: "Root", options: ROOT_NOTE_OPTIONS },
      { path: "options.grainSize", kind: "range", label: "Grain", min: 0.01, max: 0.5, step: 0.001, formatter: formatSeconds },
      { path: "options.overlap", kind: "range", label: "Overlap", min: 0.005, max: 0.3, step: 0.001, formatter: formatSeconds },
      { path: "options.playbackRate", kind: "range", label: "Rate", min: 0.2, max: 3, step: 0.01, formatter: formatMultiplier },
      { path: "options.detune", kind: "range", label: "Detune", min: -1200, max: 1200, step: 1, formatter: formatCents },
      { path: "options.loop", kind: "toggle", label: "Loop" },
      { path: "options.reverse", kind: "toggle", label: "Reverse" },
    ],
  },
  Noise: {
    accent: "source",
    tag: "Osc",
    runtime: "noise",
    voiceClass: "Noise",
    options: { type: "pink", playbackRate: 1 },
    ampEnvelope: { attack: 0.01, decay: 0.08, sustain: 0.32, release: 0.45 },
    controls: [
      { path: "options.type", kind: "select", label: "Color", options: NOISE_TYPE_OPTIONS },
      { path: "options.playbackRate", kind: "range", label: "Rate", min: 0.2, max: 4, step: 0.01, formatter: formatMultiplier },
      { path: "ampEnvelope.attack", kind: "range", label: "Attack", min: 0.001, max: 1, step: 0.001, formatter: formatSeconds },
      { path: "ampEnvelope.decay", kind: "range", label: "Decay", min: 0.001, max: 2, step: 0.001, formatter: formatSeconds },
      { path: "ampEnvelope.sustain", kind: "range", label: "Sustain", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "ampEnvelope.release", kind: "range", label: "Release", min: 0.01, max: 2, step: 0.01, formatter: formatSeconds },
    ],
  },
  Oscillator: {
    accent: "source",
    tag: "Osc",
    runtime: "pitchedSource",
    voiceClass: "Oscillator",
    options: { type: "sawtooth", detune: 0, phase: 0 },
    ampEnvelope: { attack: 0.01, decay: 0.14, sustain: 0.84, release: 0.6 },
    controls: [
      { path: "options.type", kind: "select", label: "Wave", options: SHARED_WAVE_OPTIONS },
      { path: "options.phase", kind: "range", label: "Phase", min: 0, max: 360, step: 1, formatter: (value) => `${Math.round(value)}deg` },
      { path: "options.detune", kind: "range", label: "Detune", min: -1200, max: 1200, step: 1, formatter: formatCents },
      { path: "ampEnvelope.attack", kind: "range", label: "Attack", min: 0.001, max: 1.5, step: 0.001, formatter: formatSeconds },
      { path: "ampEnvelope.decay", kind: "range", label: "Decay", min: 0.001, max: 2, step: 0.001, formatter: formatSeconds },
      { path: "ampEnvelope.sustain", kind: "range", label: "Sustain", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "ampEnvelope.release", kind: "range", label: "Release", min: 0.05, max: 4, step: 0.01, formatter: formatSeconds },
    ],
  },
  PWMOscillator: {
    accent: "source",
    tag: "Osc",
    runtime: "pitchedSource",
    voiceClass: "PWMOscillator",
    options: { modulationFrequency: 0.5, detune: 0, phase: 0 },
    ampEnvelope: { attack: 0.01, decay: 0.12, sustain: 0.82, release: 0.65 },
    controls: [
      { path: "options.modulationFrequency", kind: "range", label: "PWM Rate", min: 0.05, max: 24, step: 0.01, formatter: formatHertz },
      { path: "options.phase", kind: "range", label: "Phase", min: 0, max: 360, step: 1, formatter: (value) => `${Math.round(value)}deg` },
      { path: "options.detune", kind: "range", label: "Detune", min: -1200, max: 1200, step: 1, formatter: formatCents },
      { path: "ampEnvelope.attack", kind: "range", label: "Attack", min: 0.001, max: 1.5, step: 0.001, formatter: formatSeconds },
      { path: "ampEnvelope.release", kind: "range", label: "Release", min: 0.05, max: 4, step: 0.01, formatter: formatSeconds },
    ],
  },
  Player: {
    accent: "source",
    tag: "Osc",
    runtime: "player",
    voiceClass: "Player",
    moduleDefaults: { rootNote: "C4", assetName: "Factory Pluck" },
    options: { url: DEFAULT_SAMPLE_LIBRARY.pluck, playbackRate: 1, loop: false, reverse: false, fadeIn: 0.005, fadeOut: 0.08, loopStart: 0, loopEnd: 0 },
    controls: [
      { path: "rootNote", kind: "select", label: "Root", options: ROOT_NOTE_OPTIONS },
      { path: "options.playbackRate", kind: "range", label: "Rate", min: 0.2, max: 3, step: 0.01, formatter: formatMultiplier },
      { path: "options.fadeIn", kind: "range", label: "Fade In", min: 0, max: 0.2, step: 0.001, formatter: formatSeconds },
      { path: "options.fadeOut", kind: "range", label: "Fade Out", min: 0.01, max: 0.6, step: 0.001, formatter: formatSeconds },
      { path: "options.loopStart", kind: "range", label: "Loop In", min: 0, max: 12, step: 0.01, formatter: formatSeconds },
      { path: "options.loopEnd", kind: "range", label: "Loop Out", min: 0, max: 12, step: 0.01, formatter: formatSeconds },
      { path: "options.loop", kind: "toggle", label: "Loop" },
      { path: "options.reverse", kind: "toggle", label: "Reverse" },
    ],
  },
  Players: {
    accent: "source",
    tag: "Osc",
    runtime: "players",
    voiceClass: "Players",
    moduleDefaults: {
      rootNote: "C4",
      sampleNames: {
        low: "Factory Pluck",
        mid: "Factory Bell",
        high: "Factory Texture",
      },
    },
    options: {
      urls: {
        low: DEFAULT_SAMPLE_LIBRARY.pluck,
        mid: DEFAULT_SAMPLE_LIBRARY.bell,
        high: DEFAULT_SAMPLE_LIBRARY.texture,
      },
      playbackRate: 1,
      loop: false,
      reverse: false,
      fadeIn: 0.005,
      fadeOut: 0.08,
    },
    controls: [
      { path: "rootNote", kind: "select", label: "Root", options: ROOT_NOTE_OPTIONS },
      { path: "options.playbackRate", kind: "range", label: "Rate", min: 0.2, max: 3, step: 0.01, formatter: formatMultiplier },
      { path: "options.fadeIn", kind: "range", label: "Fade In", min: 0, max: 0.2, step: 0.001, formatter: formatSeconds },
      { path: "options.fadeOut", kind: "range", label: "Fade Out", min: 0.01, max: 0.6, step: 0.001, formatter: formatSeconds },
      { path: "options.loop", kind: "toggle", label: "Loop" },
      { path: "options.reverse", kind: "toggle", label: "Reverse" },
    ],
  },
  PulseOscillator: {
    accent: "source",
    tag: "Osc",
    runtime: "pitchedSource",
    voiceClass: "PulseOscillator",
    options: { width: 0.22, detune: 0, phase: 0 },
    ampEnvelope: { attack: 0.01, decay: 0.12, sustain: 0.8, release: 0.62 },
    controls: [
      { path: "options.width", kind: "range", label: "Width", min: 0.01, max: 0.99, step: 0.001, formatter: formatPercent },
      { path: "options.phase", kind: "range", label: "Phase", min: 0, max: 360, step: 1, formatter: (value) => `${Math.round(value)}deg` },
      { path: "options.detune", kind: "range", label: "Detune", min: -1200, max: 1200, step: 1, formatter: formatCents },
      { path: "ampEnvelope.attack", kind: "range", label: "Attack", min: 0.001, max: 1.5, step: 0.001, formatter: formatSeconds },
      { path: "ampEnvelope.release", kind: "range", label: "Release", min: 0.05, max: 4, step: 0.01, formatter: formatSeconds },
    ],
  },
  MembraneSynth: {
    accent: "source",
    tag: "Osc",
    runtime: "monoTrigger",
    voiceClass: "MembraneSynth",
    options: {
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 },
      pitchDecay: 0.08,
      octaves: 6.4,
    },
    controls: [
      { path: "options.oscillator.type", kind: "select", label: "Wave", options: SHARED_WAVE_OPTIONS },
      { path: "options.envelope.attack", kind: "range", label: "Attack", min: 0.001, max: 1.5, step: 0.001, formatter: formatSeconds },
      { path: "options.envelope.decay", kind: "range", label: "Decay", min: 0.001, max: 2, step: 0.001, formatter: formatSeconds },
      { path: "options.envelope.sustain", kind: "range", label: "Sustain", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.pitchDecay", kind: "range", label: "Pitch Dec", min: 0.001, max: 0.6, step: 0.001, formatter: formatSeconds },
      { path: "options.octaves", kind: "range", label: "Octaves", min: 1, max: 10, step: 0.1, formatter: formatPlain },
      { path: "options.envelope.release", kind: "range", label: "Release", min: 0.05, max: 4, step: 0.01, formatter: formatSeconds },
    ],
  },
  MetalSynth: {
    accent: "source",
    tag: "Osc",
    runtime: "monoTrigger",
    voiceClass: "MetalSynth",
    options: {
      envelope: { attack: 0.001, decay: 0.28, release: 0.4 },
      harmonicity: 4.2,
      modulationIndex: 18,
      octaves: 1.5,
      resonance: 2800,
    },
    controls: [
      { path: "options.harmonicity", kind: "range", label: "Ratio", min: 0.5, max: 8, step: 0.01, formatter: formatRatio },
      { path: "options.modulationIndex", kind: "range", label: "Index", min: 1, max: 60, step: 0.1, formatter: formatPlain },
      { path: "options.octaves", kind: "range", label: "Octaves", min: 0.5, max: 4, step: 0.1, formatter: formatPlain },
      { path: "options.resonance", kind: "range", label: "Resonance", min: 50, max: 8000, step: 1, formatter: formatFrequency },
      { path: "options.envelope.attack", kind: "range", label: "Attack", min: 0.001, max: 1.5, step: 0.001, formatter: formatSeconds },
      { path: "options.envelope.decay", kind: "range", label: "Decay", min: 0.02, max: 2, step: 0.01, formatter: formatSeconds },
      { path: "options.envelope.release", kind: "range", label: "Release", min: 0.01, max: 2, step: 0.01, formatter: formatSeconds },
    ],
  },
};

// 效果器库：效果器与 component 一样都会被串到主信号链上。
const EFFECT_LIBRARY = {
  Chorus: {
    accent: "fx",
    tag: "Effect",
    options: { frequency: 1.2, delayTime: 2.2, depth: 0.48, spread: 180, wet: 0.42 },
    controls: [
      { path: "options.frequency", kind: "range", label: "Rate", min: 0.1, max: 12, step: 0.1, formatter: formatHertz },
      { path: "options.depth", kind: "range", label: "Depth", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  FeedbackDelay: {
    accent: "fx",
    tag: "Effect",
    options: { delayTime: 0.25, feedback: 0.28, wet: 0.25 },
    controls: [
      { path: "options.delayTime", kind: "range", label: "Delay", min: 0.01, max: 0.9, step: 0.01, formatter: formatSeconds },
      { path: "options.feedback", kind: "range", label: "Feedback", min: 0, max: 0.95, step: 0.01, formatter: formatPercent },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  PingPongDelay: {
    accent: "fx",
    tag: "Effect",
    options: { delayTime: 0.32, feedback: 0.24, wet: 0.24 },
    controls: [
      { path: "options.delayTime", kind: "range", label: "Delay", min: 0.01, max: 0.9, step: 0.01, formatter: formatSeconds },
      { path: "options.feedback", kind: "range", label: "Feedback", min: 0, max: 0.95, step: 0.01, formatter: formatPercent },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  Reverb: {
    accent: "fx",
    tag: "Effect",
    options: { decay: 3.2, preDelay: 0.02, wet: 0.28 },
    controls: [
      { path: "options.decay", kind: "range", label: "Decay", min: 0.3, max: 12, step: 0.1, formatter: formatSeconds },
      { path: "options.preDelay", kind: "range", label: "Pre", min: 0, max: 0.25, step: 0.001, formatter: formatSeconds },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  Distortion: {
    accent: "fx",
    tag: "Effect",
    options: { distortion: 0.22, wet: 0.16 },
    controls: [
      { path: "options.distortion", kind: "range", label: "Drive", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  Phaser: {
    accent: "fx",
    tag: "Effect",
    options: { frequency: 0.5, octaves: 3, baseFrequency: 350, wet: 0.26 },
    controls: [
      { path: "options.frequency", kind: "range", label: "Rate", min: 0.05, max: 12, step: 0.05, formatter: formatHertz },
      { path: "options.octaves", kind: "range", label: "Span", min: 0.5, max: 6, step: 0.1, formatter: formatPlain },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  BitCrusher: {
    accent: "fx",
    tag: "Effect",
    options: { bits: 4, wet: 0.14 },
    controls: [
      { path: "options.bits", kind: "range", label: "Bits", min: 1, max: 8, step: 1, formatter: (value) => `${Math.round(value)} bit` },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  AutoFilter: {
    accent: "fx",
    tag: "Effect",
    options: { frequency: 1.2, depth: 0.72, baseFrequency: 240, wet: 0.34 },
    controls: [
      { path: "options.frequency", kind: "range", label: "Rate", min: 0.05, max: 12, step: 0.05, formatter: formatHertz },
      { path: "options.depth", kind: "range", label: "Depth", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  Tremolo: {
    accent: "fx",
    tag: "Effect",
    options: { frequency: 6.4, depth: 0.48, spread: 180, wet: 0.2 },
    controls: [
      { path: "options.frequency", kind: "range", label: "Rate", min: 0.1, max: 18, step: 0.1, formatter: formatHertz },
      { path: "options.depth", kind: "range", label: "Depth", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
};

// 组件库：相较于 effect，更偏工具型或增益结构型节点。
const COMPONENT_LIBRARY = {
  Compressor: {
    accent: "component",
    tag: "Component",
    options: { threshold: -24, ratio: 3, attack: 0.01, release: 0.2, knee: 20 },
    controls: [
      { path: "options.threshold", kind: "range", label: "Thresh", min: -60, max: 0, step: 0.1, formatter: formatDb },
      { path: "options.ratio", kind: "range", label: "Ratio", min: 1, max: 20, step: 0.1, formatter: formatPlain },
      { path: "options.attack", kind: "range", label: "Attack", min: 0.001, max: 0.5, step: 0.001, formatter: formatSeconds },
      { path: "options.release", kind: "range", label: "Release", min: 0.01, max: 1, step: 0.001, formatter: formatSeconds },
    ],
  },
  Limiter: {
    accent: "component",
    tag: "Component",
    options: { threshold: -5 },
    controls: [{ path: "options.threshold", kind: "range", label: "Ceiling", min: -24, max: 0, step: 0.1, formatter: formatDb }],
  },
  EQ3: {
    accent: "component",
    tag: "Component",
    options: { low: 0, mid: 0, high: 0, lowFrequency: 300, highFrequency: 2600 },
    controls: [
      { path: "options.low", kind: "range", label: "Low", min: -24, max: 24, step: 0.1, formatter: formatDb },
      { path: "options.mid", kind: "range", label: "Mid", min: -24, max: 24, step: 0.1, formatter: formatDb },
      { path: "options.high", kind: "range", label: "High", min: -24, max: 24, step: 0.1, formatter: formatDb },
      { path: "options.lowFrequency", kind: "range", label: "Lo Freq", min: 80, max: 1200, step: 1, formatter: formatFrequency },
      { path: "options.highFrequency", kind: "range", label: "Hi Freq", min: 1200, max: 8000, step: 1, formatter: formatFrequency },
    ],
  },
  Gain: {
    accent: "component",
    tag: "Component",
    options: { gain: 1 },
    controls: [{ path: "options.gain", kind: "range", label: "Gain", min: 0, max: 2, step: 0.01, formatter: formatMultiplier }],
  },
  PanVol: {
    accent: "component",
    tag: "Component",
    options: { pan: 0, volume: 0 },
    controls: [
      { path: "options.pan", kind: "range", label: "Pan", min: -1, max: 1, step: 0.01, formatter: (value) => `${value > 0 ? "R" : value < 0 ? "L" : "C"} ${Math.round(Math.abs(value) * 100)}` },
      { path: "options.volume", kind: "range", label: "Volume", min: -24, max: 12, step: 0.1, formatter: formatDb },
    ],
  },
};

// 当前 UI 提供的滤波器类型列表，同时也是 Filter 模块下拉菜单的数据源。
const FILTER_TYPES = [
  { label: "Low-pass", value: "lowpass" },
  { label: "Band-pass", value: "bandpass" },
  { label: "High-pass", value: "highpass" },
  { label: "Notch", value: "notch" },
];

// 内置预设模板。
// 这些模板先作为纯配置对象存在，真正使用时会经过 normalizePreset 标准化。
const BUILTIN_PRESET_TEMPLATES = {
  init: {
    name: "Init Patch",
    global: { volume: -8, octave: 4, velocity: 0.8 },
    filter: { type: "lowpass", frequency: 2200, Q: 0.6, rolloff: -24 },
    envelope: { attack: 0.02, decay: 0.18, sustain: 0.82, release: 0.65 },
    lfo: { enabled: true, type: "sine", frequency: 2.1, amount: 0.35, target: "filter.frequency" },
    sources: [
      {
        type: "Oscillator",
        enabled: true,
        volume: -9,
        pan: -0.12,
        options: {
          type: "sawtooth",
          detune: -8,
        },
        ampEnvelope: { attack: 0.01, decay: 0.14, sustain: 0.7, release: 0.8 },
      },
      {
        type: "FatOscillator",
        enabled: true,
        volume: -14,
        pan: 0.12,
        options: { type: "triangle", count: 3, spread: 18, detune: 6 },
        ampEnvelope: { attack: 0.02, decay: 0.12, sustain: 0.62, release: 0.9 },
      },
    ],
    components: [{ type: "Compressor", enabled: true, options: { threshold: -18, ratio: 2.6, attack: 0.01, release: 0.22, knee: 20 } }],
    effects: [
      { type: "Chorus", enabled: true, options: { frequency: 1.4, delayTime: 2.4, depth: 0.5, spread: 180, wet: 0.32 } },
      { type: "Reverb", enabled: true, options: { decay: 3.8, preDelay: 0.02, wet: 0.2 } },
    ],
  },
  fmBell: {
    name: "FM Bell Stack",
    global: { volume: -10, octave: 5, velocity: 0.76 },
    filter: { type: "bandpass", frequency: 1900, Q: 1.8, rolloff: -24 },
    envelope: { attack: 0.01, decay: 0.32, sustain: 0.56, release: 1.7 },
    lfo: { enabled: true, type: "triangle", frequency: 4.8, amount: 0.22, target: "filter.frequency" },
    sources: [
      {
        type: "FMOscillator",
        enabled: true,
        volume: -6,
        pan: -0.18,
        options: {
          type: "sine",
          modulationType: "square",
          harmonicity: 2.3,
          modulationIndex: 18,
        },
        ampEnvelope: { attack: 0.005, decay: 0.28, sustain: 0.34, release: 2.2 },
      },
      {
        type: "AMOscillator",
        enabled: true,
        volume: -12,
        pan: 0.22,
        options: {
          harmonicity: 1.2,
          type: "triangle",
          modulationType: "sine",
        },
        ampEnvelope: { attack: 0.02, decay: 0.1, sustain: 0.62, release: 1.4 },
      },
    ],
    components: [
      { type: "Compressor", enabled: true, options: { threshold: -26, ratio: 3.4, attack: 0.008, release: 0.16, knee: 18 } },
      { type: "EQ3", enabled: true, options: { low: -2, mid: 1.8, high: 3.2, lowFrequency: 260, highFrequency: 2400 } },
    ],
    effects: [
      { type: "PingPongDelay", enabled: true, options: { delayTime: 0.34, feedback: 0.31, wet: 0.22 } },
      { type: "Phaser", enabled: true, options: { frequency: 0.6, octaves: 2.8, baseFrequency: 360, wet: 0.24 } },
      { type: "Reverb", enabled: true, options: { decay: 7.4, preDelay: 0.03, wet: 0.34 } },
    ],
  },
  cinematicDust: {
    name: "Cinematic Dust",
    global: { volume: -11, octave: 3, velocity: 0.72 },
    filter: { type: "lowpass", frequency: 1450, Q: 0.92, rolloff: -48 },
    envelope: { attack: 0.14, decay: 0.48, sustain: 0.7, release: 2.6 },
    lfo: { enabled: true, type: "sine", frequency: 0.42, amount: 0.58, target: "filter.frequency" },
    sources: [
      {
        type: "AMOscillator",
        enabled: true,
        volume: -8,
        pan: -0.22,
        options: {
          type: "triangle",
          modulationType: "sine",
          harmonicity: 0.75,
        },
        ampEnvelope: { attack: 0.22, decay: 0.2, sustain: 0.92, release: 2.8 },
      },
      {
        type: "Noise",
        enabled: true,
        volume: -18,
        pan: 0.24,
        options: { type: "pink", playbackRate: 0.86 },
        ampEnvelope: { attack: 0.12, decay: 0.1, sustain: 0.3, release: 1.6 },
      },
    ],
    components: [
      { type: "Gain", enabled: true, options: { gain: 1.08 } },
      { type: "EQ3", enabled: true, options: { low: 2.4, mid: -0.8, high: -2.8, lowFrequency: 240, highFrequency: 2100 } },
    ],
    effects: [
      { type: "AutoFilter", enabled: true, options: { frequency: 0.34, depth: 0.45, baseFrequency: 160, wet: 0.32 } },
      { type: "Chorus", enabled: true, options: { frequency: 0.6, delayTime: 2.1, depth: 0.58, spread: 180, wet: 0.24 } },
      { type: "Reverb", enabled: true, options: { decay: 8.2, preDelay: 0.04, wet: 0.36 } },
    ],
  },
  percussionLab: {
    name: "Percussion Lab",
    global: { volume: -9, octave: 2, velocity: 0.86 },
    filter: { type: "highpass", frequency: 520, Q: 0.84, rolloff: -24 },
    envelope: { attack: 0.001, decay: 0.22, sustain: 0.34, release: 0.32 },
    lfo: { enabled: true, type: "square", frequency: 6, amount: 0.14, target: "filter.Q" },
    sources: [
      {
        type: "MembraneSynth",
        enabled: true,
        volume: -5,
        pan: -0.12,
        options: {
          oscillator: { type: "sine" },
          pitchDecay: 0.06,
          octaves: 8.2,
          envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 1.2 },
        },
      },
      {
        type: "Noise",
        enabled: true,
        volume: -12,
        pan: 0.18,
        options: {
          type: "brown",
          playbackRate: 1,
        },
        ampEnvelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.16 },
      },
      {
        type: "MetalSynth",
        enabled: true,
        volume: -15,
        pan: 0.05,
        options: {
          harmonicity: 5.2,
          modulationIndex: 24,
          resonance: 3400,
          envelope: { attack: 0.001, decay: 0.22, release: 0.22 },
        },
      },
    ],
    components: [
      { type: "Limiter", enabled: true, options: { threshold: -6 } },
      { type: "PanVol", enabled: true, options: { pan: 0, volume: 0 } },
    ],
    effects: [
      { type: "BitCrusher", enabled: true, options: { bits: 4, wet: 0.18 } },
      { type: "FeedbackDelay", enabled: true, options: { delayTime: 0.16, feedback: 0.24, wet: 0.14 } },
      { type: "Distortion", enabled: true, options: { distortion: 0.2, wet: 0.11 } },
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

let moduleCounter = 1;

// 生成稳定的前端模块 id，供渲染、连线和状态同步共同使用。
function createId(prefix) {
  const id = `${prefix}-${String(moduleCounter).padStart(4, "0")}`;
  moduleCounter += 1;
  return id;
}

// 深拷贝只用于可 JSON 化的数据结构，避免直接共享对象引用。
function deepClone(value) {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

// 判断是否为普通对象，供 deepMerge / setByPath 使用。
function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

// 深合并用于把用户导入的 preset 补成完整结构，同时保留已有字段。
function deepMerge(base, override) {
  if (override === undefined) {
    return deepClone(base);
  }
  if (base === undefined) {
    return deepClone(override);
  }
  if (Array.isArray(base) || Array.isArray(override)) {
    return deepClone(override);
  }
  if (isObject(base) && isObject(override)) {
    const result = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(override)]);
    keys.forEach((key) => {
      if (override[key] === undefined) {
        result[key] = deepClone(base[key]);
      } else if (base[key] === undefined) {
        result[key] = deepClone(override[key]);
      } else {
        result[key] = deepMerge(base[key], override[key]);
      }
    });
    return result;
  }
  return deepClone(override);
}

// 数值钳制工具，避免 UI 和调制系统把参数推到非法范围之外。
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// 通过 "a.b.c" 的路径读取深层字段。
function getByPath(object, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), object);
}

// 通过路径写入深层字段，如果中间层不存在则自动补对象。
function setByPath(object, path, value) {
  const parts = path.split(".");
  let ref = object;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      ref[part] = value;
      return;
    }
    if (!isObject(ref[part])) {
      ref[part] = {};
    }
    ref = ref[part];
  });
}

// 根据基础八度和键位偏移，生成 Tone.js 可识别的音名。
function noteFromOffset(baseOctave, offset) {
  const pitchClass = NOTE_NAMES[offset % 12];
  const octaveShift = Math.floor(offset / 12);
  return `${pitchClass}${baseOctave + octaveShift}`;
}

// 下列 formatter 统一负责把原始数值格式化成 UI 读数。
function formatPlain(value) {
  return Number(value).toFixed(Math.abs(value) < 10 ? 2 : 1).replace(/\.0+$/, "");
}

function formatSeconds(value) {
  return `${Number(value).toFixed(value < 0.1 ? 3 : value < 1 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, "")}s`;
}

function formatPercent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

function formatDb(value) {
  return `${Number(value).toFixed(1)} dB`;
}

function formatCents(value) {
  return `${Math.round(value)} ct`;
}

function formatRatio(value) {
  return `${Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}:1`;
}

function formatHertz(value) {
  return `${Number(value).toFixed(value < 1 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, "")} Hz`;
}

function formatFrequency(value) {
  if (value >= 1000) {
    return `${Number(value / 1000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} kHz`;
  }
  return `${Math.round(value)} Hz`;
}

function formatMultiplier(value) {
  return `${Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`;
}

// 调制目标收集器：
// 只返回当前机架里真实存在、并且允许被调制的目标。
// 这样 route 下拉菜单和拖线终点就会自动跟随当前模块结构变化。
const MODULATABLE_PARAM_CONFIG = {
  "options.harmonicity": { label: "Ratio", min: 0.25, max: 8, scale: () => 2 },
  "options.phase": { label: "Phase", min: 0, max: 360, scale: () => 90 },
  "options.detune": { label: "Detune", min: -1200, max: 1200, scale: () => 420 },
  "options.modulationIndex": { label: "Index", min: 0, max: 60, scale: () => 15 },
  "options.spread": { label: "Spread", min: 0, max: 60, scale: () => 20 },
  "options.count": { label: "Count", min: 1, max: 6, scale: () => 2 },
  "options.grainSize": { label: "Grain", min: 0.01, max: 0.5, scale: () => 0.15 },
  "options.overlap": { label: "Overlap", min: 0.005, max: 0.3, scale: () => 0.08 },
  "options.playbackRate": { label: "Rate", min: 0.2, max: 4, scale: () => 1 },
  "options.width": { label: "Width", min: 0.01, max: 0.99, scale: () => 0.3 },
  "options.modulationFrequency": { label: "PWM Rate", min: 0.05, max: 24, scale: () => 6 },
  "options.fadeIn": { label: "Fade In", min: 0, max: 0.2, scale: () => 0.05 },
  "options.fadeOut": { label: "Fade Out", min: 0.01, max: 0.6, scale: () => 0.15 },
  "options.loopStart": { label: "Loop In", min: 0, max: 12, scale: () => 3 },
  "options.loopEnd": { label: "Loop Out", min: 0, max: 12, scale: () => 3 },
  "options.pitchDecay": { label: "Pitch Dec", min: 0.001, max: 0.6, scale: () => 0.15 },
  "options.octaves": { label: "Octaves", min: 0.5, max: 10, scale: () => 2 },
  "options.resonance": { label: "Resonance", min: 50, max: 8000, scale: () => 1500 },
  "ampEnvelope.attack": { label: "Attack", min: 0.001, max: 1.5, scale: () => 0.3 },
  "ampEnvelope.decay": { label: "Decay", min: 0.001, max: 2, scale: () => 0.4 },
  "ampEnvelope.sustain": { label: "Sustain", min: 0, max: 1, scale: () => 0.3 },
  "ampEnvelope.release": { label: "Release", min: 0.01, max: 4, scale: () => 1 },
  "options.envelope.attack": { label: "Attack", min: 0.001, max: 1.5, scale: () => 0.3 },
  "options.envelope.decay": { label: "Decay", min: 0.001, max: 2, scale: () => 0.4 },
  "options.envelope.sustain": { label: "Sustain", min: 0, max: 1, scale: () => 0.3 },
  "options.envelope.release": { label: "Release", min: 0.01, max: 4, scale: () => 1 },
  "options.frequency": { label: "Rate", min: 0.05, max: 18, scale: () => 4 },
  "options.depth": { label: "Depth", min: 0, max: 1, scale: () => 0.35 },
  "options.wet": { label: "Wet", min: 0, max: 1, scale: () => 0.35 },
  "options.delayTime": { label: "Delay", min: 0.01, max: 0.9, scale: () => 0.25 },
  "options.feedback": { label: "Feedback", min: 0, max: 0.95, scale: () => 0.35 },
  "options.decay": { label: "Decay", min: 0.3, max: 12, scale: () => 3 },
  "options.preDelay": { label: "Pre", min: 0, max: 0.25, scale: () => 0.06 },
  "options.distortion": { label: "Drive", min: 0, max: 1, scale: () => 0.35 },
  "options.bits": { label: "Bits", min: 1, max: 8, scale: () => 2 },
  "options.threshold": { label: "Thresh", min: -60, max: 0, scale: () => 18 },
  "options.ratio": { label: "Ratio", min: 1, max: 20, scale: () => 6 },
  "options.attack": { label: "Attack", min: 0.001, max: 0.5, scale: () => 0.1 },
  "options.release": { label: "Release", min: 0.01, max: 1, scale: () => 0.25 },
  "options.gain": { label: "Gain", min: 0, max: 2, scale: () => 0.6 },
  "options.pan": { label: "Pan", min: -1, max: 1, scale: () => 0.5 },
  "options.volume": { label: "Volume", min: -24, max: 12, scale: () => 8 },
  "options.low": { label: "Low", min: -24, max: 24, scale: () => 8 },
  "options.mid": { label: "Mid", min: -24, max: 24, scale: () => 8 },
  "options.high": { label: "High", min: -24, max: 24, scale: () => 8 },
  "options.lowFrequency": { label: "Lo Freq", min: 80, max: 1200, scale: () => 300 },
  "options.highFrequency": { label: "Hi Freq", min: 1200, max: 8000, scale: () => 2000 },
};

function getModulationTargets(state) {
  const targets = [];

  if (state.ui?.visibleModules?.filter !== false) {
    targets.push(
      {
        label: "Filter Cutoff",
        value: "filter.frequency",
        stage: "filter",
        moduleRef: "filter-core",
        basePath: "filter.frequency",
        min: 20,
        max: 18000,
        scale: (base) => Math.max(120, base * 1.35),
      },
      {
        label: "Filter Resonance",
        value: "filter.Q",
        stage: "filter",
        moduleRef: "filter-core",
        basePath: "filter.Q",
        min: 0.001,
        max: 20,
        scale: () => 8,
      },
    );
  }

  state.sources.forEach((module, index) => {
    const labelPrefix = `${module.type} ${index + 1}`;
    targets.push(
      {
        label: `${labelPrefix} Level`,
        value: `source:${module.id}:volume`,
        stage: "sources",
        moduleRef: module.id,
        basePath: `sources.${module.id}.volume`,
        min: -36,
        max: 6,
        scale: () => 14,
      },
      {
        label: `${labelPrefix} Pan`,
        value: `source:${module.id}:pan`,
        stage: "sources",
        moduleRef: module.id,
        basePath: `sources.${module.id}.pan`,
        min: -1,
        max: 1,
        scale: () => 1,
      },
    );

    const definition = SOURCE_LIBRARY[module.type];
    if (definition?.controls) {
      definition.controls.forEach((control) => {
        if (control.kind === "range") {
          const config = MODULATABLE_PARAM_CONFIG[control.path];
          if (config) {
            const targetId = `source:${module.id}:${control.path}`;
            targets.push({
              label: `${labelPrefix} ${config.label}`,
              value: targetId,
              stage: "sources",
              moduleRef: module.id,
              basePath: `sources.${module.id}.${control.path}`,
              min: control.min,
              max: control.max,
              scale: config.scale,
            });
          }
        }
      });
    }
  });

  state.components.forEach((module, index) => {
    const labelPrefix = `${module.type} ${index + 1}`;
    const definition = COMPONENT_LIBRARY[module.type];
    if (definition?.controls) {
      definition.controls.forEach((control) => {
        if (control.kind === "range") {
          const config = MODULATABLE_PARAM_CONFIG[control.path];
          if (config) {
            const targetId = `component:${module.id}:${control.path.replace("options.", "")}`;
            targets.push({
              label: `${labelPrefix} ${config.label}`,
              value: targetId,
              stage: "components",
              moduleRef: module.id,
              basePath: `components.${module.id}.${control.path}`,
              min: control.min,
              max: control.max,
              scale: config.scale,
            });
          }
        }
      });
    }
  });

  state.effects.forEach((module, index) => {
    const labelPrefix = `${module.type} ${index + 1}`;
    const definition = EFFECT_LIBRARY[module.type];
    if (definition?.controls) {
      definition.controls.forEach((control) => {
        if (control.kind === "range") {
          const config = MODULATABLE_PARAM_CONFIG[control.path];
          if (config) {
            const targetId = `effect:${module.id}:${control.path.replace("options.", "")}`;
            targets.push({
              label: `${labelPrefix} ${config.label}`,
              value: targetId,
              stage: "effects",
              moduleRef: module.id,
              basePath: `effects.${module.id}.${control.path}`,
              min: control.min,
              max: control.max,
              scale: config.scale,
            });
          }
        }
      });
    }
  });

  return targets;
}

// 通过 id 在模块数组里查找具体实例。
function findById(list, id) {
  return list.find((entry) => entry.id === id);
}

// 以下工厂函数用于把 definition 转成真实模块实例。
// 每次新增模块、切换模块类型、或补默认值时都会调用。
function createSourceModule(type = "Oscillator") {
  const definition = SOURCE_LIBRARY[type] || SOURCE_LIBRARY.Oscillator;
  return {
    id: createId("src"),
    type,
    enabled: true,
    volume: -8,
    pan: 0,
    ...(definition.moduleDefaults ? deepClone(definition.moduleDefaults) : {}),
    options: deepClone(definition.options),
    ampEnvelope: definition.ampEnvelope ? deepClone(definition.ampEnvelope) : undefined,
  };
}

function createEffectModule(type = "Chorus") {
  const definition = EFFECT_LIBRARY[type] || EFFECT_LIBRARY.Chorus;
  return {
    id: createId("fx"),
    type,
    enabled: true,
    options: deepClone(definition.options),
  };
}

function createComponentModule(type = "Compressor") {
  const definition = COMPONENT_LIBRARY[type] || COMPONENT_LIBRARY.Compressor;
  return {
    id: createId("cmp"),
    type,
    enabled: true,
    options: deepClone(definition.options),
  };
}

function createModRoute(target = "filter.frequency", amount = 0.35) {
  return {
    id: createId("route"),
    target,
    amount,
    enabled: true,
  };
}

// 顶部 “Add Module” 下拉菜单的数据源。
// core 模块采用显隐式增删，source/component/effect 则会真正生成实例。
function getAddableModuleOptions() {
  return [
    { value: "core:filter", label: "Core / Filter" },
    { value: "core:envelope", label: "Core / Amp Envelope" },
    { value: "core:modEnvelope", label: "Core / Mod Envelope" },
    { value: "core:lfo", label: "Core / LFO" },
    ...Object.keys(SOURCE_LIBRARY).map((type) => ({
      value: `source:${type}`,
      label: `OSC / ${type}`,
    })),
    ...Object.keys(COMPONENT_LIBRARY).map((type) => ({
      value: `component:${type}`,
      label: `Component / ${type}`,
    })),
    ...Object.keys(EFFECT_LIBRARY).map((type) => ({
      value: `effect:${type}`,
      label: `Effect / ${type}`,
    })),
  ];
}

// normalize 系列函数负责把外部数据补足为当前编辑器能使用的完整格式。
function normalizeSourceModule(module) {
  const base = createSourceModule(module?.type || "Oscillator");
  const merged = deepMerge(base, module || {});
  merged.id = module?.id || base.id;
  return merged;
}

function normalizeEffectModule(module) {
  const base = createEffectModule(module?.type || "Chorus");
  const merged = deepMerge(base, module || {});
  merged.id = module?.id || base.id;
  return merged;
}

function normalizeComponentModule(module) {
  const base = createComponentModule(module?.type || "Compressor");
  const merged = deepMerge(base, module || {});
  merged.id = module?.id || base.id;
  return merged;
}

function createBasePreset() {
  return normalizePreset(BUILTIN_PRESET_TEMPLATES.init);
}

// 把任意导入预设、内置预设或半成品状态统一整形成稳定结构。
// 这是整个应用的状态入口之一，尽量保证向后兼容。
function normalizePreset(preset = {}) {
  const fallback = {
    name: "Untitled Patch",
    global: { volume: -8, octave: 4, velocity: 0.8 },
    filter: { enabled: true, type: "lowpass", frequency: 2200, Q: 0.6, rolloff: -24 },
    envelope: { enabled: true, attack: 0.02, decay: 0.18, sustain: 0.82, release: 0.65 },
    modEnvelope: { enabled: true, attack: 0.01, decay: 0.24, sustain: 0.36, release: 0.8 },
    lfo: { enabled: true, type: "sine", frequency: 2.1, amount: 1, phase: 0 },
    ui: {
      visibleModules: {
        filter: true,
        envelope: true,
        modEnvelope: true,
        lfo: true,
      },
      cableTension: 0.78,
    },
    modulation: {
      lfoRoutes: [createModRoute("filter.frequency", 0.45)],
      envelopeRoutes: [createModRoute("filter.frequency", 0.4)],
    },
    sources: [createSourceModule("Oscillator")],
    components: [createComponentModule("Compressor")],
    effects: [createEffectModule("Chorus")],
  };

  const merged = deepMerge(fallback, preset);
  const legacyLfoTarget = preset?.lfo?.target;
  const legacyLfoAmount = typeof preset?.lfo?.amount === "number" ? preset.lfo.amount : 0.35;

  merged.sources = Array.isArray(preset.sources)
    ? preset.sources.map((module) => normalizeSourceModule(module))
    : fallback.sources.map((module) => normalizeSourceModule(module));
  merged.components = Array.isArray(preset.components)
    ? preset.components.map((module) => normalizeComponentModule(module))
    : fallback.components.map((module) => normalizeComponentModule(module));
  merged.effects = Array.isArray(preset.effects)
    ? preset.effects.map((module) => normalizeEffectModule(module))
    : fallback.effects.map((module) => normalizeEffectModule(module));
  merged.modEnvelope = deepMerge(fallback.modEnvelope, preset.modEnvelope || {});
  merged.lfo = deepMerge(fallback.lfo, preset.lfo || {});
  merged.filter = deepMerge(fallback.filter, preset.filter || {});
  merged.envelope = deepMerge(fallback.envelope, preset.envelope || {});
  merged.ui = deepMerge(fallback.ui, preset.ui || {});
  merged.modulation = deepMerge(fallback.modulation, preset.modulation || {});
  merged.modulation.lfoRoutes = Array.isArray(preset?.modulation?.lfoRoutes)
    ? preset.modulation.lfoRoutes.map((route) => ({ ...createModRoute(), ...route, id: route?.id || createId("route") }))
    : legacyLfoTarget
      ? [{ ...createModRoute(legacyLfoTarget, legacyLfoAmount), enabled: merged.lfo.enabled }]
      : fallback.modulation.lfoRoutes.map((route) => ({ ...route, id: createId("route") }));
  merged.modulation.envelopeRoutes = Array.isArray(preset?.modulation?.envelopeRoutes)
    ? preset.modulation.envelopeRoutes.map((route) => ({ ...createModRoute(), ...route, id: route?.id || createId("route") }))
    : fallback.modulation.envelopeRoutes.map((route) => ({ ...route, id: createId("route") }));
  merged.global.octave = clamp(Number(merged.global.octave || 4), 1, 7);
  merged.global.velocity = clamp(Number(merged.global.velocity || 0.8), 0.1, 1);
  merged.global.volume = clamp(Number(merged.global.volume || -8), -36, 6);
  return merged;
}

// enabled 只是编辑器层的 UI 开关，不直接传给 Tone.Filter / Tone.AmplitudeEnvelope。
function getFilterAudioState(filterState = {}) {
  const { enabled, ...options } = filterState || {};
  return options;
}

function getEnvelopeAudioState(envelopeState = {}) {
  const { enabled, ...options } = envelopeState || {};
  return options;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

// 安全调用 Tone 节点的 set()，避免空对象或不支持 set 的节点报错。
function safeSet(target, options) {
  if (!target || !options) {
    return;
  }
  if (typeof target.set === "function") {
    target.set(options);
  }
}

function applyPlayerLikeOptions(player, options = {}) {
  if (!player || !options) {
    return;
  }

  [
    "playbackRate",
    "fadeIn",
    "fadeOut",
    "loopStart",
    "loopEnd",
    "grainSize",
    "overlap",
    "detune",
  ].forEach((key) => {
    if (options[key] !== undefined && key in player) {
      if (player[key] && typeof player[key] === "object" && "value" in player[key]) {
        player[key].value = options[key];
      } else {
        player[key] = options[key];
      }
    }
  });

  ["loop", "reverse", "mute"].forEach((key) => {
    if (options[key] !== undefined && key in player) {
      player[key] = Boolean(options[key]);
    }
  });
}

function applyPlayersOptions(bank, options = {}) {
  if (!bank || typeof bank.player !== "function") {
    return;
  }

  ["fadeIn", "fadeOut"].forEach((key) => {
    if (options[key] !== undefined && key in bank) {
      bank[key] = options[key];
    }
  });
  if (options.mute !== undefined && "mute" in bank) {
    bank.mute = Boolean(options.mute);
  }

  const keys = new Set(["low", "mid", "high", ...Object.keys(options.urls || {})]);
  keys.forEach((key) => {
    const player = bank.player(key);
    if (player) {
      applyPlayerLikeOptions(player, options);
    }
  });
}

// 参数平滑更新封装。
// Tone.Param 优先使用 rampTo，否则回退到直接赋值。
function rampParam(param, value, time = 0.12) {
  if (!param) {
    return;
  }
  if (typeof param.rampTo === "function") {
    param.rampTo(value, time);
  } else if ("value" in param) {
    param.value = value;
  }
}

/* -------------------------------------------------------------------------- */
/* Tone.js audio engine                                                        */
/* -------------------------------------------------------------------------- */

class AudioEngine {
  constructor() {
    // AudioEngine 只关心“如何把 state 翻译成可发声的 Tone 节点”。
    // 所有 DOM、渲染和交互状态都不应放在这里。
    this.ready = false;
    this.state = null;
    this.sourceRuntimes = new Map();
    this.componentRuntimes = new Map();
    this.effectRuntimes = new Map();
    this.activeNotes = new Set();
    this.modulationFrame = null;
    this.lfoStartTime = 0;
    this.lastModulatedTargets = new Set();
    this.modEnvelopeState = { stage: "idle", velocity: 1, attackStart: 0, attackFrom: 0, decayStart: 0, releaseStart: 0, releaseFrom: 0 };
  }

  async start(state) {
    if (this.ready) {
      return;
    }

    if (!Tone) {
      throw new Error("Tone.js is not available. Check whether the CDN script loaded successfully.");
    }

    await Tone.start();
    this.state = deepClone(state);
    this.ready = true;

    // sourceBus 是所有 source 的汇总入口；
    // filter / ampEnvelope / components / effects 会在 rebuildEffects() 中按启用状态重建串联关系。
    this.sourceBus = new Tone.Gain(1);
    this.filter = new Tone.Filter(getFilterAudioState(state.filter));
    this.ampEnvelope = new Tone.AmplitudeEnvelope(getEnvelopeAudioState(state.envelope));
    this.ampBypass = new Tone.Gain(1);
    this.masterVolume = new Tone.Volume(state.global.volume);
    this.analyser = new Tone.Analyser("waveform", 1024);
    this.lfoStartTime = Tone.now();
    this.masterVolume.toDestination();
    this.masterVolume.connect(this.analyser);

    this.rebuildEffects();
    this.rebuildSources();
    this.startModulationLoop();
  }

  // 提供给 UI 层的示波器读取入口。
  getAnalyser() {
    return this.analyser;
  }

  fullSync(state) {
    // 当预设切换、导入 JSON 或大范围结构变化时，直接做一次整链路重建。
    this.state = deepClone(state);
    if (!this.ready) {
      return;
    }

    safeSet(this.filter, getFilterAudioState(state.filter));
    safeSet(this.ampEnvelope, getEnvelopeAudioState(state.envelope));
    rampParam(this.masterVolume.volume, state.global.volume);
    this.modEnvelopeState = { stage: "idle", velocity: 1, attackStart: 0, attackFrom: 0, decayStart: 0, releaseStart: 0, releaseFrom: 0 };
    this.silenceAll();
    this.rebuildEffects();
    this.rebuildSources();
    this.applyModulationSnapshot();
  }

  updateGlobal(globalState) {
    this.state.global = deepClone(globalState);
    if (!this.ready) {
      return;
    }
    rampParam(this.masterVolume.volume, globalState.volume);
    this.applyModulationSnapshot();
  }

  // filter / envelope 的更新除了改 Tone 参数，还可能改动主链路的串接方式。
  updateFilter(filterState) {
    this.state.filter = deepClone(filterState);
    if (!this.ready) {
      return;
    }
    safeSet(this.filter, getFilterAudioState(filterState));
    this.rebuildEffects();
    this.applyModulationSnapshot();
  }

  updateEnvelope(envelopeState) {
    this.state.envelope = deepClone(envelopeState);
    if (!this.ready) {
      return;
    }
    safeSet(this.ampEnvelope, getEnvelopeAudioState(envelopeState));
    this.rebuildEffects();
  }

  updateModEnvelope(modEnvelopeState) {
    this.state.modEnvelope = deepClone(modEnvelopeState);
  }

  updateLfo(lfoState) {
    this.state.lfo = deepClone(lfoState);
    if (!this.ready) {
      return;
    }
    this.applyModulationSnapshot();
  }

  updateModulation(modulationState) {
    this.state.modulation = deepClone(modulationState);
    if (!this.ready) {
      return;
    }
    this.applyModulationSnapshot();
  }

  // source 的实例化方式差异最大，因此单独重建 source runtime 集合。
  rebuildSources() {
    if (!this.ready && !this.sourceBus) {
      return;
    }

    this.sourceRuntimes.forEach((runtime) => {
      runtime.dispose();
    });
    this.sourceRuntimes.clear();

    this.state.sources.forEach((module) => {
      const runtime = this.createSourceRuntime(module);
      this.sourceRuntimes.set(module.id, runtime);
    });
  }

  // 主信号链重建器。
  // 当前链路顺序固定为：
  // sourceBus -> (filter?) -> (ampEnvelope or bypass) -> components* -> effects* -> masterVolume
  rebuildEffects() {
    if (!this.masterVolume || !this.ampEnvelope || !this.ampBypass || !this.filter) {
      return;
    }

    this.componentRuntimes.forEach((runtime) => runtime.dispose());
    this.componentRuntimes.clear();
    this.effectRuntimes.forEach((runtime) => runtime.dispose());
    this.effectRuntimes.clear();

    this.sourceBus.disconnect();
    this.filter.disconnect();
    this.ampEnvelope.disconnect();
    this.ampBypass.disconnect();

    let cursor = this.sourceBus;
    // filter 与 amp envelope 都允许被当作“核心模块”整体移除或 bypass。
    if (this.state.filter.enabled !== false) {
      cursor.connect(this.filter);
      cursor = this.filter;
    }
    if (this.state.envelope.enabled !== false) {
      cursor.connect(this.ampEnvelope);
      cursor = this.ampEnvelope;
    } else {
      cursor.connect(this.ampBypass);
      cursor = this.ampBypass;
    }
    this.state.components.forEach((module) => {
      if (!module.enabled) {
        return;
      }

      const RuntimeCtor = Tone[module.type];
      if (!RuntimeCtor) {
        return;
      }

      const node = new RuntimeCtor(module.options);
      // 某些 Tone 节点需要 start()/generate() 才会进入可用状态，统一兼容处理。
      if (typeof node.start === "function") {
        node.start();
      }
      if (typeof node.generate === "function") {
        node.generate();
      }

      cursor.connect(node);
      cursor = node;

      this.componentRuntimes.set(module.id, {
        node,
        dispose: () => node.dispose(),
      });
    });

    this.state.effects.forEach((module) => {
      if (!module.enabled) {
        return;
      }

      const RuntimeCtor = Tone[module.type];
      if (!RuntimeCtor) {
        return;
      }

      const effectNode = new RuntimeCtor(module.options);
      if (typeof effectNode.start === "function") {
        effectNode.start();
      }
      if (typeof effectNode.generate === "function") {
        effectNode.generate();
      }

      cursor.connect(effectNode);
      cursor = effectNode;

      this.effectRuntimes.set(module.id, {
        node: effectNode,
        dispose: () => effectNode.dispose(),
      });
    });

    cursor.connect(this.masterVolume);
  }

  updateSource(module) {
    const existing = this.sourceRuntimes.get(module.id);
    this.state.sources = this.state.sources.map((entry) => (entry.id === module.id ? deepClone(module) : entry));
    if (!this.ready) {
      return;
    }

    if (!existing) {
      this.rebuildSources();
      return;
    }

    existing.apply(module);
    this.applyModulationSnapshot();
  }

  // component / effect 当前都走整段链路重建，逻辑更稳，也便于处理顺序变化。
  updateComponent(module) {
    const existing = this.componentRuntimes.get(module.id);
    this.state.components = this.state.components.map((entry) => (entry.id === module.id ? deepClone(module) : entry));
    if (!this.ready) {
      return;
    }

    if (!existing) {
      this.rebuildEffects();
      return;
    }

    this.rebuildEffects();
    this.applyModulationSnapshot();
  }

  updateEffect(module) {
    const existing = this.effectRuntimes.get(module.id);
    this.state.effects = this.state.effects.map((entry) => (entry.id === module.id ? deepClone(module) : entry));
    if (!this.ready) {
      return;
    }

    if (!existing) {
      this.rebuildEffects();
      return;
    }

    this.rebuildEffects();
    this.applyModulationSnapshot();
  }

  // 调制系统使用 requestAnimationFrame 做轻量级连续更新，
  // 以便同时驱动 LFO 和自定义的 mod envelope。
  startModulationLoop() {
    if (this.modulationFrame) {
      cancelAnimationFrame(this.modulationFrame);
    }

    const tick = () => {
      if (this.ready) {
        this.applyModulationSnapshot();
      }
      this.modulationFrame = requestAnimationFrame(tick);
    };

    this.modulationFrame = requestAnimationFrame(tick);
  }

  // 直接用数学函数生成 LFO 值，避免额外的 Tone.LFO 节点与复杂绑定管理。
  getLfoValue(time) {
    if (!this.state.lfo.enabled) {
      return 0;
    }

    const phase = ((this.state.lfo.phase || 0) / 360) * Math.PI * 2;
    const t = (time - this.lfoStartTime) * Number(this.state.lfo.frequency || 0);
    const cycle = t % 1;
    const angle = cycle * Math.PI * 2 + phase;
    const type = this.state.lfo.type || "sine";

    if (type === "triangle") {
      return 1 - 4 * Math.abs(Math.round(cycle - 0.25) - (cycle - 0.25));
    }
    if (type === "square") {
      return Math.sin(angle) >= 0 ? 1 : -1;
    }
    if (type === "sawtooth") {
      return 2 * cycle - 1;
    }
    return Math.sin(angle);
  }

  // 手写一个包络状态机给 modulation 使用。
  // 它和音量包络分离，因此不会受 Tone.AmplitudeEnvelope 内部状态限制。
  getModEnvelopeValue(time) {
    if (!this.state.modEnvelope.enabled) {
      return 0;
    }

    const envelope = this.state.modEnvelope;
    const attack = Math.max(0.0001, Number(envelope.attack || 0.0001));
    const decay = Math.max(0.0001, Number(envelope.decay || 0.0001));
    const release = Math.max(0.0001, Number(envelope.release || 0.0001));
    const peak = clamp(Number(this.modEnvelopeState.velocity || 1), 0, 1);
    const sustainLevel = clamp(Number(envelope.sustain || 0), 0, 1) * peak;

    while (true) {
      if (this.modEnvelopeState.stage === "idle") {
        return 0;
      }

      if (this.modEnvelopeState.stage === "attack") {
        const elapsed = time - this.modEnvelopeState.attackStart;
        if (elapsed < attack) {
          const progress = clamp(elapsed / attack, 0, 1);
          return this.modEnvelopeState.attackFrom + (peak - this.modEnvelopeState.attackFrom) * progress;
        }
        this.modEnvelopeState.stage = "decay";
        this.modEnvelopeState.decayStart = this.modEnvelopeState.attackStart + attack;
        continue;
      }

      if (this.modEnvelopeState.stage === "decay") {
        const elapsed = time - this.modEnvelopeState.decayStart;
        if (elapsed < decay) {
          const progress = clamp(elapsed / decay, 0, 1);
          return peak + (sustainLevel - peak) * progress;
        }
        this.modEnvelopeState.stage = "sustain";
        continue;
      }

      if (this.modEnvelopeState.stage === "sustain") {
        return sustainLevel;
      }

      if (this.modEnvelopeState.stage === "release") {
        const elapsed = time - this.modEnvelopeState.releaseStart;
        if (elapsed < release) {
          const progress = clamp(elapsed / release, 0, 1);
          return this.modEnvelopeState.releaseFrom * (1 - progress);
        }
        this.modEnvelopeState.stage = "idle";
        return 0;
      }
    }
  }

  triggerModEnvelopeAttack(velocity = 1) {
    const now = Tone.now();
    const currentValue = this.getModEnvelopeValue(now);
    this.modEnvelopeState = {
      stage: "attack",
      velocity: clamp(velocity, 0.05, 1),
      attackStart: now,
      attackFrom: currentValue,
      decayStart: now,
      releaseStart: now,
      releaseFrom: currentValue,
    };
  }

  triggerModEnvelopeRelease() {
    const now = Tone.now();
    this.modEnvelopeState = {
      ...this.modEnvelopeState,
      stage: "release",
      releaseStart: now,
      releaseFrom: this.getModEnvelopeValue(now),
    };
  }

  resolveModBinding(targetId) {
    const targets = getModulationTargets(this.state);
    const meta = targets.find((entry) => entry.value === targetId);
    if (!meta) {
      return null;
    }

    if (targetId === "filter.frequency") {
      return {
        ...meta,
        base: Number(this.state.filter.frequency),
        apply: (value) => rampParam(this.filter.frequency, value, 0.03),
      };
    }

    if (targetId === "filter.Q") {
      return {
        ...meta,
        base: Number(this.state.filter.Q),
        apply: (value) => rampParam(this.filter.Q, value, 0.03),
      };
    }

    const [group, moduleId, ...pathParts] = targetId.split(":");
    const prop = pathParts.join(":");

    if (group === "source") {
      const module = findById(this.state.sources, moduleId);
      const runtime = this.sourceRuntimes.get(moduleId);
      if (!module || !runtime) {
        return null;
      }

      if (prop === "volume") {
        return { ...meta, base: Number(module.volume), apply: (value) => rampParam(runtime.volumeNode.volume, value, 0.03) };
      }
      if (prop === "pan") {
        return { ...meta, base: Number(module.pan), apply: (value) => rampParam(runtime.panNode.pan, value, 0.03) };
      }

      const paramPath = prop;
      if (paramPath.startsWith("options.") || paramPath.startsWith("ampEnvelope.") || paramPath.startsWith("options.envelope.")) {
        const baseValue = getByPath(module, paramPath);
        if (typeof baseValue === "number") {
          const toneParam = this.resolveToneParam(runtime.node, paramPath);
          if (toneParam) {
            return { ...meta, base: Number(baseValue), apply: (value) => rampParam(toneParam, value, 0.03) };
          }
        }
      }
      return null;
    }

    if (group === "component") {
      const module = findById(this.state.components, moduleId);
      const runtime = this.componentRuntimes.get(moduleId)?.node;
      if (!module || !runtime) {
        return null;
      }

      const paramPath = `options.${prop}`;
      const baseValue = getByPath(module, paramPath);
      if (typeof baseValue === "number") {
        const toneParam = this.resolveToneParam(runtime, paramPath);
        if (toneParam) {
          return { ...meta, base: Number(baseValue), apply: (value) => rampParam(toneParam, value, 0.03) };
        }
      }
      return null;
    }

    if (group === "effect") {
      const module = findById(this.state.effects, moduleId);
      const runtime = this.effectRuntimes.get(moduleId)?.node;
      if (!module || !runtime) {
        return null;
      }

      const paramPath = `options.${prop}`;
      const baseValue = getByPath(module, paramPath);
      if (typeof baseValue === "number") {
        const toneParam = this.resolveToneParam(runtime, paramPath);
        if (toneParam) {
          return { ...meta, base: Number(baseValue), apply: (value) => rampParam(toneParam, value, 0.03) };
        }
      }
      return null;
    }

    return null;
  }

  resolveToneParam(node, path) {
    if (!node) return null;
    const parts = path.split(".");
    let current = node;
    for (let i = 0; i < parts.length; i++) {
      if (current == null) return null;
      const part = parts[i];
      if (i === parts.length - 1) {
        const param = current[part];
        if (param && typeof param.setValueAtTime === "function") {
          return param;
        }
        return null;
      }
      current = current[part];
    }
    return null;
  }

  // 每一帧把所有启用中的 route 累积成目标参数偏移，并应用到真实 Tone 节点上。
  applyModulationSnapshot() {
    if (!this.ready) {
      return;
    }

    const now = Tone.now();
    const lfoSignal = this.getLfoValue(now) * clamp(Number(this.state.lfo.amount ?? 1), 0, 1);
    const envelopeSignal = this.getModEnvelopeValue(now);
    const activeRoutes = [
      ...(this.state.modulation?.lfoRoutes || []).map((route) => ({ ...route, source: "lfo", signal: lfoSignal })),
      ...(this.state.modulation?.envelopeRoutes || []).map((route) => ({ ...route, source: "envelope", signal: envelopeSignal })),
    ].filter((route) => route.enabled !== false);

    const accumulator = new Map();
    const targetsToRefresh = new Set([...this.lastModulatedTargets, ...activeRoutes.map((route) => route.target)]);

    activeRoutes.forEach((route) => {
      const binding = this.resolveModBinding(route.target);
      if (!binding) {
        return;
      }

      const current = accumulator.get(route.target) || { binding, delta: 0 };
      current.delta += Number(route.amount || 0) * Number(route.signal || 0) * binding.scale(binding.base);
      accumulator.set(route.target, current);
    });

    targetsToRefresh.forEach((targetId) => {
      const entry = accumulator.get(targetId);
      const binding = entry?.binding || this.resolveModBinding(targetId);
      if (!binding) {
        return;
      }
      const nextValue = clamp(binding.base + (entry?.delta || 0), binding.min, binding.max);
      binding.apply(nextValue);
    });

    this.lastModulatedTargets = targetsToRefresh;
  }

  // source runtime 统一包装出：
  // apply / triggerAttack / triggerRelease / releaseAll / dispose
  // 让上层不用关心当前 source 到底是 oscillator、sample player 还是鼓合成器。
  createSourceRuntime(module) {
    const definition = SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator;
    let moduleState = deepClone(module);
    const volumeNode = new Tone.Volume(module.enabled ? module.volume : -48);
    const panNode = new Tone.Panner(module.pan);
    volumeNode.connect(panNode);
    panNode.connect(this.sourceBus);

    let node;
    let auxEnvelope = null;
    let activePlayerKey = "";

    const getNoteFrequency = (note) => Tone.Frequency(note).toFrequency();
    const getPitchRatio = (note) => {
      const root = Tone.Frequency(moduleState.rootNote || "C4").toFrequency();
      return getNoteFrequency(note) / root;
    };
    const getPlayersKey = (note) => {
      const octave = Number(String(note).replace(/[^0-9-]/g, "")) || 4;
      if (octave <= 3) {
        return "low";
      }
      if (octave >= 5) {
        return "high";
      }
      return "mid";
    };

    if (definition.runtime === "pitchedSource") {
      node = new Tone[definition.voiceClass](module.options);
      auxEnvelope = new Tone.AmplitudeEnvelope(module.ampEnvelope);
      node.connect(auxEnvelope);
      auxEnvelope.connect(volumeNode);
      node.start();
    } else if (definition.runtime === "noise") {
      node = new Tone.Noise(module.options);
      auxEnvelope = new Tone.AmplitudeEnvelope(module.ampEnvelope);
      node.connect(auxEnvelope);
      auxEnvelope.connect(volumeNode);
      node.start();
    } else if (definition.runtime === "grainPlayer") {
      node = new Tone.GrainPlayer(moduleState.options);
      auxEnvelope = new Tone.AmplitudeEnvelope(module.ampEnvelope);
      node.connect(auxEnvelope);
      auxEnvelope.connect(volumeNode);
      node.start();
    } else if (definition.runtime === "player") {
      node = new Tone.Player(moduleState.options);
      applyPlayerLikeOptions(node, moduleState.options);
      node.connect(volumeNode);
    } else if (definition.runtime === "players") {
      node = new Tone.Players(moduleState.options.urls || {});
      applyPlayersOptions(node, moduleState.options);
      node.connect(volumeNode);
    } else if (definition.runtime === "monoTrigger") {
      node = new Tone[definition.voiceClass](moduleState.options);
      node.connect(volumeNode);
    } else {
      node = new Tone.Oscillator(moduleState.options);
      auxEnvelope = new Tone.AmplitudeEnvelope(module.ampEnvelope);
      node.connect(auxEnvelope);
      auxEnvelope.connect(volumeNode);
      node.start();
    }

    return {
      type: definition.runtime,
      node,
      volumeNode,
      panNode,
      auxEnvelope,
      apply: (nextModule) => {
        moduleState = deepClone(nextModule);
        // enabled=false 不销毁节点，只把音量拉低，切换时更平滑。
        rampParam(volumeNode.volume, moduleState.enabled ? moduleState.volume : -48);
        rampParam(panNode.pan, moduleState.pan);

        if (definition.runtime === "pitchedSource" || definition.runtime === "noise" || definition.runtime === "grainPlayer") {
          safeSet(node, moduleState.options);
          if (definition.runtime === "grainPlayer") {
            applyPlayerLikeOptions(node, moduleState.options);
          }
          if (auxEnvelope) {
            safeSet(auxEnvelope, moduleState.ampEnvelope);
          }
        } else if (definition.runtime === "player") {
          safeSet(node, moduleState.options);
          applyPlayerLikeOptions(node, moduleState.options);
        } else if (definition.runtime === "monoTrigger") {
          safeSet(node, moduleState.options);
        } else {
          Object.entries(moduleState.options.urls || {}).forEach(([key, value]) => {
            if (typeof node.player === "function" && node.player(key)) {
              node.player(key).load(value);
            }
          });
          applyPlayersOptions(node, moduleState.options);
        }
      },
      triggerAttack: (note, velocity) => {
        if (!moduleState.enabled) {
          return;
        }

        if (definition.runtime === "pitchedSource") {
          if (node.frequency) {
            node.frequency.rampTo(getNoteFrequency(note), 0.02);
          }
          auxEnvelope.triggerAttack(Tone.now(), velocity);
        } else if (definition.runtime === "noise") {
          auxEnvelope.triggerAttack(Tone.now(), velocity);
        } else if (definition.runtime === "grainPlayer") {
          if ("playbackRate" in node) {
            node.playbackRate = getPitchRatio(note) * Number(moduleState.options.playbackRate || 1);
          }
          auxEnvelope.triggerAttack(Tone.now(), velocity);
        } else if (definition.runtime === "player") {
          if ("playbackRate" in node) {
            node.playbackRate = getPitchRatio(note) * Number(moduleState.options.playbackRate || 1);
          }
          try {
            node.stop(Tone.now());
          } catch {}
          node.start(Tone.now());
        } else if (definition.runtime === "players") {
          const key = getPlayersKey(note);
          const player = typeof node.player === "function" ? node.player(key) : null;
          if (player) {
            activePlayerKey = key;
            try {
              player.stop(Tone.now());
            } catch {}
            if ("playbackRate" in player) {
              player.playbackRate = getPitchRatio(note) * Number(moduleState.options.playbackRate || 1);
            }
            player.start(Tone.now());
          }
        } else if (definition.runtime === "monoTrigger") {
          node.triggerAttack(note, Tone.now(), velocity);
        }
      },
      triggerRelease: (note) => {
        if (definition.runtime === "pitchedSource" || definition.runtime === "noise" || definition.runtime === "grainPlayer") {
          auxEnvelope.triggerRelease(Tone.now());
        } else if (definition.runtime === "player") {
          try {
            node.stop(Tone.now());
          } catch {}
        } else if (definition.runtime === "players") {
          const player = activePlayerKey && typeof node.player === "function" ? node.player(activePlayerKey) : null;
          if (player) {
            try {
              player.stop(Tone.now());
            } catch {}
          }
          activePlayerKey = "";
        } else if (definition.runtime === "monoTrigger" && typeof node.triggerRelease === "function") {
          node.triggerRelease(note, Tone.now());
        }
      },
      releaseAll: () => {
        if (definition.runtime === "pitchedSource" || definition.runtime === "noise" || definition.runtime === "grainPlayer") {
          auxEnvelope.triggerRelease(Tone.now());
        } else if (definition.runtime === "player") {
          try {
            node.stop(Tone.now());
          } catch {}
        } else if (definition.runtime === "players") {
          ["low", "mid", "high"].forEach((key) => {
            const player = typeof node.player === "function" ? node.player(key) : null;
            if (player) {
              try {
                player.stop(Tone.now());
              } catch {}
            }
          });
          activePlayerKey = "";
        } else if (definition.runtime === "monoTrigger") {
          if (typeof node.triggerRelease === "function") {
            node.triggerRelease(Tone.now());
          }
        }
      },
      dispose: () => {
        if (node && typeof node.dispose === "function") {
          node.dispose();
        }
        if (auxEnvelope) {
          auxEnvelope.dispose();
        }
        volumeNode.dispose();
        panNode.dispose();
      },
    };
  }

  attack(note, velocity) {
    // 全局音量包络和 mod envelope 只在“第一个音开始”时触发一次，
    // 避免和多音 source 的内部包络重复冲突。
    if (!this.ready) {
      return;
    }

    if (!this.activeNotes.size) {
      if (this.state.envelope.enabled !== false) {
        this.ampEnvelope.triggerAttack(Tone.now(), velocity);
      }
      if (this.state.modEnvelope.enabled) {
        this.triggerModEnvelopeAttack(velocity);
      }
    }

    this.activeNotes.add(note);
    this.sourceRuntimes.forEach((runtime) => runtime.triggerAttack(note, velocity));
  }

  release(note) {
    if (!this.ready) {
      return;
    }

    this.activeNotes.delete(note);
    this.sourceRuntimes.forEach((runtime) => runtime.triggerRelease(note));

    if (!this.activeNotes.size) {
      if (this.state.envelope.enabled !== false) {
        this.ampEnvelope.triggerRelease(Tone.now());
      }
      if (this.state.modEnvelope.enabled) {
        this.triggerModEnvelopeRelease();
      }
    }
  }

  silenceAll() {
    this.activeNotes.clear();
    if (!this.ready) {
      return;
    }
    this.sourceRuntimes.forEach((runtime) => runtime.releaseAll());
    if (this.state.envelope.enabled !== false) {
      this.ampEnvelope.triggerRelease(Tone.now());
    }
    this.modEnvelopeState = { stage: "idle", velocity: 1, attackStart: 0, attackFrom: 0, decayStart: 0, releaseStart: 0, releaseFrom: 0 };
  }
}

/* -------------------------------------------------------------------------- */
/* App UI                                                                      */
/* -------------------------------------------------------------------------- */

class ModularSynthApp {
  constructor() {
    // state 是 UI 与音频引擎共享的唯一数据源。
    this.state = createBasePreset();
    this.engine = new AudioEngine();
    this.selectedPresetId = "init";
    this.audioBooted = false;
    this.heldComputerKeys = new Map();
    this.heldPointerNotes = new Set();
    this.activeNoteRefs = new Map();
    this.controlBindings = new Map();
    this.filterVisualizationBinding = null;
    this.dragPatch = null;
    this.dragHoverTarget = "";
    this.dragHoverSource = "";
    this.cableVisuals = new Map();
    this.patchFrame = 0;
    this.patchScene = null;
    this.performance = {
      morphA: "init",
      morphB: "fmBell",
      morph: 0,
      brightness: 0.5,
      motion: 0.5,
    };
    this.midi = {
      supported: typeof navigator !== "undefined" && "requestMIDIAccess" in navigator,
      access: null,
      inputs: [],
      selectedInputId: "",
      status: "MIDI idle",
      activeNotes: new Map(),
    };

    this.cacheElements();
    this.bindEvents();

    // 应用初始化时只构建界面与动画循环，不主动启动音频上下文。
    this.renderAll();
    this.resizeScopeCanvas();
    this.drawOscilloscope();
    window.addEventListener("resize", () => {
      this.resizeScopeCanvas();
      this.layoutModuleMasonry();
      this.drawPatchCables();
    });
  }

  cacheElements() {
    // 集中缓存常用 DOM 节点，后续渲染时直接复用。
    this.elements = {
      statusText: document.getElementById("statusText"),
      statusDot: document.getElementById("statusDot"),
      presetControls: document.getElementById("presetControls"),
      masterControls: document.getElementById("masterControls"),
      sourceRack: document.getElementById("sourceRack"),
      filterRack: document.getElementById("filterRack"),
      envelopeRack: document.getElementById("envelopeRack"),
      lfoRack: document.getElementById("lfoRack"),
      componentRack: document.getElementById("componentRack"),
      effectRack: document.getElementById("effectRack"),
      addModuleSelect: document.getElementById("addModuleSelect"),
      addModuleBtn: document.getElementById("addModuleBtn"),
      keyboard: document.getElementById("virtualKeyboard"),
      oscilloscope: document.getElementById("oscilloscope"),
      presetFileInput: document.getElementById("presetFileInput"),
      transportInfo: document.getElementById("transportInfo"),
      patchCables: document.getElementById("patchCables"),
      signalFlow: document.querySelector(".signal-flow"),
    };
    this.scopeContext = this.elements.oscilloscope?.getContext("2d") || null;
  }

  bindEvents() {
    // 所有可能的首次用户手势都尝试唤醒音频，兼容浏览器自动播放限制。
    const wakeAudio = () => {
      this.ensureAudioStarted();
    };

    document.addEventListener("pointerdown", wakeAudio, { passive: true });
    document.addEventListener("keydown", wakeAudio);
    document.addEventListener("pointermove", (event) => this.onPatchDragMove(event));
    document.addEventListener("pointerup", (event) => this.onPatchDragEnd(event));
    document.addEventListener("pointercancel", (event) => this.onPatchDragEnd(event));

    window.addEventListener("keydown", (event) => this.onKeyDown(event));
    window.addEventListener("keyup", (event) => this.onKeyUp(event));

    this.populateAddModuleSelect();
    this.elements.addModuleBtn?.addEventListener("click", () => this.handleAddModule());

    this.elements.presetFileInput?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      try {
        const text = await file.text();
        // 导入文件后仍然要走 normalize，保证旧格式和缺省字段都能被兼容。
        const preset = normalizePreset(JSON.parse(text));
        const previousState = deepClone(this.state);
        this.state = preset;
        this.selectedPresetId = "custom";
        this.resetPerformanceControls();
        this.renderAll(previousState);
        this.engine.fullSync(this.state);
        this.setStatus(`Imported preset from ${file.name}.`, "live");
      } catch (error) {
        this.setStatus(`Import failed: ${error.message}`, "error");
      } finally {
        event.target.value = "";
      }
    });
  }

  async ensureAudioStarted() {
    if (this.audioBooted) {
      return;
    }

    try {
      await this.engine.start(this.state);
      this.audioBooted = true;
      this.setStatus("LIVE", "live");
    } catch (error) {
      this.setStatus(`AUDIO START FAILED: ${error.message}`, "error");
    }
  }

  // 统一更新顶部状态提示。
  setStatus(message, tone = "neutral") {
    this.elements.statusText.textContent = message;
    this.elements.statusDot.classList.remove("live", "error");
    if (tone === "live") {
      this.elements.statusDot.classList.add("live");
    }
    if (tone === "error") {
      this.elements.statusDot.classList.add("error");
    }
  }

  // “Add Module” 下拉列表会随着核心模块的显隐动态变化。
  populateAddModuleSelect() {
    const select = this.elements.addModuleSelect;
    if (!select) {
      return;
    }

    const previousValue = select.value;
    select.innerHTML = "";

    getAddableModuleOptions()
      .filter((option) => {
        if (!option.value.startsWith("core:")) {
          return true;
        }
        const key = option.value.split(":")[1];
        return this.state.ui.visibleModules[key] === false;
      })
      .forEach((option) => {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
      });

    if (previousValue && [...select.options].some((option) => option.value === previousValue)) {
      select.value = previousValue;
    }
  }

  // 根据下拉值把模块加回机架，并同步重建音频链。
  handleAddModule() {
    const value = this.elements.addModuleSelect?.value;
    if (!value) {
      return;
    }

    const [kind, type] = value.split(":");
    if (kind === "core") {
      this.state.ui.visibleModules[type] = true;
      if (type === "filter") {
        this.state.filter.enabled = true;
      } else if (type === "envelope") {
        this.state.envelope.enabled = true;
      } else if (type === "modEnvelope") {
        this.state.modEnvelope.enabled = true;
      } else if (type === "lfo") {
        this.state.lfo.enabled = true;
      }
    } else if (kind === "source") {
      this.state.sources.push(createSourceModule(type));
    } else if (kind === "component") {
      this.state.components.push(createComponentModule(type));
    } else if (kind === "effect") {
      this.state.effects.push(createEffectModule(type));
    } else {
      return;
    }

    this.selectedPresetId = "custom";
    this.renderAll();
    this.engine.fullSync(this.state);
  }

  // 全量重渲染入口。
  // 当前实现选择“状态驱动整段重建 DOM”，简化了复杂交互下的一致性问题。
  renderAll(previousState = null) {
    this.sanitizeModulationState();
    this.populateAddModuleSelect();
    this.controlBindings = new Map();
    const sections = [
      ["global strip", () => this.renderGlobalStrip()],
      ["sources", () => this.renderSourceRack()],
      ["filter", () => this.renderFilterModule()],
      ["envelope", () => this.renderEnvelopeModule()],
      ["lfo", () => this.renderLfoModule()],
      ["components", () => this.renderComponentsRack()],
      ["effects", () => this.renderEffectRack()],
      ["keyboard", () => this.renderKeyboard()],
      ["transport", () => this.updateTransportInfo()],
    ];

    for (const [label, task] of sections) {
      try {
        task();
      } catch (error) {
        console.error(`Render error in ${label}:`, error);
        this.setStatus(`Render error in ${label}: ${error.message}`, "error");
      }
    }

    this.layoutModuleMasonry();
    this.drawPatchCables();

    if (previousState) {
      this.animateControlTransition(previousState, this.state);
    }
  }

  // 删除或隐藏模块后，连到失效目标的 modulation route 会在这里被清理。
  sanitizeModulationState() {
    const validTargets = new Set(getModulationTargets(this.state).map((target) => target.value));
    const sanitizeList = (routes) =>
      (routes || [])
        .filter((route) => route && validTargets.has(route.target))
        .map((route) => ({ ...route, id: route.id || createId("route") }));

    this.state.modulation.lfoRoutes = sanitizeList(this.state.modulation?.lfoRoutes);
    this.state.modulation.envelopeRoutes = sanitizeList(this.state.modulation?.envelopeRoutes);

    if (!this.state.modulation.lfoRoutes.length) {
      const firstTarget = getModulationTargets(this.state)[0]?.value;
      if (firstTarget) {
        this.state.modulation.lfoRoutes.push(createModRoute(firstTarget, 0.45));
      }
    }
  }

  // 手工瀑布流布局：把不同高度的卡片按最短列依次摆放，减少留白。
  layoutModuleMasonry() {
    const container = this.elements.signalFlow;
    if (!container) {
      return;
    }

    const cards = [...container.querySelectorAll(".module-card")];
    if (!cards.length) {
      container.style.height = "0px";
      return;
    }

    const gap = 10;
    const containerWidth = Math.max(240, container.clientWidth);
    const minColumnWidth = 246;
    const columnCount = Math.max(1, Math.floor((containerWidth + gap) / (minColumnWidth + gap)));
    const columnWidth = Math.floor((containerWidth - gap * (columnCount - 1)) / columnCount);
    const columnHeights = new Array(columnCount).fill(0);

    cards.forEach((card) => {
      card.style.position = "absolute";
      card.style.width = `${columnWidth}px`;
      const shortestColumn = columnHeights.indexOf(Math.min(...columnHeights));
      const left = shortestColumn * (columnWidth + gap);
      const top = columnHeights[shortestColumn];
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      columnHeights[shortestColumn] += card.offsetHeight + gap;
    });

    container.style.height = `${Math.max(...columnHeights) - gap}px`;
  }

  // 右侧固定边栏：预设、导入导出、MIDI、宏控制和主音量都在这里生成。
  renderGlobalStrip() {
    if (!this.elements.presetControls || !this.elements.masterControls) {
      return;
    }
    this.elements.presetControls.innerHTML = "";
    this.elements.masterControls.innerHTML = "";

    const presetCluster = document.createElement("div");
    presetCluster.className = "compact-block column";

    const presetSelect = this.createSelectControl({
      label: "Built-in Preset",
      options: [
        { label: "Init Patch", value: "init" },
        { label: "FM Bell Stack", value: "fmBell" },
        { label: "Cinematic Dust", value: "cinematicDust" },
        { label: "Percussion Lab", value: "percussionLab" },
        { label: "Current Patch", value: "custom" },
      ],
      value: this.selectedPresetId,
      onChange: (value) => {
        if (value === "custom") {
          return;
        }
        this.applyBuiltinPreset(value);
      },
    });

    const globalActions = document.createElement("div");
    globalActions.className = "global-cluster";

    const importButton = document.createElement("button");
    importButton.type = "button";
    importButton.className = "pill-button";
    importButton.textContent = "Import JSON";
    importButton.addEventListener("click", () => this.elements.presetFileInput.click());

    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "pill-button";
    exportButton.textContent = "Export JSON";
    exportButton.addEventListener("click", () => {
      const filename = `${(this.state.name || "tone-preset").toLowerCase().replace(/\s+/g, "-")}.json`;
      downloadJson(filename, this.state);
      this.setStatus(`Exported ${filename}.`, this.audioBooted ? "live" : "neutral");
    });

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "pill-button";
    resetButton.textContent = "Init Rack";
    resetButton.addEventListener("click", () => this.applyBuiltinPreset("init"));

    const randomButton = document.createElement("button");
    randomButton.type = "button";
    randomButton.className = "pill-button";
    randomButton.textContent = "Randomize";
    randomButton.addEventListener("click", () => this.randomizeCurrentPatch());

    const midiButton = document.createElement("button");
    midiButton.type = "button";
    midiButton.className = "pill-button";
    midiButton.textContent = this.midi.access ? "Refresh MIDI" : "Enable MIDI";
    midiButton.addEventListener("click", () => this.requestMidiAccess());

    globalActions.append(importButton, exportButton, resetButton, randomButton, midiButton);

    const midiCluster = document.createElement("div");
    midiCluster.className = "global-subgrid";
    const midiStatus = document.createElement("div");
    midiStatus.className = "meter-chip";
    midiStatus.textContent = this.midi.supported ? this.midi.status : "Web MIDI unsupported";
    midiCluster.append(midiStatus);
    if (this.midi.inputs.length) {
      midiCluster.append(
        this.createSelectControl({
          label: "MIDI Input",
          options: this.midi.inputs.map((input) => ({ label: input.name || input.id, value: input.id })),
          value: this.midi.selectedInputId,
          onChange: (value) => this.selectMidiInput(value),
        }),
      );
    }

    presetCluster.append(presetSelect, globalActions, midiCluster);
    this.elements.presetControls.append(presetCluster);

    const morphCluster = document.createElement("div");
    morphCluster.className = "compact-block";
    morphCluster.append(
      this.createSelectControl({
        label: "Morph A",
        options: Object.keys(BUILTIN_PRESET_TEMPLATES).map((id) => ({ label: BUILTIN_PRESET_TEMPLATES[id].name, value: id })),
        value: this.performance.morphA,
        onChange: (value) => {
          this.performance.morphA = value;
          this.applyMorphState();
        },
      }),
      this.createSelectControl({
        label: "Morph B",
        options: Object.keys(BUILTIN_PRESET_TEMPLATES).map((id) => ({ label: BUILTIN_PRESET_TEMPLATES[id].name, value: id })),
        value: this.performance.morphB,
        onChange: (value) => {
          this.performance.morphB = value;
          this.applyMorphState();
        },
      }),
      this.createRangeControl({
        label: "Morph",
        variant: "slider",
        accent: "component",
        min: 0,
        max: 1,
        step: 0.01,
        value: this.performance.morph,
        eventName: "change",
        formatter: formatPercent,
        onInput: (value) => {
          this.performance.morph = value;
          this.applyMorphState();
        },
      }),
    );

    const macroCluster = document.createElement("div");
    macroCluster.className = "compact-block";
    macroCluster.append(
      this.createRangeControl({
        label: "Brightness",
        accent: "filter",
        min: 0,
        max: 1,
        step: 0.01,
        value: this.performance.brightness,
        formatter: formatPercent,
        onInput: (value) => this.applyBrightnessMacro(value),
      }),
      this.createRangeControl({
        label: "Motion",
        accent: "lfo",
        min: 0,
        max: 1,
        step: 0.01,
        value: this.performance.motion,
        formatter: formatPercent,
        onInput: (value) => this.applyMotionMacro(value),
      }),
      this.createRangeControl({
        label: "Cable Tension",
        accent: "component",
        min: 0.2,
        max: 1,
        step: 0.01,
        value: this.state.ui.cableTension ?? 0.78,
        formatter: formatPercent,
        onInput: (value) => {
          this.state.ui.cableTension = value;
          this.drawPatchCables();
        },
      }),
    );

    this.elements.presetControls.append(morphCluster, macroCluster);

    const masterFader = this.createRangeControl({
      label: "Master",
      variant: "fader",
      accent: "lfo",
      min: -36,
      max: 6,
      step: 0.1,
      value: this.state.global.volume,
      path: "global.volume",
      formatter: formatDb,
      onInput: (value) => {
        this.state.global.volume = value;
        this.selectedPresetId = "custom";
        this.engine.updateGlobal(this.state.global);
        this.updateTransportInfo();
      },
    });

    this.elements.masterControls.append(masterFader);
  }

  // Source rack 负责把所有声源实例渲染成模块卡片。
  renderSourceRack() {
    if (!this.elements.sourceRack) {
      return;
    }
    this.elements.sourceRack.innerHTML = "";
    this.state.sources.forEach((module, index) => {
      const definition = SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator;
      const card = this.createModuleCard({
        accent: definition.accent,
        kicker: definition.tag,
        title: module.type,
        titleOptions: Object.keys(SOURCE_LIBRARY).map((type) => ({ label: type, value: type })),
        onTitleChange: (value) => {
          const replacement = createSourceModule(value);
          replacement.id = module.id;
          replacement.volume = module.volume;
          replacement.pan = module.pan;
          replacement.enabled = module.enabled;
          this.state.sources[index] = replacement;
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        moduleRef: module.id,
        enabled: module.enabled,
        onToggleEnabled: () => {
          module.enabled = !module.enabled;
          this.selectedPresetId = "custom";
          this.engine.updateSource(module);
          this.renderAll();
        },
        onRemove: () => {
          this.state.sources.splice(index, 1);
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        removable: true,
      });

      const controls = document.createElement("div");
      controls.className = "module-grid";
      controls.append(
        this.createRangeControl({
          label: "Level",
          accent: definition.accent,
          min: -36,
          max: 6,
          step: 0.1,
          value: module.volume,
          path: `sources.${index}.volume`,
          patchPoint: { accent: definition.accent, targetId: `source:${module.id}:volume` },
          formatter: formatDb,
          onInput: (value) => {
            module.volume = value;
            this.selectedPresetId = "custom";
            this.engine.updateSource(module);
          },
        }),
        this.createRangeControl({
          label: "Pan",
          accent: definition.accent,
          min: -1,
          max: 1,
          step: 0.01,
          value: module.pan,
          path: `sources.${index}.pan`,
          patchPoint: { accent: definition.accent, targetId: `source:${module.id}:pan` },
          formatter: (value) => `${value > 0 ? "R" : value < 0 ? "L" : "C"} ${Math.round(Math.abs(value) * 100)}`,
          onInput: (value) => {
            module.pan = value;
            this.selectedPresetId = "custom";
            this.engine.updateSource(module);
          },
        }),
      );

      this.getSourceSampleSlots(module).forEach((slot) => {
        controls.append(
          this.createAudioImportControl({
            label: slot.label,
            value: getByPath(module, slot.namePath) || slot.fallbackName,
            onSelect: async (file) => {
              await this.importSourceSample(module, index, slot, file);
            },
          }),
        );
      });

      definition.controls.forEach((control) => {
        let patchTarget = null;
        if (control.kind === "range") {
          patchTarget = `source:${module.id}:${control.path}`;
        }
        controls.append(
          this.renderModuleControl(
            module,
            control,
            () => this.engine.updateSource(module),
            definition.accent,
            `sources.${index}.${control.path}`,
            patchTarget,
          ),
        );
      });

      card.append(controls);
      this.elements.sourceRack.append(card);
    });
  }

  getSourceSampleSlots(module) {
    if (module.type === "Player") {
      return [
        {
          label: "Sample",
          path: "options.url",
          namePath: "assetName",
          fallbackName: "Factory Pluck",
        },
      ];
    }

    if (module.type === "GrainPlayer") {
      return [
        {
          label: "Sample",
          path: "options.url",
          namePath: "assetName",
          fallbackName: "Factory Texture",
        },
      ];
    }

    if (module.type === "Players") {
      return [
        {
          label: "Low Sample",
          path: "options.urls.low",
          namePath: "sampleNames.low",
          fallbackName: "Factory Pluck",
        },
        {
          label: "Mid Sample",
          path: "options.urls.mid",
          namePath: "sampleNames.mid",
          fallbackName: "Factory Bell",
        },
        {
          label: "High Sample",
          path: "options.urls.high",
          namePath: "sampleNames.high",
          fallbackName: "Factory Texture",
        },
      ];
    }

    return [];
  }

  async importSourceSample(module, index, slot, file) {
    const dataUrl = await readFileAsDataUrl(file);
    setByPath(module, slot.path, dataUrl);
    setByPath(module, slot.namePath, file.name);
    this.state.sources[index] = normalizeSourceModule(module);
    this.selectedPresetId = "custom";
    this.renderAll();
    this.engine.fullSync(this.state);
    this.setStatus(`Loaded ${file.name} into ${module.type}.`, this.audioBooted ? "live" : "neutral");
  }

  createAudioImportControl({ label, value, onSelect }) {
    const wrapper = document.createElement("div");
    wrapper.className = "control control-file";

    const controlLabel = document.createElement("div");
    controlLabel.className = "control-label";
    const strong = document.createElement("strong");
    strong.textContent = label;
    controlLabel.append(strong);

    const row = document.createElement("div");
    row.className = "file-control-row";

    const fileName = document.createElement("div");
    fileName.className = "file-chip";
    fileName.textContent = value || "Choose audio file";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "action-button file-action";
    trigger.textContent = "Import";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.className = "file-input";

    trigger.addEventListener("click", () => input.click());
    input.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      input.value = "";
      if (!file) {
        return;
      }
      try {
        await onSelect(file);
      } catch (error) {
        this.setStatus(error?.message || "Unable to import the selected audio file.", "error");
      }
    });

    row.append(fileName, trigger, input);
    wrapper.append(controlLabel, row);
    return wrapper;
  }

  // Filter 属于核心模块，因此支持“隐藏模块”和“仅关闭音频处理”两层状态。
  renderFilterModule() {
    if (!this.elements.filterRack) {
      return;
    }
    this.elements.filterRack.innerHTML = "";
    this.filterVisualizationBinding = null;
    if (this.state.ui.visibleModules.filter === false) {
      return;
    }
    const card = this.createModuleCard({
      accent: "filter",
      kicker: "Component",
      title: "Filter",
      moduleRef: "filter-core",
      enabled: this.state.filter.enabled !== false,
      onToggleEnabled: () => {
        this.state.filter.enabled = this.state.filter.enabled === false;
        this.selectedPresetId = "custom";
        this.engine.updateFilter(this.state.filter);
        this.renderAll();
      },
      removable: this.state.ui.visibleModules.filter,
      onRemove: () => {
        this.state.ui.visibleModules.filter = false;
        this.state.filter.enabled = false;
        this.selectedPresetId = "custom";
        this.renderAll();
        this.engine.fullSync(this.state);
      },
    });

    const filterVisualization = this.createFilterVisualization(this.state.filter);
    // 保存 update 引用，方便宏控制直接刷新可视化而不重建整个模块。
    this.filterVisualizationBinding = filterVisualization.update;
    const headGrid = document.createElement("div");
    headGrid.className = "module-grid compact";
    headGrid.append(
      this.createSelectControl({
        label: "Filter Type",
        options: FILTER_TYPES,
        value: this.state.filter.type,
        onChange: (value) => {
          this.state.filter.type = value;
          this.selectedPresetId = "custom";
          filterVisualization.update(this.state.filter);
          this.engine.updateFilter(this.state.filter);
        },
      }),
      this.createSelectControl({
        label: "Slope",
        options: [
          { label: "-12 dB", value: "-12" },
          { label: "-24 dB", value: "-24" },
          { label: "-48 dB", value: "-48" },
          { label: "-96 dB", value: "-96" },
        ],
        value: String(this.state.filter.rolloff),
        onChange: (value) => {
          this.state.filter.rolloff = Number(value);
          this.selectedPresetId = "custom";
          filterVisualization.update(this.state.filter);
          this.engine.updateFilter(this.state.filter);
        },
      }),
    );

    const controls = document.createElement("div");
    controls.className = "module-grid";
    card.append(filterVisualization.element);
    controls.append(
      this.createRangeControl({
        label: "Cutoff",
        accent: "filter",
        min: 40,
        max: 12000,
        step: 1,
        value: this.state.filter.frequency,
        path: "filter.frequency",
        patchPoint: { accent: "filter", targetId: "filter.frequency" },
        formatter: formatFrequency,
        onInput: (value) => {
          this.state.filter.frequency = value;
          this.selectedPresetId = "custom";
          filterVisualization.update(this.state.filter);
          this.engine.updateFilter(this.state.filter);
        },
      }),
      this.createRangeControl({
        label: "Q",
        accent: "filter",
        min: 0.001,
        max: 20,
        step: 0.001,
        value: this.state.filter.Q,
        path: "filter.Q",
        patchPoint: { accent: "filter", targetId: "filter.Q" },
        formatter: formatPlain,
        onInput: (value) => {
          this.state.filter.Q = value;
          this.selectedPresetId = "custom";
          filterVisualization.update(this.state.filter);
          this.engine.updateFilter(this.state.filter);
        },
      }),
    );

    card.append(headGrid, controls);
    this.elements.filterRack.append(card);
  }

  // Envelope 区同时承载音量包络和调制包络两个模块。
  renderEnvelopeModule() {
    if (!this.elements.envelopeRack) {
      return;
    }
    this.elements.envelopeRack.innerHTML = "";
    if (this.state.ui.visibleModules.envelope !== false) {
      const ampCard = this.createModuleCard({
      accent: "env",
      kicker: "Component",
      title: "Amp Envelope",
      moduleRef: "amp-envelope",
      enabled: this.state.envelope.enabled !== false,
      onToggleEnabled: () => {
        this.state.envelope.enabled = this.state.envelope.enabled === false;
        this.selectedPresetId = "custom";
        this.engine.updateEnvelope(this.state.envelope);
        this.renderAll();
      },
      removable: this.state.ui.visibleModules.envelope,
      onRemove: () => {
        this.state.ui.visibleModules.envelope = false;
        this.state.envelope.enabled = false;
        this.selectedPresetId = "custom";
        this.renderAll();
        this.engine.fullSync(this.state);
      },
      });

      const controls = document.createElement("div");
      controls.className = "module-grid";
      ampCard.append(this.createEnvelopeVisualization(this.state.envelope, "env"));
      ["attack", "decay", "sustain", "release"].forEach((key) => {
      controls.append(
        this.createRangeControl({
          label: key.charAt(0).toUpperCase() + key.slice(1),
          accent: "env",
          min: key === "sustain" ? 0 : 0.001,
          max: key === "sustain" ? 1 : 4,
          step: key === "sustain" ? 0.01 : 0.001,
          value: this.state.envelope[key],
          path: `envelope.${key}`,
          formatter: key === "sustain" ? formatPercent : formatSeconds,
          onInput: (value) => {
            this.state.envelope[key] = value;
            this.selectedPresetId = "custom";
            this.engine.updateEnvelope(this.state.envelope);
          },
        }),
        );
      });

      ampCard.append(controls);
      this.elements.envelopeRack.append(ampCard);
    }

    if (this.state.ui.visibleModules.modEnvelope === false) {
      return;
    }

    const modCard = this.createModuleCard({
      accent: "env",
      kicker: "Modulation",
      title: "Mod Envelope",
      moduleRef: "mod-envelope",
      headerPatchPoint: { accent: "env", sourceKey: "envelopeRoutes" },
      enabled: this.state.modEnvelope.enabled,
      onToggleEnabled: () => {
        this.state.modEnvelope.enabled = !this.state.modEnvelope.enabled;
        this.selectedPresetId = "custom";
        this.engine.updateModEnvelope(this.state.modEnvelope);
        this.renderAll();
      },
      removable: this.state.ui.visibleModules.modEnvelope,
      onRemove: () => {
        this.state.ui.visibleModules.modEnvelope = false;
        this.state.modEnvelope.enabled = false;
        this.selectedPresetId = "custom";
        this.renderAll();
        this.engine.fullSync(this.state);
      },
    });

    const modControls = document.createElement("div");
    modControls.className = "module-grid";
    modCard.append(this.createEnvelopeVisualization(this.state.modEnvelope, "env"));
    ["attack", "decay", "sustain", "release"].forEach((key) => {
      modControls.append(
        this.createRangeControl({
          label: key.charAt(0).toUpperCase() + key.slice(1),
          accent: "env",
          min: key === "sustain" ? 0 : 0.001,
          max: key === "sustain" ? 1 : 4,
          step: key === "sustain" ? 0.01 : 0.001,
          value: this.state.modEnvelope[key],
          formatter: key === "sustain" ? formatPercent : formatSeconds,
          onInput: (value) => {
            this.state.modEnvelope[key] = value;
            this.selectedPresetId = "custom";
            this.engine.updateModEnvelope(this.state.modEnvelope);
          },
        }),
      );
    });

    modCard.append(modControls, this.renderRouteRack("envelopeRoutes", "env"));
    this.elements.envelopeRack.append(modCard);
  }

  // LFO 模块既可以作为调制源，也可以被整体移除出机架。
  renderLfoModule() {
    if (!this.elements.lfoRack) {
      return;
    }
    this.elements.lfoRack.innerHTML = "";
    if (this.state.ui.visibleModules.lfo === false) {
      return;
    }
    const card = this.createModuleCard({
      accent: "lfo",
      kicker: "Modulation",
      title: "LFO",
      moduleRef: "lfo-core",
      headerPatchPoint: { accent: "lfo", sourceKey: "lfoRoutes" },
      enabled: this.state.lfo.enabled,
      onToggleEnabled: () => {
        this.state.lfo.enabled = !this.state.lfo.enabled;
        this.selectedPresetId = "custom";
        this.engine.updateLfo(this.state.lfo);
        this.renderAll();
      },
      removable: this.state.ui.visibleModules.lfo,
      onRemove: () => {
        this.state.ui.visibleModules.lfo = false;
        this.state.lfo.enabled = false;
        this.selectedPresetId = "custom";
        this.renderAll();
        this.engine.fullSync(this.state);
      },
    });

    const headGrid = document.createElement("div");
    headGrid.className = "module-grid compact";
    headGrid.append(
      this.createSelectControl({
        label: "Wave",
        options: SHARED_WAVE_OPTIONS,
        value: this.state.lfo.type,
        onChange: (value) => {
          this.state.lfo.type = value;
          this.selectedPresetId = "custom";
          this.engine.updateLfo(this.state.lfo);
        },
      }),
    );

    const controls = document.createElement("div");
    controls.className = "module-grid";
    controls.append(
      this.createRangeControl({
        label: "Rate",
        accent: "lfo",
        min: 0.05,
        max: 18,
        step: 0.01,
        value: this.state.lfo.frequency,
        path: "lfo.frequency",
        formatter: formatHertz,
        onInput: (value) => {
          this.state.lfo.frequency = value;
          this.selectedPresetId = "custom";
          this.engine.updateLfo(this.state.lfo);
        },
      }),
      this.createRangeControl({
        label: "Depth",
        accent: "lfo",
        min: 0,
        max: 1,
        step: 0.01,
        value: this.state.lfo.amount,
        path: "lfo.amount",
        formatter: formatPercent,
        onInput: (value) => {
          this.state.lfo.amount = value;
          this.selectedPresetId = "custom";
          this.engine.updateLfo(this.state.lfo);
        },
      }),
      this.createRangeControl({
        label: "Phase",
        accent: "lfo",
        min: 0,
        max: 360,
        step: 1,
        value: this.state.lfo.phase || 0,
        formatter: (value) => `${Math.round(value)}deg`,
        onInput: (value) => {
          this.state.lfo.phase = value;
          this.selectedPresetId = "custom";
          this.engine.updateLfo(this.state.lfo);
        },
      }),
    );

    card.append(headGrid, controls, this.renderRouteRack("lfoRoutes", "lfo"));
    this.elements.lfoRack.append(card);
  }

  // Component rack 用于串接压缩、增益、EQ 等工具型节点。
  renderComponentsRack() {
    if (!this.elements.componentRack) {
      return;
    }
    this.elements.componentRack.innerHTML = "";
    this.state.components.forEach((module, index) => {
      const definition = COMPONENT_LIBRARY[module.type] || COMPONENT_LIBRARY.Compressor;
      const card = this.createModuleCard({
        accent: definition.accent,
        kicker: definition.tag,
        title: module.type,
        titleOptions: Object.keys(COMPONENT_LIBRARY).map((type) => ({ label: type, value: type })),
        onTitleChange: (value) => {
          const replacement = createComponentModule(value);
          replacement.id = module.id;
          replacement.enabled = module.enabled;
          this.state.components[index] = replacement;
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        moduleRef: module.id,
        enabled: module.enabled,
        onToggleEnabled: () => {
          module.enabled = !module.enabled;
          this.selectedPresetId = "custom";
          this.state.components[index] = module;
          this.engine.fullSync(this.state);
          this.renderAll();
        },
        onRemove: () => {
          this.state.components.splice(index, 1);
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        removable: true,
      });

      const controls = document.createElement("div");
      controls.className = "module-grid";
      definition.controls.forEach((control) => {
        let patchTarget = null;
        if (control.kind === "range") {
          patchTarget = `component:${module.id}:${control.path.replace("options.", "")}`;
        }
        controls.append(
          this.renderModuleControl(
            module,
            control,
            () => this.engine.updateComponent(module),
            definition.accent,
            `components.${index}.${control.path}`,
            patchTarget,
          ),
        );
      });

      card.append(controls);
      this.elements.componentRack.append(card);
    });
  }

  // Effect rack 用于串接带 wet/feedback 等空间与调制效果。
  renderEffectRack() {
    if (!this.elements.effectRack) {
      return;
    }
    this.elements.effectRack.innerHTML = "";
    this.state.effects.forEach((module, index) => {
      const definition = EFFECT_LIBRARY[module.type] || EFFECT_LIBRARY.Chorus;
      const card = this.createModuleCard({
        accent: definition.accent,
        kicker: definition.tag,
        title: module.type,
        titleOptions: Object.keys(EFFECT_LIBRARY).map((type) => ({ label: type, value: type })),
        onTitleChange: (value) => {
          const replacement = createEffectModule(value);
          replacement.id = module.id;
          replacement.enabled = module.enabled;
          this.state.effects[index] = replacement;
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        moduleRef: module.id,
        enabled: module.enabled,
        onToggleEnabled: () => {
          module.enabled = !module.enabled;
          this.selectedPresetId = "custom";
          this.state.effects[index] = module;
          this.engine.fullSync(this.state);
          this.renderAll();
        },
        onRemove: () => {
          this.state.effects.splice(index, 1);
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        removable: true,
      });

      const controls = document.createElement("div");
      controls.className = "module-grid";
      definition.controls.forEach((control) => {
        let patchTarget = null;
        if (control.kind === "range") {
          patchTarget = `effect:${module.id}:${control.path.replace("options.", "")}`;
        }
        controls.append(
          this.renderModuleControl(
            module,
            control,
            () => {
              this.engine.updateEffect(module);
            },
            definition.accent,
            `effects.${index}.${control.path}`,
            patchTarget,
          ),
        );
      });

      card.append(controls);
      this.elements.effectRack.append(card);
    });
  }

  // 虚拟键盘根据当前八度和屏幕宽度实时重建。
  renderKeyboard() {
    if (!this.elements.keyboard) {
      return;
    }
    this.elements.keyboard.innerHTML = "";

    const compactLayout = window.innerWidth < 940;
    const whiteKeyWidth = compactLayout ? 68 : 72;
    const blackKeyWidth = compactLayout ? 42 : 46;
    const keyboardPadding = 10;
    const keyboardWidth = whiteKeyWidth * 8 + keyboardPadding * 2;
    this.elements.keyboard.style.width = `${keyboardWidth}px`;
    this.elements.keyboard.style.setProperty("--white-key-width", `${whiteKeyWidth}px`);
    this.elements.keyboard.style.setProperty("--black-key-width", `${blackKeyWidth}px`);

    KEYBOARD_LAYOUT.forEach((entry) => {
      const note = noteFromOffset(this.state.global.octave, entry.offset);
      const key = document.createElement("button");
      key.type = "button";
      key.className = entry.black ? "black-key" : "white-key";
      key.dataset.note = note;
      key.dataset.key = entry.key;
      const left = entry.black
        ? keyboardPadding + (entry.whiteIndex + 1) * whiteKeyWidth - blackKeyWidth / 2
        : keyboardPadding + entry.whiteIndex * whiteKeyWidth;
      key.style.left = `${left}px`;

      const cap = document.createElement("div");
      cap.className = "key-cap";
      const bind = document.createElement("span");
      bind.className = "key-bind";
      bind.textContent = entry.key.toUpperCase();
      const noteLabel = document.createElement("span");
      noteLabel.className = "key-note";
      noteLabel.textContent = note;
      cap.append(bind, noteLabel);
      key.append(cap);

      key.addEventListener("pointerdown", async () => {
        await this.ensureAudioStarted();
        this.pressNote(note);
        this.heldPointerNotes.add(note);
        key.classList.add("active");
      });

      key.addEventListener("pointerup", () => {
        this.releaseNote(note);
        this.heldPointerNotes.delete(note);
        key.classList.remove("active");
      });

      key.addEventListener("pointerleave", () => {
        if (this.heldPointerNotes.has(note)) {
          this.releaseNote(note);
          this.heldPointerNotes.delete(note);
          key.classList.remove("active");
        }
      });

      if (this.heldComputerKeys.has(entry.key)) {
        key.classList.add("active");
      }

      this.elements.keyboard.append(key);
    });
  }

  // 按定义表把模块参数翻译为 select / range 控件。
  renderModuleControl(module, control, onCommit, accent, bindingPath = null, patchTarget = null) {
    const path = control.path;
    const value = getByPath(module, path);

    if (control.kind === "select") {
      return this.createSelectControl({
        label: control.label,
        options: control.options,
        value,
        accent,
        onChange: (nextValue) => {
          setByPath(module, path, nextValue);
          this.selectedPresetId = "custom";
          onCommit();
        },
      });
    }

    if (control.kind === "toggle") {
      return this.createToggleControl({
        label: control.label,
        accent,
        value: Boolean(value),
        onToggle: (nextValue) => {
          setByPath(module, path, nextValue);
          this.selectedPresetId = "custom";
          onCommit();
        },
      });
    }

    return this.createRangeControl({
      label: control.label,
      accent,
      min: control.min,
      max: control.max,
      step: control.step,
      value,
      path: bindingPath,
      patchPoint: patchTarget ? { accent, targetId: patchTarget } : null,
      formatter: control.formatter || formatPlain,
      onInput: (nextValue) => {
        setByPath(module, path, nextValue);
        this.selectedPresetId = "custom";
        onCommit();
      },
    });
  }

  // 渲染 LFO / Mod Envelope 的路由列表，同时提供拖线句柄。
  renderRouteRack(routeKey, accent) {
    const wrapper = document.createElement("div");
    wrapper.className = "route-rack";

    const routeOptions = getModulationTargets(this.state).map((target) => ({
      label: target.label,
      value: target.value,
    }));
    const routes = this.state.modulation[routeKey];

    routes.forEach((route, index) => {
      const row = document.createElement("div");
      row.className = "route-row";

      const stack = document.createElement("div");
      stack.className = "module-grid compact route-grid";
      stack.append(
        this.createSelectControl({
          label: `Route ${index + 1}`,
          options: routeOptions,
          value: route.target,
          onChange: (value) => {
            route.target = value;
            this.selectedPresetId = "custom";
            this.engine.updateModulation(this.state.modulation);
            this.drawPatchCables();
          },
        }),
        this.createRangeControl({
          label: "Amount",
          accent,
          variant: "slider",
          min: -1,
          max: 1,
          step: 0.01,
          value: route.amount,
          formatter: (value) => `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`,
          onInput: (value) => {
            route.amount = value;
            this.selectedPresetId = "custom";
            this.engine.updateModulation(this.state.modulation);
          },
        }),
      );

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "route-remove";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        this.state.modulation[routeKey].splice(index, 1);
        this.selectedPresetId = "custom";
        this.renderAll();
        this.engine.updateModulation(this.state.modulation);
      });

      row.append(stack, removeButton);
      wrapper.append(row);
    });

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "route-add";
    addButton.textContent = "Add Route";
    addButton.addEventListener("click", () => {
      const firstTarget = routeOptions[0]?.value;
      if (!firstTarget) {
        return;
      }
      this.state.modulation[routeKey].push(createModRoute(firstTarget, 0.35));
      this.selectedPresetId = "custom";
      this.renderAll();
      this.engine.updateModulation(this.state.modulation);
      this.drawPatchCables();
    });

    wrapper.append(addButton);
    return wrapper;
  }

  createModuleCard({
    accent,
    kicker,
    title,
    titleOptions = null,
    onTitleChange = null,
    onRemove = null,
    removable = false,
    moduleRef = null,
    enabled = true,
    onToggleEnabled = null,
    headerPatchPoint = null,
  }) {
    // 所有模块卡片共享同一个骨架结构，避免不同模块出现不同的头部交互模式。
    const card = document.createElement("section");
    card.className = "module-card";
    card.dataset.accent = accent;
    if (moduleRef) {
      card.dataset.moduleRef = moduleRef;
    }

    const head = document.createElement("div");
    head.className = "module-head";

    const titleBlock = document.createElement("div");
    titleBlock.className = "module-title-row";
    if (titleOptions && onTitleChange) {
      titleBlock.append(this.createTitleSelect({ accent, title, options: titleOptions, value: title, onChange: onTitleChange }));
    } else {
      const titleNode = document.createElement("h3");
      titleNode.textContent = title;
      titleBlock.append(titleNode);
    }
    if (headerPatchPoint) {
      titleBlock.append(this.createPatchPoint(headerPatchPoint));
    }

    const actions = document.createElement("div");
    actions.className = "module-actions";
    if (onToggleEnabled) {
      actions.append(this.createModuleSwitch({ enabled, accent, onToggle: onToggleEnabled }));
    }
    if (removable && onRemove) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "module-remove";
      removeButton.textContent = "×";
      removeButton.addEventListener("click", onRemove);
      actions.append(removeButton);
    }

    head.append(titleBlock, actions);
    card.append(head);

    return card;
  }

  createTitleSelect({ accent, title, value, options, onChange }) {
    // 模块标题右侧的小箭头实际上是一个轻量下拉，不额外占一整行表单空间。
    const wrap = document.createElement("label");
    wrap.className = "module-title-select";
    wrap.style.setProperty("--accent", `var(--${accent})`);

    const select = document.createElement("select");
    select.className = "module-title-input";
    options.forEach((option) => {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    });
    select.value = value;
    select.setAttribute("aria-label", title);
    select.addEventListener("change", (event) => onChange(event.target.value));
    wrap.append(select);
    return wrap;
  }

  createModuleSwitch({ enabled, accent, onToggle }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `module-switch ${enabled ? "is-on" : ""}`;
    button.style.setProperty("--accent", `var(--${accent})`);
    button.setAttribute("aria-label", enabled ? "Disable module" : "Enable module");
    button.addEventListener("click", onToggle);
    return button;
  }

  // 某个参数是否已被任何调制源连接，用于参数标题后 patch 点的高亮。
  isTargetPatched(targetValue) {
    return [...(this.state.modulation?.lfoRoutes || []), ...(this.state.modulation?.envelopeRoutes || [])]
      .some((route) => route.enabled !== false && route.target === targetValue);
  }

  // patch point 可以表示参数输入端，也可以表示调制源输出端。
  createPatchPoint({ accent, targetId = null, sourceKey = null }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "patch-point";
    button.style.setProperty("--accent", `var(--${accent})`);

    if (targetId) {
      button.dataset.modTarget = targetId;
      if (this.dragHoverTarget === targetId) {
        button.classList.add("is-hover");
      }
      if (this.isTargetPatched(targetId)) {
        button.classList.add("is-patched");
      }
    }

    if (sourceKey) {
      button.dataset.modSource = sourceKey;
      if (this.dragHoverSource === sourceKey) {
        button.classList.add("is-hover");
      }
    }

    return button;
  }

  // Envelope 可视化是抽象的 ADSR 轮廓图，不追求精确时间比例，只强调形状关系。
  createEnvelopeVisualization(envelopeState, accent = "env") {
    const wrap = document.createElement("div");
    wrap.className = "module-visual envelope-visual";
    wrap.style.setProperty("--accent", `var(--${accent})`);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 220 90");

    const attack = Math.max(0.03, Number(envelopeState.attack || 0.01));
    const decay = Math.max(0.03, Number(envelopeState.decay || 0.2));
    const sustain = clamp(Number(envelopeState.sustain || 0), 0, 1);
    const release = Math.max(0.03, Number(envelopeState.release || 0.4));
    const total = attack + decay + release + 0.5;
    const x1 = 24 + (attack / total) * 128;
    const x2 = x1 + (decay / total) * 54;
    const x3 = 172;
    const yBase = 76;
    const yPeak = 14;
    const ySustain = yBase - sustain * 42;
    const points = [
      [16, yBase],
      [x1, yPeak],
      [x2, ySustain],
      [x3, ySustain],
      [204, yBase],
    ];

    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute(
      "points",
      [...points, [204, yBase], [16, yBase]].map((point) => point.join(",")).join(" "),
    );
    polygon.setAttribute("fill", "currentColor");
    polygon.setAttribute("opacity", "0.96");

    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", points.map((point) => point.join(",")).join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "2.4");

    svg.append(polygon, line);
    wrap.append(svg);
    return wrap;
  }

  // Filter 可视化使用几何近似来表达滤波器响应趋势。
  // 核心关注点是：type、cutoff、Q、slope 的相对变化能被直观看到。
  createFilterVisualization(filterState) {
    const wrap = document.createElement("div");
    wrap.className = "module-visual filter-visual";
    wrap.style.setProperty("--accent", "var(--filter)");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 220 90");

    const left = 8;
    const right = 212;
    const top = 14;
    const floor = 78;
    const plateau = 50;
    const clampX = (value) => clamp(value, left, right);

    const grid = document.createElementNS("http://www.w3.org/2000/svg", "path");
    grid.setAttribute("d", `M ${left} 72 H ${right} M ${left} 52 H ${right} M ${left} 32 H ${right}`);
    grid.setAttribute("fill", "none");
    grid.setAttribute("stroke", "currentColor");
    grid.setAttribute("stroke-opacity", "0.12");
    grid.setAttribute("stroke-width", "1");

    const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
    area.setAttribute("fill", "currentColor");
    area.setAttribute("opacity", "0.18");

    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "2.2");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");

    const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    marker.setAttribute("r", "3.6");
    marker.setAttribute("fill", "currentColor");

    const markerRing = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    markerRing.setAttribute("r", "6.2");
    markerRing.setAttribute("fill", "none");
    markerRing.setAttribute("stroke", "currentColor");
    markerRing.setAttribute("stroke-opacity", "0.24");
    markerRing.setAttribute("stroke-width", "1.4");

    const slopeLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    slopeLabel.setAttribute("x", String(right));
    slopeLabel.setAttribute("y", "16");
    slopeLabel.setAttribute("text-anchor", "end");
    slopeLabel.setAttribute("font-size", "9");
    slopeLabel.setAttribute("fill", "currentColor");
    slopeLabel.setAttribute("opacity", "0.62");

    const update = (nextState) => {
      // cutoff 按对数频率归一化，这样低频区域不会被视觉上压得过窄。
      const type = nextState.type || "lowpass";
      const cutoffNorm = clamp(
        (Math.log10(Math.max(20, Number(nextState.frequency || 20))) - Math.log10(20)) / (Math.log10(12000) - Math.log10(20)),
        0,
        1,
      );
      const resonance = clamp(Number(nextState.Q || 0.5) / 16, 0, 1);
      const slopeStrength = clamp(Math.abs(Number(nextState.rolloff || -24)) / 96, 0.12, 1);
      const cutoffX = left + cutoffNorm * (right - left);
      const shoulder = 42 - slopeStrength * 24;
      const bumpHeight = resonance * 18;
      const availableLeft = Math.max(0, cutoffX - left);
      const availableRight = Math.max(0, right - cutoffX);

      let path;
      let fillPath;
      let markerX = cutoffX;
      let markerY = plateau;

      if (type === "highpass") {
        const riseStart = clampX(cutoffX - Math.min(shoulder, availableLeft));
        const riseEnd = clampX(cutoffX + Math.min(shoulder * 0.42, availableRight));
        const control1X = clampX(cutoffX - Math.min(shoulder * 0.18, availableLeft * 0.55));
        const control2X = clampX(cutoffX - Math.min(shoulder * 0.06, availableLeft * 0.18));
        markerY = plateau - bumpHeight;
        path = [
          `M ${left} ${floor}`,
          `L ${Math.max(left + 6, riseStart)} ${floor}`,
          `C ${control1X} ${floor}, ${control2X} ${markerY}, ${cutoffX} ${markerY}`,
          `L ${riseEnd} ${plateau}`,
          `L ${right} ${plateau}`,
        ].join(" ");
        fillPath = `${path} L ${right} ${floor + 4} L ${left} ${floor + 4} Z`;
      } else if (type === "bandpass") {
        const bandWidth = Math.max(8, Math.min(36 - slopeStrength * 18, availableLeft * 0.92, availableRight * 0.92));
        const peakY = top + (1 - resonance) * 8;
        markerY = peakY;
        path = [
          `M ${left} ${floor}`,
          `L ${clampX(cutoffX - bandWidth)} ${floor}`,
          `C ${clampX(cutoffX - bandWidth * 0.36)} ${floor}, ${clampX(cutoffX - bandWidth * 0.14)} ${peakY}, ${cutoffX} ${peakY}`,
          `L ${clampX(cutoffX + bandWidth)} ${floor}`,
          `L ${right} ${floor}`,
        ].join(" ");
        fillPath = `${path} L ${right} ${floor + 4} L ${left} ${floor + 4} Z`;
      } else if (type === "notch") {
        const notchWidth = Math.max(7, Math.min(28 - slopeStrength * 12, availableLeft * 0.88, availableRight * 0.88));
        const notchDepth = 10 + slopeStrength * 16 + resonance * 10;
        markerY = Math.min(floor, plateau + notchDepth);
        path = [
          `M ${left} ${plateau}`,
          `L ${clampX(cutoffX - notchWidth)} ${plateau}`,
          `C ${clampX(cutoffX - notchWidth * 0.28)} ${plateau}, ${clampX(cutoffX - notchWidth * 0.08)} ${markerY}, ${cutoffX} ${markerY}`,
          `L ${clampX(cutoffX + notchWidth)} ${plateau}`,
          `L ${right} ${plateau}`,
        ].join(" ");
        fillPath = `${path} L ${right} ${floor + 4} L ${left} ${floor + 4} Z`;
      } else {
        // 默认分支按 low-pass 绘制。
        const dropStart = clampX(cutoffX - Math.min(shoulder * 0.32, availableLeft));
        const dropEnd = clampX(cutoffX + Math.min(shoulder, availableRight));
        const control1X = clampX(cutoffX - Math.min(shoulder * 0.12, availableLeft * 0.5));
        const control2X = clampX(cutoffX - Math.min(shoulder * 0.02, availableLeft * 0.14));
        markerY = plateau - bumpHeight;
        path = [
          `M ${left} ${plateau}`,
          `L ${Math.max(left + 6, dropStart)} ${plateau}`,
          `C ${control1X} ${plateau}, ${control2X} ${markerY}, ${cutoffX} ${markerY}`,
          `L ${dropEnd} ${floor}`,
          `L ${right} ${floor}`,
        ].join(" ");
        fillPath = `${path} L ${right} ${floor + 4} L ${left} ${floor + 4} Z`;
      }

      line.setAttribute("d", path);
      area.setAttribute("d", fillPath);
      marker.setAttribute("cx", String(markerX));
      marker.setAttribute("cy", String(markerY));
      markerRing.setAttribute("cx", String(markerX));
      markerRing.setAttribute("cy", String(markerY));
      slopeLabel.textContent = `${nextState.rolloff} dB`;
      wrap.style.opacity = nextState.enabled === false ? "0.42" : "1";
    };

    svg.append(grid, area, line, markerRing, marker, slopeLabel);
    wrap.append(svg);
    update(filterState);
    return { element: wrap, update };
  }

  // 开始拖线时只记录临时状态，不立刻修改实际 route。
  beginPatchDrag(event, routeKey, routeId, accent, endType = "target") {
    const color = accent === "lfo" ? "rgba(61, 127, 184, 0.92)" : "rgba(192, 160, 62, 0.92)";
    this.dragPatch = {
      routeKey,
      routeId,
      color,
      endType,
      point: this.getRelativePatchPoint(event.clientX, event.clientY),
    };
    this.updatePatchHoverState();
    this.drawPatchCables();
  }

  getRelativePatchPoint(clientX, clientY) {
    const container = this.elements.signalFlow;
    if (!container) {
      return { x: 0, y: 0 };
    }
    const rect = container.getBoundingClientRect();
    return {
      x: clientX - rect.left + container.scrollLeft,
      y: clientY - rect.top + container.scrollTop,
    };
  }

  // 找到鼠标当前经过的可连接参数目标。
  findHoveredPatchTarget(clientX, clientY) {
    const element = document.elementFromPoint(clientX, clientY);
    return element?.closest?.("[data-mod-target]") || null;
  }

  findHoveredPatchSource(clientX, clientY) {
    const element = document.elementFromPoint(clientX, clientY);
    return element?.closest?.("[data-mod-source]") || null;
  }

  updatePatchHoverState() {
    const container = this.elements.signalFlow;
    if (!container) {
      return;
    }
    container
      .querySelectorAll("[data-mod-target]")
      .forEach((element) => element.classList.toggle("is-hover", element.dataset.modTarget === this.dragHoverTarget));
    container
      .querySelectorAll("[data-mod-source]")
      .forEach((element) => element.classList.toggle("is-hover", element.dataset.modSource === this.dragHoverSource));
  }

  onPatchDragMove(event) {
    if (!this.dragPatch) {
      return;
    }
    this.dragPatch.point = this.getRelativePatchPoint(event.clientX, event.clientY);
    if (this.dragPatch.endType === "target") {
      const hoveredTarget = this.findHoveredPatchTarget(event.clientX, event.clientY);
      const nextHoverTarget = hoveredTarget?.dataset.modTarget || "";
      if (nextHoverTarget !== this.dragHoverTarget) {
        this.dragHoverTarget = nextHoverTarget;
        this.updatePatchHoverState();
      }
    } else {
      const hoveredSource = this.findHoveredPatchSource(event.clientX, event.clientY);
      const nextHoverSource = hoveredSource?.dataset.modSource || "";
      if (nextHoverSource !== this.dragHoverSource) {
        this.dragHoverSource = nextHoverSource;
        this.updatePatchHoverState();
      }
    }
    this.drawPatchCables();
  }

  onPatchDragEnd(event) {
    // 只有在松手时命中合法 patch target，才真正改写 route.target。
    if (!this.dragPatch) {
      return;
    }

    let routeChanged = false;
    if (this.dragPatch.endType === "target") {
      const hoveredTarget = this.findHoveredPatchTarget(event.clientX, event.clientY);
      if (hoveredTarget?.dataset.modTarget) {
        const route = findById(this.state.modulation[this.dragPatch.routeKey], this.dragPatch.routeId);
        if (route && route.target !== hoveredTarget.dataset.modTarget) {
          route.target = hoveredTarget.dataset.modTarget;
          routeChanged = true;
        }
      }
    } else {
      const hoveredSource = this.findHoveredPatchSource(event.clientX, event.clientY);
      const nextRouteKey = hoveredSource?.dataset.modSource || "";
      if (nextRouteKey && nextRouteKey !== this.dragPatch.routeKey) {
        const list = this.state.modulation[this.dragPatch.routeKey] || [];
        const routeIndex = list.findIndex((route) => route.id === this.dragPatch.routeId);
        if (routeIndex >= 0) {
          const [route] = list.splice(routeIndex, 1);
          this.state.modulation[nextRouteKey].push(route);
          routeChanged = true;
        }
      }
    }

    if (routeChanged) {
      this.selectedPresetId = "custom";
      this.engine.updateModulation(this.state.modulation);
    }

    this.dragPatch = null;
    this.dragHoverTarget = "";
    this.dragHoverSource = "";
    this.updatePatchHoverState();
    this.renderAll();
  }

  createSelectControl({ label, options, value, onChange, patchPoint = null }) {
    // Select 控件也可以携带 patch point，因此标题和控件本体拆成两层结构。
    const wrapper = document.createElement("label");
    wrapper.className = "control";

    const controlLabel = document.createElement("div");
    controlLabel.className = "control-label";
    const title = document.createElement("div");
    title.className = "control-title";
    const strong = document.createElement("strong");
    strong.textContent = label;
    title.append(strong);
    if (patchPoint) {
      title.append(this.createPatchPoint(patchPoint));
    }
    controlLabel.append(title);

    const select = document.createElement("select");
    select.className = "select-input";
    options.forEach((option) => {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    });
    select.value = value;
    select.addEventListener("change", (event) => onChange(event.target.value));

    wrapper.append(controlLabel, select);
    return wrapper;
  }

  createToggleControl({ label, value, onToggle, accent }) {
    const wrapper = document.createElement("div");
    wrapper.className = "control";

    const controlLabel = document.createElement("div");
    controlLabel.className = "control-label";
    const strong = document.createElement("strong");
    strong.textContent = label;
    controlLabel.append(strong);

    const button = document.createElement("button");
    button.type = "button";
    button.className = `pill-button ${value ? "is-on" : ""}`;
    button.style.setProperty("--accent", `var(--${accent})`);
    const syncState = (nextValue) => {
      button.classList.toggle("is-on", nextValue);
      button.textContent = nextValue ? "On" : "Off";
    };

    syncState(Boolean(value));
    button.addEventListener("click", () => {
      const nextValue = !button.classList.contains("is-on");
      syncState(nextValue);
      onToggle(nextValue);
    });

    wrapper.append(controlLabel, button);
    return wrapper;
  }

  // Range 控件支持 slider / knob / fader 三种可视变体，
  // 并统一写入 controlBindings，供预设切换动画和宏控制回写 UI。
  createRangeControl({ label, value, min, max, step, formatter, onInput, accent = "source", variant = "slider", path = null, eventName = "input", patchPoint = null }) {
    const wrapper = document.createElement("label");
    wrapper.className = `control control-${variant}`;
    wrapper.style.setProperty("--accent", `var(--${accent})`);

    const controlLabel = document.createElement("div");
    controlLabel.className = "control-label";
    const title = document.createElement("div");
    title.className = "control-title";
    const strong = document.createElement("strong");
    strong.textContent = label;
    const readout = document.createElement("span");
    readout.className = "control-readout";
    title.append(strong);
    if (patchPoint) {
      title.append(this.createPatchPoint(patchPoint));
    }
    controlLabel.append(title, readout);

    const shell = document.createElement("div");
    shell.className = "slider-shell";

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.className = variant === "knob" ? "knob-input" : "slider-input";

    const updateVisual = (nextValue) => {
      const numericValue = Number(nextValue);
      const percent = (numericValue - min) / (max - min);
      readout.textContent = formatter(numericValue);
      shell.style.setProperty("--percent", percent.toString());
      if (variant === "knob" && dial) {
        dial.style.setProperty("--rotation", `${-135 + percent * 270}deg`);
      }
    };

    let dial = null;
    if (variant === "knob") {
      shell.className = "knob-shell";
      dial = document.createElement("div");
      dial.className = "knob-dial";
      shell.append(dial, input);
    } else {
      shell.append(input);
    }

    updateVisual(value);

    if (path) {
      this.controlBindings.set(path, {
        setVisual: (nextValue) => {
          input.value = String(nextValue);
          updateVisual(nextValue);
        },
      });
    }

    input.addEventListener("input", (event) => {
      const nextValue = Number(event.target.value);
      updateVisual(nextValue);
      if (eventName === "input") {
        onInput(nextValue);
      }
    });

    if (eventName === "change") {
      input.addEventListener("change", (event) => {
        onInput(Number(event.target.value));
      });
    }

    wrapper.append(controlLabel, shell);
    return wrapper;
  }

  async applyBuiltinPreset(presetId) {
    // 内置预设加载与导入 JSON 一样，都走完整的状态替换与重渲染流程。
    const template = BUILTIN_PRESET_TEMPLATES[presetId];
    if (!template) {
      return;
    }

    const previousState = deepClone(this.state);
    this.state = normalizePreset(template);
    this.selectedPresetId = presetId;
    this.resetPerformanceControls();
    this.renderAll(previousState);
    this.engine.fullSync(this.state);
    this.setStatus(`LOADED PRESET: ${this.state.name}.`, this.audioBooted ? "live" : "neutral");
  }

  // 当逻辑层直接改了 state，需要把当前已经挂在页面上的控件视觉值同步回来。
  syncControlsFromState() {
    this.controlBindings.forEach((binding, path) => {
      const value = getByPath(this.state, path);
      if (typeof value === "number" && Number.isFinite(value)) {
        binding.setVisual(value);
      }
    });
  }

  // 预设切换和 morph 时，对数值控件做一次短暂过渡，避免界面瞬间跳变。
  animateControlTransition(fromState, toState) {
    const animations = [];

    this.controlBindings.forEach((binding, path) => {
      const startValue = getByPath(fromState, path);
      const endValue = getByPath(toState, path);

      if (typeof startValue === "number" && Number.isFinite(startValue) && typeof endValue === "number" && Number.isFinite(endValue)) {
        binding.setVisual(startValue);
        animations.push({ binding, startValue, endValue });
      }
    });

    if (!animations.length) {
      return;
    }

    const duration = 360;
    const startTime = performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    const frame = (now) => {
      const progress = clamp((now - startTime) / duration, 0, 1);
      const eased = easeOut(progress);

      animations.forEach(({ binding, startValue, endValue }) => {
        binding.setVisual(startValue + (endValue - startValue) * eased);
      });

      if (progress < 1) {
        requestAnimationFrame(frame);
      }
    };

    requestAnimationFrame(frame);
  }

  resetPerformanceControls() {
    this.performance.morph = 0;
    this.performance.brightness = 0.5;
    this.performance.motion = 0.5;
  }

  // 预设混合器：
  // 数值字段线性插值，布尔/字符串按 morph 所在半区择一，
  // 模块列表则尽量保留顺序并为结果生成新的临时 id。
  blendPresets(aId, bId, morph) {
    const presetA = normalizePreset(BUILTIN_PRESET_TEMPLATES[aId]);
    const presetB = normalizePreset(BUILTIN_PRESET_TEMPLATES[bId]);
    const t = clamp(morph, 0, 1);

    const blendNumbers = (a, b) => a + (b - a) * t;
    const blendObject = (a, b) => {
      if (typeof a === "number" && typeof b === "number") {
        return blendNumbers(a, b);
      }
      if (typeof a === "boolean" || typeof b === "boolean") {
        return t < 0.5 ? a : b;
      }
      if (typeof a === "string" || typeof b === "string") {
        return t < 0.5 ? a : b;
      }
      if (Array.isArray(a) && Array.isArray(b)) {
        return t < 0.5 ? deepClone(a) : deepClone(b);
      }
      if (isObject(a) && isObject(b)) {
        const result = {};
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        keys.forEach((key) => {
          if (a[key] === undefined) {
            result[key] = deepClone(b[key]);
          } else if (b[key] === undefined) {
            result[key] = deepClone(a[key]);
          } else {
            result[key] = blendObject(a[key], b[key]);
          }
        });
        return result;
      }
      return t < 0.5 ? deepClone(a) : deepClone(b);
    };

    const blendModuleLists = (listA, listB, normalizer) => {
      const max = Math.max(listA.length, listB.length);
      const output = [];
      for (let index = 0; index < max; index += 1) {
        const modA = listA[index];
        const modB = listB[index];
        if (!modA) {
          output.push(normalizer(modB));
          continue;
        }
        if (!modB) {
          output.push(normalizer(modA));
          continue;
        }

        if (modA.type === modB.type) {
          const blended = blendObject(modA, modB);
          blended.id = createId("morph");
          output.push(normalizer(blended));
        } else {
          const chosen = t < 0.5 ? deepClone(modA) : deepClone(modB);
          chosen.id = createId("morph");
          if (typeof chosen.volume === "number" && typeof (t < 0.5 ? modB.volume : modA.volume) === "number") {
            chosen.volume = blendNumbers(modA.volume ?? chosen.volume, modB.volume ?? chosen.volume);
          }
          if (typeof chosen.pan === "number" && typeof (t < 0.5 ? modB.pan : modA.pan) === "number") {
            chosen.pan = blendNumbers(modA.pan ?? chosen.pan, modB.pan ?? chosen.pan);
          }
          output.push(normalizer(chosen));
        }
      }
      return output;
    };

    const blendRouteLists = (listA, listB) => {
      const max = Math.max(listA.length, listB.length);
      const output = [];
      for (let index = 0; index < max; index += 1) {
        const routeA = listA[index];
        const routeB = listB[index];
        if (!routeA) {
          output.push({ ...deepClone(routeB), id: createId("route") });
          continue;
        }
        if (!routeB) {
          output.push({ ...deepClone(routeA), id: createId("route") });
          continue;
        }

        if (routeA.target === routeB.target) {
          output.push({
            id: createId("route"),
            target: routeA.target,
            enabled: t < 0.5 ? routeA.enabled !== false : routeB.enabled !== false,
            amount: blendNumbers(Number(routeA.amount || 0), Number(routeB.amount || 0)),
          });
          continue;
        }

        output.push({ ...(t < 0.5 ? deepClone(routeA) : deepClone(routeB)), id: createId("route") });
      }
      return output;
    };

    return normalizePreset({
      name: `Morph ${presetA.name} / ${presetB.name}`,
      global: blendObject(presetA.global, presetB.global),
      filter: blendObject(presetA.filter, presetB.filter),
      envelope: blendObject(presetA.envelope, presetB.envelope),
      modEnvelope: blendObject(presetA.modEnvelope, presetB.modEnvelope),
      lfo: blendObject(presetA.lfo, presetB.lfo),
      modulation: {
        lfoRoutes: blendRouteLists(presetA.modulation.lfoRoutes, presetB.modulation.lfoRoutes),
        envelopeRoutes: blendRouteLists(presetA.modulation.envelopeRoutes, presetB.modulation.envelopeRoutes),
      },
      sources: blendModuleLists(presetA.sources, presetB.sources, normalizeSourceModule),
      components: blendModuleLists(presetA.components, presetB.components, normalizeComponentModule),
      effects: blendModuleLists(presetA.effects, presetB.effects, normalizeEffectModule),
    });
  }

  applyMorphState() {
    const nextState = this.blendPresets(this.performance.morphA, this.performance.morphB, this.performance.morph);
    const previousState = deepClone(this.state);
    this.state = nextState;
    this.selectedPresetId = this.performance.morph === 0 ? this.performance.morphA : this.performance.morph === 1 ? this.performance.morphB : "custom";
    this.renderAll(previousState);
    this.engine.fullSync(this.state);
    this.setStatus(`Morph ${Math.round(this.performance.morph * 100)}% between presets.`, this.audioBooted ? "live" : "neutral");
  }

  // Brightness 宏优先映射到滤波器亮度感最强的两个参数：cutoff 与 Q。
  applyBrightnessMacro(value) {
    const delta = value - this.performance.brightness;
    this.performance.brightness = value;
    this.selectedPresetId = "custom";

    this.state.filter.frequency = clamp(this.state.filter.frequency * Math.pow(2, delta * 2.4), 40, 12000);
    this.state.filter.Q = clamp(this.state.filter.Q + delta * 5, 0.001, 20);

    this.filterVisualizationBinding?.(this.state.filter);
    this.engine.updateFilter(this.state.filter);
    this.syncControlsFromState();
  }

  // Motion 宏优先映射到 LFO 速度/深度以及可感知明显的 effect wet / feedback。
  applyMotionMacro(value) {
    const delta = value - this.performance.motion;
    this.performance.motion = value;
    this.selectedPresetId = "custom";

    this.state.lfo.enabled = true;
    this.state.lfo.frequency = clamp(this.state.lfo.frequency + delta * 8, 0.05, 18);
    this.state.lfo.amount = clamp(this.state.lfo.amount + delta * 0.8, 0, 1);

    this.state.effects.forEach((module) => {
      if (typeof module.options.wet === "number") {
        module.options.wet = clamp(module.options.wet + delta * 0.35, 0, 1);
      }
      if (typeof module.options.feedback === "number") {
        module.options.feedback = clamp(module.options.feedback + delta * 0.22, 0, 0.95);
      }
    });

    this.engine.updateLfo(this.state.lfo);
    this.state.effects.forEach((module) => this.engine.updateEffect(module));
    this.syncControlsFromState();
  }

  // 随机化在保持当前机架结构不变的前提下，给各模块参数和连线路由重新赋值。
  randomizeCurrentPatch() {
    const randomChoice = (list) => list[Math.floor(Math.random() * list.length)];
    const randomRange = (min, max, step = 0.01) => {
      const steps = Math.round((max - min) / step);
      return min + Math.floor(Math.random() * (steps + 1)) * step;
    };
    const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const shuffle = (list) => {
      const next = [...list];
      for (let index = next.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
      }
      return next;
    };
    const createRandomRoutes = (targets, maxCount, amountScale = 0.75) =>
      shuffle(targets)
        .slice(0, Math.min(targets.length, maxCount))
        .map((target) => createModRoute(target.value, randomRange(-amountScale, amountScale, 0.01)));

    const applyDefinitionRandomness = (module, definition) => {
      definition.controls.forEach((control) => {
        if (control.kind === "select") {
          setByPath(module, control.path, randomChoice(control.options).value);
        } else {
          setByPath(module, control.path, randomRange(control.min, control.max, control.step));
        }
      });
    };

    const previousState = deepClone(this.state);
    this.state.global.volume = randomRange(-16, -4, 0.1);
    this.state.global.velocity = randomRange(0.55, 1, 0.01);
    this.state.filter.type = randomChoice(FILTER_TYPES).value;
    this.state.filter.frequency = randomRange(180, 8800, 1);
    this.state.filter.Q = randomRange(0.2, 8, 0.01);
    this.state.envelope.attack = randomRange(0.001, 0.18, 0.001);
    this.state.envelope.decay = randomRange(0.04, 0.7, 0.001);
    this.state.envelope.sustain = randomRange(0.2, 0.95, 0.01);
    this.state.envelope.release = randomRange(0.08, 2.8, 0.01);
    this.state.modEnvelope.enabled = Math.random() > 0.15;
    this.state.modEnvelope.attack = randomRange(0.001, 0.6, 0.001);
    this.state.modEnvelope.decay = randomRange(0.03, 1.4, 0.001);
    this.state.modEnvelope.sustain = randomRange(0, 1, 0.01);
    this.state.modEnvelope.release = randomRange(0.05, 3.2, 0.01);
    this.state.lfo.enabled = true;
    this.state.lfo.type = randomChoice(SHARED_WAVE_OPTIONS).value;
    this.state.lfo.frequency = randomRange(0.08, 9.5, 0.01);
    this.state.lfo.amount = randomRange(0.05, 0.75, 0.01);
    this.state.lfo.phase = randomRange(0, 360, 1);

    this.state.sources.forEach((module) => {
      module.volume = randomRange(-18, -4, 0.1);
      module.pan = randomRange(-0.45, 0.45, 0.01);
      applyDefinitionRandomness(module, SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator);
    });

    this.state.components.forEach((module) => applyDefinitionRandomness(module, COMPONENT_LIBRARY[module.type] || COMPONENT_LIBRARY.Compressor));
    this.state.effects.forEach((module) => applyDefinitionRandomness(module, EFFECT_LIBRARY[module.type] || EFFECT_LIBRARY.Chorus));

    const modulationTargets = getModulationTargets(this.state);
    this.state.modulation.lfoRoutes = createRandomRoutes(modulationTargets, randomInt(1, Math.min(3, modulationTargets.length || 1)), 0.8);
    this.state.modulation.envelopeRoutes = createRandomRoutes(modulationTargets, randomInt(1, Math.min(2, modulationTargets.length || 1)), 0.65);

    this.selectedPresetId = "custom";
    this.resetPerformanceControls();
    this.renderAll(previousState);
    this.engine.fullSync(this.state);
    this.setStatus("Randomized the current patch.", this.audioBooted ? "live" : "neutral");
  }

  // Web MIDI 接入入口。
  async requestMidiAccess() {
    if (!this.midi.supported) {
      this.midi.status = "Web MIDI unsupported";
      this.renderGlobalStrip();
      return;
    }

    try {
      await this.ensureAudioStarted();
      this.midi.access = this.midi.access || (await navigator.requestMIDIAccess());
      this.midi.access.onstatechange = () => {
        this.refreshMidiInputs();
        this.renderGlobalStrip();
        this.drawPatchCables();
      };
      this.refreshMidiInputs();
      this.renderGlobalStrip();
      this.setStatus("MIDI ready. Select an input and play hardware notes.", this.audioBooted ? "live" : "neutral");
    } catch (error) {
      this.midi.status = `MIDI failed: ${error.message}`;
      this.renderGlobalStrip();
      this.setStatus(this.midi.status, "error");
    }
  }

  // 刷新当前可用的 MIDI 输入设备列表，并尽量保留已有选择。
  refreshMidiInputs() {
    if (!this.midi.access) {
      this.midi.inputs = [];
      this.midi.status = "MIDI idle";
      return;
    }

    this.midi.inputs = Array.from(this.midi.access.inputs.values());
    if (!this.midi.inputs.length) {
      this.midi.selectedInputId = "";
      this.midi.status = "No MIDI inputs";
      return;
    }

    if (!this.midi.inputs.some((input) => input.id === this.midi.selectedInputId)) {
      this.midi.selectedInputId = this.midi.inputs[0].id;
    }

    this.selectMidiInput(this.midi.selectedInputId, false);
  }

  selectMidiInput(inputId, rerender = true) {
    this.midi.selectedInputId = inputId;
    this.midi.inputs.forEach((input) => {
      input.onmidimessage = input.id === inputId ? (event) => this.handleMidiMessage(event) : null;
    });

    const selected = this.midi.inputs.find((input) => input.id === inputId);
    this.midi.status = selected ? `MIDI ${selected.name || selected.id}` : "No MIDI input";
    if (rerender) {
      this.renderGlobalStrip();
    }
  }

  async handleMidiMessage(event) {
    // 当前只处理音符开/关消息，控制器映射可以后续继续扩展。
    const [status, data1, data2] = event.data;
    const command = status & 0xf0;
    const note = Tone.Frequency(data1, "midi").toNote();

    if (command === 0x90 && data2 > 0) {
      await this.ensureAudioStarted();
      const velocity = clamp(data2 / 127, 0.05, 1);
      this.midi.activeNotes.set(data1, note);
      this.pressNote(note, velocity);
      return;
    }

    if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      this.midi.activeNotes.delete(data1);
      this.releaseNote(note);
    }
  }

  updateTransportInfo() {
    if (this.elements.transportInfo) {
      this.elements.transportInfo.textContent = `Oct ${this.state.global.octave} / Vel ${Math.round(this.state.global.velocity * 100)}%`;
    }
  }

  // 电脑键盘映射：
  // A-K 演奏音高，Z/X 调整八度，C/V 调整默认力度。
  async onKeyDown(event) {
    const targetTag = event.target?.tagName;
    if (targetTag === "INPUT" || targetTag === "SELECT" || event.repeat) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "z") {
      this.state.global.octave = clamp(this.state.global.octave - 1, 1, 7);
      this.selectedPresetId = "custom";
      this.renderKeyboard();
      this.updateTransportInfo();
      return;
    }
    if (key === "x") {
      this.state.global.octave = clamp(this.state.global.octave + 1, 1, 7);
      this.selectedPresetId = "custom";
      this.renderKeyboard();
      this.updateTransportInfo();
      return;
    }
    if (key === "c") {
      this.state.global.velocity = clamp(Number((this.state.global.velocity - 0.05).toFixed(2)), 0.1, 1);
      this.selectedPresetId = "custom";
      this.updateTransportInfo();
      return;
    }
    if (key === "v") {
      this.state.global.velocity = clamp(Number((this.state.global.velocity + 0.05).toFixed(2)), 0.1, 1);
      this.selectedPresetId = "custom";
      this.updateTransportInfo();
      return;
    }

    const entry = KEYBOARD_LAYOUT.find((item) => item.key === key);
    if (!entry) {
      return;
    }

    await this.ensureAudioStarted();
    const note = noteFromOffset(this.state.global.octave, entry.offset);
    if (!this.heldComputerKeys.has(key)) {
      this.heldComputerKeys.set(key, note);
      this.pressNote(note);
      this.updateKeyboardKeyState(key, true);
    }
  }

  onKeyUp(event) {
    const key = event.key.toLowerCase();
    const note = this.heldComputerKeys.get(key);
    if (!note) {
      return;
    }

    this.heldComputerKeys.delete(key);
    this.releaseNote(note);
    this.updateKeyboardKeyState(key, false);
  }

  // activeNoteRefs 是简单的引用计数器，用来处理多输入源重复按住同一个音的情况。
  pressNote(note, velocity = this.state.global.velocity) {
    const count = this.activeNoteRefs.get(note) || 0;
    this.activeNoteRefs.set(note, count + 1);
    if (!count) {
      this.engine.attack(note, velocity);
    }
  }

  releaseNote(note) {
    const count = this.activeNoteRefs.get(note) || 0;
    if (count <= 1) {
      this.activeNoteRefs.delete(note);
      this.engine.release(note);
      return;
    }
    this.activeNoteRefs.set(note, count - 1);
  }

  updateKeyboardKeyState(boundKey, active) {
    const visualKey = this.elements.keyboard.querySelector(`[data-key="${boundKey}"]`);
    if (!visualKey) {
      return;
    }
    visualKey.classList.toggle("active", active);
  }

  drawPatchCables() {
    // 所有连线都会根据当前 DOM 位置重算，但真正绘制时会经过一层弹簧插值，
    // 这样模块重排和拖线时看起来更像一根有张力的线缆。
    const svg = this.elements.patchCables;
    const container = this.elements.signalFlow;
    if (!svg || !container) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const width = Math.round(container.scrollWidth || containerRect.width);
    const height = Math.round(container.scrollHeight || containerRect.height);

    const escapeSelector = (value) => {
      if (window.CSS?.escape) {
        return window.CSS.escape(value);
      }
      return String(value).replace(/["\\]/g, "\\$&");
    };

    const anchorSource = (sourceKey) => {
      const node = container.querySelector(`[data-mod-source="${escapeSelector(sourceKey)}"]`);
      if (!node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return {
        x: rect.left - containerRect.left + rect.width * 0.5,
        y: rect.top - containerRect.top + rect.height * 0.5,
      };
    };

    const anchorTarget = (targetId) => {
      const node = container.querySelector(`[data-mod-target="${escapeSelector(targetId)}"]`);
      if (!node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return {
        x: rect.left - containerRect.left + rect.width * 0.5,
        y: rect.top - containerRect.top + rect.height * 0.5,
      };
    };

    const modulationTargets = new Map(getModulationTargets(this.state).map((target) => [target.value, target]));
    const routes = [
      ...(this.state.modulation?.lfoRoutes || []).map((route) => ({
        ...route,
        accent: "lfo",
        color: "rgba(61, 127, 184, 0.92)",
        sourceKey: "lfoRoutes",
        sourceEnabled: this.state.lfo.enabled,
      })),
      ...(this.state.modulation?.envelopeRoutes || []).map((route) => ({
        ...route,
        accent: "env",
        color: "rgba(192, 160, 62, 0.92)",
        sourceKey: "envelopeRoutes",
        sourceEnabled: this.state.modEnvelope.enabled,
      })),
    ];

    this.patchScene = {
      width,
      height,
      routes: routes
        .filter((route) => route.enabled !== false && modulationTargets.has(route.target))
        .map((route) => ({
          id: route.id,
          routeKey: route.sourceKey,
          accent: route.accent,
          color: route.color,
          sourceEnabled: route.sourceEnabled,
          from: anchorSource(route.sourceKey),
          to: anchorTarget(route.target),
        }))
        .filter((route) => route.from && route.to),
      drag: null,
    };

    if (this.dragPatch) {
      const activeRoute = routes.find((route) => route.id === this.dragPatch.routeId);
      if (activeRoute) {
        const fixedFrom = anchorSource(activeRoute.sourceKey);
        const fixedTo = anchorTarget(activeRoute.target);
        if (fixedFrom && fixedTo) {
          this.patchScene.drag = {
            id: activeRoute.id,
            routeKey: activeRoute.sourceKey,
            accent: activeRoute.accent,
            color: activeRoute.color,
            sourceEnabled: activeRoute.sourceEnabled,
            from: this.dragPatch.endType === "source" ? this.dragPatch.point : fixedFrom,
            to: this.dragPatch.endType === "target" ? this.dragPatch.point : fixedTo,
          };
        }
      }
    }

    if (!this.patchFrame) {
      this.animatePatchCables();
    }
  }

  stepCableAnchor(anchorState, target, spring, damping) {
    const dx = target.x - anchorState.x;
    const dy = target.y - anchorState.y;
    anchorState.vx = (anchorState.vx + dx * spring) * damping;
    anchorState.vy = (anchorState.vy + dy * spring) * damping;
    anchorState.x += anchorState.vx;
    anchorState.y += anchorState.vy;

    const settled = Math.abs(dx) < 0.2 && Math.abs(dy) < 0.2 && Math.abs(anchorState.vx) < 0.2 && Math.abs(anchorState.vy) < 0.2;
    if (settled) {
      anchorState.x = target.x;
      anchorState.y = target.y;
      anchorState.vx = 0;
      anchorState.vy = 0;
    }
    return !settled;
  }

  animatePatchCables() {
    const svg = this.elements.patchCables;
    const scene = this.patchScene;
    if (!svg || !scene) {
      this.patchFrame = 0;
      return;
    }

    this.patchFrame = 0;
    svg.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);
    svg.innerHTML = "";

    const tension = clamp(Number(this.state.ui?.cableTension ?? 0.78), 0.2, 1);
    const spring = 0.06 + tension * 0.24;
    const damping = 0.72 + tension * 0.18;
    let shouldContinue = Boolean(this.dragPatch);
    const activeKeys = new Set();

    const createLine = (from, to, stroke, opacity) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${from.x} ${from.y} L ${to.x} ${to.y}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", stroke);
      path.setAttribute("stroke-width", "2.4");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("opacity", String(opacity));
      svg.append(path);
    };

    const createSocket = (point, fill, meta = null) => {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", String(point.x));
      dot.setAttribute("cy", String(point.y));
      dot.setAttribute("r", "5");
      dot.setAttribute("fill", fill);
      dot.setAttribute("opacity", "0.34");
      if (meta) {
        dot.setAttribute("class", "cable-socket is-interactive");
        dot.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.beginPatchDrag(event, meta.routeKey, meta.routeId, meta.accent, meta.endType);
        });
      }
      svg.append(dot);
    };

    const renderCable = (route, interactive = true) => {
      activeKeys.add(route.id);
      const visual = this.cableVisuals.get(route.id) || {
        from: { x: route.from.x, y: route.from.y, vx: 0, vy: 0 },
        to: { x: route.to.x, y: route.to.y, vx: 0, vy: 0 },
      };
      const movingFrom = this.stepCableAnchor(visual.from, route.from, spring, damping);
      const movingTo = this.stepCableAnchor(visual.to, route.to, spring, damping);
      this.cableVisuals.set(route.id, visual);
      if (movingFrom || movingTo) {
        shouldContinue = true;
      }

      const opacity = route.sourceEnabled ? 0.46 : 0.18;
      createLine(visual.from, visual.to, route.color, opacity);
      if (interactive) {
        createSocket(visual.from, route.color, {
          routeKey: route.routeKey,
          routeId: route.id,
          accent: route.accent,
          endType: "source",
        });
        createSocket(visual.to, route.color, {
          routeKey: route.routeKey,
          routeId: route.id,
          accent: route.accent,
          endType: "target",
        });
      } else {
        createSocket(visual.from, route.color);
        createSocket(visual.to, route.color);
      }
    };

    scene.routes.forEach((route) => {
      if (scene.drag?.id === route.id) {
        return;
      }
      renderCable(route, true);
    });

    if (scene.drag) {
      renderCable(scene.drag, false);
    }

    this.cableVisuals.forEach((_value, key) => {
      if (!activeKeys.has(key)) {
        this.cableVisuals.delete(key);
      }
    });

    if (shouldContinue) {
      this.patchFrame = requestAnimationFrame(() => this.animatePatchCables());
    }
  }

  resizeScopeCanvas() {
    // 把 canvas 的实际像素尺寸同步到 CSS 尺寸 * DPR，避免高分屏模糊。
    const canvas = this.elements.oscilloscope;
    if (!canvas || !this.scopeContext) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    this.scopeContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  drawOscilloscope() {
    // 示例波器持续重绘；当音频尚未启动时则显示占位提示文本。
    requestAnimationFrame(() => this.drawOscilloscope());

    const canvas = this.elements.oscilloscope;
    const context = this.scopeContext;
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

    const analyser = this.engine.getAnalyser();
    if (!analyser || !this.audioBooted) {
      context.fillStyle = "rgba(114, 103, 87, 0.78)";
      context.font = '500 16px "IBM Plex Sans"';
      context.fillText("Waveform will appear after the first interaction.", 24, 34);
      return;
    }

    const waveform = analyser.getValue();
    context.strokeStyle = "#2e8ea7";
    context.lineWidth = 2;
    context.beginPath();

    waveform.forEach((sample, index) => {
      const x = (index / (waveform.length - 1)) * width;
      const y = height * 0.5 + sample * height * 0.34;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });

    context.stroke();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  try {
    // 页面加载完成后创建应用实例，音频仍然等待第一次真实交互再启动。
    const app = new ModularSynthApp();
    if (!Tone) {
      app.setStatus("Tone.js failed to load. The UI is available, but audio is disabled until the CDN script loads.", "error");
    }
  } catch (error) {
    console.error("Failed to initialize ModularSynthApp:", error);
    const status = document.getElementById("statusText");
    const dot = document.getElementById("statusDot");
    if (status) {
      status.textContent = `Initialization failed: ${error.message}`;
    }
    dot?.classList.add("error");
  }
});
