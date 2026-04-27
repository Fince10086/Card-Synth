import { NOTE_NAMES, KEYBOARD_LAYOUT, noteFromOffset } from "../core/keyboard.js";
import { SOURCE_LIBRARY, EFFECT_LIBRARY, COMPONENT_LIBRARY } from "../core/libraries.js";

let moduleCounter = 1;

export function createId(prefix) {
  const id = `${prefix}-${String(moduleCounter).padStart(4, "0")}`;
  moduleCounter += 1;
  return id;
}

export function resetModuleCounter() {
  moduleCounter = 1;
}

export function deepClone(value) {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

export function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge(base, override) {
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

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function getByPath(object, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), object);
}

export function setByPath(object, path, value) {
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

export { noteFromOffset };

export { NOTE_NAMES, KEYBOARD_LAYOUT };
export { SOURCE_LIBRARY, EFFECT_LIBRARY, COMPONENT_LIBRARY };

export function createSourceModule(type = "Oscillator") {
  const definition = SOURCE_LIBRARY[type] || SOURCE_LIBRARY.Oscillator;
  const options = deepClone(definition.options);
  const initialFrequencyOffset = Number(options?.frequencyOffset);
  options.frequencyOffset = Number.isFinite(initialFrequencyOffset) ? initialFrequencyOffset : 1;
  return {
    id: createId("src"),
    type,
    category: "source",
    enabled: true,
    volume: -8,
    pan: 0,
    modulationMode: false,
    midiOn: true,
    index: moduleCounter - 1,
    ...(definition.moduleDefaults ? deepClone(definition.moduleDefaults) : {}),
    options,
  };
}

export function createEffectModule(type = "Chorus") {
  const definition = EFFECT_LIBRARY[type] || EFFECT_LIBRARY.Chorus;
  return {
    id: createId("fx"),
    type,
    category: "effect",
    enabled: true,
    index: moduleCounter - 1,
    options: deepClone(definition.options),
  };
}

export function createComponentModule(type = "AmplitudeEnvelope") {
  const definition = COMPONENT_LIBRARY[type] || COMPONENT_LIBRARY.AmplitudeEnvelope;
  return {
    id: createId("cmp"),
    type,
    category: "component",
    enabled: true,
    index: moduleCounter - 1,
    options: deepClone(definition.options),
  };
}

export function createModule(category, type) {
  if (category === "source") {
    return createSourceModule(type);
  }
  if (category === "effect") {
    return createEffectModule(type);
  }
  return createComponentModule(type);
}

export function getAddableModuleOptions() {
  return [
    ...Object.keys(SOURCE_LIBRARY).map((type) => ({
      value: `source:${type}`,
      label: `OSC / ${type}`,
      category: "source",
    })),
    ...Object.keys(EFFECT_LIBRARY).map((type) => ({
      value: `effect:${type}`,
      label: `Effect / ${type}`,
      category: "effect",
    })),
    ...Object.keys(COMPONENT_LIBRARY).map((type) => ({
      value: `component:${type}`,
      label: `Envelope / ${type}`,
      category: "component",
    })),
  ];
}

export function normalizeModule(module, defaultCategory, defaultCreator) {
  const base = defaultCreator(module?.type);
  const merged = deepMerge(base, module || {});
  merged.id = module?.id || base.id;
  merged.category = module?.category || defaultCategory;
  merged.index = module?.index ?? base.index;
  return merged;
}

export function normalizeSourceModule(module) {
  const normalized = normalizeModule(module, "source", (type) => createSourceModule(type || "Oscillator"));

  if (!isObject(normalized.options)) {
    normalized.options = {};
  }

  const frequencyOffset = Number(normalized.options.frequencyOffset);
  normalized.options.frequencyOffset = Number.isFinite(frequencyOffset) ? frequencyOffset : 1;

  if (normalized.type === "Oscillator" || normalized.type === "PulseOscillator") {
    const nextOptions = isObject(normalized.options) ? normalized.options : {};
    const hasConfiguredFrequency = Number.isFinite(Number(nextOptions.frequency)) && Number(nextOptions.frequency) > 0;

    if (!hasConfiguredFrequency) {
      const legacyFrequency = Number(normalized.modulationFrequency);
      if (Number.isFinite(legacyFrequency) && legacyFrequency > 0) {
        nextOptions.frequency = legacyFrequency;
      }
    }

    normalized.options = nextOptions;
  }

  if ("modulationFrequency" in normalized) {
    delete normalized.modulationFrequency;
  }

  return normalized;
}

export function normalizeEffectModule(module) {
  return normalizeModule(module, "effect", (type) => createEffectModule(type || "Chorus"));
}

export function normalizeComponentModule(module) {
  return normalizeModule(module, "component", (type) => createComponentModule(type || "AmplitudeEnvelope"));
}

export function normalizeAnyModule(module) {
  let category = module?.category || "component";

  if (category === "source") {
    return normalizeSourceModule(module);
  }
  if (category === "effect") {
    return normalizeEffectModule(module);
  }
  return normalizeComponentModule(module);
}

export function safeSet(target, options) {
  if (!target || !options) {
    return;
  }
  if (typeof target.set === "function") {
    target.set(options);
  }
}

export function applyPlayerLikeOptions(player, options = {}) {
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

export function rampParam(param, value, time = 0.12) {
  if (!param) {
    return;
  }

  // 获取参数的有效范围
  const minValue = param.minValue ?? -Infinity;
  const maxValue = param.maxValue ?? Infinity;

  // 检查范围是否有效（min === max 是无效范围）
  if (minValue === maxValue) {
    // 范围无效，直接设置值而不使用 rampTo
    if ("value" in param) {
      param.value = Math.max(minValue, Math.min(maxValue, value));
    }
    return;
  }

  // 将值钳制到有效范围内
  const clampedValue = Math.max(minValue, Math.min(maxValue, value));

  if (typeof param.rampTo === "function") {
    // 检查值是否接近0，如果是则使用线性渐变而不是指数渐变
    // 因为 exponentialRampToValueAtTime 不能 ramp 到 0
    const isNearZero = Math.abs(clampedValue) < 1e-10;
    
    if (isNearZero && typeof param.linearRampTo === "function") {
      // 使用线性渐变到接近0的值
      param.linearRampTo(0, time);
    } else if (isNearZero && typeof param.linearRampToValueAtTime === "function") {
      // 直接使用 AudioParam 的线性渐变
      const now = param.context?.currentTime ?? 0;
      param.linearRampToValueAtTime(0, now + time);
    } else {
      // 正常使用 rampTo（通常是指数渐变）
      try {
        param.rampTo(clampedValue, time);
      } catch (e) {
        // 如果 rampTo 失败（比如范围错误），直接设置值
        if ("value" in param) {
          param.value = clampedValue;
        }
      }
    }
  } else if ("value" in param) {
    param.value = clampedValue;
  }
}

export function getModuleDefinition(module) {
  if (module.category === "source" || SOURCE_LIBRARY[module.type]) {
    return SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator;
  }
  if (module.category === "effect" || EFFECT_LIBRARY[module.type]) {
    return EFFECT_LIBRARY[module.type] || EFFECT_LIBRARY.Chorus;
  }
  return COMPONENT_LIBRARY[module.type] || COMPONENT_LIBRARY.AmplitudeEnvelope;
}

export function getModuleAccent(module) {
  const definition = getModuleDefinition(module);
  return definition.accent || "component";
}

export function getModuleTag(module) {
  const definition = getModuleDefinition(module);
  return definition.tag || "Module";
}
