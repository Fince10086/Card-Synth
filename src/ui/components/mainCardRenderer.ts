import { createSelectControl } from "../controls/selectControl";
import { createSliderControl } from "../controls/sliderControl";
import { createToggleControl } from "../controls/toggleControl";
import { createSwitchControl } from "../controls/switchControl";
import { formatDb } from "../../core/formatters";
import { createModuleCard, type ModuleCardElement } from "./moduleCard";
import { t, getLanguage, type Language } from "../../i18n";
import type { ChainState, Preset } from "../../types";

interface MacroPoint {
  pointIndex: number;
  visible: boolean;
  selected: boolean;
  recentRank: number;
  x: number;
  y: number;
  color: string;
}

interface MacroViewModel {
  pointCount: number;
  selectedPointIndex: number;
  recentSelection: number[];
  points: MacroPoint[];
}

interface PresetEntry extends Preset {
  name?: string;
}

interface TransportState {
  isPlaying: boolean;
  progress: number;
  duration: number;
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
  transport: TransportState;
  onPresetChange?: (value: string) => void;
  onChainIndexClick?: (chainIndex: number, isSelected: boolean) => void;
  onImportClick?: () => void;
  onExportCurrentClick?: () => void;
  onExportAllClick?: () => void;
  onResetClick?: () => void;
  onRandomClick?: () => void;
  onMasterVolumeChange?: (value: number) => void;
  onMacroPointPointerDown?: (event: PointerEvent, pointIndex: number, padElement: HTMLElement) => void;
  onMacroAxisPointerDown?: (event: PointerEvent, axis: string, pointIndex: number) => void;
  onMacroPointCountChange?: (value: number) => void;
  onGestureClick?: () => void;
  onDeleteUserPreset?: (id: string) => void;
  onLanguageChange?: (lang: Language) => void;
  onAiGenerate?: (description: string) => void;
  onPlayClick?: () => void;
  onSeek?: (percent: number) => void;
  aiPhase?: 'idle' | 'reasoning' | 'generating';
  aiReasoning?: string | null;
}

interface UpdateMainCardOptions {
  selectedChainIndex: number;
  chains: ChainState[];
  transport: TransportState;
  onChainIndexClick?: (chainIndex: number, isSelected: boolean) => void;
  onPlayClick?: () => void;
  onSeek?: (percent: number) => void;
  macro: MacroViewModel;
  onMacroPointPointerDown?: (event: PointerEvent, pointIndex: number, padElement: HTMLElement) => void;
  onMacroAxisPointerDown?: (event: PointerEvent, axis: string, pointIndex: number) => void;
  onMacroPointCountChange?: (value: number) => void;
}

interface RenderMainCardContentOptions {
  updatePresetSelect?: () => void;
  updateMasterReadout?: (value: number) => void;
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
  transport,
  onPresetChange,
  onChainIndexClick,
  onImportClick,
  onExportCurrentClick,
  onExportAllClick,
  onResetClick,
  onRandomClick,
  onMasterVolumeChange,
  onMacroPointPointerDown,
  onMacroAxisPointerDown,
  onMacroPointCountChange,
  onGestureClick,
  onDeleteUserPreset,
  onLanguageChange,
  onAiGenerate,
  onPlayClick,
  onSeek,
  aiPhase,
  aiReasoning,
}: RenderMainCardOptions): ModuleCardElement {
  const card = createModuleCard({
    accent: "indigo",
    title: t("Main"),
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
    ...buildPresetOptions(builtinPresets, t("— Built-in —")),
    ...buildPresetOptions(userPresets, t("— User —")),
  ];

  const presetSelectWrapper = document.createElement("div");
  presetSelectWrapper.className = "preset-select-wrapper";

  const selectControl = createSelectControl({
    label: t("Preset"),
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
    delBtn.title = t("Delete preset");
    delBtn.setAttribute("tabindex", "-1");

    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const presetName = userPresets[selectedPresetId]?.name || selectedPresetId;
      if (confirm(t('Delete preset "{{name}}"?', { name: presetName }))) {
        onDeleteUserPreset?.(selectedPresetId);
      }
    });
    presetSelectWrapper.appendChild(delBtn);
  }

  controls.append(presetSelectWrapper);

  // AI 音色生成区域
  const aiWrapper = document.createElement("div");
  aiWrapper.className = "control";

  const aiLabel = document.createElement("div");
  aiLabel.className = "control-label";
  const aiLabelStrong = document.createElement("strong");
  aiLabelStrong.textContent = t("AI Timbre");
  aiLabel.append(aiLabelStrong);
  aiWrapper.append(aiLabel);

  const aiInputRow = document.createElement("div");
  aiInputRow.className = "file-control-row";

  const aiInput = document.createElement("input");
  aiInput.type = "text";
  aiInput.className = "file-chip";
  aiInput.placeholder = t("Describe the timbre you want...");
  const isGenerating = aiPhase !== 'idle' && aiPhase !== undefined;
  aiInput.disabled = isGenerating;
  aiInput.style.flex = "1";
  aiInput.style.minWidth = "0";
  aiInputRow.append(aiInput);

  const aiGenerateBtn = document.createElement("button");
  aiGenerateBtn.type = "button";
  aiGenerateBtn.className = "pill-button file-action";
  aiGenerateBtn.style.setProperty("--accent", "var(--main)");

  if (aiPhase === 'reasoning') {
    aiGenerateBtn.textContent = t("Thinking...");
  } else if (aiPhase === 'generating') {
    aiGenerateBtn.textContent = t("Generating...");
  } else {
    aiGenerateBtn.textContent = t("Generate");
  }

  aiGenerateBtn.disabled = isGenerating;
  aiGenerateBtn.addEventListener("click", () => {
    const desc = aiInput.value.trim();
    if (desc && onAiGenerate) {
      onAiGenerate(desc);
    }
  });
  aiInputRow.append(aiGenerateBtn);
  aiWrapper.append(aiInputRow);

  const reasoningBox = document.createElement("div");
  reasoningBox.className = "ai-reasoning-box";

  const reasoningLines = document.createElement("div");
  reasoningLines.className = "ai-reasoning-lines";

  if (aiReasoning) {
    const lines = aiReasoning
      .split("\n")
      .filter((line) => line.trim())
      .slice(-3);

    lines.forEach((line) => {
      const lineEl = document.createElement("div");
      lineEl.className = "ai-reasoning-line";
      lineEl.textContent = line;
      reasoningLines.append(lineEl);
    });
  }

  reasoningBox.append(reasoningLines);
  aiWrapper.append(reasoningBox);

  if (aiPhase === "reasoning") {
    if (!aiReasoning) {
      requestAnimationFrame(() => {
        reasoningBox.classList.add("is-visible");
      });
    } else {
      reasoningBox.classList.add("is-visible");
    }
  } else {
    reasoningBox.classList.remove("is-visible");
  }

  controls.append(aiWrapper);

  const buttonGroups = document.createElement("div");
  buttonGroups.className = "preset-buttons";

  const rows = [
    [{ key: "Import Timbre", handler: () => onImportClick?.() }],
    [
      { key: "Export Current", handler: () => onExportCurrentClick?.() },
      { key: "Export All", handler: () => onExportAllClick?.() },
    ],
    [
      { key: "Reset Preset", handler: () => onResetClick?.() },
      { key: "Random Params", handler: () => onRandomClick?.() },
    ],
  ];

  rows.forEach((rowButtons) => {
    const row = document.createElement("div");
    row.className = "preset-button-row";
    rowButtons.forEach(({ key, handler }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-button";
      btn.setAttribute("tabindex", "-1");
      btn.textContent = t(key);
      btn.addEventListener("click", handler);
      row.append(btn);
    });
    buttonGroups.append(row);
  });

  controls.append(buttonGroups);

  // Transport controls
  const transportWrapper = document.createElement("div");
  transportWrapper.className = "transport-container";

  const transportLabel = document.createElement("div");
  transportLabel.className = "control-label";
  const transportLabelStrong = document.createElement("strong");
  transportLabelStrong.textContent = t("Playback");
  transportLabel.append(transportLabelStrong);
  transportWrapper.append(transportLabel);

  const transportRow = document.createElement("div");
  transportRow.className = "transport-row";

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "transport-play-btn";
  if (transport.isPlaying) {
    playBtn.classList.add("is-playing");
  }
  playBtn.setAttribute("tabindex", "-1");
  playBtn.textContent = transport.isPlaying ? t("Pause") : t("Play");
  playBtn.addEventListener("click", () => {
    onPlayClick?.();
  });
  transportRow.append(playBtn);

  const progressBar = document.createElement("div");
  progressBar.className = "transport-progress";
  progressBar.setAttribute("data-transport-progress", "true");

  const progressInner = document.createElement("div");
  progressInner.className = "transport-progress-inner";
  const pct = transport.duration > 0 ? (transport.progress / transport.duration) * 100 : 0;
  progressInner.style.setProperty("--progress-pct", `${Math.min(100, Math.max(0, pct))}%`);
  progressBar.append(progressInner);

  const formatTime = (s: number): string => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const timeReadout = document.createElement("span");
  timeReadout.className = "transport-time";
  timeReadout.textContent = `${formatTime(transport.progress)} / ${formatTime(transport.duration)}`;
  progressBar.append(timeReadout);

  progressBar.addEventListener("click", (e) => {
    const rect = progressBar.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onSeek?.(Math.max(0, Math.min(1, pct)));
  });

  transportRow.append(progressBar);
  transportWrapper.append(transportRow);
  controls.append(transportWrapper);

  const langControl = createSwitchControl({
    label: t("Language"),
    options: [
      { label: "English", value: "en" },
      { label: "中文", value: "zh" },
    ],
    value: getLanguage(),
    onChange: (value) => {
      onLanguageChange?.(value as Language);
    },
    accent: "main",
  });
  controls.append(langControl);

  controls.append(
    createSliderControl({
      label: t("Master"),
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

  const macroContainer = document.createElement("div");
  macroContainer.className = "main-card__macro";

  const macroHeader = document.createElement("div");
  macroHeader.className = "control-label";
  const macroHeaderStrong = document.createElement("strong");
  macroHeaderStrong.textContent = t("Macro");
  macroHeader.append(macroHeaderStrong);
  macroContainer.append(macroHeader);

  const pointCountRow = document.createElement("label");
  pointCountRow.className = "control control-slider macro-point-count-row";

  const pointCountLabel = document.createElement("div");
  pointCountLabel.className = "control-label";
  const pointCountStrong = document.createElement("strong");
  pointCountStrong.textContent = t("Points");
  const pointCountReadout = document.createElement("span");
  pointCountReadout.className = "control-readout";
  pointCountReadout.textContent = String(macro.pointCount);
  const pointCountValueGroup = document.createElement("span");
  pointCountValueGroup.className = "value-group";
  pointCountValueGroup.append(pointCountReadout);
  pointCountLabel.append(pointCountStrong, pointCountValueGroup);

  const pointCountShell = document.createElement("div");
  pointCountShell.className = "slider-shell";
  pointCountShell.style.setProperty("--percent", String((macro.pointCount - 1) / 8));

  const pointCountSlider = document.createElement("input");
  pointCountSlider.type = "range";
  pointCountSlider.className = "slider-input";
  pointCountSlider.min = "1";
  pointCountSlider.max = "9";
  pointCountSlider.step = "1";
  pointCountSlider.value = String(macro.pointCount);
  pointCountSlider.setAttribute("tabindex", "-1");
  pointCountSlider.addEventListener("input", (e) => {
    const value = Number((e.target as HTMLInputElement).value);
    pointCountReadout.textContent = String(value);
    pointCountShell.style.setProperty("--percent", String((value - 1) / 8));
    onMacroPointCountChange?.(value);
  });

  pointCountShell.append(pointCountSlider);
  pointCountRow.append(pointCountLabel, pointCountShell);
  macroContainer.append(pointCountRow);

  const macroPad = document.createElement("div");
  macroPad.className = "macro-pad";

  const visiblePoints = (macro?.points || []).filter((point) => point?.visible);
  visiblePoints.forEach((point) => {
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
    const opacityScale = point.recentRank === 0 ? 1 : point.recentRank === 1 ? 0.6 : 0.3;
    macroPoint.style.opacity = String(opacityScale);
    macroPoint.style.transform = `scale(${point.recentRank === 0 ? 1.2 : point.recentRank === 1 ? 0.95 : 0.75})`;
    macroPoint.setAttribute("aria-label", t("Macro Point {{n}}", { n: point.pointIndex + 1 }));
    macroPoint.textContent = String(point.pointIndex + 1);

    macroPoint.addEventListener("pointerdown", (event) => {
      onMacroPointPointerDown?.(event, point.pointIndex, macroPad);
    });

    macroPad.append(macroPoint);
  });

  macroContainer.append(macroPad);

  const axisRow = document.createElement("div");
  axisRow.className = "macro-axis-row";

  const selectedPointIndex = macro.selectedPointIndex;
  const makeAxisButton = (axis: string, text: string) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "macro-axis-handle";
    button.setAttribute("tabindex", "-1");
    button.textContent = text;
    button.setAttribute("aria-label", axis === "x" ? t("Bind Macro X Axis") : t("Bind Macro Y Axis"));
    button.addEventListener("pointerdown", (event) => {
      onMacroAxisPointerDown?.(event, axis, selectedPointIndex);
    });
    return button;
  };

  axisRow.append(makeAxisButton("x", "←→"), makeAxisButton("y", "↑↓"));
  macroContainer.append(axisRow);

  const gestureBtn = document.createElement("button");
  gestureBtn.type = "button";
  gestureBtn.className = "macro-gesture-btn";
  gestureBtn.setAttribute("tabindex", "-1");
  gestureBtn.textContent = t("Gesture");
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
  scopeLabelStrong.textContent = t("Visualization");
  scopeLabel.append(scopeLabelStrong);
  scopeContainer.append(scopeLabel);

  const scopeCanvas = document.createElement("canvas");
  scopeCanvas.id = "oscilloscope";
  scopeCanvas.setAttribute("tabindex", "-1");
  scopeCanvas.setAttribute("aria-hidden", "true");
  scopeContainer.append(scopeCanvas);
  controls.append(scopeContainer);

  card.append(controls);
  return card;
}

export function updateMainCard(card: ModuleCardElement | null, {
  selectedChainIndex,
  chains,
  transport,
  onChainIndexClick,
  onPlayClick,
  onSeek,
  macro,
  onMacroPointPointerDown,
  onMacroAxisPointerDown,
  onMacroPointCountChange,
}: UpdateMainCardOptions): void {
  if (!card) return;

  // Update chain badges
  const head = card.querySelector(".module-head");
  if (head) {
    const badges = head.querySelectorAll(".chain-index");
    badges.forEach((badge, index) => {
      const chain = chains?.[index] || { enabled: false };
      const isSelected = selectedChainIndex === index;

      badge.classList.toggle("is-selected", isSelected);
      badge.classList.toggle("is-disabled", !chain.enabled);

      const newBadge = badge.cloneNode(true) as HTMLElement;
      newBadge.setAttribute("tabindex", "-1");
      newBadge.addEventListener("click", () => {
        onChainIndexClick?.(index, isSelected);
      });
      badge.replaceWith(newBadge);
    });
  }

  // Update transport controls
  const playBtn = card.querySelector(".transport-play-btn") as HTMLButtonElement | null;
  if (playBtn) {
    playBtn.textContent = transport.isPlaying ? t("Pause") : t("Play");
    playBtn.classList.toggle("is-playing", transport.isPlaying);
  }

  const progressInner = card.querySelector(".transport-progress-inner") as HTMLElement | null;
  if (progressInner) {
    const pct = transport.duration > 0 ? (transport.progress / transport.duration) * 100 : 0;
    progressInner.style.setProperty("--progress-pct", `${Math.min(100, Math.max(0, pct))}%`);
  }

  const formatTime = (s: number): string => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const timeReadout = card.querySelector(".transport-time") as HTMLElement | null;
  if (timeReadout) {
    timeReadout.textContent = `${formatTime(transport.progress)} / ${formatTime(transport.duration)}`;
  }

  // Re-bind progress bar click
  const progressBar = card.querySelector(".transport-progress") as HTMLElement | null;
  if (progressBar && onSeek) {
    const newBar = progressBar.cloneNode(true) as HTMLElement;
    newBar.addEventListener("click", (e) => {
      const rect = newBar.getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      onSeek(Math.max(0, Math.min(1, pct)));
    });
    progressBar.replaceWith(newBar);
  }

  // Update macro pad
  const macroPad = card.querySelector(".macro-pad");
  if (macroPad) {
    macroPad.innerHTML = "";
    const visiblePoints = (macro?.points || []).filter((point) => point?.visible);
    visiblePoints.forEach((point) => {
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
      const opacityScale = point.recentRank === 0 ? 1 : point.recentRank === 1 ? 0.6 : 0.3;
      macroPoint.style.opacity = String(opacityScale);
      macroPoint.style.transform = `scale(${point.recentRank === 0 ? 1.2 : point.recentRank === 1 ? 0.95 : 0.75})`;
      macroPoint.setAttribute("aria-label", t("Macro Point {{n}}", { n: point.pointIndex + 1 }));
      macroPoint.textContent = String(point.pointIndex + 1);

      macroPoint.addEventListener("pointerdown", (event) => {
        onMacroPointPointerDown?.(event, point.pointIndex, macroPad as HTMLElement);
      });

      macroPad.append(macroPoint);
    });
  }

  // Update axis buttons
  const selectedPointIndex = macro?.selectedPointIndex ?? 0;
  const axisHandles = card.querySelectorAll(".macro-axis-handle");
  axisHandles.forEach((handle) => {
    const old = handle as HTMLElement;
    const button = old.cloneNode(true) as HTMLButtonElement;
    button.disabled = false;
    const axis = button.getAttribute("aria-label")?.includes("X") ? "x" : "y";
    button.addEventListener("pointerdown", (event) => {
      onMacroAxisPointerDown?.(event, axis, selectedPointIndex);
    });
    old.replaceWith(button);
  });

  // Update point count slider
  const pointCountRow = card.querySelector(".macro-point-count-row");
  if (pointCountRow) {
    const pointCountSlider = pointCountRow.querySelector(".slider-input") as HTMLInputElement | null;
    const pointCountReadout = pointCountRow.querySelector(".control-readout");
    const pointCountShell = pointCountRow.querySelector(".slider-shell");
    if (pointCountSlider) {
      pointCountSlider.value = String(macro?.pointCount ?? 3);
    }
    if (pointCountReadout) {
      pointCountReadout.textContent = String(macro?.pointCount ?? 3);
    }
    if (pointCountShell) {
      (pointCountShell as HTMLElement).style.setProperty("--percent", String(((macro?.pointCount ?? 3) - 1) / 8));
    }
  }
}

export function renderMainCardContent({
  updatePresetSelect,
  updateMasterReadout,
  volume,
}: RenderMainCardContentOptions): void {
  updatePresetSelect?.();
  updateMasterReadout?.(volume);
}

export function cacheDynamicElements(): DynamicElements {
  const elements: DynamicElements = {
    keyboard: document.getElementById("keyboardContent"),
    oscilloscope: document.getElementById("oscilloscope") as HTMLCanvasElement | null,
    scopeContext: null,
  };
  elements.scopeContext = elements.oscilloscope?.getContext("2d") || null;

  return elements;
}
