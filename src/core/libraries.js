import {
  formatPlain,
  formatSeconds,
  formatPercent,
  formatDb,
  formatCents,
  formatRatio,
  formatHertz,
  formatFrequency,
  formatMultiplier,
} from "./formatters.js";

import { NOTE_NAMES } from "./keyboard.js";

import { DEFAULT_SAMPLE_LIBRARY } from "./samples.js";

export const SHARED_WAVE_OPTIONS = [
  { label: "Sine", value: "sine" },
  { label: "Triangle", value: "triangle" },
  { label: "Saw", value: "sawtooth" },
  { label: "Square", value: "square" },
];

export const NOISE_TYPE_OPTIONS = [
  { label: "White", value: "white" },
  { label: "Pink", value: "pink" },
  { label: "Brown", value: "brown" },
];

export const ROOT_NOTE_OPTIONS = Array.from({ length: 6 * 12 }, (_, index) => {
  const octave = 1 + Math.floor(index / 12);
  const note = `${NOTE_NAMES[index % 12]}${octave}`;
  return { label: note, value: note };
});

export const SOURCE_LIBRARY = {
  Noise: {
    accent: "source",
    tag: "Osc",
    runtime: "noise",
    options: { type: "pink", playbackRate: 1 },
    controls: [
      { path: "pan", kind: "range", label: "Pan", min: -1, max: 1, step: 0.01, formatter: (value) => `${value > 0 ? "R" : value < 0 ? "L" : "C"} ${Math.round(Math.abs(value) * 100)}` },
      { path: "volume", kind: "range", label: "Level", min: -48, max: 6, step: 0.1, formatter: formatDb },
      { path: "options.type", kind: "select", label: "Color", options: NOISE_TYPE_OPTIONS },
      { path: "options.playbackRate", kind: "range", label: "Rate", min: 0.1, max: 1, step: 0.01, formatter: formatMultiplier },
    ],
  },
  Oscillator: {
    accent: "source",
    tag: "Osc",
    runtime: "pitchedSource",
    options: { type: "sawtooth", detune: 0, phase: 0, octave: 0 },
    controls: [
      { path: "pan", kind: "range", label: "Pan", min: -1, max: 1, step: 0.01, formatter: (value) => `${value > 0 ? "R" : value < 0 ? "L" : "C"} ${Math.round(Math.abs(value) * 100)}` },
      { path: "volume", kind: "range", label: "Level", min: -48, max: 6, step: 0.1, formatter: formatDb },
      { path: "options.type", kind: "select", label: "Wave", options: SHARED_WAVE_OPTIONS },
      { path: "options.phase", kind: "range", label: "Phase", min: 0, max: 360, step: 1, formatter: (value) => `${Math.round(value)}deg` },
      { path: "options.detune", kind: "range", label: "Detune", min: -1200, max: 1200, step: 1, formatter: formatCents },
      { path: "options.octave", kind: "range", label: "Octave", min: -3, max: 3, step: 1, formatter: (value) => `Oct ${value > 0 ? "+" : ""}${value}` },
    ],
  },
  Player: {
    accent: "source",
    tag: "Osc",
    runtime: "player",
    moduleDefaults: { rootNote: "C4", assetName: "Factory Pluck" },
    options: { url: DEFAULT_SAMPLE_LIBRARY.pluck, playbackRate: 1, loop: false, reverse: false, loopStart: 0, loopEnd: 0 },
    controls: [
      { path: "pan", kind: "range", label: "Pan", min: -1, max: 1, step: 0.01, formatter: (value) => `${value > 0 ? "R" : value < 0 ? "L" : "C"} ${Math.round(Math.abs(value) * 100)}` },
      { path: "volume", kind: "range", label: "Level", min: -48, max: 6, step: 0.1, formatter: formatDb },
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
    options: { width: 0.22, detune: 0, phase: 0, octave: 0 },
    controls: [
      { path: "pan", kind: "range", label: "Pan", min: -1, max: 1, step: 0.01, formatter: (value) => `${value > 0 ? "R" : value < 0 ? "L" : "C"} ${Math.round(Math.abs(value) * 100)}` },
      { path: "volume", kind: "range", label: "Level", min: -48, max: 6, step: 0.1, formatter: formatDb },
      { path: "options.width", kind: "range", label: "Width", min: 0.01, max: 0.99, step: 0.001, formatter: formatPercent },
      { path: "options.phase", kind: "range", label: "Phase", min: 0, max: 360, step: 1, formatter: (value) => `${Math.round(value)}deg` },
      { path: "options.detune", kind: "range", label: "Detune", min: -1200, max: 1200, step: 1, formatter: formatCents },
      { path: "options.octave", kind: "range", label: "Octave", min: -3, max: 3, step: 1, formatter: (value) => `Oct ${value > 0 ? "+" : ""}${value}` },
    ],
  },
};

export const EFFECT_LIBRARY = {
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

export const COMPONENT_LIBRARY = {
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
    options: { attack: 0.02, decay: 0.18, sustain: 0.82, release: 0.65, gain: 1 },
    controls: [
      { path: "options.attack", kind: "range", label: "Attack", min: 0.001, max: 4, step: 0.001, formatter: formatSeconds },
      { path: "options.decay", kind: "range", label: "Decay", min: 0.001, max: 4, step: 0.001, formatter: formatSeconds },
      { path: "options.sustain", kind: "range", label: "Sustain", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.release", kind: "range", label: "Release", min: 0.001, max: 4, step: 0.001, formatter: formatSeconds },
      { path: "options.gain", kind: "range", label: "Depth", min: 0, max: 100, step: 0.01, formatter: formatMultiplier },
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
