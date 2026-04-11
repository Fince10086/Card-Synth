import { createSelectControl, createSliderControl, createToggleControl } from "../controls/index.js";
import { formatDb } from "../../core/formatters.js";
import { exportPresetToFile } from "../../preset/preset.js";
import { createModuleCard } from "./moduleCard.js";

export function renderMainCard({
  selectedPresetId,
  state,
  audioBooted,
  onPresetChange,
  onImportClick,
  onExportClick,
  onResetClick,
  onRandomClick,
  onMidiClick,
  onMasterVolumeChange,
  onVelocityEnabledChange,
}) {
  const card = createModuleCard({
    accent: "indigo",
    title: "Main",
    isMainCard: true,
  });

  const controls = document.createElement("div");
  controls.className = "module-grid";

  controls.append(
    createSelectControl({
      label: "Preset",
      options: [
        { value: "init", label: "Init Patch" },
        { value: "fmBell", label: "FM Bell Stack" },
        { value: "cinematicDust", label: "Cinematic Dust" },
        { value: "percussionLab", label: "Percussion Lab" },
        { value: "custom", label: "Current Patch" },
      ],
      value: selectedPresetId,
      onChange: (value) => {
        if (value !== "custom" && onPresetChange) {
          onPresetChange(value);
        }
      },
    })
  );

  const buttonRow = document.createElement("div");
  buttonRow.className = "preset-buttons";
  ["Import", "Export", "Reset", "Random", "MIDI"].forEach((label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-button";
    btn.textContent = label;

    if (label === "Import") {
      btn.addEventListener("click", () => onImportClick?.());
    } else if (label === "Export") {
      btn.addEventListener("click", () => onExportClick?.(state, audioBooted));
    } else if (label === "Reset") {
      btn.addEventListener("click", () => onResetClick?.());
    } else if (label === "Random") {
      btn.addEventListener("click", () => onRandomClick?.());
    } else if (label === "MIDI") {
      btn.addEventListener("click", () => onMidiClick?.());
    }

    buttonRow.append(btn);
  });
  controls.append(buttonRow);

  const midiContainer = document.createElement("div");
  midiContainer.id = "midiSelecter";
  midiContainer.className = "midi-selecter";
  controls.append(midiContainer);

  controls.append(
    createSliderControl({
      label: "Master",
      min: -36,
      max: 6,
      step: 0.1,
      value: state.global.volume,
      formatter: formatDb,
      onInput: (value) => {
        if (onMasterVolumeChange) {
          onMasterVolumeChange(value);
        }
      },
    })
  );

  controls.append(
    createToggleControl({
      label: "Velocity",
      value: state.global.velocityEnabled,
      accent: getComputedStyle(document.documentElement).getPropertyValue("--main").trim() || "#4b0082",
      onToggle: (value) => {
        if (onVelocityEnabledChange) {
          onVelocityEnabledChange(value);
        }
      },
    })
  );

  const scopeContainer = document.createElement("div");
  scopeContainer.className = "main-card__scope";

  const scopeLabel = document.createElement("div");
  scopeLabel.className = "control-label";
  const scopeLabelStrong = document.createElement("strong");
  scopeLabelStrong.textContent = "Visualization";
  scopeLabel.append(scopeLabelStrong);
  scopeContainer.append(scopeLabel);

  const scopeCanvas = document.createElement("canvas");
  scopeCanvas.id = "oscilloscope";
  scopeContainer.append(scopeCanvas);
  controls.append(scopeContainer);

  const keyboardHint = document.createElement("div");
  keyboardHint.className = "keyboard-hint";
  ["A-K 演奏", "Z/X 八度", "C/V 力度"].forEach((text) => {
    const span = document.createElement("span");
    span.textContent = text;
    keyboardHint.append(span);
  });
  controls.append(keyboardHint);

  const keyboard = document.createElement("div");
  keyboard.id = "virtualKeyboard";
  keyboard.className = "virtual-keyboard virtual-keyboard--compact";
  controls.append(keyboard);

  card.append(controls);
  return card;
}

export function renderMainCardContent({
  updatePresetSelect,
  updateMasterReadout,
  updateMidiStatus,
  volume,
}) {
  updatePresetSelect?.();
  updateMasterReadout?.(volume);
  updateMidiStatus?.();
}

export function cacheDynamicElements() {
  const elements = {};
  elements.keyboard = document.getElementById("virtualKeyboard");
  elements.oscilloscope = document.getElementById("oscilloscope");
  elements.scopeContext = elements.oscilloscope?.getContext("2d") || null;

  return elements;
}
