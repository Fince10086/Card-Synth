const Tone = window.Tone || null;

/* -------------------------------------------------------------------------- */
/* Module library and preset templates                                         */
/* -------------------------------------------------------------------------- */

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const KEYBOARD_LAYOUT = [
  { key: "a", offset: 0, whiteIndex: 0, black: false },
  { key: "w", offset: 1, whiteIndex: 0.68, black: true },
  { key: "s", offset: 2, whiteIndex: 1, black: false },
  { key: "e", offset: 3, whiteIndex: 1.68, black: true },
  { key: "d", offset: 4, whiteIndex: 2, black: false },
  { key: "f", offset: 5, whiteIndex: 3, black: false },
  { key: "t", offset: 6, whiteIndex: 3.68, black: true },
  { key: "g", offset: 7, whiteIndex: 4, black: false },
  { key: "y", offset: 8, whiteIndex: 4.68, black: true },
  { key: "h", offset: 9, whiteIndex: 5, black: false },
  { key: "u", offset: 10, whiteIndex: 5.68, black: true },
  { key: "j", offset: 11, whiteIndex: 6, black: false },
  { key: "k", offset: 12, whiteIndex: 7, black: false },
];

const SHARED_WAVE_OPTIONS = [
  { label: "Sine", value: "sine" },
  { label: "Triangle", value: "triangle" },
  { label: "Saw", value: "sawtooth" },
  { label: "Square", value: "square" },
];

const SOURCE_LIBRARY = {
  Synth: {
    accent: "source",
    tag: "Instrument",
    runtime: "poly",
    voiceClass: "Synth",
    options: {
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.01, decay: 0.12, sustain: 0.72, release: 0.8 },
      detune: 0,
      portamento: 0.02,
    },
    controls: [
      { path: "options.oscillator.type", kind: "select", label: "Wave", options: SHARED_WAVE_OPTIONS },
      { path: "options.detune", kind: "range", label: "Detune", min: -1200, max: 1200, step: 1, formatter: formatCents },
      { path: "options.envelope.attack", kind: "range", label: "Attack", min: 0.001, max: 2, step: 0.001, formatter: formatSeconds },
      { path: "options.envelope.release", kind: "range", label: "Release", min: 0.05, max: 4, step: 0.01, formatter: formatSeconds },
    ],
  },
  MonoSynth: {
    accent: "source",
    tag: "Instrument",
    runtime: "poly",
    voiceClass: "MonoSynth",
    options: {
      oscillator: { type: "square" },
      envelope: { attack: 0.02, decay: 0.16, sustain: 0.58, release: 0.8 },
      filterEnvelope: { attack: 0.02, decay: 0.22, sustain: 0.24, release: 1.1, baseFrequency: 180, octaves: 3.4 },
      detune: 0,
      portamento: 0.03,
    },
    controls: [
      { path: "options.oscillator.type", kind: "select", label: "Wave", options: SHARED_WAVE_OPTIONS },
      { path: "options.filterEnvelope.baseFrequency", kind: "range", label: "Base", min: 80, max: 2000, step: 1, formatter: formatFrequency },
      { path: "options.envelope.attack", kind: "range", label: "Attack", min: 0.001, max: 1.5, step: 0.001, formatter: formatSeconds },
      { path: "options.envelope.release", kind: "range", label: "Release", min: 0.05, max: 4, step: 0.01, formatter: formatSeconds },
    ],
  },
  AMSynth: {
    accent: "source",
    tag: "Instrument",
    runtime: "poly",
    voiceClass: "AMSynth",
    options: {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.02, decay: 0.08, sustain: 0.86, release: 1.4 },
      modulation: { type: "square" },
      modulationEnvelope: { attack: 0.25, decay: 0.1, sustain: 1, release: 1.2 },
      harmonicity: 1.5,
      detune: 0,
    },
    controls: [
      { path: "options.oscillator.type", kind: "select", label: "Carrier", options: SHARED_WAVE_OPTIONS },
      { path: "options.harmonicity", kind: "range", label: "Ratio", min: 0.25, max: 5, step: 0.01, formatter: formatRatio },
      { path: "options.envelope.attack", kind: "range", label: "Attack", min: 0.001, max: 1.5, step: 0.001, formatter: formatSeconds },
      { path: "options.modulationEnvelope.release", kind: "range", label: "Mod Rel", min: 0.05, max: 4, step: 0.01, formatter: formatSeconds },
    ],
  },
  DuoSynth: {
    accent: "source",
    tag: "Instrument",
    runtime: "poly",
    voiceClass: "DuoSynth",
    options: {
      harmonicity: 1.5,
      vibratoAmount: 0.35,
      vibratoRate: 4.5,
      voice0: {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.01, decay: 0.06, sustain: 0.72, release: 1.3 },
      },
      voice1: {
        oscillator: { type: "square" },
        envelope: { attack: 0.04, decay: 0.12, sustain: 0.62, release: 1.1 },
      },
    },
    controls: [
      { path: "options.voice0.oscillator.type", kind: "select", label: "Voice A", options: SHARED_WAVE_OPTIONS },
      { path: "options.harmonicity", kind: "range", label: "Offset", min: 0.4, max: 3.5, step: 0.01, formatter: formatRatio },
      { path: "options.vibratoAmount", kind: "range", label: "Vibrato", min: 0, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.vibratoRate", kind: "range", label: "Rate", min: 0.1, max: 12, step: 0.1, formatter: formatHertz },
    ],
  },
  FMSynth: {
    accent: "source",
    tag: "Instrument",
    runtime: "poly",
    voiceClass: "FMSynth",
    options: {
      oscillator: { type: "sine" },
      envelope: { attack: 0.01, decay: 0.14, sustain: 0.5, release: 1.4 },
      modulation: { type: "triangle" },
      modulationEnvelope: { attack: 0.08, decay: 0.04, sustain: 1, release: 1.2 },
      harmonicity: 1.5,
      modulationIndex: 8,
    },
    controls: [
      { path: "options.oscillator.type", kind: "select", label: "Carrier", options: SHARED_WAVE_OPTIONS },
      { path: "options.harmonicity", kind: "range", label: "Ratio", min: 0.25, max: 8, step: 0.01, formatter: formatRatio },
      { path: "options.modulationIndex", kind: "range", label: "Index", min: 0, max: 40, step: 0.1, formatter: formatPlain },
      { path: "options.envelope.release", kind: "range", label: "Release", min: 0.05, max: 4, step: 0.01, formatter: formatSeconds },
    ],
  },
  MembraneSynth: {
    accent: "source",
    tag: "Instrument",
    runtime: "poly",
    voiceClass: "MembraneSynth",
    options: {
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4 },
      pitchDecay: 0.08,
      octaves: 6.4,
    },
    controls: [
      { path: "options.oscillator.type", kind: "select", label: "Wave", options: SHARED_WAVE_OPTIONS },
      { path: "options.pitchDecay", kind: "range", label: "Pitch Dec", min: 0.001, max: 0.6, step: 0.001, formatter: formatSeconds },
      { path: "options.octaves", kind: "range", label: "Octaves", min: 1, max: 10, step: 0.1, formatter: formatPlain },
      { path: "options.envelope.release", kind: "range", label: "Release", min: 0.05, max: 4, step: 0.01, formatter: formatSeconds },
    ],
  },
  MetalSynth: {
    accent: "source",
    tag: "Instrument",
    runtime: "poly",
    voiceClass: "MetalSynth",
    options: {
      envelope: { attack: 0.001, decay: 0.28, release: 0.4 },
      harmonicity: 4.2,
      modulationIndex: 18,
      resonance: 2800,
    },
    controls: [
      { path: "options.harmonicity", kind: "range", label: "Ratio", min: 0.5, max: 8, step: 0.01, formatter: formatRatio },
      { path: "options.modulationIndex", kind: "range", label: "Index", min: 1, max: 60, step: 0.1, formatter: formatPlain },
      { path: "options.resonance", kind: "range", label: "Resonance", min: 50, max: 8000, step: 1, formatter: formatFrequency },
      { path: "options.envelope.decay", kind: "range", label: "Decay", min: 0.02, max: 2, step: 0.01, formatter: formatSeconds },
    ],
  },
  PluckSynth: {
    accent: "source",
    tag: "Instrument",
    runtime: "pluck",
    voiceClass: "PluckSynth",
    options: {
      attackNoise: 0.8,
      dampening: 3600,
      resonance: 0.88,
      release: 0.8,
    },
    controls: [
      { path: "options.attackNoise", kind: "range", label: "Noise", min: 0.1, max: 8, step: 0.01, formatter: formatPlain },
      { path: "options.dampening", kind: "range", label: "Damp", min: 400, max: 9000, step: 1, formatter: formatFrequency },
      { path: "options.resonance", kind: "range", label: "Reson", min: 0.1, max: 1, step: 0.01, formatter: formatPercent },
      { path: "options.release", kind: "range", label: "Release", min: 0.05, max: 4, step: 0.01, formatter: formatSeconds },
    ],
  },
  NoiseSynth: {
    accent: "source",
    tag: "Instrument",
    runtime: "noiseSynth",
    voiceClass: "NoiseSynth",
    options: {
      noise: { type: "pink" },
      envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.4 },
    },
    controls: [
      {
        path: "options.noise.type",
        kind: "select",
        label: "Color",
        options: [
          { label: "White", value: "white" },
          { label: "Pink", value: "pink" },
          { label: "Brown", value: "brown" },
        ],
      },
      { path: "options.envelope.attack", kind: "range", label: "Attack", min: 0.001, max: 1, step: 0.001, formatter: formatSeconds },
      { path: "options.envelope.decay", kind: "range", label: "Decay", min: 0.01, max: 1.2, step: 0.001, formatter: formatSeconds },
      { path: "options.envelope.release", kind: "range", label: "Release", min: 0.01, max: 2, step: 0.01, formatter: formatSeconds },
    ],
  },
  OmniOscillator: {
    accent: "source",
    tag: "Source",
    runtime: "rawOscillator",
    voiceClass: "OmniOscillator",
    options: {
      type: "sawtooth",
      detune: 0,
    },
    ampEnvelope: {
      attack: 0.01,
      decay: 0.14,
      sustain: 0.78,
      release: 0.8,
    },
    controls: [
      { path: "options.type", kind: "select", label: "Wave", options: SHARED_WAVE_OPTIONS },
      { path: "options.detune", kind: "range", label: "Detune", min: -1200, max: 1200, step: 1, formatter: formatCents },
      { path: "ampEnvelope.attack", kind: "range", label: "Attack", min: 0.001, max: 1.2, step: 0.001, formatter: formatSeconds },
      { path: "ampEnvelope.release", kind: "range", label: "Release", min: 0.05, max: 4, step: 0.01, formatter: formatSeconds },
    ],
  },
  Noise: {
    accent: "source",
    tag: "Source",
    runtime: "rawNoise",
    voiceClass: "Noise",
    options: {
      type: "pink",
      playbackRate: 1,
    },
    ampEnvelope: {
      attack: 0.01,
      decay: 0.08,
      sustain: 0.24,
      release: 0.45,
    },
    controls: [
      {
        path: "options.type",
        kind: "select",
        label: "Color",
        options: [
          { label: "White", value: "white" },
          { label: "Pink", value: "pink" },
          { label: "Brown", value: "brown" },
        ],
      },
      { path: "options.playbackRate", kind: "range", label: "Rate", min: 0.2, max: 4, step: 0.01, formatter: formatMultiplier },
      { path: "ampEnvelope.attack", kind: "range", label: "Attack", min: 0.001, max: 1, step: 0.001, formatter: formatSeconds },
      { path: "ampEnvelope.release", kind: "range", label: "Release", min: 0.01, max: 2, step: 0.01, formatter: formatSeconds },
    ],
  },
};

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

const FILTER_TYPES = [
  { label: "Low-pass", value: "lowpass" },
  { label: "Band-pass", value: "bandpass" },
  { label: "High-pass", value: "highpass" },
  { label: "Notch", value: "notch" },
];

const BUILTIN_PRESET_TEMPLATES = {
  init: {
    name: "Init Patch",
    global: { volume: -8, octave: 4, velocity: 0.8 },
    filter: { type: "lowpass", frequency: 2200, Q: 0.6, rolloff: -24 },
    envelope: { attack: 0.02, decay: 0.18, sustain: 0.82, release: 0.65 },
    lfo: { enabled: true, type: "sine", frequency: 2.1, amount: 0.35, target: "filter.frequency" },
    sources: [
      {
        type: "Synth",
        enabled: true,
        volume: -9,
        pan: -0.12,
        options: {
          oscillator: { type: "sawtooth" },
          envelope: { attack: 0.01, decay: 0.14, sustain: 0.7, release: 0.8 },
          detune: -8,
        },
      },
      {
        type: "OmniOscillator",
        enabled: true,
        volume: -14,
        pan: 0.12,
        options: { type: "triangle", detune: 6 },
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
        type: "FMSynth",
        enabled: true,
        volume: -6,
        pan: -0.18,
        options: {
          oscillator: { type: "sine" },
          modulation: { type: "square" },
          harmonicity: 2.3,
          modulationIndex: 18,
          envelope: { attack: 0.005, decay: 0.28, sustain: 0.34, release: 2.2 },
          modulationEnvelope: { attack: 0.05, decay: 0.08, sustain: 0.76, release: 1.4 },
        },
      },
      {
        type: "DuoSynth",
        enabled: true,
        volume: -12,
        pan: 0.22,
        options: {
          harmonicity: 1.2,
          vibratoAmount: 0.18,
          vibratoRate: 5.8,
          voice0: { oscillator: { type: "triangle" }, envelope: { attack: 0.02, decay: 0.1, sustain: 0.62, release: 1.4 } },
          voice1: { oscillator: { type: "sine" }, envelope: { attack: 0.04, decay: 0.12, sustain: 0.58, release: 1.8 } },
        },
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
        type: "AMSynth",
        enabled: true,
        volume: -8,
        pan: -0.22,
        options: {
          oscillator: { type: "triangle" },
          modulation: { type: "sine" },
          harmonicity: 0.75,
          envelope: { attack: 0.22, decay: 0.2, sustain: 0.92, release: 2.8 },
          modulationEnvelope: { attack: 0.4, decay: 0.12, sustain: 0.92, release: 2.2 },
        },
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
        type: "NoiseSynth",
        enabled: true,
        volume: -12,
        pan: 0.18,
        options: {
          noise: { type: "brown" },
          envelope: { attack: 0.001, decay: 0.18, sustain: 0, release: 0.16 },
        },
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

function createId(prefix) {
  const id = `${prefix}-${String(moduleCounter).padStart(4, "0")}`;
  moduleCounter += 1;
  return id;
}

function deepClone(value) {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getByPath(object, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), object);
}

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

function noteFromOffset(baseOctave, offset) {
  const pitchClass = NOTE_NAMES[offset % 12];
  const octaveShift = Math.floor(offset / 12);
  return `${pitchClass}${baseOctave + octaveShift}`;
}

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

function getModulationTargets(state) {
  const targets = [
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
  ];

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

    if (typeof module.options?.detune === "number") {
      targets.push({
        label: `${labelPrefix} Detune`,
        value: `source:${module.id}:detune`,
        stage: "sources",
        moduleRef: module.id,
        basePath: `sources.${module.id}.options.detune`,
        min: -1200,
        max: 1200,
        scale: () => 420,
      });
    }
  });

  state.components.forEach((module, index) => {
    const labelPrefix = `${module.type} ${index + 1}`;
    if (module.type === "Gain" && typeof module.options?.gain === "number") {
      targets.push({
        label: `${labelPrefix} Level`,
        value: `component:${module.id}:gain`,
        stage: "components",
        moduleRef: module.id,
        basePath: `components.${module.id}.options.gain`,
        min: 0,
        max: 2,
        scale: () => 0.8,
      });
    }

    if (module.type === "PanVol") {
      targets.push(
        {
          label: `${labelPrefix} Pan`,
          value: `component:${module.id}:pan`,
          stage: "components",
          moduleRef: module.id,
          basePath: `components.${module.id}.options.pan`,
          min: -1,
          max: 1,
          scale: () => 1,
        },
        {
          label: `${labelPrefix} Volume`,
          value: `component:${module.id}:volume`,
          stage: "components",
          moduleRef: module.id,
          basePath: `components.${module.id}.options.volume`,
          min: -24,
          max: 12,
          scale: () => 10,
        },
      );
    }
  });

  state.effects.forEach((module, index) => {
    const labelPrefix = `${module.type} ${index + 1}`;
    if (typeof module.options?.wet === "number") {
      targets.push({
        label: `${labelPrefix} Wet`,
        value: `effect:${module.id}:wet`,
        stage: "effects",
        moduleRef: module.id,
        basePath: `effects.${module.id}.options.wet`,
        min: 0,
        max: 1,
        scale: () => 0.7,
      });
    }

    if (typeof module.options?.feedback === "number") {
      targets.push({
        label: `${labelPrefix} Feedback`,
        value: `effect:${module.id}:feedback`,
        stage: "effects",
        moduleRef: module.id,
        basePath: `effects.${module.id}.options.feedback`,
        min: 0,
        max: 0.95,
        scale: () => 0.4,
      });
    }
  });

  return targets;
}

function findById(list, id) {
  return list.find((entry) => entry.id === id);
}

function createSourceModule(type = "Synth") {
  const definition = SOURCE_LIBRARY[type] || SOURCE_LIBRARY.Synth;
  return {
    id: createId("src"),
    type,
    enabled: true,
    volume: -8,
    pan: 0,
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

function getAddableModuleOptions() {
  return [
    ...Object.keys(SOURCE_LIBRARY).map((type) => ({
      value: `source:${type}`,
      label: `Instrument / ${type}`,
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

function normalizeSourceModule(module) {
  const base = createSourceModule(module?.type || "Synth");
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

function normalizePreset(preset = {}) {
  const fallback = {
    name: "Untitled Patch",
    global: { volume: -8, octave: 4, velocity: 0.8 },
    filter: { type: "lowpass", frequency: 2200, Q: 0.6, rolloff: -24 },
    envelope: { attack: 0.02, decay: 0.18, sustain: 0.82, release: 0.65 },
    modEnvelope: { enabled: true, attack: 0.01, decay: 0.24, sustain: 0.36, release: 0.8 },
    lfo: { enabled: true, type: "sine", frequency: 2.1, amount: 1, phase: 0 },
    modulation: {
      lfoRoutes: [createModRoute("filter.frequency", 0.45)],
      envelopeRoutes: [createModRoute("filter.frequency", 0.4)],
    },
    sources: [createSourceModule("Synth")],
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

function safeSet(target, options) {
  if (!target || !options) {
    return;
  }
  if (typeof target.set === "function") {
    target.set(options);
  }
}

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

    this.sourceBus = new Tone.Gain(1);
    this.filter = new Tone.Filter(state.filter);
    this.ampEnvelope = new Tone.AmplitudeEnvelope(state.envelope);
    this.masterVolume = new Tone.Volume(state.global.volume);
    this.analyser = new Tone.Analyser("waveform", 1024);
    this.lfoStartTime = Tone.now();

    this.sourceBus.connect(this.filter);
    this.filter.connect(this.ampEnvelope);
    this.ampEnvelope.connect(this.masterVolume);
    this.masterVolume.toDestination();
    this.masterVolume.connect(this.analyser);

    this.rebuildEffects();
    this.rebuildSources();
    this.startModulationLoop();
  }

  getAnalyser() {
    return this.analyser;
  }

  fullSync(state) {
    this.state = deepClone(state);
    if (!this.ready) {
      return;
    }

    safeSet(this.filter, state.filter);
    safeSet(this.ampEnvelope, state.envelope);
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

  updateFilter(filterState) {
    this.state.filter = deepClone(filterState);
    if (!this.ready) {
      return;
    }
    safeSet(this.filter, filterState);
    this.applyModulationSnapshot();
  }

  updateEnvelope(envelopeState) {
    this.state.envelope = deepClone(envelopeState);
    if (!this.ready) {
      return;
    }
    safeSet(this.ampEnvelope, envelopeState);
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

  rebuildEffects() {
    if (!this.masterVolume || !this.ampEnvelope) {
      return;
    }

    this.componentRuntimes.forEach((runtime) => runtime.dispose());
    this.componentRuntimes.clear();
    this.effectRuntimes.forEach((runtime) => runtime.dispose());
    this.effectRuntimes.clear();

    this.ampEnvelope.disconnect();

    let cursor = this.ampEnvelope;
    this.state.components.forEach((module) => {
      if (!module.enabled) {
        return;
      }

      const RuntimeCtor = Tone[module.type];
      if (!RuntimeCtor) {
        return;
      }

      const node = new RuntimeCtor(module.options);
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

    const [group, moduleId, prop] = targetId.split(":");

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
      if (prop === "detune" && runtime.node?.detune) {
        return { ...meta, base: Number(module.options.detune || 0), apply: (value) => rampParam(runtime.node.detune, value, 0.03) };
      }
      return null;
    }

    if (group === "component") {
      const module = findById(this.state.components, moduleId);
      const runtime = this.componentRuntimes.get(moduleId)?.node;
      if (!module || !runtime) {
        return null;
      }

      if (prop === "gain" && runtime.gain) {
        return { ...meta, base: Number(module.options.gain), apply: (value) => rampParam(runtime.gain, value, 0.03) };
      }
      if (prop === "pan" && runtime.pan) {
        return { ...meta, base: Number(module.options.pan), apply: (value) => rampParam(runtime.pan, value, 0.03) };
      }
      if (prop === "volume" && runtime.volume) {
        return { ...meta, base: Number(module.options.volume), apply: (value) => rampParam(runtime.volume, value, 0.03) };
      }
      return null;
    }

    if (group === "effect") {
      const module = findById(this.state.effects, moduleId);
      const runtime = this.effectRuntimes.get(moduleId)?.node;
      if (!module || !runtime) {
        return null;
      }

      if (prop === "wet" && runtime.wet) {
        return { ...meta, base: Number(module.options.wet), apply: (value) => rampParam(runtime.wet, value, 0.03) };
      }
      if (prop === "feedback" && runtime.feedback) {
        return { ...meta, base: Number(module.options.feedback), apply: (value) => rampParam(runtime.feedback, value, 0.03) };
      }
      return null;
    }

    return null;
  }

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

  createSourceRuntime(module) {
    const definition = SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Synth;
    const volumeNode = new Tone.Volume(module.enabled ? module.volume : -48);
    const panNode = new Tone.Panner(module.pan);
    volumeNode.connect(panNode);
    panNode.connect(this.sourceBus);

    let node;
    let auxEnvelope = null;

    if (definition.runtime === "poly") {
      node = new Tone.PolySynth(Tone[definition.voiceClass], module.options);
      node.connect(volumeNode);
    } else if (definition.runtime === "pluck") {
      node = new Tone.PluckSynth(module.options);
      node.connect(volumeNode);
    } else if (definition.runtime === "noiseSynth") {
      node = new Tone.NoiseSynth(module.options);
      node.connect(volumeNode);
    } else if (definition.runtime === "rawOscillator") {
      node = new Tone.OmniOscillator(module.options);
      auxEnvelope = new Tone.AmplitudeEnvelope(module.ampEnvelope);
      node.connect(auxEnvelope);
      auxEnvelope.connect(volumeNode);
      node.start();
    } else if (definition.runtime === "rawNoise") {
      node = new Tone.Noise(module.options);
      auxEnvelope = new Tone.AmplitudeEnvelope(module.ampEnvelope);
      node.connect(auxEnvelope);
      auxEnvelope.connect(volumeNode);
      node.start();
    } else {
      node = new Tone.PolySynth(Tone.Synth, module.options);
      node.connect(volumeNode);
    }

    return {
      type: definition.runtime,
      node,
      volumeNode,
      panNode,
      auxEnvelope,
      apply: (nextModule) => {
        rampParam(volumeNode.volume, nextModule.enabled ? nextModule.volume : -48);
        rampParam(panNode.pan, nextModule.pan);

        if (definition.runtime === "rawOscillator" || definition.runtime === "rawNoise") {
          safeSet(node, nextModule.options);
          if (auxEnvelope) {
            safeSet(auxEnvelope, nextModule.ampEnvelope);
          }
        } else {
          safeSet(node, nextModule.options);
        }
      },
      triggerAttack: (note, velocity) => {
        if (!module.enabled) {
          return;
        }

        if (definition.runtime === "poly") {
          node.triggerAttack(note, Tone.now(), velocity);
        } else if (definition.runtime === "pluck") {
          node.triggerAttack(note, Tone.now());
        } else if (definition.runtime === "noiseSynth") {
          node.triggerAttack(Tone.now(), velocity);
        } else if (definition.runtime === "rawOscillator") {
          node.frequency.rampTo(Tone.Frequency(note).toFrequency(), 0.02);
          auxEnvelope.triggerAttack(Tone.now(), velocity);
        } else if (definition.runtime === "rawNoise") {
          auxEnvelope.triggerAttack(Tone.now(), velocity);
        }
      },
      triggerRelease: (note) => {
        if (definition.runtime === "poly") {
          node.triggerRelease(note, Tone.now());
        } else if (definition.runtime === "pluck") {
          if (typeof node.triggerRelease === "function") {
            node.triggerRelease(Tone.now());
          }
        } else if (definition.runtime === "noiseSynth") {
          if (typeof node.triggerRelease === "function") {
            node.triggerRelease(Tone.now());
          }
        } else if (definition.runtime === "rawOscillator" || definition.runtime === "rawNoise") {
          auxEnvelope.triggerRelease(Tone.now());
        }
      },
      releaseAll: () => {
        if (definition.runtime === "poly") {
          node.releaseAll(Tone.now());
        } else if (definition.runtime === "pluck" || definition.runtime === "noiseSynth") {
          if (typeof node.triggerRelease === "function") {
            node.triggerRelease(Tone.now());
          }
        } else if (definition.runtime === "rawOscillator" || definition.runtime === "rawNoise") {
          auxEnvelope.triggerRelease(Tone.now());
        }
      },
      dispose: () => {
        node.dispose();
        if (auxEnvelope) {
          auxEnvelope.dispose();
        }
        volumeNode.dispose();
        panNode.dispose();
      },
    };
  }

  attack(note, velocity) {
    if (!this.ready) {
      return;
    }

    if (!this.activeNotes.size) {
      this.ampEnvelope.triggerAttack(Tone.now(), velocity);
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
      this.ampEnvelope.triggerRelease(Tone.now());
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
    this.ampEnvelope.triggerRelease(Tone.now());
    this.modEnvelopeState = { stage: "idle", velocity: 1, attackStart: 0, attackFrom: 0, decayStart: 0, releaseStart: 0, releaseFrom: 0 };
  }
}

/* -------------------------------------------------------------------------- */
/* App UI                                                                      */
/* -------------------------------------------------------------------------- */

class ModularSynthApp {
  constructor() {
    this.state = createBasePreset();
    this.engine = new AudioEngine();
    this.selectedPresetId = "init";
    this.audioBooted = false;
    this.heldComputerKeys = new Map();
    this.heldPointerNotes = new Set();
    this.activeNoteRefs = new Map();
    this.controlBindings = new Map();
    this.dragPatch = null;
    this.dragHoverTarget = "";
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
    this.renderAll();
    this.resizeScopeCanvas();
    this.drawOscilloscope();
    window.addEventListener("resize", () => {
      this.resizeScopeCanvas();
      this.drawPatchCables();
    });
  }

  cacheElements() {
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
      this.setStatus("Audio engine live. Play with the keyboard or the rack.", "live");
    } catch (error) {
      this.setStatus(`Audio start failed: ${error.message}`, "error");
    }
  }

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

  populateAddModuleSelect() {
    const select = this.elements.addModuleSelect;
    if (!select || select.options.length) {
      return;
    }

    getAddableModuleOptions().forEach((option) => {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    });
  }

  handleAddModule() {
    const value = this.elements.addModuleSelect?.value;
    if (!value) {
      return;
    }

    const [kind, type] = value.split(":");
    if (kind === "source") {
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

  renderAll(previousState = null) {
    this.sanitizeModulationState();
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
      ["patch cables", () => this.drawPatchCables()],
    ];

    for (const [label, task] of sections) {
      try {
        task();
      } catch (error) {
        console.error(`Render error in ${label}:`, error);
        this.setStatus(`Render error in ${label}: ${error.message}`, "error");
      }
    }

    if (previousState) {
      this.animateControlTransition(previousState, this.state);
    }
  }

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

  renderSourceRack() {
    if (!this.elements.sourceRack) {
      return;
    }
    this.elements.sourceRack.innerHTML = "";
    this.state.sources.forEach((module, index) => {
      const definition = SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Synth;
      const card = this.createModuleCard({
        accent: definition.accent,
        kicker: definition.tag,
        title: module.type,
        moduleRef: module.id,
        onRemove: () => {
          this.state.sources.splice(index, 1);
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        removable: this.state.sources.length > 1,
      });

      const headGrid = document.createElement("div");
      headGrid.className = "module-grid compact";
      headGrid.append(
        this.createSelectControl({
          label: "Source Type",
          options: Object.keys(SOURCE_LIBRARY).map((type) => ({ label: type, value: type })),
          value: module.type,
          onChange: (value) => {
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
        }),
        this.createToggleControl({
          label: "Enabled",
          value: module.enabled,
          accent: definition.accent,
          onToggle: () => {
            module.enabled = !module.enabled;
            this.selectedPresetId = "custom";
            this.engine.updateSource(module);
            this.renderAll();
          },
        }),
      );

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

      definition.controls.forEach((control) => {
        const patchTarget = control.path === "options.detune" ? `source:${module.id}:detune` : null;
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

      card.append(headGrid, controls);
      this.elements.sourceRack.append(card);
    });
  }

  renderFilterModule() {
    if (!this.elements.filterRack) {
      return;
    }
    this.elements.filterRack.innerHTML = "";
    const card = this.createModuleCard({
      accent: "filter",
      kicker: "Component",
      title: "Filter",
      moduleRef: "filter-core",
    });

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
          this.engine.updateFilter(this.state.filter);
        },
      }),
    );

    const controls = document.createElement("div");
    controls.className = "module-grid";
    card.append(this.createFilterVisualization(this.state.filter));
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
          this.engine.updateFilter(this.state.filter);
        },
      }),
    );

    card.append(headGrid, controls);
    this.elements.filterRack.append(card);
  }

  renderEnvelopeModule() {
    if (!this.elements.envelopeRack) {
      return;
    }
    this.elements.envelopeRack.innerHTML = "";
    const ampCard = this.createModuleCard({
      accent: "env",
      kicker: "Component",
      title: "Amp Envelope",
      moduleRef: "amp-envelope",
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

    const modCard = this.createModuleCard({
      accent: "env",
      kicker: "Modulation",
      title: "Mod Envelope",
      moduleRef: "mod-envelope",
    });

    const modHead = document.createElement("div");
    modHead.className = "module-grid compact";
    modHead.append(
      this.createToggleControl({
        label: "Enabled",
        value: this.state.modEnvelope.enabled,
        accent: "env",
        onToggle: () => {
          this.state.modEnvelope.enabled = !this.state.modEnvelope.enabled;
          this.selectedPresetId = "custom";
          this.engine.updateModEnvelope(this.state.modEnvelope);
          this.renderEnvelopeModule();
          this.drawPatchCables();
        },
      }),
    );

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

    modCard.append(modHead, modControls, this.renderRouteRack("envelopeRoutes", "env"));
    this.elements.envelopeRack.append(modCard);
  }

  renderLfoModule() {
    if (!this.elements.lfoRack) {
      return;
    }
    this.elements.lfoRack.innerHTML = "";
    const card = this.createModuleCard({
      accent: "lfo",
      kicker: "Modulation",
      title: "LFO",
      moduleRef: "lfo-core",
    });

    const headGrid = document.createElement("div");
    headGrid.className = "module-grid compact";
    headGrid.append(
      this.createToggleControl({
        label: "Enabled",
        value: this.state.lfo.enabled,
        accent: "lfo",
        onToggle: () => {
          this.state.lfo.enabled = !this.state.lfo.enabled;
          this.selectedPresetId = "custom";
          this.engine.updateLfo(this.state.lfo);
          this.renderLfoModule();
          this.drawPatchCables();
        },
      }),
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
        moduleRef: module.id,
        onRemove: () => {
          this.state.components.splice(index, 1);
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        removable: this.state.components.length > 0,
      });

      const headGrid = document.createElement("div");
      headGrid.className = "module-grid compact";
      headGrid.append(
        this.createSelectControl({
          label: "Component Type",
          options: Object.keys(COMPONENT_LIBRARY).map((type) => ({ label: type, value: type })),
          value: module.type,
          onChange: (value) => {
            const replacement = createComponentModule(value);
            replacement.id = module.id;
            replacement.enabled = module.enabled;
            this.state.components[index] = replacement;
            this.selectedPresetId = "custom";
            this.renderAll();
            this.engine.fullSync(this.state);
          },
        }),
        this.createToggleControl({
          label: "Enabled",
          value: module.enabled,
          accent: definition.accent,
          onToggle: () => {
            module.enabled = !module.enabled;
            this.selectedPresetId = "custom";
            this.state.components[index] = module;
            this.engine.fullSync(this.state);
            this.renderAll();
          },
        }),
      );

      const controls = document.createElement("div");
      controls.className = "module-grid";
      definition.controls.forEach((control) => {
        let patchTarget = null;
        if (module.type === "Gain" && control.path === "options.gain") {
          patchTarget = `component:${module.id}:gain`;
        }
        if (module.type === "PanVol" && control.path === "options.pan") {
          patchTarget = `component:${module.id}:pan`;
        }
        if (module.type === "PanVol" && control.path === "options.volume") {
          patchTarget = `component:${module.id}:volume`;
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

      card.append(headGrid, controls);
      this.elements.componentRack.append(card);
    });
  }

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
        moduleRef: module.id,
        onRemove: () => {
          this.state.effects.splice(index, 1);
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        removable: this.state.effects.length > 0,
      });

      const headGrid = document.createElement("div");
      headGrid.className = "module-grid compact";
      headGrid.append(
        this.createSelectControl({
          label: "Effect Type",
          options: Object.keys(EFFECT_LIBRARY).map((type) => ({ label: type, value: type })),
          value: module.type,
          onChange: (value) => {
            const replacement = createEffectModule(value);
            replacement.id = module.id;
            replacement.enabled = module.enabled;
            this.state.effects[index] = replacement;
            this.selectedPresetId = "custom";
            this.renderAll();
            this.engine.fullSync(this.state);
          },
        }),
        this.createToggleControl({
          label: "Enabled",
          value: module.enabled,
          accent: definition.accent,
          onToggle: () => {
            module.enabled = !module.enabled;
            this.selectedPresetId = "custom";
            this.state.effects[index] = module;
            this.engine.fullSync(this.state);
            this.renderAll();
          },
        }),
      );

      const controls = document.createElement("div");
      controls.className = "module-grid";
      definition.controls.forEach((control) => {
        let patchTarget = null;
        if (control.path === "options.wet") {
          patchTarget = `effect:${module.id}:wet`;
        }
        if (control.path === "options.feedback") {
          patchTarget = `effect:${module.id}:feedback`;
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

      card.append(headGrid, controls);
      this.elements.effectRack.append(card);
    });
  }

  renderKeyboard() {
    if (!this.elements.keyboard) {
      return;
    }
    this.elements.keyboard.innerHTML = "";

    const whiteKeyWidth = 84;
    const keyboardWidth = whiteKeyWidth * 8 + 28;
    this.elements.keyboard.style.width = `${keyboardWidth}px`;

    KEYBOARD_LAYOUT.forEach((entry) => {
      const note = noteFromOffset(this.state.global.octave, entry.offset);
      const key = document.createElement("button");
      key.type = "button";
      key.className = entry.black ? "black-key" : "white-key";
      key.dataset.note = note;
      key.dataset.key = entry.key;
      key.style.left = `${14 + entry.whiteIndex * whiteKeyWidth - (entry.black ? 28 : 0)}px`;

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
          patchPoint: {
            accent,
            routeKey,
            routeId: route.id,
            routeIndex: index,
          },
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

  createModuleCard({ accent, kicker, title, onRemove = null, removable = false, moduleRef = null }) {
    const card = document.createElement("section");
    card.className = "module-card";
    card.dataset.accent = accent;
    if (moduleRef) {
      card.dataset.moduleRef = moduleRef;
    }

    const head = document.createElement("div");
    head.className = "module-head";

    const titleBlock = document.createElement("div");
    const tag = document.createElement("span");
    tag.className = "module-tag";
    tag.textContent = kicker;
    const titleNode = document.createElement("h3");
    titleNode.textContent = title;
    titleBlock.append(tag, titleNode);

    const actions = document.createElement("div");
    actions.className = "module-actions";
    if (removable && onRemove) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "pill-button destructive-button";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", onRemove);
      actions.append(removeButton);
    }

    head.append(titleBlock, actions);
    card.append(head);

    return card;
  }

  isTargetPatched(targetValue) {
    return [...(this.state.modulation?.lfoRoutes || []), ...(this.state.modulation?.envelopeRoutes || [])]
      .some((route) => route.enabled !== false && route.target === targetValue);
  }

  createPatchPoint({ accent, targetId = null, routeKey = null, routeId = null, routeIndex = 0 }) {
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

    if (routeId) {
      button.dataset.routeHandle = routeId;
      button.dataset.routeKey = routeKey;
      if (this.dragPatch?.routeId === routeId) {
        button.classList.add("is-active");
      }
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        this.beginPatchDrag(event, routeKey, routeId, accent, routeIndex);
      });
    }

    return button;
  }

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

  createFilterVisualization(filterState) {
    const wrap = document.createElement("div");
    wrap.className = "module-visual filter-visual";
    wrap.style.setProperty("--accent", "var(--filter)");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 220 90");

    const type = filterState.type || "lowpass";
    const cutoffNorm = clamp((Math.log10(Math.max(20, filterState.frequency)) - Math.log10(20)) / (Math.log10(12000) - Math.log10(20)), 0, 1);
    const resonance = clamp(Number(filterState.Q || 0.5) / 12, 0, 1);
    const cutoffX = 42 + cutoffNorm * 142;
    const bumpX = cutoffX + 10;
    const baseY = 62;
    const floorY = 80;
    const peakY = baseY - resonance * 28;
    let points;

    if (type === "highpass") {
      points = [
        [16, floorY],
        [cutoffX - 22, floorY],
        [cutoffX, peakY],
        [cutoffX + 24, baseY],
        [204, baseY],
      ];
    } else if (type === "bandpass") {
      points = [
        [16, floorY],
        [cutoffX - 34, floorY],
        [cutoffX, peakY],
        [cutoffX + 34, floorY],
        [204, floorY],
      ];
    } else if (type === "notch") {
      points = [
        [16, baseY],
        [cutoffX - 26, baseY],
        [cutoffX, floorY],
        [cutoffX + 26, baseY],
        [204, baseY],
      ];
    } else {
      points = [
        [16, baseY],
        [cutoffX - 30, baseY],
        [bumpX, peakY],
        [cutoffX + 28, floorY],
        [204, floorY],
      ];
    }

    const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const linePath = `M ${points[0][0]} ${points[0][1]} C ${points[1][0]} ${points[1][1]}, ${points[2][0]} ${points[2][1]}, ${points[3][0]} ${points[3][1]} S ${points[4][0]} ${points[4][1]}, ${points[4][0]} ${points[4][1]}`;
    area.setAttribute("d", `${linePath} L 204 84 L 16 84 Z`);
    area.setAttribute("fill", "currentColor");
    area.setAttribute("opacity", "0.9");

    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("d", linePath);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "2.4");

    svg.append(area, line);
    wrap.append(svg);
    return wrap;
  }

  beginPatchDrag(event, routeKey, routeId, accent, routeIndex) {
    const sourceRef = routeKey === "lfoRoutes" ? "lfo-core" : "mod-envelope";
    const color = accent === "lfo" ? "rgba(61, 127, 184, 0.92)" : "rgba(192, 160, 62, 0.92)";
    this.dragPatch = {
      routeKey,
      routeId,
      sourceRef,
      color,
      routeIndex,
      point: this.getRelativePatchPoint(event.clientX, event.clientY),
    };
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

  findHoveredPatchTarget(clientX, clientY) {
    const element = document.elementFromPoint(clientX, clientY);
    return element?.closest?.("[data-mod-target]") || null;
  }

  onPatchDragMove(event) {
    if (!this.dragPatch) {
      return;
    }
    this.dragPatch.point = this.getRelativePatchPoint(event.clientX, event.clientY);
    const hoveredTarget = this.findHoveredPatchTarget(event.clientX, event.clientY);
    const nextHoverTarget = hoveredTarget?.dataset.modTarget || "";
    if (nextHoverTarget !== this.dragHoverTarget) {
      this.dragHoverTarget = nextHoverTarget;
      this.renderAll();
      return;
    }
    this.drawPatchCables();
  }

  onPatchDragEnd(event) {
    if (!this.dragPatch) {
      return;
    }

    const hoveredTarget = this.findHoveredPatchTarget(event.clientX, event.clientY);
    if (hoveredTarget?.dataset.modTarget) {
      const route = findById(this.state.modulation[this.dragPatch.routeKey], this.dragPatch.routeId);
      if (route) {
        route.target = hoveredTarget.dataset.modTarget;
        this.selectedPresetId = "custom";
        this.engine.updateModulation(this.state.modulation);
      }
    }

    this.dragPatch = null;
    this.dragHoverTarget = "";
    this.renderAll();
  }

  createSelectControl({ label, options, value, onChange, patchPoint = null }) {
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
    button.textContent = value ? "On" : "Off";
    button.addEventListener("click", onToggle);

    wrapper.append(controlLabel, button);
    return wrapper;
  }

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
    this.setStatus(`Loaded preset: ${this.state.name}.`, this.audioBooted ? "live" : "neutral");
  }

  syncControlsFromState() {
    this.controlBindings.forEach((binding, path) => {
      const value = getByPath(this.state, path);
      if (typeof value === "number" && Number.isFinite(value)) {
        binding.setVisual(value);
      }
    });
  }

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

  applyBrightnessMacro(value) {
    const delta = value - this.performance.brightness;
    this.performance.brightness = value;
    this.selectedPresetId = "custom";

    this.state.filter.frequency = clamp(this.state.filter.frequency * Math.pow(2, delta * 2.4), 40, 12000);
    this.state.filter.Q = clamp(this.state.filter.Q + delta * 5, 0.001, 20);

    this.engine.updateFilter(this.state.filter);
    this.syncControlsFromState();
  }

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
      applyDefinitionRandomness(module, SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Synth);
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
    const svg = this.elements.patchCables;
    const container = this.elements.signalFlow;
    if (!svg || !container) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const width = Math.round(container.scrollWidth || containerRect.width);
    const height = Math.round(container.scrollHeight || containerRect.height);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = "";

    const createPath = (d, stroke, dashed = false, widthValue = 3, opacity = 0.7) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", stroke);
      path.setAttribute("stroke-width", String(widthValue));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("opacity", String(opacity));
      if (dashed) {
        path.setAttribute("stroke-dasharray", "7 9");
      }
      svg.append(path);
    };

    const createSocket = (x, y, fill, radius = 4.5) => {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", String(x));
      dot.setAttribute("cy", String(y));
      dot.setAttribute("r", String(radius));
      dot.setAttribute("fill", fill);
      dot.setAttribute("opacity", "0.92");
      svg.append(dot);
    };

    const escapeSelector = (value) => {
      if (window.CSS?.escape) {
        return window.CSS.escape(value);
      }
      return String(value).replace(/["\\]/g, "\\$&");
    };

    const anchorModule = (moduleRef, side = "right", verticalBias = 0.5) => {
      const node = container.querySelector(`[data-module-ref="${escapeSelector(moduleRef)}"]`);
      if (!node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return {
        x: side === "right" ? rect.right - containerRect.left : rect.left - containerRect.left,
        y: rect.top - containerRect.top + rect.height * verticalBias,
      };
    };

    const anchorRouteHandle = (routeId) => {
      const node = container.querySelector(`[data-route-handle="${escapeSelector(routeId)}"]`);
      if (!node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return {
        x: rect.right - containerRect.left,
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

    const drawCable = (from, to, color, widthValue, opacity, dashed = true) => {
      const direction = to.x >= from.x ? 1 : -1;
      const horizontalDistance = Math.max(42, Math.abs(to.x - from.x));
      const controlOffset = horizontalDistance * 0.28;
      const arcHeight = Math.max(22, Math.min(110, horizontalDistance * 0.18));
      const controlY = Math.min(from.y, to.y) - arcHeight;
      createPath(
        `M ${from.x} ${from.y} C ${from.x + direction * controlOffset} ${controlY}, ${to.x - direction * controlOffset} ${controlY}, ${to.x} ${to.y}`,
        color,
        dashed,
        widthValue,
        opacity,
      );
    };

    const modulationTargets = new Map(getModulationTargets(this.state).map((target) => [target.value, target]));
    const routes = [
      ...(this.state.modulation?.lfoRoutes || []).map((route) => ({
        ...route,
        color: "rgba(61, 127, 184, 0.92)",
        sourceRef: "lfo-core",
        sourceEnabled: this.state.lfo.enabled,
      })),
      ...(this.state.modulation?.envelopeRoutes || []).map((route) => ({
        ...route,
        color: "rgba(192, 160, 62, 0.92)",
        sourceRef: "mod-envelope",
        sourceEnabled: this.state.modEnvelope.enabled,
      })),
    ];

    routes.forEach((route, index) => {
      if (route.enabled === false) {
        return;
      }
      const targetMeta = modulationTargets.get(route.target);
      if (!targetMeta) {
        return;
      }

      const from = anchorRouteHandle(route.id) || anchorModule(route.sourceRef, "right", 0.35 + (index % 4) * 0.12);
      const to = anchorTarget(targetMeta.value);
      if (!from || !to) {
        return;
      }

      const widthValue = 2 + Math.abs(Number(route.amount || 0)) * 2.6;
      const opacity = route.sourceEnabled ? 0.78 : 0.28;
      drawCable(from, to, route.color, widthValue, opacity, true);
      createSocket(from.x, from.y, route.color, 4);
      createSocket(to.x, to.y, route.color, 3.5);
    });

    if (this.dragPatch?.point) {
      const from =
        anchorRouteHandle(this.dragPatch.routeId)
        || anchorModule(this.dragPatch.sourceRef, "right", 0.4 + (this.dragPatch.routeIndex % 4) * 0.1);
      const to = this.dragPatch.point;
      if (from && to) {
        drawCable(from, to, this.dragPatch.color, 2.6, 0.95, true);
        createSocket(from.x, from.y, this.dragPatch.color, 4.5);
        createSocket(to.x, to.y, this.dragPatch.color, 4);
      }
    }
  }

  resizeScopeCanvas() {
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
    requestAnimationFrame(() => this.drawOscilloscope());

    const canvas = this.elements.oscilloscope;
    const context = this.scopeContext;
    if (!canvas || !context) {
      return;
    }
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#12161d";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(255,255,255,0.06)";
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

    context.strokeStyle = "rgba(83, 159, 255, 0.22)";
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();

    const analyser = this.engine.getAnalyser();
    if (!analyser || !this.audioBooted) {
      context.fillStyle = "rgba(236, 229, 214, 0.72)";
      context.font = '500 16px "IBM Plex Sans"';
      context.fillText("Waveform will appear after the first interaction.", 24, 34);
      return;
    }

    const waveform = analyser.getValue();
    context.strokeStyle = "#89f0cf";
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
