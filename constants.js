/**
 * constants.js
 * 常量和配置定义
 * 
 * 包含：
 * - 格式化函数（用于库配置中的 formatter）
 * - 音名表和键盘布局
 * - 波形和噪声类型选项
 * - 模块库定义（声源、效果器、组件）
 * - 滤波器类型
 * - 内置预设模板
 */

const Tone = window.Tone || null;

/* -------------------------------------------------------------------------- */
/* 格式化函数                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 格式化普通数值
 * @param {number} value - 要格式化的值
 * @returns {string} - 格式化后的字符串
 */
function formatPlain(value) {
  return Number(value).toFixed(Math.abs(value) < 10 ? 2 : 1).replace(/\.0+$/, "");
}

/**
 * 格式化秒数
 * @param {number} value - 秒数
 * @returns {string} - 格式化后的字符串
 */
function formatSeconds(value) {
  return `${Number(value).toFixed(value < 0.1 ? 3 : value < 1 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, "")}s`;
}

/**
 * 格式化百分比
 * @param {number} value - 百分比值 (0-1)
 * @returns {string} - 格式化后的字符串
 */
function formatPercent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

/**
 * 格式化分贝值
 * @param {number} value - 分贝值
 * @returns {string} - 格式化后的字符串
 */
function formatDb(value) {
  return `${Number(value).toFixed(1)} dB`;
}

/**
 * 格式化音分值
 * @param {number} value - 音分值
 * @returns {string} - 格式化后的字符串
 */
function formatCents(value) {
  return `${Math.round(value)} ct`;
}

/**
 * 格式化比率
 * @param {number} value - 比率值
 * @returns {string} - 格式化后的字符串
 */
function formatRatio(value) {
  return `${Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}:1`;
}

/**
 * 格式化赫兹值
 * @param {number} value - 赫兹值
 * @returns {string} - 格式化后的字符串
 */
function formatHertz(value) {
  return `${Number(value).toFixed(value < 1 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, "")} Hz`;
}

/**
 * 格式化频率值
 * @param {number} value - 频率值
 * @returns {string} - 格式化后的字符串
 */
function formatFrequency(value) {
  if (value >= 1000) {
    return `${Number(value / 1000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} kHz`;
  }
  return `${Math.round(value)} Hz`;
}

/**
 * 格式化倍数
 * @param {number} value - 倍数值
 * @returns {string} - 格式化后的字符串
 */
function formatMultiplier(value) {
  return `${Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`;
}

/* -------------------------------------------------------------------------- */
/* 音名和键盘布局                                                            */
/* -------------------------------------------------------------------------- */

// 12 平均律音名表，用于把键盘偏移量映射成真实音名
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// 虚拟键盘布局描述：
// key 是电脑键盘按键，offset 是相对当前八度的半音偏移，
// whiteIndex 用于计算白键/黑键的可视位置
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

// 在多个模块间复用的波形选项
const SHARED_WAVE_OPTIONS = [
  { label: "Sine", value: "sine" },
  { label: "Triangle", value: "triangle" },
  { label: "Saw", value: "sawtooth" },
  { label: "Square", value: "square" },
];

// 噪声类型选项
const NOISE_TYPE_OPTIONS = [
  { label: "White", value: "white" },
  { label: "Pink", value: "pink" },
  { label: "Brown", value: "brown" },
];

// 根音符选项（6个八度）
const ROOT_NOTE_OPTIONS = Array.from({ length: 6 * 12 }, (_, index) => {
  const octave = 1 + Math.floor(index / 12);
  const note = `${NOTE_NAMES[index % 12]}${octave}`;
  return { label: note, value: note };
});

/* -------------------------------------------------------------------------- */
/* 样本生成工具                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 生成样本数据的 Data URL
 * @param {Object} options - 生成选项
 * @returns {string} - WAV 格式的 Data URL
 */
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

  // WAV 文件头
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

  // 生成音频样本
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

  // 转换为 Base64 Data URL
  let binary = "";
  const bytes = new Uint8Array(buffer);
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/**
 * 读取文件为 Data URL
 * @param {File} file - 要读取的文件
 * @returns {Promise<string>} - Data URL
 */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read audio file."));
    reader.readAsDataURL(file);
  });
}

// 默认样本库
const DEFAULT_SAMPLE_LIBRARY = {
  pluck: createSampleDataUrl({ mode: "pluck", frequency: 196, duration: 0.24 }),
  bell: createSampleDataUrl({ mode: "bell", frequency: 440, duration: 0.62 }),
  texture: createSampleDataUrl({ mode: "texture", frequency: 140, duration: 0.46 }),
};

/* -------------------------------------------------------------------------- */
/* 模块库定义                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 声源库
 * runtime 用来描述当前 source 在 AudioEngine 中该如何实例化和触发
 * controls 只负责 UI 层暴露哪些参数，不直接参与 Tone.js 节点创建
 */

const SOURCE_LIBRARY = {
  Noise: {
    accent: "source",
    tag: "Osc",
    runtime: "noise",
    options: { type: "pink", playbackRate: 1 },
    controls: [
      { path: "options.type", kind: "select", label: "Color", options: NOISE_TYPE_OPTIONS },
      { path: "options.playbackRate", kind: "range", label: "Rate", min: 0.1, max: 1, step: 0.01, formatter: formatMultiplier },
    ],
  },
  Oscillator: {
    accent: "source",
    tag: "Osc",
    runtime: "pitchedSource",
    options: { type: "sawtooth", detune: 0, phase: 0 },
    controls: [
      { path: "options.type", kind: "select", label: "Wave", options: SHARED_WAVE_OPTIONS },
      { path: "options.phase", kind: "range", label: "Phase", min: 0, max: 360, step: 1, formatter: (value) => `${Math.round(value)}deg` },
      { path: "options.detune", kind: "range", label: "Detune", min: -1200, max: 1200, step: 1, formatter: formatCents },
    ],
  },
  Player: {
    accent: "source",
    tag: "Osc",
    runtime: "player",
    moduleDefaults: { rootNote: "C4", assetName: "Factory Pluck" },
    options: { url: DEFAULT_SAMPLE_LIBRARY.pluck, playbackRate: 1, loop: false, reverse: false, loopStart: 0, loopEnd: 0 },
    controls: [
      { path: "rootNote", kind: "select", label: "Root", options: ROOT_NOTE_OPTIONS },
      { path: "options.playbackRate", kind: "range", label: "Rate", min: 0.1, max: 3, step: 0.01, formatter: formatMultiplier },
      { path: "options.loop", kind: "toggle", label: "Loop" },
      { path: "options.loopStart", kind: "range", label: "Loop In", min: 0, max: 12, step: 0.01, formatter: formatSeconds },
      { path: "options.loopEnd", kind: "range", label: "Loop Out", min: 0, max: 12, step: 0.01, formatter: formatSeconds },
      { path: "options.reverse", kind: "toggle", label: "Reverse" },
    ],
  },
  PulseOscillator: {
    accent: "source",
    tag: "Osc",
    runtime: "pitchedSource",
    options: { width: 0.22, detune: 0, phase: 0 },
    controls: [
      { path: "options.width", kind: "range", label: "Width", min: 0.01, max: 0.99, step: 0.001, formatter: formatPercent },
      { path: "options.phase", kind: "range", label: "Phase", min: 0, max: 360, step: 1, formatter: (value) => `${Math.round(value)}deg` },
      { path: "options.detune", kind: "range", label: "Detune", min: -1200, max: 1200, step: 1, formatter: formatCents },
    ],
  },
};

/**
 * 效果器库
 * 效果器与 component 一样都会被串到主信号链上
 */
const EFFECT_LIBRARY = {
  AutoFilter: {
    accent: "fx",
    tag: "Effect",
    options: { frequency: 1.2, depth: 0.72, octaves: 2, baseFrequency: 240, type: "sine", filter: { type: "lowpass", Q: 1, rolloff: -12 }, wet: 0.34 },
    controls: [
      { path: "options.frequency", kind: "range", label: "Rate", min: 0.05, max: 12, step: 0.05, formatter: formatHertz },
      { path: "options.depth", kind: "range", label: "Depth", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.octaves", kind: "range", label: "Octave", min: 0.5, max: 6, step: 0.1, formatter: formatPlain },
      { path: "options.baseFrequency", kind: "range", label: "Base Frequency", min: 20, max: 2000, step: 1, formatter: formatFrequency },
      { path: "options.type", kind: "select", label: "LFO Type", options: SHARED_WAVE_OPTIONS },
      { path: "options.filter.type", kind: "select", label: "Filter", options: [
        { label: "Low-pass", value: "lowpass" },
        { label: "High-pass", value: "highpass" },
        { label: "Band-pass", value: "bandpass" },
        { label: "Notch", value: "notch" },
      ]},
      { path: "options.filter.Q", kind: "range", label: "Q", min: 0.1, max: 20, step: 0.1, formatter: formatPlain },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  AutoPanner: {
    accent: "fx",
    tag: "Effect",
    options: { frequency: 1.5, depth: 0.8, type: "sine", wet: 0.3 },
    controls: [
      { path: "options.frequency", kind: "range", label: "Rate", min: 0.1, max: 12, step: 0.1, formatter: formatHertz },
      { path: "options.depth", kind: "range", label: "Depth", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.type", kind: "select", label: "Type", options: SHARED_WAVE_OPTIONS },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  AutoWah: {
    accent: "fx",
    tag: "Effect",
    options: { baseFrequency: 120, octaves: 5, sensitivity: 0.5, Q: 6, gain: 2, wet: 0.4 },
    controls: [
      { path: "options.baseFrequency", kind: "range", label: "Base Frequency", min: 20, max: 500, step: 1, formatter: formatFrequency },
      { path: "options.octaves", kind: "range", label: "Octave", min: 1, max: 8, step: 0.5, formatter: formatPlain },
      { path: "options.sensitivity", kind: "range", label: "Sensitivity", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.Q", kind: "range", label: "Q", min: 0.5, max: 20, step: 0.1, formatter: formatPlain },
      { path: "options.gain", kind: "range", label: "Gain", min: 0, max: 10, step: 0.1, formatter: formatMultiplier },
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
  Chebyshev: {
    accent: "fx",
    tag: "Effect",
    options: { order: 50, wet: 0.2 },
    controls: [
      { path: "options.order", kind: "range", label: "Order", min: 1, max: 100, step: 1, formatter: formatPlain },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  Chorus: {
    accent: "fx",
    tag: "Effect",
    options: { frequency: 1.2, delayTime: 2.2, depth: 0.48, type: "sine", spread: 180, feedback: 0.2, wet: 0.42 },
    controls: [
      { path: "options.frequency", kind: "range", label: "Rate", min: 0.1, max: 12, step: 0.1, formatter: formatHertz },
      { path: "options.delayTime", kind: "range", label: "Delay", min: 0.5, max: 10, step: 0.1, formatter: (value) => `${Math.round(value)} ms` },
      { path: "options.depth", kind: "range", label: "Depth", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.type", kind: "select", label: "Type", options: SHARED_WAVE_OPTIONS },
      { path: "options.feedback", kind: "range", label: "Feedback", min: 0, max: 0.95, step: 0.01, formatter: formatPercent },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  Distortion: {
    accent: "fx",
    tag: "Effect",
    options: { distortion: 0.22, oversample: "4x", wet: 0.16 },
    controls: [
      { path: "options.distortion", kind: "range", label: "Drive", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.oversample", kind: "select", label: "Oversample", options: [
        { label: "None", value: "none" },
        { label: "2x", value: "2x" },
        { label: "4x", value: "4x" },
      ]},
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
  Freeverb: {
    accent: "fx",
    tag: "Effect",
    options: { roomSize: 0.7, dampening: 3000, wet: 0.3 },
    controls: [
      { path: "options.roomSize", kind: "range", label: "Room", min: 0.1, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.dampening", kind: "range", label: "Damp", min: 100, max: 10000, step: 100, formatter: formatFrequency },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  FrequencyShifter: {
    accent: "fx",
    tag: "Effect",
    options: { frequency: 42, wet: 0.25 },
    controls: [
      { path: "options.frequency", kind: "range", label: "Shift", min: -500, max: 500, step: 1, formatter: formatHertz },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  JCReverb: {
    accent: "fx",
    tag: "Effect",
    options: { roomSize: 0.5, wet: 0.2 },
    controls: [
      { path: "options.roomSize", kind: "range", label: "Room", min: 0.01, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  Phaser: {
    accent: "fx",
    tag: "Effect",
    options: { frequency: 0.5, octaves: 3, baseFrequency: 350, Q: 10, wet: 0.26 },
    controls: [
      { path: "options.frequency", kind: "range", label: "Rate", min: 0.05, max: 12, step: 0.05, formatter: formatHertz },
      { path: "options.octaves", kind: "range", label: "Span", min: 0.5, max: 6, step: 0.1, formatter: formatPlain },
      { path: "options.baseFrequency", kind: "range", label: "Base Frequency", min: 50, max: 2000, step: 1, formatter: formatFrequency },
      { path: "options.Q", kind: "range", label: "Q", min: 0.1, max: 20, step: 0.1, formatter: formatPlain },
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
  PitchShift: {
    accent: "fx",
    tag: "Effect",
    options: { pitch: 0, windowSize: 0.1, feedback: 0, wet: 1 },
    controls: [
      { path: "options.pitch", kind: "range", label: "Pitch", min: -24, max: 24, step: 1, formatter: (value) => `${value > 0 ? "+" : ""}${value} st` },
      { path: "options.windowSize", kind: "range", label: "Window", min: 0.01, max: 0.5, step: 0.01, formatter: formatSeconds },
      { path: "options.feedback", kind: "range", label: "Feedback", min: 0, max: 0.9, step: 0.01, formatter: formatPercent },
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
  StereoWidener: {
    accent: "fx",
    tag: "Effect",
    options: { width: 0.5, wet: 0.3 },
    controls: [
      { path: "options.width", kind: "range", label: "Width", min: 0, max: 1, step: 0.01, formatter: formatPercent },
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
      { path: "options.spread", kind: "range", label: "Spread", min: 0, max: 180, step: 1, formatter: (value) => `${Math.round(value)}°` },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
  Vibrato: {
    accent: "fx",
    tag: "Effect",
    options: { frequency: 5, depth: 0.1, maxDelay: 0.005, wet: 0.3 },
    controls: [
      { path: "options.frequency", kind: "range", label: "Rate", min: 0.1, max: 20, step: 0.1, formatter: formatHertz },
      { path: "options.depth", kind: "range", label: "Depth", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.maxDelay", kind: "range", label: "Max Delay", min: 0.001, max: 0.02, step: 0.001, formatter: formatSeconds },
      { path: "options.wet", kind: "range", label: "Wet", min: 0, max: 1, step: 0.01, formatter: formatPercent },
    ],
  },
};

/**
 * 组件库
 * 相较于 effect，更偏工具型或增益结构型节点
 */
const COMPONENT_LIBRARY = {
  Filter: {
    accent: "component",
    tag: "Component",
    options: { type: "lowpass", frequency: 2200, Q: 0.6, rolloff: -24 },
    controls: [
      { path: "options.type", kind: "select", label: "Type", options: [
        { label: "Low-pass", value: "lowpass" },
        { label: "Band-pass", value: "bandpass" },
        { label: "High-pass", value: "highpass" },
        { label: "Notch", value: "notch" },
      ] },
      { path: "options.rolloff", kind: "select", label: "Slope", options: [
        { label: "-12 dB", value: -12 },
        { label: "-24 dB", value: -24 },
        { label: "-48 dB", value: -48 },
        { label: "-96 dB", value: -96 },
      ]},
      { path: "options.frequency", kind: "range", label: "Cutoff", min: 40, max: 12000, step: 1, formatter: formatFrequency },
      { path: "options.Q", kind: "range", label: "Q", min: 0.001, max: 20, step: 0.001, formatter: formatPlain },
    ],
  },
  AmplitudeEnvelope: {
    accent: "env",
    tag: "Component",
    options: { attack: 0.02, decay: 0.18, sustain: 0.82, release: 0.65 },
    controls: [
      { path: "options.attack", kind: "range", label: "Attack", min: 0.001, max: 4, step: 0.001, formatter: formatSeconds },
      { path: "options.decay", kind: "range", label: "Decay", min: 0.001, max: 4, step: 0.001, formatter: formatSeconds },
      { path: "options.sustain", kind: "range", label: "Sustain", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.release", kind: "range", label: "Release", min: 0.001, max: 4, step: 0.001, formatter: formatSeconds },
    ],
  },
  Envelope: {
    accent: "modulation",
    tag: "Mod",
    options: { attack: 0.02, decay: 0.18, sustain: 0.82, release: 0.65 },
    controls: [
      { path: "options.attack", kind: "range", label: "Attack", min: 0.001, max: 4, step: 0.001, formatter: formatSeconds },
      { path: "options.decay", kind: "range", label: "Decay", min: 0.001, max: 4, step: 0.001, formatter: formatSeconds },
      { path: "options.sustain", kind: "range", label: "Sustain", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.release", kind: "range", label: "Release", min: 0.001, max: 4, step: 0.001, formatter: formatSeconds },
    ],
  },
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
