import { createSelectControl, createSliderControl, createToggleControl } from "../controls/index.js";
import { formatDb } from "../../core/formatters.js";
import { createModuleCard } from "./moduleCard.js";

export function renderMainCard({
  selectedPresetId,
  state,
  selectedChainIndex,
  chains,
  audioBooted,
  onPresetChange,
  onChainIndexClick,
  onImportClick,
  onExportCurrentClick,
  onExportAllClick,
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

  const head = card.querySelector(".module-head");
  const titleWrap = card.querySelector(".module-title");
  if (head && titleWrap) {
    head.classList.add("module-head--main");
    head.innerHTML = "";

    const leftGroup = document.createElement("div");
    leftGroup.className = "chain-index-group chain-index-group--left";

    const rightGroup = document.createElement("div");
    rightGroup.className = "chain-index-group chain-index-group--right";

    [0, 1, 2, 3].forEach((chainIndex) => {
      const chain = chains?.[chainIndex] || { enabled: false };
      const badge = document.createElement("span");
      badge.className = "chain-index";
      badge.textContent = `${["I", "II", "III", "IV"][chainIndex]}`;

      const isSelected = selectedChainIndex === chainIndex;
      if (isSelected) {
        badge.classList.add("is-selected");
      }
      if (!chain.enabled) {
        badge.classList.add("is-disabled");
      }

      badge.addEventListener("click", () => {
        onChainIndexClick?.(chainIndex, isSelected);
      });

      if (chainIndex < 2) {
        leftGroup.append(badge);
      } else {
        rightGroup.append(badge);
      }
    });

    head.append(leftGroup, titleWrap, rightGroup);
  }

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
  ["Import", "Export Current", "Export All", "Reset", "Random", "MIDI"].forEach((label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-button";
    btn.textContent = label;

    if (label === "Import") {
      btn.addEventListener("click", () => onImportClick?.());
    } else if (label === "Export Current") {
      btn.addEventListener("click", () => onExportCurrentClick?.());
    } else if (label === "Export All") {
      btn.addEventListener("click", () => onExportAllClick?.());
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
