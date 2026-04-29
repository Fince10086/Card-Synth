/**
 * Preset storage - localStorage wrapper
 */

const STORAGE_KEY = "card_synth_user_presets";
const LAST_SELECTED_KEY = "card_synth_last_preset_id";

export function loadUserPresets(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveUserPresets(presets: Record<string, unknown>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function saveUserPreset(id: string, data: unknown): void {
  const presets = loadUserPresets();
  presets[id] = data;
  saveUserPresets(presets);
}

export function deleteUserPreset(id: string): void {
  const presets = loadUserPresets();
  delete presets[id];
  saveUserPresets(presets);
}

export function getLastSelectedPresetId(): string | null {
  try {
    return localStorage.getItem(LAST_SELECTED_KEY) || null;
  } catch {
    return null;
  }
}

export function setLastSelectedPresetId(id: string): void {
  localStorage.setItem(LAST_SELECTED_KEY, id);
}
