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

function toSlug(filename) {
  return filename
    .replace(/\.json$/i, "")
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function slugToName(slug) {
  return slug
    .replace(/-/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeWithName(data, id) {
  const normalized = normalizeCurrentPresetData(data);
  if (!normalized.name) {
    normalized.name = slugToName(toSlug(id));
  }
  return normalized;
}

export async function loadBuiltinPresets() {
  const modules = import.meta.glob("../presetFiles/*.json", { eager: true, import: "default" });
  const entries = {};

  Object.entries(modules).forEach(([path, data]) => {
    const filename = path.split("/").pop();
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

export function loadUserPresetList() {
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

export function addUserPreset(id, data) {
  userPresets[id] = normalizeWithName(data, id);
  saveUserPreset(id, data);
  return userPresets[id];
}

export function removeUserPreset(id) {
  delete userPresets[id];
  deleteUserPreset(id);
}

export function generateUserPresetId(baseName) {
  const slug = toSlug(baseName) || "custom";
  const all = getAllPresets();
  if (!all[slug]) return slug;
  let n = 1;
  while (all[`${slug}-${n}`]) n++;
  return `${slug}-${n}`;
}

export function getLastSelectedId() {
  return getLastSelectedPresetId();
}

export function saveLastSelectedId(id) {
  setLastSelectedPresetId(id);
}
