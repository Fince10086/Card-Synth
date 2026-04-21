export function createSliderControl({
  label,
  value,
  min,
  max,
  step,
  formatter,
  onInput,
  accent = "source",
  path = null,
  eventName = "input",
  moduleId = "",
  paramPath = "",
  modulation = null,
  controlBindings = null,
  engine = null,
  modulationManager = null,
  onPresetChange = null,
  macroBinding = null,
  onManualMacroInput = null,
  onMacroRangeChange = null,
}) {
  const wrapper = document.createElement("label");
  wrapper.className = "control control-slider";
  if (moduleId && paramPath) {
    wrapper.dataset.moduleId = moduleId;
    wrapper.dataset.paramPath = paramPath;
    wrapper.dataset.sliderMin = String(min);
    wrapper.dataset.sliderMax = String(max);
    wrapper.dataset.sliderStep = String(step);
  }

  const controlLabel = document.createElement("div");
  controlLabel.className = "control-label";
  const strong = document.createElement("strong");
  strong.textContent = label;
  const modulationTarget = document.createElement("span");
  modulationTarget.className = "modulation-target";
  if (moduleId && paramPath) {
    modulationTarget.dataset.moduleId = moduleId;
    modulationTarget.dataset.paramPath = paramPath;
    if (modulationManager && modulationManager.getModulationByTarget(moduleId, paramPath)) {
      modulationTarget.classList.add("is-connected");
    }
  }

  modulationTarget.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (modulationManager) {
      const existingModulation = modulationManager.getModulationByTarget(moduleId, paramPath);
      if (existingModulation) {
        modulationManager.startModulationDrag({
          event,
          sourceModuleId: existingModulation.sourceModuleId,
          updateConnectionId: existingModulation.id,
        });
      }
    }
  });

  const readout = document.createElement("span");
  readout.className = "control-readout";

  const valueGroup = document.createElement("span");
  valueGroup.className = "value-group";
  valueGroup.append(modulationTarget, readout);

  controlLabel.append(strong, valueGroup);

  const shell = document.createElement("div");
  shell.className = "slider-shell";
  shell.style.setProperty("--thumb-fill", "#ffffff");

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.className = "slider-input";

  shell.append(input);

  const updateVisual = (nextValue) => {
    const numericValue = Number(nextValue);
    const percent = (numericValue - min) / (max - min);
    readout.textContent = formatter(numericValue);
    shell.style.setProperty("--percent", percent.toString());
  };

  updateVisual(value);

  const syncModulationRange = (nextValue) => {
    if (!(modulation && paintRange)) {
      return;
    }
    paintRange();
    const centerValue = Number(nextValue);
    const radius = modulation.radius ?? ((max - min) * 0.15);
    modulationManager?.updateModulationRange(modulation.id, centerValue, radius);
  };

  const setVisualValue = (nextValue) => {
    input.value = String(nextValue);
    updateVisual(nextValue);
    syncModulationRange(nextValue);
  };

  if (path && controlBindings) {
    controlBindings.set(path, {
      setVisual: (nextValue) => setVisualValue(nextValue),
    });
  }

  let paintRange = null;
  let clearMacroVisualState = null;
  let macroBindingCleared = false;

  const clearMacroBindingOnManualInput = () => {
    if (macroBindingCleared) {
      return;
    }
    const removed = onManualMacroInput?.();
    if (removed) {
      macroBindingCleared = true;
      clearMacroVisualState?.();
    }
  };

  input.addEventListener("input", (event) => {
    const nextValue = Number(event.target.value);
    clearMacroBindingOnManualInput();
    setVisualValue(nextValue);
    if (eventName === "input") {
      onInput(nextValue);
    }
  });

  input.addEventListener("pointerup", () => {
    input.blur();
  });

  if (eventName === "change") {
    input.addEventListener("change", (event) => {
      const nextValue = Number(event.target.value);
      clearMacroBindingOnManualInput();
      setVisualValue(nextValue);
      onInput(nextValue);
      input.blur();
    });
  }

  // 双击读数手动输入
  const handleReadoutDoubleClick = () => {
    const currentInput = readout.nextElementSibling;
    if (currentInput && currentInput.classList.contains("readout-input")) {
      return;
    }

    const inputField = document.createElement("input");
    inputField.type = "number";
    inputField.min = String(min);
    inputField.max = String(max);
    inputField.step = String(step);
    inputField.value = String(input.value);
    inputField.className = "readout-input";

    readout.style.display = "none";
    readout.parentNode.insertBefore(inputField, readout);
    inputField.focus();
    inputField.select();

    let isCommitting = false;

    const commitValue = () => {
      if (isCommitting) return;
      isCommitting = true;

      let newValue = Number(inputField.value);
      if (Number.isNaN(newValue)) {
        newValue = Number(input.value);
      }
      newValue = Math.max(min, Math.min(max, newValue));
      setVisualValue(newValue);
      clearMacroBindingOnManualInput();
      onInput(newValue);
      inputField.remove();
      readout.style.display = "";
    };

    const cancelEdit = () => {
      if (isCommitting) return;
      isCommitting = true;
      inputField.remove();
      readout.style.display = "";
    };

    inputField.addEventListener("blur", commitValue);
    inputField.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitValue();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelEdit();
      }
    });
  };

  readout.addEventListener("dblclick", handleReadoutDoubleClick);

  if (macroBinding) {
    shell.classList.add("slider-shell--macro-bound");
    shell.style.setProperty("--thumb-fill", macroBinding.color || "var(--ink)");

    const markerStart = document.createElement("span");
    markerStart.className = "macro-range-marker macro-range-marker--start";
    markerStart.textContent = "┌";

    const markerEnd = document.createElement("span");
    markerEnd.className = "macro-range-marker macro-range-marker--end";
    markerEnd.textContent = "┐";

    shell.append(markerStart, markerEnd);

    let rangeStart = Math.max(0, Math.min(1, Number(macroBinding.rangeStart ?? 0)));
    let rangeEnd = Math.max(0, Math.min(1, Number(macroBinding.rangeEnd ?? 1)));

    const paintMacroRange = () => {
      markerStart.style.left = `${rangeStart * 100}%`;
      markerEnd.style.left = `${rangeEnd * 100}%`;
    };

    const updateRangeFromPointer = (clientX, markerType) => {
      const rect = shell.getBoundingClientRect();
      if (!rect.width) {
        return;
      }
      const norm = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      if (markerType === "start") {
        rangeStart = norm;
      } else {
        rangeEnd = norm;
      }
      paintMacroRange();
      onMacroRangeChange?.(rangeStart, rangeEnd);
    };

    const bindMacroMarkerDrag = (marker, markerType) => {
      marker.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const onMove = (moveEvent) => {
          updateRangeFromPointer(moveEvent.clientX, markerType);
        };

        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };

        updateRangeFromPointer(event.clientX, markerType);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
    };

    bindMacroMarkerDrag(markerStart, "start");
    bindMacroMarkerDrag(markerEnd, "end");
    paintMacroRange();

    clearMacroVisualState = () => {
      shell.classList.remove("slider-shell--macro-bound");
      shell.style.setProperty("--thumb-fill", "#ffffff");
      markerStart.remove();
      markerEnd.remove();
    };
  }

  if (modulation) {
    shell.classList.add("slider-shell--mod-range");
    const markerMin = document.createElement("span");
    markerMin.className = "mod-range-marker mod-range-marker--min";
    markerMin.textContent = "[";
    const markerMinValue = document.createElement("span");
    markerMinValue.className = "mod-range-marker__value";
    markerMin.append(markerMinValue);
    const markerMax = document.createElement("span");
    markerMax.className = "mod-range-marker mod-range-marker--max";
    markerMax.textContent = "]";
    const markerMaxValue = document.createElement("span");
    markerMaxValue.className = "mod-range-marker__value";
    markerMax.append(markerMaxValue);
    shell.append(markerMin, markerMax);

    const clamp = (next) => Math.max(min, Math.min(max, next));
    const snap = (next) => {
      const numericStep = Number(step) || 1;
      const snapped = min + Math.round((next - min) / numericStep) * numericStep;
      return clamp(Number(snapped.toFixed(6)));
    };
    const safeNumber = (next, fallback) => {
      const numeric = Number(next);
      return Number.isFinite(numeric) ? numeric : fallback;
    };

    if (modulation.radius === undefined) {
      modulation.radius = (max - min) * 0.15;
    }

    paintRange = () => {
      const centerValue = Number(input.value);
      const radius = modulation.radius ?? ((max - min) * 0.15);
      const minValue = centerValue - radius;
      const maxValue = centerValue + radius;

      // 转换为百分比用于 CSS 显示
      const minPct = ((minValue - min) / (max - min)) * 100;
      const maxPct = ((maxValue - min) / (max - min)) * 100;

      // 范围显示使用排序后的值，确保正确渲染
      shell.style.setProperty("--range-start", `${Math.min(minPct, maxPct)}%`);
      shell.style.setProperty("--range-end", `${Math.max(minPct, maxPct)}%`);
      // 标记位置保持实际值，允许 max 在 min 左边（radius 为负）
      markerMin.style.left = `${minPct}%`;
      markerMax.style.left = `${maxPct}%`;
      markerMinValue.textContent = minValue.toFixed(2);
      markerMaxValue.textContent = maxValue.toFixed(2);
    };

    const commitRange = () => {
      onPresetChange?.("custom");
    };

    const bindMarkerDrag = (marker) => {
      marker.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const isMinMarker = marker.classList.contains("mod-range-marker--min");
        const updateFromPointer = (clientX) => {
          const rect = shell.getBoundingClientRect();
          if (!rect.width) {
            return;
          }

          // 像素位置 → 参数域绝对值
          const markerPercent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
          const valueAtMarker = min + (max - min) * markerPercent;
          const centerValue = Number(input.value);

          // 根据标记类型计算有符号的 radius
          // min 标记：radius = centerValue - valueAtMarker（向右拉为正，向左拉为负）
          // max 标记：radius = valueAtMarker - centerValue（向右拉为正，向左拉为负）
          if (isMinMarker) {
            modulation.radius = centerValue - valueAtMarker;
          } else {
            modulation.radius = valueAtMarker - centerValue;
          }
          console.log(`[SliderControl] ${isMinMarker ? 'min' : 'max'} marker: center=${centerValue.toFixed(2)}, valueAtMarker=${valueAtMarker.toFixed(2)}, radius=${modulation.radius.toFixed(2)}`);
          paintRange();

          modulationManager?.updateModulationRange(modulation.id, centerValue, modulation.radius);
        };
        const onMove = (moveEvent) => {
          updateFromPointer(moveEvent.clientX);
        };
        const onUp = () => {
          commitRange();
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        updateFromPointer(event.clientX);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
    };

    bindMarkerDrag(markerMin);
    bindMarkerDrag(markerMax);
    paintRange();
    wrapper.append(controlLabel, shell);
    return wrapper;
  }

  wrapper.append(controlLabel, shell);
  return wrapper;
}
