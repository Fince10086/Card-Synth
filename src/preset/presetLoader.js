import {
  normalizeCurrentPresetData,
} from "./preset.js";
import {
  loadUserPresets,
  saveUserPreset,
  deleteUserPreset,
  getLastSelectedPresetId,
  setLastSelectedPresetId,
} from "./presetStorage.js";

let builtinPresets = {};
let userPresets = {};

function filenameToName(filename) {
  const nameWithoutExt = filename.replace(/\.json$/i, "");
  const withSpaces = nameWithoutExt.replace(/[_-]/g, " ");
  return withSpaces
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function filenameToId(filename) {
  return filename.replace(/\.json$/i, "").toLowerCase().replace(/\s+/g, "-");
}

export async function loadBuiltinPresets() {
  const modules = import.meta.glob("../presets/*.json", { eager: true, import: "default" });
  const entries = {};

  Object.entries(modules).forEach(([path, data]) => {
    const filename = path.split("/").pop();
    const id = filenameToId(filename);
    const name = filenameToName(filename);

    try {
      const normalized = normalizeCurrentPresetData(data);
      normalized.name = name;
      entries[id] = normalized;
    } catch (err) {
      console.warn(`Failed to parse preset ${filename}:`, err);
    }
  });

  builtinPresets = entries;
  return entries;
}

export function loadUserPresetList() {
  const raw = loadUserPresets();
  userPresets = {};
  Object.entries(raw).forEach(([id, data]) => {
    try {
      const normalized = normalizeCurrentPresetData(data);
      if (!normalized.name) {
        normalized.name = filenameToName(id);
      }
      userPresets[id] = normalized;
    } catch (err) {
      console.warn(`Failed to parse user preset ${id}:`, err);
    }
  });
  return userPresets;
}

export async function loadAllPresets() {
  await loadBuiltinPresets();
  loadUserPresetList();
}

export function getBuiltinPresets() {
  return builtinPresets;
}

export function getUserPresets() {
  return userPresets;
}

export function getAllPresets() {
  return { ...builtinPresets, ...userPresets };
}

export function getPresetById(id) {
  return builtinPresets[id] || userPresets[id] || null;
}

export function isBuiltinPreset(id) {
  return Object.prototype.hasOwnProperty.call(builtinPresets, id);
}

export function isAllTypePreset(preset) {
  return Array.isArray(preset?.chains) || preset?.presetType === "all";
}

export function addUserPreset(id, data) {
  const normalized = normalizeCurrentPresetData(data);
  if (!normalized.name) {
    normalized.name = filenameToName(id);
  }
  userPresets[id] = normalized;
  saveUserPreset(id, data);
  return normalized;
}

export function removeUserPreset(id) {
  delete userPresets[id];
  deleteUserPreset(id);
}

export function generateUserPresetId(baseName) {
  const slug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  let id = slug || "custom";
  const all = getAllPresets();
  if (!all[id]) return id;
  let n = 1;
  while (all[`${id}-${n}`]) n++;
  return `${id}-${n}`;
}

export function getLastSelectedId() {
  return getLastSelectedPresetId();
}

export function saveLastSelectedId(id) {
  setLastSelectedPresetId(id);
}
