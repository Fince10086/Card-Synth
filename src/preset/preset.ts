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
import type { ModuleConfig, Preset, ChainState, MacroChainState, MacroPointState, MacroState, GlobalState, ModulationConnection } from "../types";

const CHAIN_COUNT = 4;
const MACRO_POINT_COUNT = 9;
const DEFAULT_MACRO_POINT_COUNT = 3;
const DEFAULT_GLOBAL: GlobalState = { volume: -8, octave: 4, velocity: 0.8, velocityEnabled: true, polyVoice: 8 };
const MACRO_POINT_DEFAULT = Object.freeze({ x: 0.5, y: 0.5 });
const MACRO_EPSILON = 1e-6;

export interface MacroMappingItem {
  targetChainIndex: number;
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
  scaleMin?: number;
  scaleMax?: number;
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

function createDefaultMacroPointBindings(): { x: MacroMappingItem[]; y: MacroMappingItem[] } {
  return { x: [], y: [] };
}

export function createDefaultMacroPointState(): MacroPointState {
  return {
    x: MACRO_POINT_DEFAULT.x,
    y: MACRO_POINT_DEFAULT.y,
    bindings: createDefaultMacroPointBindings(),
  };
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
  const targetChainIndex = Number(item?.targetChainIndex);
  const targetModuleId = String(item?.targetModuleId || "");
  const targetParamPath = String(item?.targetParamPath || "");
  const rawMin = Number(item?.min);
  const rawMax = Number(item?.max);
  const rawStep = Number(item?.step);

  if (!Number.isFinite(targetChainIndex) || !targetModuleId || !targetParamPath || !Number.isFinite(rawMin) || !Number.isFinite(rawMax)) {
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
    targetChainIndex: clamp(targetChainIndex, 0, CHAIN_COUNT - 1),
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
    const key = `${normalized.targetChainIndex}::${normalized.targetModuleId}::${normalized.targetParamPath}`;
    deduped.set(key, normalized);
  });

  return Array.from(deduped.values());
}

export function normalizeMacroPoint(
  point: Partial<MacroPointState> & { point?: { x?: number; y?: number }; mappings?: Record<string, unknown[]> } = {}
): MacroPointState {
  const fallback = createDefaultMacroPointState();

  const x = typeof point.point?.x === "number" ? point.point.x : point.x;
  const y = typeof point.point?.y === "number" ? point.point.y : point.y;

  return {
    x: clamp(Number(x ?? fallback.x), 0, 1),
    y: clamp(Number(y ?? fallback.y), 0, 1),
    bindings: {
      x: normalizeMacroMappings(point.mappings?.x ?? point.bindings?.x),
      y: normalizeMacroMappings(point.mappings?.y ?? point.bindings?.y),
    },
  };
}

function migrateLegacyMacroChainToPoint(chainMacro: Partial<MacroChainState> & { point?: { x?: number; y?: number; z?: number }; mappings?: Record<string, unknown[]> } = {}, targetChainIndex: number): MacroPointState {
  const normalized = (() => {
    const fallback = createDefaultMacroChainState();
    const x = typeof chainMacro.point?.x === "number" ? chainMacro.point.x : chainMacro.x;
    const y = typeof chainMacro.point?.y === "number" ? chainMacro.point.y : chainMacro.y;
    return {
      x: clamp(Number(x ?? fallback.x), 0, 1),
      y: clamp(Number(y ?? fallback.y), 0, 1),
      bindings: {
        x: chainMacro.mappings?.x ?? chainMacro.bindings?.x ?? [],
        y: chainMacro.mappings?.y ?? chainMacro.bindings?.y ?? [],
        z: chainMacro.mappings?.z ?? chainMacro.bindings?.z ?? [],
      },
    };
  })();

  const migrateAxis = (items: Partial<MacroMappingItem>[]): MacroMappingItem[] =>
    normalizeMacroMappings(
      items.map((item) => ({ ...item, targetChainIndex }))
    );

  return {
    x: normalized.x,
    y: normalized.y,
    bindings: {
      x: migrateAxis(normalized.bindings.x),
      y: migrateAxis(normalized.bindings.y),
    },
  };
}

export function normalizeMacroChain(chainMacro: Partial<MacroChainState> & { point?: { x?: number; y?: number; z?: number }; mappings?: Record<string, unknown[]> } = {}): MacroChainState {
  const fallback = createDefaultMacroChainState();

  const x = typeof chainMacro.point?.x === "number" ? chainMacro.point.x : chainMacro.x;
  const y = typeof chainMacro.point?.y === "number" ? chainMacro.point.y : chainMacro.y;
  const z = typeof chainMacro.point?.z === "number" ? chainMacro.point.z : chainMacro.z;

  return {
    x: clamp(Number(x ?? fallback.x), 0, 1),
    y: clamp(Number(y ?? fallback.y), 0, 1),
    z: clamp(Number(z ?? fallback.z), 0, 1),
    bindings: {
      x: normalizeMacroMappings(chainMacro.mappings?.x ?? chainMacro.bindings?.x),
      y: normalizeMacroMappings(chainMacro.mappings?.y ?? chainMacro.bindings?.y),
      z: normalizeMacroMappings(chainMacro.mappings?.z ?? chainMacro.bindings?.z),
    },
  };
}

export function createDefaultMacroState(): MacroState {
  return {
    pointCount: DEFAULT_MACRO_POINT_COUNT,
    selectedPointIndex: 0,
    recentSelection: [0, 1, 2],
    points: Array.from({ length: MACRO_POINT_COUNT }, () => createDefaultMacroPointState()),
  };
}

export function normalizeMacroState(macro: Partial<MacroState> | null = null, chainFallback: ChainState[] = []): MacroState {
  const fallbackList = Array.isArray(chainFallback) ? chainFallback : [];

  if (macro && Array.isArray((macro as { points?: unknown }).points)) {
    const rawPointCount = Number((macro as { pointCount?: number }).pointCount);
    const pointCount = clamp(Number.isFinite(rawPointCount) ? rawPointCount : DEFAULT_MACRO_POINT_COUNT, 1, MACRO_POINT_COUNT);
    const rawSelected = Number((macro as { selectedPointIndex?: number }).selectedPointIndex);
    const selectedPointIndex = clamp(Number.isFinite(rawSelected) ? rawSelected : 0, 0, pointCount - 1);
    const rawRecent = (macro as { recentSelection?: unknown }).recentSelection;
    const recentSelection = Array.isArray(rawRecent)
      ? rawRecent.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0 && n < pointCount)
      : [];

    const sourcePoints = Array.isArray((macro as { points?: unknown[] }).points) ? (macro as { points: unknown[] }).points : [];

    const points: MacroPointState[] = Array.from({ length: MACRO_POINT_COUNT }, (_, index) => {
      const rawPoint = sourcePoints[index];
      if (rawPoint && typeof rawPoint === "object") {
        return normalizeMacroPoint(rawPoint as Parameters<typeof normalizeMacroPoint>[0]);
      }
      return createDefaultMacroPointState();
    });

    return {
      pointCount,
      selectedPointIndex,
      recentSelection: recentSelection.length > 0 ? recentSelection : [0, 1, 2].slice(0, pointCount),
      points,
    };
  }

  // Legacy migration from chain-based macro state
  const sourceChains = Array.isArray(macro)
    ? (macro as unknown as Array<Partial<MacroChainState> & { point?: { x?: number; y?: number; z?: number }; mappings?: Record<string, unknown[]> }>)
    : Array.isArray((macro as { chains?: unknown }).chains)
      ? ((macro as { chains: unknown }).chains as Array<Partial<MacroChainState> & { point?: { x?: number; y?: number; z?: number }; mappings?: Record<string, unknown[]> }>)
      : [];

  const points: MacroPointState[] = Array.from({ length: MACRO_POINT_COUNT }, (_, index) => {
    const fromMacro = sourceChains[index];
    const fromChain = fallbackList[index]?.macro;
    if (fromMacro || fromChain) {
      return migrateLegacyMacroChainToPoint(fromMacro ?? fromChain ?? {}, index);
    }
    return createDefaultMacroPointState();
  });

  let pointCount = DEFAULT_MACRO_POINT_COUNT;
  for (let i = MACRO_POINT_COUNT - 1; i >= 0; i--) {
    const p = points[i];
    if (p.bindings.x.length > 0 || p.bindings.y.length > 0 || Math.abs(p.x - MACRO_POINT_DEFAULT.x) > MACRO_EPSILON || Math.abs(p.y - MACRO_POINT_DEFAULT.y) > MACRO_EPSILON) {
      pointCount = Math.max(pointCount, i + 1);
      break;
    }
  }
  pointCount = clamp(pointCount, 1, MACRO_POINT_COUNT);

  return {
    pointCount,
    selectedPointIndex: 0,
    recentSelection: [0, 1, 2].slice(0, pointCount),
    points,
  };
}

export function hasMacroSettingsInPoint(point: Partial<MacroPointState> = {}): boolean {
  const normalized = normalizeMacroPoint(point);
  return (
    Math.abs(normalized.x - MACRO_POINT_DEFAULT.x) > MACRO_EPSILON
    || Math.abs(normalized.y - MACRO_POINT_DEFAULT.y) > MACRO_EPSILON
    || normalized.bindings.x.length > 0
    || normalized.bindings.y.length > 0
  );
}

export function hasAnyMacroSettings(macroState: Partial<MacroState> = {}): boolean {
  const normalized = normalizeMacroState(macroState);
  return normalized.points.some((point) => hasMacroSettingsInPoint(point));
}

function normalizeModulations(modulations: Array<Partial<ModulationItem> | ModulationConnection> = []): ModulationItem[] {
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

export function normalizeCurrentPresetData(preset: Partial<{ global: Partial<GlobalState>; modules: ModuleConfig[]; modulations: ModulationItem[]; macro: Partial<MacroChainState>; name?: string }> = {}): { global: GlobalState; modules: ModuleConfig[]; modulations: ModulationItem[]; macro: MacroState; name?: string } {
  const modules = Array.isArray(preset.modules)
    ? preset.modules.map((module) => normalizeAnyModule(module))
    : createStarterModules();

  const legacyChainMacro = preset?.macro
    ? normalizeMacroChain(preset.macro as Parameters<typeof normalizeMacroChain>[0])
    : null;

  const migratedPoint = legacyChainMacro
    ? migrateLegacyMacroChainToPoint(legacyChainMacro as Parameters<typeof migrateLegacyMacroChainToPoint>[0], 0)
    : null;

  const points = Array.from({ length: MACRO_POINT_COUNT }, (_, index) =>
    index === 0 && migratedPoint ? migratedPoint : createDefaultMacroPointState()
  );

  const hasSettings = migratedPoint && hasMacroSettingsInPoint(migratedPoint);

  return {
    global: normalizeGlobalState(preset.global || {}),
    modules,
    modulations: normalizeModulations(Array.isArray(preset.modulations) ? preset.modulations : []),
    macro: {
      pointCount: hasSettings ? Math.max(DEFAULT_MACRO_POINT_COUNT, 1) : DEFAULT_MACRO_POINT_COUNT,
      selectedPointIndex: 0,
      recentSelection: [0, 1, 2],
      points,
    },
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

  const current = normalizeCurrentPresetData(preset as unknown as Parameters<typeof normalizeCurrentPresetData>[0]);
  const macro = current.macro;
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
  return Array.isArray((preset as unknown as Record<string, unknown>)?.chains) || (preset as unknown as Record<string, unknown>)?.presetType === "all";
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
  const macroPoint = normalizeMacroPoint(state?.macro?.points?.[selectedIndex] || {});
  const slug = presetName.toLowerCase().replace(/\s+/g, "-");
  const filename = `${slug}-current.json`;

  const payload: Record<string, unknown> = {
    presetType: "current",
    global: deepClone(state?.global || DEFAULT_GLOBAL),
    modules: deepClone(chain.modules || []),
    modulations: deepClone(chain.modulations || []),
  };

  if (hasMacroSettingsInPoint(macroPoint)) {
    payload.macro = deepClone(macroPoint);
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
    delete (payload as unknown as Record<string, unknown>).macro;
  }

  (payload as unknown as Record<string, unknown>).presetType = "all";
  downloadJson(filename, payload);
  return filename;
}

export function exportPresetToFile(state: Preset): string {
  const selectedChainIndex = clamp(Number(state?.selectedChainIndex ?? 0), 0, CHAIN_COUNT - 1);
  const filename = exportCurrentPresetToFile(state, selectedChainIndex);
  return filename;
}
