/* -------------------------------------------------------------------------- */
/* 内置预设模板                                                               */
/* -------------------------------------------------------------------------- */

const BUILTIN_PRESET_TEMPLATES = {
  init: {
    name: "Init Patch",
    global: { volume: -8, octave: 4, velocity: 0.8 },
    modules: [
      { type: "Oscillator", category: "source", enabled: true, volume: -9, pan: -0.12, options: { type: "sawtooth", detune: -8 } },
      { type: "PulseOscillator", category: "source", enabled: true, volume: -14, pan: 0.12, options: { width: 0.5, detune: 6 } },
      { type: "Filter", category: "component", enabled: true, options: { type: "lowpass", frequency: 2200, Q: 0.6, rolloff: -24 } },
      { type: "AmplitudeEnvelope", category: "component", enabled: true, options: { attack: 0.02, decay: 0.18, sustain: 0.82, release: 0.65 } },
      { type: "Compressor", category: "component", enabled: true, options: { threshold: -18, ratio: 2.6, attack: 0.01, release: 0.22, knee: 20 } },
      { type: "Chorus", category: "effect", enabled: true, options: { frequency: 1.4, delayTime: 2.4, depth: 0.5, spread: 180, wet: 0.32 } },
      { type: "Reverb", category: "effect", enabled: true, options: { decay: 3.8, preDelay: 0.02, wet: 0.2 } },
    ],
  },
  cinematicDust: {
    name: "Cinematic Dust",
    global: { volume: -11, octave: 3, velocity: 0.72 },
    modules: [
      { type: "Oscillator", category: "source", enabled: true, volume: -8, pan: -0.22, options: { type: "triangle", detune: 0 } },
      { type: "Noise", category: "source", enabled: true, volume: -18, pan: 0.24, options: { type: "pink", playbackRate: 0.86 } },
      { type: "Filter", category: "component", enabled: true, options: { type: "lowpass", frequency: 1450, Q: 0.92, rolloff: -48 } },
      { type: "AmplitudeEnvelope", category: "component", enabled: true, options: { attack: 0.14, decay: 0.48, sustain: 0.7, release: 2.6 } },
      { type: "Gain", category: "component", enabled: true, options: { gain: 1.08 } },
      { type: "EQ3", category: "component", enabled: true, options: { low: 2.4, mid: -0.8, high: -2.8, lowFrequency: 240, highFrequency: 2100 } },
      { type: "AutoFilter", category: "effect", enabled: true, options: { frequency: 0.34, depth: 0.45, baseFrequency: 160, wet: 0.32 } },
      { type: "Chorus", category: "effect", enabled: true, options: { frequency: 0.6, delayTime: 2.1, depth: 0.58, spread: 180, wet: 0.24 } },
      { type: "Reverb", category: "effect", enabled: true, options: { decay: 8.2, preDelay: 0.04, wet: 0.36 } },
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* 预设工具函数                                                               */
/* -------------------------------------------------------------------------- */

function createBasePreset() {
  return normalizePreset(BUILTIN_PRESET_TEMPLATES.init);
}

function normalizePreset(preset = {}) {
  resetModuleCounter();

  const fallback = {
    name: "Untitled Patch",
    global: { volume: -8, octave: 4, velocity: 0.8 },
    modules: [],
    modulations: [],
  };

  const merged = deepMerge(fallback, preset);

  if (Array.isArray(preset.modules) && preset.modules.length > 0) {
    merged.modules = preset.modules.map((module) => normalizeAnyModule(module));
  } else {
    merged.modules = [
      createSourceModule("Oscillator"),
      createComponentModule("Filter"),
      createComponentModule("AmplitudeEnvelope"),
      createEffectModule("Chorus"),
    ];
  }

  merged.global.octave = clamp(Number(merged.global.octave || 4), 1, 7);
  merged.global.velocity = clamp(Number(merged.global.velocity || 0.8), 0.1, 1);
  merged.global.volume = clamp(Number(merged.global.volume || -8), -36, 6);

  merged.modulations = Array.isArray(merged.modulations)
    ? merged.modulations
      .map((item) => {
        let radius = 0.15; // 默认值

        // 尝试从新格式读取
        if (typeof item?.radius === "number" && !Number.isNaN(item.radius)) {
          radius = item.radius;
        }
        // 可选：从旧格式转换（如果需要兼容性）
        else if (typeof item?.scaleMin === "number" && typeof item?.scaleMax === "number") {
          // 旧格式存在但不再做复杂转换，直接使用默认值
        // 或者可以基于旧值估算一个 radius（可选）
          console.warn("Legacy modulation format detected (scaleMin/scaleMax), using default radius");
        }

        return {
          id: String(item?.id || createId("mod")),
          sourceModuleId: String(item?.sourceModuleId || ""),
          sourceVoiceIndex: clamp(Number(item?.sourceVoiceIndex ?? 0), 0, 7),
          targetModuleId: String(item?.targetModuleId || ""),
          targetParamPath: String(item?.targetParamPath || ""),
          radius: radius,
        };
      })
      .filter((item) => item.sourceModuleId && item.targetModuleId && item.targetParamPath)
    : [];

  return merged;
}

/* -------------------------------------------------------------------------- */
/* 文件下载工具                                                               */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* 预设导入导出                                                               */
/* -------------------------------------------------------------------------- */

async function importPresetFromFile(file) {
  const text = await file.text();
  const preset = normalizePreset(JSON.parse(text));
  return preset;
}

function exportPresetToFile(state) {
  const filename = `${(state.name || "tone-preset").toLowerCase().replace(/\s+/g, "-")}.json`;
  downloadJson(filename, state);
  return filename;
}
