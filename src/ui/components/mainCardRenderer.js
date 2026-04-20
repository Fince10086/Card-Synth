import { createSelectControl, createSliderControl, createToggleControl } from "../controls/index.js";
import { formatDb } from "../../core/formatters.js";
import { createModuleCard } from "./moduleCard.js";

export function renderMainCard({
  selectedPresetId,
  state,
  selectedChainIndex,
  chains,
  macro,
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
  onMacroPointPointerDown,
  onMacroAxisPointerDown,
  onGestureClick,
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

  const macroContainer = document.createElement("div");
  macroContainer.className = "main-card__macro";

  const macroLabel = document.createElement("div");
  macroLabel.className = "control-label";
  const macroLabelStrong = document.createElement("strong");
  macroLabelStrong.textContent = "Macro";
  macroLabel.append(macroLabelStrong);
  macroContainer.append(macroLabel);

  const macroPad = document.createElement("div");
  macroPad.className = "macro-pad";

  const points = Array.isArray(macro?.points) ? macro.points : [];
  points.forEach((point) => {
    if (!point?.visible) {
      return;
    }

    const macroPoint = document.createElement("button");
    macroPoint.type = "button";
    macroPoint.className = "macro-point";
    if (point.selected) {
      macroPoint.classList.add("is-selected");
    }
    macroPoint.style.left = `${Number(point.x) * 100}%`;
    macroPoint.style.top = `${(1 - Number(point.y)) * 100}%`;
    macroPoint.style.background = point.color;
    macroPoint.setAttribute("aria-label", `Macro Chain ${point.chainIndex + 1}`);

    macroPoint.addEventListener("pointerdown", (event) => {
      onMacroPointPointerDown?.(event, point.chainIndex, macroPad);
    });

    macroPad.append(macroPoint);
  });

  macroContainer.append(macroPad);

  const axisRow = document.createElement("div");
  axisRow.className = "macro-axis-row";

  const selectedChainEnabled = Boolean(macro?.selectedChainEnabled);
  const makeAxisButton = (axis, text) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "macro-axis-handle";
    button.textContent = text;
    button.disabled = !selectedChainEnabled;
    button.setAttribute("aria-label", axis === "x" ? "Bind Macro X Axis" : "Bind Macro Y Axis");
    button.addEventListener("pointerdown", (event) => {
      onMacroAxisPointerDown?.(event, axis);
    });
    return button;
  };

  axisRow.append(makeAxisButton("x", "←→"), makeAxisButton("y", "↑↓"));
  macroContainer.append(axisRow);

  const gestureBtn = document.createElement("button");
  gestureBtn.type = "button";
  gestureBtn.className = "macro-gesture-btn";
  gestureBtn.textContent = "Gesture";
  gestureBtn.addEventListener("click", () => {
    onGestureClick?.();
  });
  macroContainer.append(gestureBtn);

  controls.append(macroContainer);

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
