/**
 * Preset management utilities
 */

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
  createInputModule,
} from "../utils/helpers";
import type { ModuleConfig, Preset, ChainState, MacroChainState, MacroState, GlobalState } from "../types";

const CHAIN_COUNT = 4;
const DEFAULT_GLOBAL: GlobalState = { volume: -8, octave: 4, velocity: 0.8, velocityEnabled: true, polyVoice: 8 };
const MACRO_POINT_DEFAULT = Object.freeze({ x: 0.5, y: 0.5 });
const MACRO_EPSILON = 1e-6;

export interface MacroMappingItem {
  targetModuleId: string;
  targetParamPath: string;
  min: number;
  max: number;
  step: number;
  rangeStart: number;
  rangeEnd: number;
}

export interface ModulationItem {
  id: string;
  sourceModuleId: string;
  sourceVoiceIndex: number;
  targetModuleId: string;
  targetParamPath: string;
  radius: number;
}

function createStarterModules(): ModuleConfig[] {
  return [
    createInputModule("Pitch"),
    createSourceModule("Oscillator"),
    createEffectModule("Filter"),
    createComponentModule("Envelope"),
    createEffectModule("Chorus"),
  ];
}

function normalizeGlobalState(global: Partial<GlobalState> = {}): GlobalState {
  const merged = deepMerge(DEFAULT_GLOBAL, global || {}) as GlobalState;
  merged.octave = clamp(Number(merged.octave || 4), 1, 7);
  merged.velocity = clamp(Number(merged.velocity || 0.8), 0.1, 1);
  merged.volume = clamp(Number(merged.volume || -8), -36, 6);
  merged.velocityEnabled = merged.velocityEnabled !== false;
  merged.polyVoice = clamp(Number(merged.polyVoice ?? 8), 2, 8);
  return merged;
}

export function createDefaultMacroChainState(): MacroChainState {
  return {
    x: MACRO_POINT_DEFAULT.x,
    y: MACRO_POINT_DEFAULT.y,
    z: 0.5,
    bindings: {
      x: [],
      y: [],
      z: [],
    },
  };
}

function normalizeMacroMappingItem(item: Partial<MacroMappingItem> = {}): MacroMappingItem | null {
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

function normalizeMacroMappings(items: Partial<MacroMappingItem>[] = []): MacroMappingItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const deduped = new Map<string, MacroMappingItem>();
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

export function normalizeMacroChain(chainMacro: Partial<MacroChainState> = {}): MacroChainState {
  const fallback = createDefaultMacroChainState();

  return {
    x: clamp(Number(chainMacro.x ?? fallback.x), 0, 1),
    y: clamp(Number(chainMacro.y ?? fallback.y), 0, 1),
    z: clamp(Number(chainMacro.z ?? fallback.z), 0, 1),
    bindings: {
      x: normalizeMacroMappings(chainMacro.bindings?.x),
      y: normalizeMacroMappings(chainMacro.bindings?.y),
      z: normalizeMacroMappings(chainMacro.bindings?.z),
    },
  };
}

export function createDefaultMacroState(): MacroState {
  return {
    chains: Array.from({ length: CHAIN_COUNT }, () => createDefaultMacroChainState()),
  };
}

export function normalizeMacroState(macro: Partial<MacroState> | null = null, chainFallback: ChainState[] = []): MacroState {
  const fallbackList = Array.isArray(chainFallback) ? chainFallback : [];
  const sourceChains = Array.isArray(macro)
    ? macro
    : Array.isArray(macro?.chains)
      ? macro!.chains
      : [];

  return {
    chains: Array.from({ length: CHAIN_COUNT }, (_, index) => {
      const fromMacro = sourceChains[index];
      const fromChain = fallbackList[index]?.macro;
      return normalizeMacroChain(fromMacro ?? fromChain ?? {});
    }),
  };
}

export function hasMacroSettingsInChain(chainMacro: Partial<MacroChainState> = {}): boolean {
  const normalized = normalizeMacroChain(chainMacro);
  return (
    Math.abs(normalized.x - MACRO_POINT_DEFAULT.x) > MACRO_EPSILON
    || Math.abs(normalized.y - MACRO_POINT_DEFAULT.y) > MACRO_EPSILON
    || normalized.bindings.x.length > 0
    || normalized.bindings.y.length > 0
  );
}

export function hasAnyMacroSettings(macroState: Partial<MacroState> = {}): boolean {
  const normalized = normalizeMacroState(macroState);
  return normalized.chains.some((chainMacro) => hasMacroSettingsInChain(chainMacro));
}

function normalizeModulations(modulations: Partial<ModulationItem>[] = []): ModulationItem[] {
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

function normalizeChain(chain: Partial<ChainState> = {}, { defaultEnabled = false, defaultModules = [] }: { defaultEnabled?: boolean; defaultModules?: ModuleConfig[] } = {}): ChainState {
  const hasModulesField = Array.isArray(chain?.modules);
  const modules = hasModulesField
    ? chain.modules!.map((module) => normalizeAnyModule(module))
    : defaultModules.map((module) => normalizeAnyModule(module));

  const rawModulations = Array.isArray(chain?.modulations) ? chain.modulations : [];

  return {
    enabled: chain?.enabled === undefined ? defaultEnabled : Boolean(chain.enabled),
    modules,
    modulations: normalizeModulations(rawModulations),
  };
}

function emptyChain(): ChainState {
  return { enabled: false, modules: [], modulations: [] };
}

export function normalizeCurrentPresetData(preset: Partial<{ global: Partial<GlobalState>; modules: ModuleConfig[]; modulations: ModulationItem[]; macro: Partial<MacroChainState> }> = {}): { global: GlobalState; modules: ModuleConfig[]; modulations: ModulationItem[]; macro: MacroChainState } {
  const modules = Array.isArray(preset.modules)
    ? preset.modules.map((module) => normalizeAnyModule(module))
    : createStarterModules();

  return {
    global: normalizeGlobalState(preset.global || {}),
    modules,
    modulations: normalizeModulations(Array.isArray(preset.modulations) ? preset.modulations : []),
    macro: normalizeMacroChain(preset?.macro || {}),
  };
}

export function createBasePreset(): Preset {
  return {
    global: normalizeGlobalState({}),
    selectedChainIndex: 0,
    chains: [
      { enabled: true, modules: createStarterModules(), modulations: [] },
      emptyChain(),
      emptyChain(),
      emptyChain(),
    ],
    macro: createDefaultMacroState(),
  };
}

export function normalizePreset(preset: Partial<Preset> = {}): Preset {
  resetModuleCounter();

  if (Array.isArray(preset?.chains)) {
    const macro = normalizeMacroState(preset?.macro, preset.chains);
    const chains = Array.from({ length: CHAIN_COUNT }, (_, index) => {
      const incoming = preset.chains![index] || {};
      return normalizeChain(incoming, { defaultEnabled: index === 0, defaultModules: [] });
    });

    return {
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

function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

export function isAllTypePreset(preset: unknown): boolean {
  return Array.isArray((preset as Record<string, unknown>)?.chains) || (preset as Record<string, unknown>)?.presetType === "all";
}

export async function importPresetFromFile(file: File): Promise<{ type: "all"; preset: Preset } | { type: "current"; chain: ReturnType<typeof normalizeCurrentPresetData> }> {
  const text = await file.text();
  const raw = JSON.parse(text);

  if (isAllTypePreset(raw)) {
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

export function exportCurrentPresetToFile(state: Preset, chainIndex = 0, presetName = "preset"): string {
  const selectedIndex = clamp(Number(chainIndex || 0), 0, CHAIN_COUNT - 1);
  const chain = state?.chains?.[selectedIndex] || emptyChain();
  const macroChain = normalizeMacroChain(state?.macro?.chains?.[selectedIndex] || {});
  const slug = presetName.toLowerCase().replace(/\s+/g, "-");
  const filename = `${slug}-current.json`;

  const payload: Record<string, unknown> = {
    presetType: "current",
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

export function exportAllPresetToFile(state: Preset, presetName = "preset"): string {
  const slug = presetName.toLowerCase().replace(/\s+/g, "-");
  const filename = `${slug}-all.json`;

  const payload = normalizePreset({
    presetType: "all",
    global: deepClone(state?.global || DEFAULT_GLOBAL),
    selectedChainIndex: clamp(Number(state?.selectedChainIndex ?? 0), 0, CHAIN_COUNT - 1),
    chains: deepClone(state?.chains || []),
    macro: deepClone(state?.macro || null),
  });

  if (!hasAnyMacroSettings(payload.macro)) {
    delete (payload as Record<string, unknown>).macro;
  }

  (payload as Record<string, unknown>).presetType = "all";
  downloadJson(filename, payload);
  return filename;
}

export function exportPresetToFile(state: Preset): string {
  const selectedChainIndex = clamp(Number(state?.selectedChainIndex ?? 0), 0, CHAIN_COUNT - 1);
  const filename = exportCurrentPresetToFile(state, selectedChainIndex);
  return filename;
}
