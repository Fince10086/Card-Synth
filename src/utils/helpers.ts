/**
 * Helper utilities for module management and state manipulation
 */

import { NOTE_NAMES, KEYBOARD_LAYOUT, noteFromOffset } from "../core/keyboard";
import { SOURCE_LIBRARY, EFFECT_LIBRARY, COMPONENT_LIBRARY, INPUT_LIBRARY } from "../core/libraries";
import type { ModuleConfig, ModuleCategory, ModuleType, AddableModuleOption, ModuleDefinition } from "../types";

let moduleCounter = 1;

export function createId(prefix: string): string {
  const id = `${prefix}-${String(moduleCounter).padStart(4, "0")}`;
  moduleCounter += 1;
  return id;
}

export function resetModuleCounter(): void {
  moduleCounter = 1;
}

export function deepClone<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as unknown as T;
  }
  const result = {} as Record<string, unknown>;
  for (const key in value as Record<string, unknown>) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      result[key] = deepClone((value as Record<string, unknown>)[key]);
    }
  }
  return result as T;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge(base: unknown, override: unknown): unknown {
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
    const result: Record<string, unknown> = {};
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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getByPath<T = unknown>(object: Record<string, unknown>, path: string): T | undefined {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, object) as T | undefined;
}

export function setByPath(object: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let ref: Record<string, unknown> = object;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      ref[part] = value;
      return;
    }
    if (!isObject(ref[part])) {
      ref[part] = {};
    }
    ref = ref[part] as Record<string, unknown>;
  });
}

export { noteFromOffset };

export { NOTE_NAMES, KEYBOARD_LAYOUT };
export { SOURCE_LIBRARY, EFFECT_LIBRARY, COMPONENT_LIBRARY, INPUT_LIBRARY };

export function createSourceModule(type: ModuleType = "Oscillator"): ModuleConfig {
  const definition = SOURCE_LIBRARY[type] || SOURCE_LIBRARY.Oscillator;
  const options = deepClone(definition.options) as Record<string, unknown>;
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

export function createEffectModule(type: ModuleType = "Chorus"): ModuleConfig {
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

export function createComponentModule(type: ModuleType = "Envelope"): ModuleConfig {
  const definition = COMPONENT_LIBRARY[type] || COMPONENT_LIBRARY.Envelope;
  return {
    id: createId("cmp"),
    type,
    category: "component",
    enabled: true,
    modulationMode: false,
    index: moduleCounter - 1,
    options: deepClone(definition.options),
  };
}

export function createInputModule(type: ModuleType = "Pitch"): ModuleConfig {
  const definition = INPUT_LIBRARY[type] || INPUT_LIBRARY.Pitch;
  return {
    id: createId("inp"),
    type,
    category: "input",
    enabled: true,
    index: moduleCounter - 1,
    options: deepClone(definition.options),
  };
}

export function createModule(category: ModuleCategory, type: ModuleType): ModuleConfig {
  if (category === "source") {
    return createSourceModule(type);
  }
  if (category === "effect") {
    return createEffectModule(type);
  }
  if (category === "input") {
    return createInputModule(type);
  }
  return createComponentModule(type);
}

export function getAddableModuleOptions(): AddableModuleOption[] {
  return [
    ...Object.keys(INPUT_LIBRARY).map((type) => ({
      value: `input:${type}`,
      label: `Input / ${type}`,
      category: "input" as ModuleCategory,
      type: type as ModuleType,
    })),
    ...Object.keys(SOURCE_LIBRARY).map((type) => ({
      value: `source:${type}`,
      label: `OSC / ${type}`,
      category: "source" as ModuleCategory,
      type: type as ModuleType,
    })),
    ...Object.keys(EFFECT_LIBRARY).map((type) => ({
      value: `effect:${type}`,
      label: `Effect / ${type}`,
      category: "effect" as ModuleCategory,
      type: type as ModuleType,
    })),
    ...Object.keys(COMPONENT_LIBRARY).map((type) => ({
      value: `component:${type}`,
      label: `Envelope / ${type}`,
      category: "component" as ModuleCategory,
      type: type as ModuleType,
    })),
  ];
}

export function normalizeModule(module: ModuleConfig | null | undefined, defaultCategory: ModuleCategory, defaultCreator: (type?: string) => ModuleConfig): ModuleConfig {
  const base = defaultCreator(module?.type);
  const merged = deepMerge(base, module || {}) as ModuleConfig;
  merged.id = module?.id || base.id;
  merged.category = module?.category || defaultCategory;
  merged.index = module?.index ?? base.index;
  return merged;
}

export function normalizeSourceModule(module: ModuleConfig | null | undefined): ModuleConfig {
  const normalized = normalizeModule(module, "source", (type) => createSourceModule((type || "Oscillator") as ModuleType));

  if (!isObject(normalized.options)) {
    normalized.options = {};
  }

  const frequencyOffset = Number((normalized.options as Record<string, unknown>)?.frequencyOffset);
  (normalized.options as Record<string, unknown>).frequencyOffset = Number.isFinite(frequencyOffset) ? frequencyOffset : 1;

  if (normalized.type === "Oscillator" || normalized.type === "PulseOscillator") {
    const nextOptions = isObject(normalized.options) ? normalized.options : {};
    const hasConfiguredFrequency = Number.isFinite(Number(nextOptions.frequency)) && Number(nextOptions.frequency) > 0;

    if (!hasConfiguredFrequency) {
      const legacyFrequency = Number((normalized as Record<string, unknown>).modulationFrequency);
      if (Number.isFinite(legacyFrequency) && legacyFrequency > 0) {
        nextOptions.frequency = legacyFrequency;
      }
    }

    normalized.options = nextOptions;
  }

  if ("modulationFrequency" in normalized) {
    delete (normalized as Record<string, unknown>).modulationFrequency;
  }

  return normalized;
}

export function normalizeEffectModule(module: ModuleConfig | null | undefined): ModuleConfig {
  return normalizeModule(module, "effect", (type) => createEffectModule((type || "Chorus") as ModuleType));
}

export function normalizeComponentModule(module: ModuleConfig | null | undefined): ModuleConfig {
  return normalizeModule(module, "component", (type) => createComponentModule((type || "Envelope") as ModuleType));
}

export function normalizeInputModule(module: ModuleConfig | null | undefined): ModuleConfig {
  const baseModule = { ...module } as ModuleConfig;

  // Migrate old type names to unified "Pitch"
  if (baseModule.type === "MIDI") {
    baseModule.type = "Pitch";
    baseModule.options = baseModule.options || {};
    (baseModule.options as Record<string, unknown>).mode = "midi";
  } else if (baseModule.type === "Frequency") {
    baseModule.type = "Pitch";
    baseModule.options = baseModule.options || {};
    (baseModule.options as Record<string, unknown>).mode = "frequency";
  }

  const result = normalizeModule(baseModule, "input", () => createInputModule("Pitch"));

  // Ensure mode exists
  if (!(result.options as Record<string, unknown>)?.mode) {
    (result.options as Record<string, unknown>).mode = "midi";
  }

  // Migrate old `polyVoice` field to `mono` toggle
  if ((result.options as Record<string, unknown>)?.polyVoice !== undefined) {
    (result.options as Record<string, unknown>).mono = Number((result.options as Record<string, unknown>).polyVoice) === 1;
    delete (result.options as Record<string, unknown>).polyVoice;
  }

  // Clean up legacy `mono` and `pedal` from Pitch options (now in Voices/Pedal modules)
  if (result.type === "Pitch") {
    delete (result.options as Record<string, unknown>).mono;
    delete (result.options as Record<string, unknown>).pedal;
  }

  return result;
}

export function normalizeAnyModule(module: ModuleConfig | null | undefined): ModuleConfig {
  let category = module?.category || "component";

  // Backward compatibility: modules that used to be in COMPONENT_LIBRARY
  // but are now in EFFECT_LIBRARY should be treated as effect
  if (category === "component" && EFFECT_LIBRARY[module?.type || ""]) {
    category = "effect";
  }

  if (category === "source") {
    return normalizeSourceModule(module);
  }
  if (category === "effect") {
    return normalizeEffectModule(module);
  }
  if (category === "input") {
    return normalizeInputModule(module);
  }
  return normalizeComponentModule(module);
}

export function safeSet(target: { set?(options: unknown): void } | null | undefined, options: unknown): void {
  if (!target || !options) {
    return;
  }
  if (typeof target.set === "function") {
    target.set(options);
  }
}

export function applyPlayerLikeOptions(player: Record<string, unknown>, options: Record<string, unknown> = {}): void {
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
      const playerKey = player[key];
      if (playerKey && typeof playerKey === "object" && "value" in (playerKey as Record<string, unknown>)) {
        (playerKey as Record<string, unknown>).value = options[key];
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

interface RampParam {
  minValue?: number;
  maxValue?: number;
  value?: number;
  rampTo?(value: number, time: number): void;
  linearRampTo?(value: number, time: number): void;
  linearRampToValueAtTime?(value: number, time: number): void;
  context?: { currentTime?: number };
}

export function rampParam(param: RampParam | null | undefined, value: number, time = 0.12): void {
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
      } catch {
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

export function getModuleDefinition(module: ModuleConfig): ModuleDefinition {
  if (module.category === "source" || SOURCE_LIBRARY[module.type]) {
    return SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator;
  }
  if (module.category === "effect" || EFFECT_LIBRARY[module.type]) {
    return EFFECT_LIBRARY[module.type] || EFFECT_LIBRARY.Chorus;
  }
  if (module.category === "input" || INPUT_LIBRARY[module.type]) {
    return INPUT_LIBRARY[module.type] || INPUT_LIBRARY.Pitch;
  }
  return COMPONENT_LIBRARY[module.type] || COMPONENT_LIBRARY.Envelope;
}

export function getModuleAccent(module: ModuleConfig): string {
  const definition = getModuleDefinition(module);
  return definition.accent || "component";
}

export function getModuleTag(module: ModuleConfig): string {
  const definition = getModuleDefinition(module);
  return definition.tag || "Module";
}
