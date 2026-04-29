/**
 * Slider control component
 */

export interface SliderControlOptions {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatter?: (value: number) => string;
  onInput: (value: number) => void;
  accent?: string;
  path?: string | null;
  eventName?: string;
  moduleId?: string;
  paramPath?: string;
  modulation?: Record<string, unknown> | null;
  controlBindings?: Map<string, { setVisual(value: number): void }> | null;
  engine?: unknown;
  modulationManager?: Record<string, unknown> | null;
  onPresetChange?: (() => void) | null;
  macroBinding?: Record<string, unknown> | null;
  onManualMacroInput?: (() => boolean) | null;
  onMacroRangeChange?: ((start: number, end: number) => void) | null;
}

export function createSliderControl({
  label,
  value,
  min,
  max,
  step,
  formatter = (v: number) => String(v),
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
}: SliderControlOptions): HTMLElement {
  const isLogarithmic = (formatter as Record<string, unknown>)?.unit === "log" && min > 0 && max > 0 && max !== min;

  function toLogPercent(actualValue: number): number {
    if (!isLogarithmic || actualValue <= 0) return (actualValue - min) / (max - min);
    return Math.max(0, Math.min(1, Math.log(actualValue / min) / Math.log(max / min)));
  }

  function fromLogPercent(linearPercent: number): number {
    if (!isLogarithmic) return min + (max - min) * linearPercent;
    return min * Math.pow(max / min, Math.max(0, Math.min(1, linearPercent)));
  }

  function actualToLinear(actualValue: number): number {
    if (!isLogarithmic) return actualValue;
    return min + (max - min) * toLogPercent(actualValue);
  }

  function linearToActual(linearValue: number): number {
    if (!isLogarithmic) return linearValue;
    return fromLogPercent((linearValue - min) / (max - min));
  }

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
  const macroTarget = document.createElement("span");
  macroTarget.className = "macro-target";
  if (moduleId && paramPath && macroBinding) {
    macroTarget.dataset.moduleId = moduleId;
    macroTarget.dataset.paramPath = paramPath;
    macroTarget.textContent = macroBinding.axis === "x" ? "←→" : macroBinding.axis === "z" ? "Z" : "↑↓";
    macroTarget.classList.add("is-connected");
  }

  const modulationTarget = document.createElement("span");
  modulationTarget.className = "modulation-target";
  if (moduleId && paramPath) {
    modulationTarget.dataset.moduleId = moduleId;
    modulationTarget.dataset.paramPath = paramPath;
    if (modulationManager && (modulationManager as Record<string, unknown>).getModulationByTarget) {
      const existing = (modulationManager as Record<string, Function>).getModulationByTarget(moduleId, paramPath);
      if (existing) {
        modulationTarget.classList.add("is-connected");
      }
    }
  }

  modulationTarget.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (modulationManager) {
      const existingModulation = (modulationManager as Record<string, Function>).getModulationByTarget(moduleId, paramPath);
      if (existingModulation) {
        (modulationManager as Record<string, Function>).startModulationDrag({
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
  valueGroup.append(macroTarget, modulationTarget, readout);

  controlLabel.append(strong, valueGroup);

  const shell = document.createElement("div");
  shell.className = "slider-shell";
  shell.style.setProperty("--thumb-fill", "#ffffff");

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(actualToLinear(value));
  input.className = "slider-input";
  input.setAttribute("tabindex", "-1");

  shell.append(input);

  const updateVisual = (actualValue: number) => {
    const linearValue = actualToLinear(actualValue);
    const percent = (linearValue - min) / (max - min);
    readout.textContent = formatter(actualValue);
    shell.style.setProperty("--percent", percent.toString());
  };

  updateVisual(value);

  const syncModulationRange = (nextValue: number) => {
    if (!(modulation && paintRange)) {
      return;
    }
    paintRange();
    const centerValue = Number(nextValue);
    const radius = (modulation as Record<string, unknown>).radius ?? ((max - min) * 0.15);
    (modulationManager as Record<string, Function> | null)?.updateModulationRange?.(
      (modulation as Record<string, unknown>).id,
      centerValue,
      radius,
      undefined,
      min,
      max
    );
  };

  const setVisualValue = (nextValue: number) => {
    input.value = String(actualToLinear(nextValue));
    updateVisual(nextValue);
    syncModulationRange(nextValue);
  };

  if (path && controlBindings) {
    controlBindings.set(path, {
      setVisual: (nextValue: number) => setVisualValue(nextValue),
    });
  }

  let paintRange: (() => void) | null = null;
  let clearMacroVisualState: (() => void) | null = null;
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

  let pendingValue: number | null = null;
  let rafId: number | null = null;

  input.addEventListener("input", (event) => {
    const linearValue = Number((event.target as HTMLInputElement).value);
    const nextValue = linearToActual(linearValue);
    clearMacroBindingOnManualInput();
    setVisualValue(nextValue);
    if (eventName === "input") {
      pendingValue = nextValue;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          onInput(pendingValue!);
          rafId = null;
          pendingValue = null;
        });
      }
    }
  });

  input.addEventListener("pointerup", () => {
    input.blur();
  });

  if (eventName === "change") {
    input.addEventListener("change", (event) => {
      const linearValue = Number((event.target as HTMLInputElement).value);
      const nextValue = linearToActual(linearValue);
      clearMacroBindingOnManualInput();
      setVisualValue(nextValue);
      onInput(nextValue);
      input.blur();
    });
  }

  const createInlineInput = (
    targetEl: HTMLElement,
    config: Record<string, unknown>,
    onCommit: (value: string, cleanup: () => void) => void,
    onCancel?: () => void
  ) => {
    const inputField = document.createElement("input");
    inputField.type = (config.type as string) || "number";
    if (config.min !== undefined) inputField.min = String(config.min);
    if (config.max !== undefined) inputField.max = String(config.max);
    if (config.step !== undefined) inputField.step = String(config.step);
    inputField.value = String(config.value);
    inputField.className = (config.className as string) || "readout-input";
    if (config.style) {
      Object.assign(inputField.style, config.style as Record<string, string>);
    }

    targetEl.style.display = "none";
    targetEl.parentNode!.insertBefore(inputField, targetEl);
    inputField.focus();
    inputField.select();

    let isCommitting = false;

    const commit = () => {
      if (isCommitting) return;
      isCommitting = true;
      onCommit(inputField.value, () => {
        inputField.remove();
        targetEl.style.display = "";
      });
    };

    const cancel = () => {
      if (isCommitting) return;
      isCommitting = true;
      if (onCancel) onCancel();
      inputField.remove();
      targetEl.style.display = "";
    };

    inputField.addEventListener("blur", commit);
    inputField.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    });
  };

  readout.addEventListener("dblclick", () => {
    const currentInput = readout.nextElementSibling;
    if (currentInput && currentInput.classList.contains("readout-input")) {
      return;
    }

    createInlineInput(
      readout,
      { type: "number", min, max, step, value: linearToActual(Number(input.value)) },
      (value, cleanup) => {
        let newValue = Number(value);
        if (Number.isNaN(newValue)) {
          newValue = linearToActual(Number(input.value));
        }
        newValue = Math.max(min, Math.min(max, newValue));
        cleanup();
        setVisualValue(newValue);
        clearMacroBindingOnManualInput();
        onInput(newValue);
      },
      () => {}
    );
  });

  if (macroBinding) {
    shell.classList.add("slider-shell--macro-bound");
    shell.style.setProperty("--thumb-fill", (macroBinding.color as string) || "var(--ink)");

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

    const updateRangeFromPointer = (clientX: number, markerType: string) => {
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

    const bindMacroMarkerDrag = (marker: HTMLElement, markerType: string) => {
      marker.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const onMove = (moveEvent: PointerEvent) => {
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

    const bracketMin = document.createElement("span");
    bracketMin.className = "mod-range-bracket mod-range-bracket--min";
    bracketMin.textContent = "[";
    const valueMin = document.createElement("span");
    valueMin.className = "mod-range-value mod-range-value--min";

    const bracketMax = document.createElement("span");
    bracketMax.className = "mod-range-bracket mod-range-bracket--max";
    bracketMax.textContent = "]";
    const valueMax = document.createElement("span");
    valueMax.className = "mod-range-value mod-range-value--max";

    const centerValueEl = document.createElement("span");
    centerValueEl.className = "mod-range-center-value";
    shell.append(centerValueEl, bracketMin, valueMin, bracketMax, valueMax);

    const clamp = (next: number) => Math.max(min, Math.min(max, next));
    const snap = (next: number) => {
      const numericStep = Number(step) || 1;
      const snapped = min + Math.round((next - min) / numericStep) * numericStep;
      return clamp(Number(snapped.toFixed(6)));
    };

    if ((modulation as Record<string, unknown>).radius === undefined) {
      (modulation as Record<string, unknown>).radius = (max - min) * 0.15;
    }

    paintRange = () => {
      const centerValue = linearToActual(Number(input.value));
      const radius = (modulation as Record<string, unknown>).radius ?? ((max - min) * 0.15);
      const minValue = centerValue - (radius as number);
      const maxValue = centerValue + (radius as number);

      const effMinValue = Math.max(min, Math.min(max, minValue));
      const effMaxValue = Math.max(min, Math.min(max, maxValue));

      const minPct = isLogarithmic ? toLogPercent(effMinValue) : ((effMinValue - min) / (max - min));
      const maxPct = isLogarithmic ? toLogPercent(effMaxValue) : ((effMaxValue - min) / (max - min));
      const centerPct = isLogarithmic ? toLogPercent(centerValue) : ((centerValue - min) / (max - min));

      const sourceModule = (modulationManager as Record<string, Function> | null)?.getModules?.()?.find((m: { id: string; type: string }) => m.id === (modulation as Record<string, unknown>).sourceModuleId);
      const isEnvelopeSource = sourceModule?.type === "Envelope";

      if (isEnvelopeSource) {
        shell.style.setProperty("--range-start", `${Math.min(centerPct, maxPct) * 100}%`);
        shell.style.setProperty("--range-end", `${Math.max(centerPct, maxPct) * 100}%`);
        bracketMin.style.visibility = "hidden";
        valueMin.style.visibility = "hidden";
      } else {
        shell.style.setProperty("--range-start", `${Math.min(minPct, maxPct) * 100}%`);
        shell.style.setProperty("--range-end", `${Math.max(minPct, maxPct) * 100}%`);
        bracketMin.style.visibility = "visible";
        valueMin.style.visibility = "visible";
      }

      const trackWidth = shell.clientWidth || input.clientWidth;
      const edgeLeft = (percent: number, element: HTMLElement) => {
        if (!trackWidth) return `${percent * 100}%`;
        const elWidth = element.getBoundingClientRect().width;
        const constrained = percent * (1 - elWidth / trackWidth);
        return `${constrained * 100}%`;
      };

      bracketMin.style.left = edgeLeft(minPct, bracketMin);
      valueMin.style.left = edgeLeft(minPct, valueMin);
      bracketMax.style.left = edgeLeft(maxPct, bracketMax);
      valueMax.style.left = edgeLeft(maxPct, valueMax);

      if (!isEnvelopeSource) {
        const minRect = bracketMin.getBoundingClientRect();
        const maxRect = bracketMax.getBoundingClientRect();
        const distance = Math.abs(maxRect.left - minRect.right);
        if (distance < 40) {
          valueMin.textContent = "";
          valueMax.textContent = "";
        } else {
          valueMin.textContent = effMinValue.toFixed(2);
          valueMax.textContent = effMaxValue.toFixed(2);
        }
      } else {
        valueMax.textContent = effMaxValue.toFixed(2);
      }

      const radiusStr = isEnvelopeSource
        ? `+${Math.abs(radius as number).toFixed(2)}`
        : (radius as number) >= 0 ? `±${Math.abs(radius as number).toFixed(2)}` : `${(radius as number).toFixed(2)}`;
      centerValueEl.textContent = radiusStr;
      const sliderPercent = isLogarithmic ? toLogPercent(centerValue) : ((centerValue - min) / (max - min));
      centerValueEl.style.left = edgeLeft(sliderPercent, centerValueEl);
    };

    const commitRange = () => {
      onPresetChange?.();
    };

    const bindMarkerDrag = (bracket: HTMLElement) => {
      bracket.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const isMinBracket = bracket.classList.contains("mod-range-bracket--min");
        const updateFromPointer = (clientX: number) => {
          const rect = shell.getBoundingClientRect();
          if (!rect.width) {
            return;
          }

          const bracketPercent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
          const valueAtBracket = isLogarithmic
            ? fromLogPercent(bracketPercent)
            : Math.max(min, Math.min(max, min + (max - min) * bracketPercent));
          const centerValue = linearToActual(Number(input.value));

          if (isMinBracket) {
            (modulation as Record<string, unknown>).radius = centerValue - valueAtBracket;
          } else {
            (modulation as Record<string, unknown>).radius = valueAtBracket - centerValue;
          }
          paintRange!();

          (modulationManager as Record<string, Function> | null)?.updateModulationRange?.(
            (modulation as Record<string, unknown>).id,
            centerValue,
            (modulation as Record<string, unknown>).radius,
            undefined,
            min,
            max
          );
        };
        const onMove = (moveEvent: PointerEvent) => {
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

    bindMarkerDrag(bracketMin);
    bindMarkerDrag(bracketMax);

    centerValueEl.addEventListener("dblclick", () => {
      if (centerValueEl.parentNode!.querySelector(".mod-range-center-value + .readout-input")) {
        return;
      }

      createInlineInput(
        centerValueEl,
        {
          type: "number",
          step,
          value: ((modulation as Record<string, unknown>).radius ?? ((max - min) * 0.15)).toFixed(2),
          style: {
            position: "absolute",
            left: centerValueEl.style.left || "0%",
            top: "-10px",
            zIndex: "3",
          },
        },
        (value, cleanup) => {
          let newRadius = Number(value);
          if (Number.isNaN(newRadius)) {
            newRadius = (modulation as Record<string, unknown>).radius as number ?? ((max - min) * 0.15);
          }
          const centerValue = Number(input.value);
          const maxRadius = Math.min(centerValue - min, max - centerValue);
          newRadius = Math.max(-maxRadius, Math.min(maxRadius, newRadius));
          (modulation as Record<string, unknown>).radius = newRadius;
          cleanup();
          paintRange!();
          (modulationManager as Record<string, Function> | null)?.updateModulationRange?.(
            (modulation as Record<string, unknown>).id,
            Number(input.value),
            (modulation as Record<string, unknown>).radius,
            undefined,
            min,
            max
          );
          commitRange();
        },
        () => {}
      );
    });

    const resizeObserver = new ResizeObserver(() => {
      paintRange!();
    });
    resizeObserver.observe(bracketMin);
    resizeObserver.observe(valueMin);
    resizeObserver.observe(bracketMax);
    resizeObserver.observe(valueMax);
    resizeObserver.observe(centerValueEl);

    paintRange();
    wrapper.append(controlLabel, shell);
    return wrapper;
  }

  wrapper.append(controlLabel, shell);
  return wrapper;
}
