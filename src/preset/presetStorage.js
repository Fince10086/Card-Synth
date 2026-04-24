const STORAGE_KEY = "card_synth_user_presets";
const LAST_SELECTED_KEY = "card_synth_last_preset_id";

export function loadUserPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveUserPresets(presets) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function saveUserPreset(id, data) {
  const presets = loadUserPresets();
  presets[id] = data;
  saveUserPresets(presets);
}

export function deleteUserPreset(id) {
  const presets = loadUserPresets();
  delete presets[id];
  saveUserPresets(presets);
}

export function getLastSelectedPresetId() {
  try {
    return localStorage.getItem(LAST_SELECTED_KEY) || null;
  } catch {
    return null;
  }
}

export function setLastSelectedPresetId(id) {
  localStorage.setItem(LAST_SELECTED_KEY, id);
}
