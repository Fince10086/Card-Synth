import {
  createId,
  resetModuleCounter,
  deepMerge,
  deepClone,
  clamp,
  normalizeAnyModule,
  createSourceModule,
  createComponentModule,
  createEffectModule,
} from "../utils/helpers.js";

const CHAIN_COUNT = 4;
const DEFAULT_GLOBAL = { volume: -8, octave: 4, velocity: 0.8, velocityEnabled: true };
const MACRO_POINT_DEFAULT = Object.freeze({ x: 0.5, y: 0.5 });
const MACRO_EPSILON = 1e-6;

export const BUILTIN_PRESET_TEMPLATES = {
  init: {
    name: "Init Patch",
    global: { volume: -8, octave: 4, velocity: 0.8, velocityEnabled: true },
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
    global: { volume: -11, octave: 3, velocity: 0.72, velocityEnabled: true },
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

function createStarterModules() {
  return [
    createSourceModule("Oscillator"),
    createComponentModule("Filter"),
    createComponentModule("AmplitudeEnvelope"),
    createEffectModule("Chorus"),
  ];
}

function normalizeGlobalState(global = {}) {
  const merged = deepMerge(DEFAULT_GLOBAL, global || {});
  merged.octave = clamp(Number(merged.octave || 4), 1, 7);
  merged.velocity = clamp(Number(merged.velocity || 0.8), 0.1, 1);
  merged.volume = clamp(Number(merged.volume || -8), -36, 6);
  merged.velocityEnabled = merged.velocityEnabled !== false;
  return merged;
}

export function createDefaultMacroChainState() {
  return {
    point: {
      x: MACRO_POINT_DEFAULT.x,
      y: MACRO_POINT_DEFAULT.y,
    },
    mappings: {
      x: [],
      y: [],
    },
  };
}

function normalizeMacroMappingItem(item = {}) {
  const targetModuleId = String(item?.targetModuleId || "");
  const targetParamPath = String(item?.targetParamPath || "");
  const rawMin = Number(item?.min);
  const rawMax = Number(item?.max);
  const rawStep = Number(item?.step);

  if (!targetModuleId || !targetParamPath || !Number.isFinite(rawMin) || !Number.isFinite(rawMax)) {
    return null;
  }

  let min = rawMin;
  let max = rawMax;
  if (max < min) {
    [min, max] = [max, min];
  }
  if (Math.abs(max - min) <= MACRO_EPSILON) {
    return null;
  }

  const fallbackStep = Math.max((max - min) / 1000, 0.000001);
  const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : fallbackStep;

  return {
    targetModuleId,
    targetParamPath,
    min,
    max,
    step,
    rangeStart: clamp(Number(item?.rangeStart ?? 0), 0, 1),
    rangeEnd: clamp(Number(item?.rangeEnd ?? 1), 0, 1),
  };
}

function normalizeMacroMappings(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  const deduped = new Map();
  items.forEach((item) => {
    const normalized = normalizeMacroMappingItem(item);
    if (!normalized) {
      return;
    }
    const key = `${normalized.targetModuleId}::${normalized.targetParamPath}`;
    deduped.set(key, normalized);
  });

  return Array.from(deduped.values());
}

export function normalizeMacroChain(chainMacro = {}) {
  const fallback = createDefaultMacroChainState();
  const point = chainMacro?.point || {};

  return {
    point: {
      x: clamp(Number(point.x ?? fallback.point.x), 0, 1),
      y: clamp(Number(point.y ?? fallback.point.y), 0, 1),
    },
    mappings: {
      x: normalizeMacroMappings(chainMacro?.mappings?.x),
      y: normalizeMacroMappings(chainMacro?.mappings?.y),
    },
  };
}

export function createDefaultMacroState() {
  return {
    chains: Array.from({ length: CHAIN_COUNT }, () => createDefaultMacroChainState()),
  };
}

export function normalizeMacroState(macro = null, chainFallback = []) {
  const fallbackList = Array.isArray(chainFallback) ? chainFallback : [];
  const sourceChains = Array.isArray(macro)
    ? macro
    : Array.isArray(macro?.chains)
      ? macro.chains
      : [];

  return {
    chains: Array.from({ length: CHAIN_COUNT }, (_, index) => {
      const fromMacro = sourceChains[index];
      const fromChain = fallbackList[index]?.macro;
      return normalizeMacroChain(fromMacro ?? fromChain ?? {});
    }),
  };
}

export function hasMacroSettingsInChain(chainMacro = {}) {
  const normalized = normalizeMacroChain(chainMacro);
  return (
    Math.abs(normalized.point.x - MACRO_POINT_DEFAULT.x) > MACRO_EPSILON
    || Math.abs(normalized.point.y - MACRO_POINT_DEFAULT.y) > MACRO_EPSILON
    || normalized.mappings.x.length > 0
    || normalized.mappings.y.length > 0
  );
}

export function hasAnyMacroSettings(macroState = {}) {
  const normalized = normalizeMacroState(macroState);
  return normalized.chains.some((chainMacro) => hasMacroSettingsInChain(chainMacro));
}

function normalizeModulations(modulations = []) {
  return Array.isArray(modulations)
    ? modulations
      .map((item) => {
        let radius = 0.15;

        if (typeof item?.radius === "number" && !Number.isNaN(item.radius)) {
          radius = item.radius;
        }
        else if (typeof item?.scaleMin === "number" && typeof item?.scaleMax === "number") {
          console.warn("Legacy modulation format detected (scaleMin/scaleMax), using default radius");
        }

        return {
          id: String(item?.id || createId("mod")),
          sourceModuleId: String(item?.sourceModuleId || ""),
          sourceVoiceIndex: clamp(Number(item?.sourceVoiceIndex ?? 0), 0, 7),
          targetModuleId: String(item?.targetModuleId || ""),
          targetParamPath: String(item?.targetParamPath || ""),
          radius,
        };
      })
      .filter((item) => item.sourceModuleId && item.targetModuleId && item.targetParamPath)
    : [];
}

function normalizeChain(chain = {}, { defaultEnabled = false, defaultModules = [] } = {}) {
  const hasModulesField = Array.isArray(chain?.modules);
  const modules = hasModulesField
    ? chain.modules.map((module) => normalizeAnyModule(module))
    : defaultModules.map((module) => normalizeAnyModule(module));

  const rawModulations = Array.isArray(chain?.modulations) ? chain.modulations : [];

  return {
    enabled: chain?.enabled === undefined ? defaultEnabled : Boolean(chain.enabled),
    modules,
    modulations: normalizeModulations(rawModulations),
  };
}

function emptyChain() {
  return { enabled: false, modules: [], modulations: [] };
}

export function normalizeCurrentPresetData(preset = {}) {
  const modules = Array.isArray(preset.modules)
    ? preset.modules.map((module) => normalizeAnyModule(module))
    : createStarterModules();

  return {
    name: String(preset.name || "Untitled Patch"),
    global: normalizeGlobalState(preset.global || {}),
    modules,
    modulations: normalizeModulations(Array.isArray(preset.modulations) ? preset.modulations : []),
    macro: normalizeMacroChain(preset?.macro || {}),
  };
}

export function createBasePreset() {
  const init = normalizeCurrentPresetData(BUILTIN_PRESET_TEMPLATES.init);
  return {
    name: init.name,
    global: init.global,
    selectedChainIndex: 0,
    chains: [
      { enabled: true, modules: init.modules, modulations: init.modulations },
      emptyChain(),
      emptyChain(),
      emptyChain(),
    ],
    macro: createDefaultMacroState(),
  };
}

export function normalizePreset(preset = {}) {
  resetModuleCounter();

  if (Array.isArray(preset?.chains)) {
    const macro = normalizeMacroState(preset?.macro, preset.chains);
    const chains = Array.from({ length: CHAIN_COUNT }, (_, index) => {
      const incoming = preset.chains[index] || {};
      return normalizeChain(incoming, { defaultEnabled: index === 0, defaultModules: [] });
    });

    return {
      name: String(preset.name || "Untitled Patch"),
      global: normalizeGlobalState(preset.global || {}),
      selectedChainIndex: clamp(Number(preset.selectedChainIndex ?? 0), 0, CHAIN_COUNT - 1),
      chains,
      macro,
    };
  }

  const current = normalizeCurrentPresetData(preset);
  const macro = createDefaultMacroState();
  macro.chains[0] = current.macro;
  return {
    name: current.name,
    global: current.global,
    selectedChainIndex: 0,
    chains: [
      { enabled: true, modules: current.modules, modulations: current.modulations },
      emptyChain(),
      emptyChain(),
      emptyChain(),
    ],
    macro,
  };
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

export async function importPresetFromFile(file) {
  const text = await file.text();
  const raw = JSON.parse(text);

  if (Array.isArray(raw?.chains) || raw?.presetType === "all") {
    return {
      type: "all",
      preset: normalizePreset(raw),
    };
  }

  return {
    type: "current",
    chain: normalizeCurrentPresetData(raw),
  };
}

export function exportCurrentPresetToFile(state, chainIndex = 0) {
  const selectedIndex = clamp(Number(chainIndex || 0), 0, CHAIN_COUNT - 1);
  const chain = state?.chains?.[selectedIndex] || emptyChain();
  const macroChain = normalizeMacroChain(state?.macro?.chains?.[selectedIndex] || {});
  const slug = (state?.name || "tone-preset").toLowerCase().replace(/\s+/g, "-");
  const filename = `${slug}-current.json`;

  const payload = {
    presetType: "current",
    name: state?.name || "Current Chain",
    global: deepClone(state?.global || DEFAULT_GLOBAL),
    modules: deepClone(chain.modules || []),
    modulations: deepClone(chain.modulations || []),
  };

  if (hasMacroSettingsInChain(macroChain)) {
    payload.macro = deepClone(macroChain);
  }

  downloadJson(filename, payload);
  return filename;
}

export function exportAllPresetToFile(state) {
  const slug = (state?.name || "tone-preset").toLowerCase().replace(/\s+/g, "-");
  const filename = `${slug}-all.json`;

  const payload = normalizePreset({
    presetType: "all",
    name: state?.name || "All Chains",
    global: deepClone(state?.global || DEFAULT_GLOBAL),
    selectedChainIndex: clamp(Number(state?.selectedChainIndex ?? 0), 0, CHAIN_COUNT - 1),
    chains: deepClone(state?.chains || []),
    macro: deepClone(state?.macro || null),
  });

  if (!hasAnyMacroSettings(payload.macro)) {
    delete payload.macro;
  }

  payload.presetType = "all";
  downloadJson(filename, payload);
  return filename;
}

export function exportPresetToFile(state) {
  const selectedChainIndex = clamp(Number(state?.selectedChainIndex ?? 0), 0, CHAIN_COUNT - 1);
  const filename = exportCurrentPresetToFile(state, selectedChainIndex);
  return filename;
}
