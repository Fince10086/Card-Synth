import { SOURCE_LIBRARY, EFFECT_LIBRARY, COMPONENT_LIBRARY } from "../../core/libraries.js";
import {
  getModuleDefinition,
  getModuleAccent,
  getModuleTag,
  getByPath,
  setByPath,
  normalizeSourceModule,
  createModule,
} from "../../utils/helpers.js";
import { formatMultiplier } from "../../core/formatters.js";
import { ENABLED as SOURCE_MONITOR_ENABLED } from "../../debug/sourceOutputMonitor.js";
import {
  createSelectControl,
  createToggleControl,
  createSliderControl,
  createAudioImportControl,
} from "../controls/index.js";
import { createModuleCard } from "../components/moduleCard.js";
import { isBuiltinPreset } from "../../preset/presetLoader.js";

const MODULATION_DEPTH_CONTROL = {
  path: "options.gain",
  kind: "range",
  label: "Depth",
  min: 0,
  max: 100,
  step: 0.01,
  formatter: formatMultiplier,
};

/**
 * 获取可渲染的控件列表
 * - 非调制模式：显示所有控件（除了 conditional 不满足的）
 * - 调制模式：将 volume 替换为 Depth，隐藏 pan，条件性显示 octave/frequency
 */
function getRenderableControls(module, controls) {
  if (module.category !== "source") {
    return controls.filter((control) => !control.conditional || control.conditional(module));
  }

  return controls
    .map((control) => (module.modulationMode && control.path === "volume" ? MODULATION_DEPTH_CONTROL : control))
    .filter((control) => {
      // 调制模式下隐藏 pan
      if (module.modulationMode && control.path === "pan") return false;
      // 条件性显示：octave 在 midiOn 时显示
      if (control.path === "options.octave") return module.midiOn;
      // 条件性显示：frequency 在 !midiOn 时显示
      if (control.path === "options.frequency") return !module.midiOn;
      // 其他控件检查 conditional 函数
      if (control.conditional && !control.conditional(module)) return false;
      return true;
    });
}

function getMacroSliderProps(app, moduleId, paramPath) {
  const chainIndex = app.getSelectedChainIndex();
  const readBinding = () => app.macroManager.getBindingForTarget(moduleId, paramPath, chainIndex);
  return {
    macroBinding: readBinding(),
    onManualMacroInput: () => app.macroManager.removeBindingsForTarget(moduleId, paramPath, chainIndex),
    onMacroRangeChange: (rangeStart, rangeEnd) => {
      const binding = readBinding();
      if (!binding) {
        return;
      }
      app.macroManager.updateBindingRange({ chainIndex, axis: binding.axis, moduleId, paramPath, rangeStart, rangeEnd });
    },
  };
}

export function renderModuleCard(module, index, app) {
  const chainIndex = app.getSelectedChainIndex();
  const definition = getModuleDefinition(module);
  const modulationSource = app.isModulationSource(module);
  const accent = modulationSource ? "modulation" : getModuleAccent(module);
  const kicker = getModuleTag(module);
  const canToggleModulation = module.category === "source";
  const canCreateCable = modulationSource;

  const card = createModuleCard({
    accent,
    kicker,
    title: module.type,
    titleOptions: getTitleOptions(module.category),
    showOutputLevel: module.category === "source" && SOURCE_MONITOR_ENABLED,
    onTitleChange: (value) => {
      const replacement = createModule(module.category, value);
      replacement.id = module.id;
      replacement.enabled = module.enabled;
      if (module.category === "source") {
        replacement.volume = module.volume;
        replacement.pan = module.pan;
        replacement.modulationMode = module.modulationMode;
        replacement.midiOn = module.midiOn;
        const sourceFrequencyOffset = Number(module?.options?.frequencyOffset);
        if (Number.isFinite(sourceFrequencyOffset)) {
          replacement.options.frequencyOffset = sourceFrequencyOffset;
        }
        const sourceFrequency = Number(module?.options?.frequency);
        if (Number.isFinite(sourceFrequency) && sourceFrequency > 0) {
          replacement.options.frequency = sourceFrequency;
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
      // 切换模式时重置 frequency 为当前模式的默认值
      if (!module.midiOn) {
        module.options.frequency = module.modulationMode ? 1 : 440;
      }
      app.markUnsaved();
      app.renderAll();
      app.engine.fullSync(app.state);
    },
    showModulationAnchor: canCreateCable,
    onModulationAnchorPointerDown: (event) => {
      if (app.getOutgoingModulations(module.id).length >= 8) {
        return;
      }
      app.startModulationDrag({ event, sourceModuleId: module.id });
    },
    removable: !isBuiltinPreset(app.selectedPresetId),
    index: index + 1,
    initModuleDrag: (event, card, moduleIndex) => app.initModuleDrag(event, card, moduleIndex),
  });

  const controls = document.createElement("div");
  controls.className = "module-grid";

  if (
    ((module.category === "source" && module.modulationMode) || module.type === "Envelope")
    && !Number.isFinite(Number(module?.options?.gain))
  ) {
    setByPath(module, "options.gain", 1);
  }

  if (module.category === "source") {
    getSourceSampleSlots(module).forEach((slot) => {
      controls.append(
        createAudioImportControl({
          label: slot.label,
          value: getByPath(module, slot.namePath) || slot.fallbackName,
          onSelect: async (file) => {
            await importSourceSample(module, index, slot, file, app);
          },
        }),
      );
    });
  }

  if (
    module.category === "source" &&
    (module.type === "Oscillator" || module.type === "PulseOscillator")
  ) {
    controls.append(
      createToggleControl({
        label: "MIDI",
        accent: "modulation",
        value: Boolean(module.midiOn),
        onToggle: (nextValue) => {
          module.midiOn = nextValue;
          // 关闭 MIDI 时，根据当前模式设置默认 frequency
          if (!nextValue) {
            module.options.frequency = module.modulationMode ? 1 : 440;
          }
          app.markUnsaved();
          app.renderAll();
          app.engine.fullSync(app.state);
        },
      }),
    );
  }

  getRenderableControls(module, definition.controls).forEach((control) => {
    controls.append(
      renderModuleControl(
        module,
        control,
        () => app.engine.updateModule(module.id, module),
        accent,
        `chains.${chainIndex}.modules.${index}.${control.path}`,
        app,
      ),
    );
  });

  card.append(controls);
  return card;
}

export function renderModuleControl(module, control, onCommit, accent, bindingPath = null, app) {
  const path = control.path;
  const value = getByPath(module, path);
  const macroSliderProps = getMacroSliderProps(app, module.id, path);

  if (control.kind === "select") {
    return createSelectControl({
      label: control.label,
      options: control.options,
      value,
      accent,
      onChange: (nextValue) => {
        setByPath(module, path, nextValue);
        app.markUnsaved();
        onCommit();
      },
    });
  }

  if (control.kind === "toggle") {
    return createToggleControl({
      label: control.label,
      accent,
      value: Boolean(value),
      onToggle: (nextValue) => {
        setByPath(module, path, nextValue);
        app.markUnsaved();
        onCommit();
      },
    });
  }

  // 动态调整 frequency 滑块范围：非调制模式下扩展为 20-20000Hz
  let controlMin = control.min;
  let controlMax = control.max;
  let controlStep = control.step;
  if (control.path === "options.frequency" && module.category === "source" && !module.modulationMode) {
    controlMin = 20;
    controlMax = 20000;
    controlStep = 1;
  }

  return createSliderControl({
    label: control.label,
    accent,
    min: controlMin,
    max: controlMax,
    step: controlStep,
    value,
    path: bindingPath,
    controlBindings: app.controlBindings,
    moduleId: module.id,
    paramPath: control.path,
    ...macroSliderProps,
    modulation: app.getModulationByTarget(module.id, control.path),
    formatter: control.formatter || formatPlain,
    onInput: (nextValue) => {
      setByPath(module, path, nextValue);
      app.markUnsaved();
      onCommit();
    },
    engine: app.engine,
    modulationManager: app.modulationManager,
    onPresetChange: (presetId) => {
      app.selectedPresetId = presetId;
    },
  });
}

export function getSourceSampleSlots(module) {
  if (module.type === "Player") {
    return [
      {
        label: "Sample",
        path: "options.url",
        namePath: "assetName",
        fallbackName: "Factory Pluck",
      },
    ];
  }

  if (module.type === "GrainPlayer") {
    return [
      {
        label: "Sample",
        path: "options.url",
        namePath: "assetName",
        fallbackName: "Factory Texture",
      },
    ];
  }

  if (module.type === "Players") {
    return [
      {
        label: "Low Sample",
        path: "options.urls.low",
        namePath: "sampleNames.low",
        fallbackName: "Factory Pluck",
      },
      {
        label: "Mid Sample",
        path: "options.urls.mid",
        namePath: "sampleNames.mid",
        fallbackName: "Factory Bell",
      },
      {
        label: "High Sample",
        path: "options.urls.high",
        namePath: "sampleNames.high",
        fallbackName: "Factory Texture",
      },
    ];
  }

  return [];
}

export async function importSourceSample(module, index, slot, file, app) {
  const dataUrl = await readFileAsDataUrl(file);
  setByPath(module, slot.path, dataUrl);
  setByPath(module, slot.namePath, file.name);
  app.getCurrentModules()[index] = normalizeSourceModule(module);
  app.markUnsaved();
  app.renderAll();
  app.engine.fullSync(app.state);
  app.setStatus(`Loaded ${file.name} into ${module.type}.`, app.audioBooted ? "live" : "neutral");
}

export function getTitleOptions(category) {
  if (category === "source") {
    return Object.keys(SOURCE_LIBRARY).map((type) => ({ label: type, value: type }));
  }
  if (category === "effect") {
    return Object.keys(EFFECT_LIBRARY).map((type) => ({ label: type, value: type }));
  }
  return Object.keys(COMPONENT_LIBRARY).map((type) => ({ label: type, value: type }));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
