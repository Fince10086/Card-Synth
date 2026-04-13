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
import { formatHertz, formatPlain } from "../../core/formatters.js";
import {
  createSelectControl,
  createToggleControl,
  createSliderControl,
  createAudioImportControl,
} from "../controls/index.js";
import { createModuleCard } from "../components/moduleCard.js";

export function renderModuleCard(module, index, app) {
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
    onTitleChange: (value) => {
      const replacement = createModule(module.category, value);
      replacement.id = module.id;
      replacement.enabled = module.enabled;
      if (module.category === "source") {
        replacement.volume = module.volume;
        replacement.pan = module.pan;
        replacement.modulationMode = module.modulationMode;
        const sourceFrequency = Number(module?.options?.frequency);
        if (Number.isFinite(sourceFrequency) && sourceFrequency > 0) {
          replacement.options.frequency = sourceFrequency;
        }
      }
      if (!app.isModulationSource(replacement)) {
        app.removeOutgoingModulations(module.id);
      }
      app.state.modules[index] = replacement;
      app.selectedPresetId = "custom";
      app.renderAll();
      app.engine.fullSync(app.state);
    },
    moduleRef: module.id,
    enabled: module.enabled,
    onToggleEnabled: () => {
      module.enabled = !module.enabled;
      app.selectedPresetId = "custom";
      app.engine.fullSync(app.state);
      app.renderAll();
    },
    onRemove: () => {
      app.removeModuleModulations(module.id);
      app.state.modules.splice(index, 1);
      app.selectedPresetId = "custom";
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
      app.selectedPresetId = "custom";
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
    removable: true,
    index: index + 1,
    initModuleDrag: (event, card, moduleIndex) => app.initModuleDrag(event, card, moduleIndex),
  });

  const controls = document.createElement("div");
  controls.className = "module-grid";

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
    module.modulationMode &&
    (module.type === "Oscillator" || module.type === "PulseOscillator")
  ) {
    const modulationFrequency = Number(module?.options?.frequency);
    const initialFrequency = Number.isFinite(modulationFrequency) && modulationFrequency > 0
      ? modulationFrequency
      : 1;

    controls.append(
      createSliderControl({
        label: "Frequency",
        accent: "modulation",
        min: 0.1,
        max: 100,
        step: 0.01,
        value: initialFrequency,
        path: `modules.${index}.options.frequency`,
        moduleId: module.id,
        paramPath: "options.frequency",
        formatter: formatHertz,
        onInput: (value) => {
          setByPath(module, "options.frequency", value);
          app.selectedPresetId = "custom";
          app.engine.updateSource(module);
        },
      }),
    );
  }

  definition.controls.forEach((control) => {
    if (module.category === "source" && module.modulationMode && control.path === "pan") {
      return;
    }

    controls.append(
      renderModuleControl(
        module,
        control,
        () => app.engine.updateModule(module.id, module),
        accent,
        `modules.${index}.${control.path}`,
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

  if (control.kind === "select") {
    return createSelectControl({
      label: control.label,
      options: control.options,
      value,
      accent,
      onChange: (nextValue) => {
        setByPath(module, path, nextValue);
        app.selectedPresetId = "custom";
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
        app.selectedPresetId = "custom";
        onCommit();
      },
    });
  }

  return createSliderControl({
    label: control.label,
    accent,
    min: control.min,
    max: control.max,
    step: control.step,
    value,
    path: bindingPath,
    moduleId: module.id,
    paramPath: control.path,
    modulation: app.getModulationByTarget(module.id, control.path),
    formatter: control.formatter || formatPlain,
    onInput: (nextValue) => {
      setByPath(module, path, nextValue);
      app.selectedPresetId = "custom";
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
  app.state.modules[index] = normalizeSourceModule(module);
  app.selectedPresetId = "custom";
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
