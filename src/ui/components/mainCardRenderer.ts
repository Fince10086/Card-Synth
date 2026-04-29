import { createSelectControl } from "../controls/selectControl";
import { createSliderControl } from "../controls/sliderControl";
import { createToggleControl } from "../controls/toggleControl";
import { formatDb } from "../../core/formatters";
import { createModuleCard, type ModuleCardElement } from "./moduleCard";
import type { ChainState, Preset } from "../../types";

interface MacroPoint {
  chainIndex: number;
  visible: boolean;
  selected: boolean;
  x: number;
  y: number;
  color: string;
}

interface MacroViewModel {
  selectedChainEnabled: boolean;
  points: MacroPoint[];
}

interface PresetEntry extends Preset {
  name?: string;
}

interface RenderMainCardOptions {
  selectedPresetId: string | null;
  hasUnsavedChanges: boolean;
  builtinPresets: Record<string, PresetEntry>;
  userPresets: Record<string, PresetEntry>;
  state: Preset;
  selectedChainIndex: number;
  chains: ChainState[];
  macro: MacroViewModel;
  audioBooted: boolean;
  onPresetChange?: (value: string) => void;
  onChainIndexClick?: (chainIndex: number, isSelected: boolean) => void;
  onImportClick?: () => void;
  onExportCurrentClick?: () => void;
  onExportAllClick?: () => void;
  onResetClick?: () => void;
  onRandomClick?: () => void;
  onMidiClick?: () => void;
  onMasterVolumeChange?: (value: number) => void;
  onVelocityEnabledChange?: (value: boolean) => void;
  onMacroPointPointerDown?: (event: PointerEvent, chainIndex: number, padElement: HTMLElement) => void;
  onMacroAxisPointerDown?: (event: PointerEvent, axis: string) => void;
  onGestureClick?: () => void;
  onDeleteUserPreset?: (id: string) => void;
  onPolyVoiceChange?: (value: number) => void;
}

interface UpdateMainCardOptions {
  selectedChainIndex: number;
  chains: ChainState[];
  onChainIndexClick?: (chainIndex: number, isSelected: boolean) => void;
  macro: MacroViewModel;
  onMacroPointPointerDown?: (event: PointerEvent, chainIndex: number, padElement: HTMLElement) => void;
  onMacroAxisPointerDown?: (event: PointerEvent, axis: string) => void;
}

interface RenderMainCardContentOptions {
  updatePresetSelect?: () => void;
  updateMasterReadout?: (value: number) => void;
  updateMidiStatus?: () => void;
  volume: number;
}

interface DynamicElements {
  keyboard: HTMLElement | null;
  oscilloscope: HTMLCanvasElement | null;
  scopeContext: CanvasRenderingContext2D | null;
}

export function renderMainCard({
  selectedPresetId,
  hasUnsavedChanges,
  builtinPresets,
  userPresets,
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
  onDeleteUserPreset,
  onPolyVoiceChange,
}: RenderMainCardOptions): ModuleCardElement {
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

      badge.setAttribute("tabindex", "-1");
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

  function buildPresetOptions(entries: Record<string, PresetEntry>, groupLabel: string) {
    const options: { value: string; label: string; disabled?: boolean }[] = [];
    const items = Object.entries(entries || {});
    if (items.length > 0) {
      options.push({ value: "", label: groupLabel, disabled: true });
      items.forEach(([id, preset]) => {
        const isSelected = selectedPresetId === id;
        const name = preset?.name || id;
        const label = isSelected && hasUnsavedChanges ? `${name} *` : name;
        options.push({ value: id, label });
      });
    }
    return options;
  }

  const presetOptions = [
    ...buildPresetOptions(builtinPresets, "— Built-in —"),
    ...buildPresetOptions(userPresets, "— User —"),
  ];

  const presetSelectWrapper = document.createElement("div");
  presetSelectWrapper.className = "preset-select-wrapper";

  const selectControl = createSelectControl({
    label: "Preset",
    options: presetOptions,
    value: selectedPresetId || "",
    onChange: (value) => {
      if (value && onPresetChange) {
        onPresetChange(value);
      }
    },
  });
  presetSelectWrapper.appendChild(selectControl);

  const isUserPreset = selectedPresetId && userPresets && Object.prototype.hasOwnProperty.call(userPresets, selectedPresetId);
  if (isUserPreset) {
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "user-preset-delete";
    delBtn.textContent = "×";
    delBtn.title = "Delete preset";
    delBtn.setAttribute("tabindex", "-1");

    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const presetName = userPresets[selectedPresetId]?.name || selectedPresetId;
      if (confirm(`Delete preset "${presetName}"?`)) {
        onDeleteUserPreset?.(selectedPresetId);
      }
    });
    presetSelectWrapper.appendChild(delBtn);
  }

  controls.append(presetSelectWrapper);

  const buttonRow = document.createElement("div");
  buttonRow.className = "preset-buttons";
  ["Import", "Export Current", "Export All", "Reset", "Random", "MIDI"].forEach((label) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-button";
    btn.setAttribute("tabindex", "-1");
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
    createSliderControl({
      label: "Poly Voices",
      min: 2,
      max: 8,
      step: 1,
      value: state.global.polyVoice,
      formatter: (value) => `${value} voices`,
      onInput: (value) => {
        if (onPolyVoiceChange) {
          onPolyVoiceChange(value);
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
    macroPoint.setAttribute("tabindex", "-1");
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
  const makeAxisButton = (axis: string, text: string) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "macro-axis-handle";
    button.setAttribute("tabindex", "-1");
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
  gestureBtn.setAttribute("tabindex", "-1");
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
  scopeCanvas.setAttribute("tabindex", "-1");
  scopeCanvas.setAttribute("aria-hidden", "true");
  scopeContainer.append(scopeCanvas);
  controls.append(scopeContainer);

  const keyboard = document.createElement("div");
  keyboard.id = "virtualKeyboard";
  keyboard.className = "virtual-keyboard";
  keyboard.setAttribute("aria-hidden", "true");
  keyboard.setAttribute("tabindex", "-1");
  controls.append(keyboard);

  card.append(controls);
  return card;
}

export function updateMainCard(card: ModuleCardElement | null, {
  selectedChainIndex,
  chains,
  onChainIndexClick,
  macro,
  onMacroPointPointerDown,
  onMacroAxisPointerDown,
}: UpdateMainCardOptions): void {
  if (!card) return;

  // 更新 chain badges
  const head = card.querySelector(".module-head");
  if (head) {
    const badges = head.querySelectorAll(".chain-index");
    badges.forEach((badge, index) => {
      const chain = chains?.[index] || { enabled: false };
      const isSelected = selectedChainIndex === index;

      badge.classList.toggle("is-selected", isSelected);
      badge.classList.toggle("is-disabled", !chain.enabled);

      // 替换点击事件以更新闭包
      const newBadge = badge.cloneNode(true) as HTMLElement;
      newBadge.setAttribute("tabindex", "-1");
      newBadge.addEventListener("click", () => {
        onChainIndexClick?.(index, isSelected);
      });
      badge.replaceWith(newBadge);
    });
  }

  // 更新 macro pad
  const macroPad = card.querySelector(".macro-pad");
  if (macroPad) {
    macroPad.innerHTML = "";
    const points = Array.isArray(macro?.points) ? macro.points : [];
    points.forEach((point) => {
      if (!point?.visible) return;

      const macroPoint = document.createElement("button");
      macroPoint.type = "button";
      macroPoint.className = "macro-point";
      macroPoint.setAttribute("tabindex", "-1");
      if (point.selected) {
        macroPoint.classList.add("is-selected");
      }
      macroPoint.style.left = `${Number(point.x) * 100}%`;
      macroPoint.style.top = `${(1 - Number(point.y)) * 100}%`;
      macroPoint.style.background = point.color;
      macroPoint.setAttribute("aria-label", `Macro Chain ${point.chainIndex + 1}`);

      macroPoint.addEventListener("pointerdown", (event) => {
        onMacroPointPointerDown?.(event, point.chainIndex, macroPad as HTMLElement);
      });

      macroPad.append(macroPoint);
    });
  }

  // 更新 axis buttons 禁用状态
  const selectedChainEnabled = Boolean(macro?.selectedChainEnabled);
  const axisHandles = card.querySelectorAll(".macro-axis-handle");
  axisHandles.forEach((handle) => {
    (handle as HTMLButtonElement).disabled = !selectedChainEnabled;
  });
}

export function renderMainCardContent({
  updatePresetSelect,
  updateMasterReadout,
  updateMidiStatus,
  volume,
}: RenderMainCardContentOptions): void {
  updatePresetSelect?.();
  updateMasterReadout?.(volume);
  updateMidiStatus?.();
}

export function cacheDynamicElements(): DynamicElements {
  const elements: DynamicElements = {
    keyboard: document.getElementById("virtualKeyboard"),
    oscilloscope: document.getElementById("oscilloscope") as HTMLCanvasElement | null,
    scopeContext: null,
  };
  elements.scopeContext = elements.oscilloscope?.getContext("2d") || null;

  return elements;
}
