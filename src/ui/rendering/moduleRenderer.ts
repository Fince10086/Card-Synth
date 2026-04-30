import {
  SOURCE_LIBRARY,
  EFFECT_LIBRARY,
  COMPONENT_LIBRARY,
  INPUT_LIBRARY,
} from "../../core/libraries";
import {
  getModuleDefinition,
  getModuleAccent,
  getModuleTag,
  getByPath,
  setByPath,
  normalizeSourceModule,
  createModule,
} from "../../utils/helpers";
import { formatMultiplier, formatPlain } from "../../core/formatters";
import { ENABLED as SOURCE_MONITOR_ENABLED } from "../../debug/sourceOutputMonitor";
import { t } from "../../i18n";
import {
  createSelectControl,
  createToggleControl,
  createSwitchControl,
  createSliderControl,
  createAudioImportControl,
} from "../controls/index";
import { createModuleCard } from "../components/moduleCard";
import type {
  ModuleConfig,
  ModuleType,
  ControlDefinition,
  ModulationConnection,
  Preset,
  ControlBinding,
  AudioEngine,
} from "../../types";

interface MacroBinding {
  axis: string;
}

interface MacroManagerLike {
  getBindingForTarget(
    moduleId: string,
    paramPath: string,
    chainIndex: number
  ): MacroBinding | undefined;
  removeBindingsForTarget(
    moduleId: string,
    paramPath: string,
    chainIndex: number
  ): boolean;
  updateBindingRange(options: {
    chainIndex: number;
    axis: string;
    moduleId: string;
    paramPath: string;
    rangeStart: number;
    rangeEnd: number;
  }): void;
  removeBindingsForModule(moduleId: string): void;
}

interface KeyboardNavigationLike {
  setNextFocusTarget(ref: string): void;
}

interface ModuleRendererApp {
  getSelectedChainIndex(): number;
  isModulationSource(module: ModuleConfig): boolean;
  macroManager: MacroManagerLike;
  getCurrentModules(): ModuleConfig[];
  removeOutgoingModulations(sourceModuleId: string): void;
  markUnsaved(): void;
  renderAll(): void;
  engine: AudioEngine;
  state: Preset;
  removeModuleModulations(moduleId: string): void;
  getOutgoingModulations(sourceModuleId: string): ModulationConnection[];
  startModulationDrag(options: unknown): void;
  initModuleDrag(
    event: PointerEvent,
    card: HTMLElement,
    moduleIndex: number
  ): void;
  getModulationByTarget(
    targetModuleId: string,
    targetParamPath: string
  ): ModulationConnection | undefined;
  controlBindings: Map<string, ControlBinding>;
  modulationManager: Record<string, unknown>;
  keyboardNavigation: KeyboardNavigationLike;
  elements: {
    signalFlow: HTMLElement | null;
  };
  audioBooted: boolean;
  setStatus(message: string, status: string): void;
  selectedPresetId: string | null;
}

const MODULATION_DEPTH_CONTROL: ControlDefinition = {
  path: "options.gain",
  kind: "range",
  label: "Depth",
  min: 0,
  max: 100,
  step: 0.01,
  formatter: formatMultiplier,
};

interface SourceSampleSlot {
  label: string;
  path: string;
  namePath: string;
  fallbackName: string;
}

function getRenderableControls(
  module: ModuleConfig,
  controls: ControlDefinition[]
): ControlDefinition[] {
  if (module.category === "input") {
    return controls.filter(
      (control) => !control.conditional || control.conditional(module)
    );
  }
  if (module.category !== "source") {
    return controls.filter(
      (control) => !control.conditional || control.conditional(module)
    );
  }

  return controls
    .map((control) =>
      module.modulationMode && control.path === "volume"
        ? MODULATION_DEPTH_CONTROL
        : control
    )
    .filter((control) => {
      if (module.modulationMode && control.path === "pan") return false;
      if (control.conditional && !control.conditional(module)) return false;
      return true;
    });
}

function getMacroSliderProps(
  app: ModuleRendererApp,
  moduleId: string,
  paramPath: string
): {
  macroBinding: Record<string, unknown> | null;
  onManualMacroInput: (() => boolean) | null;
  onMacroRangeChange: ((rangeStart: number, rangeEnd: number) => void) | null;
} {
  const chainIndex = app.getSelectedChainIndex();
  const binding = app.macroManager.getBindingForTarget(moduleId, paramPath, chainIndex);
  return {
    macroBinding: (binding as unknown as unknown as Record<string, unknown> | null) ?? null,
    onManualMacroInput: () => {
      return app.macroManager.removeBindingsForTarget(moduleId, paramPath, chainIndex);
    },
    onMacroRangeChange: (rangeStart: number, rangeEnd: number) => {
      if (!binding) {
        return;
      }
      app.macroManager.updateBindingRange({
        chainIndex,
        axis: binding.axis,
        moduleId,
        paramPath,
        rangeStart,
        rangeEnd,
      });
    },
  };
}

export function renderModuleCard(
  module: ModuleConfig,
  index: number,
  app: ModuleRendererApp
): HTMLElement {
  const chainIndex = app.getSelectedChainIndex();
  const definition = getModuleDefinition(module);
  const modulationSource = app.isModulationSource(module);
  const accent = modulationSource ? "modulation" : getModuleAccent(module);
  const kicker = getModuleTag(module);
  const canToggleModulation =
    module.category === "source" || module.type === "Envelope";
  const canCreateCable = modulationSource;

  const card = createModuleCard({
    accent,
    kicker,
    title: module.type,
    titleOptions: getTitleOptions(module.category),
    showOutputLevel: module.category === "source" && SOURCE_MONITOR_ENABLED,
    onTitleChange: (value: string) => {
      const replacement = createModule(module.category, value as ModuleType);
      replacement.id = module.id;
      replacement.enabled = module.enabled;
      if (module.category === "source" || module.type === "Envelope") {
        replacement.modulationMode = module.modulationMode;
      }
      if (module.category === "source") {
        replacement.volume = module.volume;
        replacement.pan = module.pan;
        const sourceFrequencyOffset = Number(
          (module.options as unknown as Record<string, unknown> | undefined)?.frequencyOffset
        );
        if (Number.isFinite(sourceFrequencyOffset)) {
          (replacement.options as unknown as Record<string, unknown>).frequencyOffset =
            sourceFrequencyOffset;
        }
      }
      if (!app.isModulationSource(replacement)) {
        app.removeOutgoingModulations(module.id);
      }
      app.macroManager.removeBindingsForModule(module.id);
      app.getCurrentModules()[index] = replacement;
      app.markUnsaved();
      app.renderAll();
      app.engine.fullSync(app.state);
    },
    moduleRef: module.id,
    enabled: module.enabled,
    onToggleEnabled: () => {
      module.enabled = !module.enabled;
      app.markUnsaved();
      app.engine.fullSync(app.state);
      app.renderAll();
    },
    onRemove: () => {
      const container = app.elements.signalFlow;
      const currentCard = container?.querySelector(
        `.module-card[data-module-ref="${module.id}"]`
      );
      if (currentCard) {
        const prevCard = currentCard.previousElementSibling;
        if (
          prevCard &&
          (prevCard.classList.contains("module-card") ||
            prevCard.classList.contains("add-module-card"))
        ) {
          const ref =
            (prevCard as HTMLElement).dataset.moduleRef ||
            (prevCard as HTMLElement).dataset.mainCard ||
            (prevCard as HTMLElement).id ||
            "";
          app.keyboardNavigation.setNextFocusTarget(ref);
        }
      }

      app.removeModuleModulations(module.id);
      app.macroManager.removeBindingsForModule(module.id);
      app.getCurrentModules().splice(index, 1);
      app.markUnsaved();
      app.renderAll();
      app.engine.fullSync(app.state);
    },
    modulationEnabled: modulationSource,
    showModulationToggle: canToggleModulation,
    onToggleModulation: () => {
      module.modulationMode = !module.modulationMode;
      if (!module.modulationMode) {
        app.removeOutgoingModulations(module.id);
      }
      app.markUnsaved();
      app.renderAll();
      app.engine.fullSync(app.state);
    },
    showModulationAnchor: canCreateCable,
    onModulationAnchorPointerDown: (event: PointerEvent) => {
      if (app.getOutgoingModulations(module.id).length >= 8) {
        return;
      }
      app.startModulationDrag({ event, sourceModuleId: module.id });
    },
    removable: true,
    index: index + 1,
    initModuleDrag: (event: PointerEvent, card: HTMLElement, moduleIndex: number) =>
      app.initModuleDrag(event, card, moduleIndex),
  });

  const controls = document.createElement("div");
  controls.className = "module-grid";

  if (
    ((module.category === "source" && module.modulationMode) ||
      (module.type === "Envelope" && module.modulationMode)) &&
    !Number.isFinite(
      Number((module.options as unknown as Record<string, unknown> | undefined)?.gain)
    )
  ) {
    setByPath(module as unknown as Record<string, unknown>, "options.gain", 1);
  }

  if (module.category === "source") {
    getSourceSampleSlots(module).forEach((slot) => {
      controls.append(
        createAudioImportControl({
          label: slot.label,
          value:
            getByPath(module as unknown as Record<string, unknown>, slot.namePath) ||
            slot.fallbackName,
          onSelect: async (file: File) => {
            await importSourceSample(module, index, slot, file, app);
          },
        })
      );
    });
  }

  getRenderableControls(module, definition.controls).forEach((control) => {
    controls.append(
      renderModuleControl(
        module,
        control,
        () => app.engine.updateModule(module.id, module),
        accent,
        `chains.${chainIndex}.modules.${index}.${control.path}`,
        app
      )
    );
  });

  card.append(controls);
  return card;
}

export function renderModuleControl(
  module: ModuleConfig,
  control: ControlDefinition,
  onCommit: () => void,
  accent: string,
  bindingPath: string | null = null,
  app: ModuleRendererApp
): HTMLElement {
  const path = control.path;
  const value = getByPath(module as unknown as Record<string, unknown>, path);
  const macroSliderProps = getMacroSliderProps(app, module.id, path);

  if (control.kind === "select") {
    return createSelectControl({
      label: t(control.label),
      options:
        control.options?.map((opt) => ({
          value: String(opt.value),
          label: t(opt.label),
        })) ?? [],
      value: String(value ?? ""),
      onChange: (nextValue: string) => {
        setByPath(module as unknown as Record<string, unknown>, path, nextValue);
        app.markUnsaved();
        onCommit();
      },
    });
  }

  if (control.kind === "toggle") {
    const controlExt = control as ControlDefinition & {
      inverted?: boolean;
      onLabel?: string;
      offLabel?: string;
    };
    const isInverted = controlExt.inverted === true;
    const displayValue = isInverted ? !Boolean(value) : Boolean(value);
    return createToggleControl({
      label: t(control.label),
      accent,
      value: displayValue,
      onLabel: controlExt.onLabel,
      offLabel: controlExt.offLabel,
      onToggle: (nextValue: boolean) => {
        const actualValue = isInverted ? !nextValue : nextValue;
        setByPath(module as unknown as Record<string, unknown>, path, actualValue);
        app.markUnsaved();
        onCommit();
      },
    });
  }

  if (control.kind === "switch") {
    return createSwitchControl({
      label: t(control.label),
      accent,
      options:
        control.options?.map((opt) => ({
          value: opt.value,
          label: t(opt.label),
        })) ?? [],
      value: value as string | number | boolean,
      onChange: (nextValue: string | number | boolean) => {
        setByPath(module as unknown as Record<string, unknown>, path, nextValue);
        app.markUnsaved();
        onCommit();
        app.renderAll();
      },
    });
  }

  return createSliderControl({
    label: t(control.label),
    accent,
    min: control.min ?? 0,
    max: control.max ?? 1,
    step: control.step ?? 0.01,
    value: Number(value ?? 0),
    path: bindingPath,
    controlBindings: app.controlBindings,
    moduleId: module.id,
    paramPath: control.path,
    ...macroSliderProps,
    modulation: app.getModulationByTarget(module.id, control.path) as unknown as unknown as Record<string, unknown> | null,
    formatter: control.formatter || formatPlain,
    onInput: (nextValue: number) => {
      setByPath(module as unknown as Record<string, unknown>, path, nextValue);
      app.markUnsaved();
      onCommit();
    },
    engine: app.engine,
    modulationManager: app.modulationManager,
    onPresetChange: ((presetId: string) => {
      app.selectedPresetId = presetId;
    }) as () => void,
  });
}

export function getSourceSampleSlots(module: ModuleConfig): SourceSampleSlot[] {
  const moduleType = module.type as string;

  if (moduleType === "Player") {
    return [
      {
        label: t("Sample"),
        path: "options.url",
        namePath: "assetName",
        fallbackName: "Factory Pluck",
      },
    ];
  }

  if (moduleType === "GrainPlayer") {
    return [
      {
        label: t("Sample"),
        path: "options.url",
        namePath: "assetName",
        fallbackName: "Factory Texture",
      },
    ];
  }

  if (moduleType === "Players") {
    return [
      {
        label: t("Low Sample"),
        path: "options.urls.low",
        namePath: "sampleNames.low",
        fallbackName: "Factory Pluck",
      },
      {
        label: t("Mid Sample"),
        path: "options.urls.mid",
        namePath: "sampleNames.mid",
        fallbackName: "Factory Bell",
      },
      {
        label: t("High Sample"),
        path: "options.urls.high",
        namePath: "sampleNames.high",
        fallbackName: "Factory Texture",
      },
    ];
  }

  return [];
}

export async function importSourceSample(
  module: ModuleConfig,
  index: number,
  slot: SourceSampleSlot,
  file: File,
  app: ModuleRendererApp
): Promise<void> {
  const dataUrl = await readFileAsDataUrl(file);
  setByPath(module as unknown as Record<string, unknown>, slot.path, dataUrl);
  setByPath(module as unknown as Record<string, unknown>, slot.namePath, file.name);
  app.getCurrentModules()[index] = normalizeSourceModule(module);
  app.markUnsaved();
  app.renderAll();
  app.engine.fullSync(app.state);
  app.setStatus(
    t("Loaded {{file}} into {{module}}.", { file: file.name, module: t(module.type) }),
    app.audioBooted ? "live" : "neutral"
  );
}

export function getTitleOptions(
  category: string
): Array<{ label: string; value: string }> {
  if (category === "source") {
    return Object.keys(SOURCE_LIBRARY).map((type) => ({
      label: t(type),
      value: type,
    }));
  }
  if (category === "effect") {
    return Object.keys(EFFECT_LIBRARY).map((type) => ({
      label: t(type),
      value: type,
    }));
  }
  if (category === "input") {
    return Object.keys(INPUT_LIBRARY).map((type) => ({
      label: t(type),
      value: type,
    }));
  }
  return Object.keys(COMPONENT_LIBRARY).map((type) => ({
    label: t(type),
    value: type,
  }));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
