/**
 * Preset loader - manages builtin and user presets
 */

import {
  normalizeCurrentPresetData,
} from "./preset";
import {
  loadUserPresets,
  saveUserPreset,
  deleteUserPreset,
  getLastSelectedPresetId,
  setLastSelectedPresetId,
} from "./presetStorage";
import type { Preset, GlobalState, ModuleConfig, MacroChainState } from "../types";
import type { ModulationItem } from "./preset";

let builtinPresets: Record<string, Preset> = {};
let userPresets: Record<string, Preset> = {};

function toSlug(filename: string): string {
  return filename
    .replace(/\.json$/i, "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function slugToName(slug: string): string {
  return slug
    .replace(/-/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeWithName(data: unknown, id: string): Preset {
  const normalized = normalizeCurrentPresetData(data as unknown as Partial<{ global: Partial<GlobalState>; modules: ModuleConfig[]; modulations: ModulationItem[]; macro: Partial<MacroChainState>; name?: string }>);
  if (!normalized.name) {
    (normalized as unknown as Record<string, unknown>).name = slugToName(toSlug(id));
  }
  return normalized as unknown as Preset;
}

export async function loadBuiltinPresets(): Promise<Record<string, Preset>> {
  const modules = import.meta.glob<{ default: unknown }>("../presetFiles/*.json", { eager: true, import: "default" });
  const entries: Record<string, Preset> = {};

  Object.entries(modules).forEach(([path, data]) => {
    const filename = path.split("/").pop() || "";
    const id = toSlug(filename);

    try {
      entries[id] = normalizeWithName(data, id);
    } catch (err) {
      console.warn(`Failed to parse preset ${filename}:`, err);
    }
  });

  builtinPresets = entries;
  return entries;
}

export function loadUserPresetList(): Record<string, Preset> {
  const raw = loadUserPresets();
  userPresets = {};
  Object.entries(raw).forEach(([id, data]) => {
    try {
      userPresets[id] = normalizeWithName(data, id);
    } catch (err) {
      console.warn(`Failed to parse user preset ${id}:`, err);
    }
  });
  return userPresets;
}

export async function loadAllPresets(): Promise<void> {
  await loadBuiltinPresets();
  loadUserPresetList();
}

export function getBuiltinPresets(): Record<string, Preset> {
  return builtinPresets;
}

export function getUserPresets(): Record<string, Preset> {
  return userPresets;
}

export function getAllPresets(): Record<string, Preset> {
  return { ...builtinPresets, ...userPresets };
}

export function getPresetById(id: string): Preset | null {
  return builtinPresets[id] || userPresets[id] || null;
}

export function isBuiltinPreset(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(builtinPresets, id);
}

export function addUserPreset(id: string, data: unknown): Preset {
  userPresets[id] = normalizeWithName(data, id);
  saveUserPreset(id, data);
  return userPresets[id];
}

export function removeUserPreset(id: string): void {
  delete userPresets[id];
  deleteUserPreset(id);
}

export function generateUserPresetId(baseName: string): string {
  const slug = toSlug(baseName) || "custom";
  const all = getAllPresets();
  if (!all[slug]) return slug;
  let n = 1;
  while (all[`${slug}-${n}`]) n++;
  return `${slug}-${n}`;
}

export function getLastSelectedId(): string | null {
  return getLastSelectedPresetId();
}

export function saveLastSelectedId(id: string): void {
  setLastSelectedPresetId(id);
}
