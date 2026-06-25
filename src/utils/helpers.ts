/**
 * Helper utilities for module management and state manipulation
 */

import { SOURCE_LIBRARY, EFFECT_LIBRARY, getTrackAudioUrl } from "../core/libraries";
import { t } from "../i18n";
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
  const result = {} as unknown as Record<string, unknown>;
  for (const key in value as unknown as Record<string, unknown>) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      result[key] = deepClone((value as unknown as Record<string, unknown>)[key]);
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
  if (!isObject(base) || !isObject(override)) {
    return override === undefined ? deepClone(base) : deepClone(override);
  }
  const result = {} as unknown as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(base), ...Object.keys(override)]);
  allKeys.forEach((key) => {
    if (key in override) {
      result[key] = deepMerge(
        (base as Record<string, unknown>)[key],
        (override as Record<string, unknown>)[key]
      );
    } else {
      result[key] = deepClone((base as Record<string, unknown>)[key]);
    }
  });
  return result;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

export function getByPath<T>(object: unknown, path: string): T | undefined {
  if (!isObject(object)) return undefined;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    return (acc as unknown as Record<string, unknown>)[key];
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
    ref = ref[part] as unknown as Record<string, unknown>;
  });
}

export { SOURCE_LIBRARY, EFFECT_LIBRARY, getTrackAudioUrl };

const TRACK_NAMES: Record<number, string> = {
  0: "1-Violin",
  1: "2-Effects",
  2: "3-Sampler",
  3: "4-Water",
};

export function createSourceModule(chainIndex: number = 0): ModuleConfig {
  const type: ModuleType = "TrackPlayer";
  const definition = SOURCE_LIBRARY[type];
  const options = deepClone(definition.options) as unknown as Record<string, unknown>;
  options.url = getTrackAudioUrl(chainIndex);
  return {
    id: createId("src"),
    type,
    category: "source",
    enabled: true,
    volume: -8,
    pan: 0,
    index: moduleCounter - 1,
    label: TRACK_NAMES[chainIndex] ?? "TrackPlayer",
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

export function createModule(category: ModuleCategory, type: ModuleType, chainIndex: number = 0): ModuleConfig {
  if (category === "source") {
    return createSourceModule(chainIndex);
  }
  if (category === "effect") {
    // Handle legacy types that no longer exist
    const validEffects = Object.keys(EFFECT_LIBRARY);
    const effectType = validEffects.includes(type as string) ? type : "Chorus";
    return createEffectModule(effectType);
  }
  return createEffectModule("Chorus" as ModuleType);
}

export function getAddableModuleOptions(): AddableModuleOption[] {
  return [
    ...Object.keys(EFFECT_LIBRARY).map((type) => ({
      value: `effect:${type}`,
      label: t(type),
      category: "effect" as ModuleCategory,
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

export function normalizeSourceModule(module: ModuleConfig | null | undefined, chainIndex: number = 0): ModuleConfig {
  // Map legacy source types to TrackPlayer
  const type = module?.type as string || "TrackPlayer";
  const validSourceTypes = Object.keys(SOURCE_LIBRARY);
  if (!validSourceTypes.includes(type)) {
    // Old source type — normalize to TrackPlayer
    const normalized = normalizeModule(module, "source", () => createSourceModule(chainIndex));
    normalized.type = "TrackPlayer";
    return normalized;
  }

  const normalized = normalizeModule(module, "source", () => createSourceModule(chainIndex));

  if (!isObject(normalized.options)) {
    normalized.options = {};
  }

  return normalized;
}

export function normalizeEffectModule(module: ModuleConfig | null | undefined): ModuleConfig {
  return normalizeModule(module, "effect", (type) => createEffectModule((type || "Chorus") as ModuleType));
}

export function normalizeAnyModule(module: ModuleConfig | null | undefined, chainIndex: number = 0): ModuleConfig {
  const category = (module?.category as string | undefined) || "effect";

  // Map legacy categories to supported ones
  if (category === "input" || category === "envelope" || category === "component") {
    return normalizeEffectModule(module);
  }
  if (category === "source") {
    return normalizeSourceModule(module, chainIndex);
  }
  if (category === "effect") {
    return normalizeEffectModule(module);
  }
  return normalizeEffectModule(module);
}

export function normalizeModules(modules: ModuleConfig[] | null | undefined, chainIndex: number = 0): ModuleConfig[] {
  if (!Array.isArray(modules)) return [];
  return modules.map((m) => normalizeAnyModule(m, chainIndex));
}

export function safeSet(target: Record<string, unknown>, options: Record<string, unknown>): void {
  if (!target || !options) return;
  Object.entries(options).forEach(([key, value]) => {
    if (key in target) {
      target[key] = value;
    }
  });
}

export function applyPlayerLikeOptions(player: Record<string, unknown>, options: Record<string, unknown>): void {
  if (!player || !options) return;

  ["playbackRate", "fadeIn", "fadeOut"].forEach((key) => {
    if (options[key] !== undefined && key in player) {
      player[key] = options[key];
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

  const minValue = param.minValue ?? -Infinity;
  const maxValue = param.maxValue ?? Infinity;

  if (minValue === maxValue) {
    if ("value" in param) {
      param.value = Math.max(minValue, Math.min(maxValue, value));
    }
    return;
  }

  const clampedValue = Math.max(minValue, Math.min(maxValue, value));

  if (typeof param.rampTo === "function") {
    const isNearZero = Math.abs(clampedValue) < 1e-10;

    if (isNearZero && typeof param.linearRampTo === "function") {
      param.linearRampTo(0, time);
    } else if (isNearZero && typeof param.linearRampToValueAtTime === "function") {
      const now = param.context?.currentTime ?? 0;
      param.linearRampToValueAtTime(0, now + time);
    } else {
      try {
        param.rampTo(clampedValue, time);
      } catch {
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
    return SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.TrackPlayer;
  }
  return EFFECT_LIBRARY[module.type] || EFFECT_LIBRARY.Chorus;
}

export function getModuleAccent(module: ModuleConfig): string {
  const definition = getModuleDefinition(module);
  return definition.accent || "effect";
}

export function getModuleTag(module: ModuleConfig): string {
  const definition = getModuleDefinition(module);
  return definition.tag || "Module";
}
