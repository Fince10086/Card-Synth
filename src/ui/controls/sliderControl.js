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
  const isLogarithmic = formatter?.unit === "log" && min > 0 && max > 0 && max !== min;

  function toLogPercent(actualValue) {
    if (!isLogarithmic || actualValue <= 0) return (actualValue - min) / (max - min);
    return Math.max(0, Math.min(1, Math.log(actualValue / min) / Math.log(max / min)));
  }

  function fromLogPercent(linearPercent) {
    if (!isLogarithmic) return min + (max - min) * linearPercent;
    return min * Math.pow(max / min, Math.max(0, Math.min(1, linearPercent)));
  }

  function actualToLinear(actualValue) {
    if (!isLogarithmic) return actualValue;
    return min + (max - min) * toLogPercent(actualValue);
  }

  function linearToActual(linearValue) {
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

  const updateVisual = (actualValue) => {
    const linearValue = actualToLinear(actualValue);
    const percent = (linearValue - min) / (max - min);
    readout.textContent = formatter(actualValue);
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
    modulationManager?.updateModulationRange(modulation.id, centerValue, radius, undefined, min, max);
  };

  const setVisualValue = (nextValue) => {
    input.value = String(actualToLinear(nextValue));
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

  let pendingValue = null;
  let rafId = null;

  input.addEventListener("input", (event) => {
    const linearValue = Number(event.target.value);
    const nextValue = linearToActual(linearValue);
    clearMacroBindingOnManualInput();
    setVisualValue(nextValue);
    if (eventName === "input") {
      pendingValue = nextValue;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          onInput(pendingValue);
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
      const linearValue = Number(event.target.value);
      const nextValue = linearToActual(linearValue);
      clearMacroBindingOnManualInput();
      setVisualValue(nextValue);
      onInput(nextValue);
      input.blur();
    });
  }

  /**
   * 创建内联输入框
   * @param {HTMLElement} targetEl - 要替换显示的元素
   * @param {Object} config - 输入框配置
   * @param {Function} onCommit - 提交回调
   * @param {Function} onCancel - 取消回调（可选）
   */
  const createInlineInput = (targetEl, config, onCommit, onCancel) => {
    const inputField = document.createElement("input");
    inputField.type = config.type || "number";
    if (config.min !== undefined) inputField.min = String(config.min);
    if (config.max !== undefined) inputField.max = String(config.max);
    if (config.step !== undefined) inputField.step = String(config.step);
    inputField.value = String(config.value);
    inputField.className = config.className || "readout-input";
    if (config.style) {
      Object.assign(inputField.style, config.style);
    }

    targetEl.style.display = "none";
    targetEl.parentNode.insertBefore(inputField, targetEl);
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

  // 双击读数手动输入
  const handleReadoutDoubleClick = () => {
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
        cleanup(); // 先恢复显示
        setVisualValue(newValue);
        clearMacroBindingOnManualInput();
        onInput(newValue);
      },
      () => {}
    );
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

    // min 边界：bracket 和 value 独立元素，左边缘对齐
    const bracketMin = document.createElement("span");
    bracketMin.className = "mod-range-bracket mod-range-bracket--min";
    bracketMin.textContent = "[";
    const valueMin = document.createElement("span");
    valueMin.className = "mod-range-value mod-range-value--min";

    // max 边界：bracket 和 value 独立元素，右边缘对齐
    const bracketMax = document.createElement("span");
    bracketMax.className = "mod-range-bracket mod-range-bracket--max";
    bracketMax.textContent = "]";
    const valueMax = document.createElement("span");
    valueMax.className = "mod-range-value mod-range-value--max";

    // 悬浮显示的 ±radius 值（跟随滑块 thumb）
    const centerValueEl = document.createElement("span");
    centerValueEl.className = "mod-range-center-value";
    shell.append(centerValueEl, bracketMin, valueMin, bracketMax, valueMax);

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
      const centerValue = linearToActual(Number(input.value));
      const radius = modulation.radius ?? ((max - min) * 0.15);
      const minValue = centerValue - radius;
      const maxValue = centerValue + radius;

      // 计算有效范围（软钳制到 [min, max]）
      const effMinValue = Math.max(min, Math.min(max, minValue));
      const effMaxValue = Math.max(min, Math.min(max, maxValue));

      // 使用有效范围计算比例（0~1），对数滑块使用对数映射
      const minPct = isLogarithmic ? toLogPercent(effMinValue) : ((effMinValue - min) / (max - min));
      const maxPct = isLogarithmic ? toLogPercent(effMaxValue) : ((effMaxValue - min) / (max - min));
      const centerPct = isLogarithmic ? toLogPercent(centerValue) : ((centerValue - min) / (max - min));

      // 判断调制源是否为 Envelope（单向 0~1）
      const sourceModule = modulationManager?.getModules?.()?.find(m => m.id === modulation.sourceModuleId);
      const isEnvelopeSource = sourceModule?.type === "Envelope";

      if (isEnvelopeSource) {
        // Envelope 源：只显示 center 到 max 的区间，隐藏 min 部分
        shell.style.setProperty("--range-start", `${Math.min(centerPct, maxPct) * 100}%`);
        shell.style.setProperty("--range-end", `${Math.max(centerPct, maxPct) * 100}%`);
        bracketMin.style.visibility = "hidden";
        valueMin.style.visibility = "hidden";
      } else {
        // 普通源（Source 等双向 -1~1）：显示完整范围
        shell.style.setProperty("--range-start", `${Math.min(minPct, maxPct) * 100}%`);
        shell.style.setProperty("--range-end", `${Math.max(minPct, maxPct) * 100}%`);
        bracketMin.style.visibility = "visible";
        valueMin.style.visibility = "visible";
      }

      // 边缘约束定位：0% 时左边缘对齐，100% 时右边缘对齐
      const trackWidth = shell.clientWidth || input.clientWidth;
      const edgeLeft = (percent, element) => {
        if (!trackWidth) return `${percent * 100}%`;
        const elWidth = element.getBoundingClientRect().width;
        const constrained = percent * (1 - elWidth / trackWidth);
        return `${constrained * 100}%`;
      };

      bracketMin.style.left = edgeLeft(minPct, bracketMin);
      valueMin.style.left = edgeLeft(minPct, valueMin);
      bracketMax.style.left = edgeLeft(maxPct, bracketMax);
      valueMax.style.left = edgeLeft(maxPct, valueMax);

      // 碰撞检测：基于实际渲染边界（仅对非 Envelope 源生效）
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
        // Envelope 源时只显示 max value
        valueMax.textContent = effMaxValue.toFixed(2);
      }

      // 更新悬浮 radius 值，位置跟随滑块 thumb
      const radiusStr = isEnvelopeSource
        ? `+${Math.abs(radius).toFixed(2)}`
        : radius >= 0 ? `±${Math.abs(radius).toFixed(2)}` : `${radius.toFixed(2)}`;
      centerValueEl.textContent = radiusStr;
      const sliderPercent = isLogarithmic ? toLogPercent(centerValue) : ((centerValue - min) / (max - min));
      centerValueEl.style.left = edgeLeft(sliderPercent, centerValueEl);

    };

    const commitRange = () => {
      onPresetChange?.("custom");
    };

    const bindMarkerDrag = (bracket) => {
      bracket.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const isMinBracket = bracket.classList.contains("mod-range-bracket--min");
        const updateFromPointer = (clientX) => {
          const rect = shell.getBoundingClientRect();
          if (!rect.width) {
            return;
          }

          // 像素位置 → 参数域绝对值（硬边界限制在 [min, max]）
          const bracketPercent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
          const valueAtBracket = isLogarithmic
            ? fromLogPercent(bracketPercent)
            : Math.max(min, Math.min(max, min + (max - min) * bracketPercent));
          const centerValue = linearToActual(Number(input.value));

          // 根据 bracket 类型计算有符号的 radius
          // min bracket：radius = centerValue - valueAtBracket（向右拉为正，向左拉为负）
          // max bracket：radius = valueAtBracket - centerValue（向右拉为正，向左拉为负）
          if (isMinBracket) {
            modulation.radius = centerValue - valueAtBracket;
          } else {
            modulation.radius = valueAtBracket - centerValue;
          }
          paintRange();

          modulationManager?.updateModulationRange(modulation.id, centerValue, modulation.radius, undefined, min, max);
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

    bindMarkerDrag(bracketMin);
    bindMarkerDrag(bracketMax);

    // 双击悬浮 ± 值直接编辑 radius
    centerValueEl.addEventListener("dblclick", () => {
      if (centerValueEl.parentNode.querySelector(".mod-range-center-value + .readout-input")) {
        return;
      }

    createInlineInput(
      centerValueEl,
      {
        type: "number",
        step,
        value: (modulation.radius ?? ((max - min) * 0.15)).toFixed(2),
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
          newRadius = modulation.radius ?? ((max - min) * 0.15);
        }
        // 自动 clamp：确保 centerValue ± radius 在 [min, max] 范围内
        const centerValue = Number(input.value);
        const maxRadius = Math.min(centerValue - min, max - centerValue);
        newRadius = Math.max(-maxRadius, Math.min(maxRadius, newRadius));
        modulation.radius = newRadius;
        cleanup(); // 先恢复显示
        paintRange(); // 再计算正确位置（此时元素可见）
        modulationManager?.updateModulationRange(modulation.id, Number(input.value), modulation.radius, undefined, min, max);
        commitRange();
      },
      () => {}
    );
    });

    // 使用 ResizeObserver 监听所有标记元素的尺寸变化，确保位置始终正确
    const resizeObserver = new ResizeObserver(() => {
      paintRange();
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
