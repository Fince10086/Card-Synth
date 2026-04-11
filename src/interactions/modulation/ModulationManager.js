export class ModulationManager {
  constructor(app) {
    this.app = app;
    this.modulationDrag = {
      active: false,
      pointerId: 0,
      sourceModuleId: "",
      updateConnectionId: "",
      startX: 0,
      startY: 0,
      x: 0,
      y: 0,
    };
    this.modulationSvg = null;
    this.cableVisuals = new Map();
    this.modulationFrame = 0;
  }

  bindEvents() {
    document.addEventListener("pointermove", (event) => this.handleModulationPointerMove(event));
    document.addEventListener("pointerup", (event) => this.handleModulationPointerUp(event));
    document.addEventListener("pointercancel", () => this.cancelModulationDrag());
  }

  isModulationSource(module) {
    if (!module) {
      return false;
    }
    if (module.type === "Envelope") {
      return true;
    }
    return module.category === "source" && Boolean(module.modulationMode);
  }

  getModulations() {
    if (!Array.isArray(this.app.state.modulations)) {
      this.app.state.modulations = [];
    }
    return this.app.state.modulations;
  }

  getOutgoingModulations(sourceModuleId) {
    return this.getModulations().filter((item) => item.sourceModuleId === sourceModuleId);
  }

  getModulationByTarget(targetModuleId, targetParamPath) {
    return (
      this.getModulations().find(
        (item) => item.targetModuleId === targetModuleId && item.targetParamPath === targetParamPath,
      ) || null
    );
  }

  getModulationById(connectionId) {
    return this.getModulations().find((item) => item.id === connectionId) || null;
  }

  getNextModulationVoiceIndex(sourceModuleId) {
    const used = new Set(this.getOutgoingModulations(sourceModuleId).map((item) => Number(item.sourceVoiceIndex)));
    for (let i = 0; i < 8; i += 1) {
      if (!used.has(i)) {
        return i;
      }
    }
    return -1;
  }

  startModulationDrag({ event, sourceModuleId, updateConnectionId = "" }) {
    event.preventDefault();
    this.modulationDrag = {
      active: true,
      pointerId: event.pointerId,
      sourceModuleId,
      updateConnectionId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
    };
    this.renderModulationOverlay();
  }

  handleModulationPointerMove(event) {
    if (!this.modulationDrag.active) {
      return;
    }
    this.modulationDrag.x = event.clientX;
    this.modulationDrag.y = event.clientY;

    document.querySelectorAll(".control.mod-target-hover").forEach((node) => {
      node.classList.remove("mod-target-hover");
    });
    const slider = event.target?.closest?.(".control.control-slider[data-module-id][data-param-path]");
    if (slider) {
      slider.classList.add("mod-target-hover");
    }

    this.renderModulationOverlay();
  }

  handleModulationPointerUp(event) {
    if (!this.modulationDrag.active) {
      return;
    }

    const drag = { ...this.modulationDrag };
    const targetControl = event.target?.closest?.(".control.control-slider[data-module-id][data-param-path]");

    if (targetControl) {
      const mainCard = targetControl.closest(".module-card[data-main-card='true']");
      if (mainCard) {
        document.querySelectorAll(".control.mod-target-hover").forEach((node) => {
          node.classList.remove("mod-target-hover");
        });
        this.app.setStatus("Main Card parameters cannot be modulated.", "error");
        this.cancelModulationDrag();
        return;
      }
    }

    document.querySelectorAll(".control.mod-target-hover").forEach((node) => {
      node.classList.remove("mod-target-hover");
    });

    if (!targetControl) {
      if (drag.updateConnectionId) {
        this.removeModulationById(drag.updateConnectionId);
        this.app.engine.fullSync(this.app.state);
        this.app.renderAll();
      }
      this.cancelModulationDrag();
      return;
    }

    const targetModuleId = targetControl.dataset.moduleId;
    const targetParamPath = targetControl.dataset.paramPath;
    this.commitModulationTarget({
      sourceModuleId: drag.sourceModuleId,
      targetModuleId,
      targetParamPath,
      updateConnectionId: drag.updateConnectionId,
    });
    this.cancelModulationDrag();
  }

  commitModulationTarget({ sourceModuleId, targetModuleId, targetParamPath, updateConnectionId = "" }) {
    if (!sourceModuleId || !targetModuleId || !targetParamPath || sourceModuleId === targetModuleId) {
      return;
    }

    const targetModuleCard = document.querySelector(`.module-card[data-module-id="${targetModuleId}"][data-main-card='true']`);
    if (targetModuleCard) {
      this.app.setStatus("Main Card parameters cannot be modulated.", "error");
      return;
    }

    const sourceModule = this.app.state.modules.find((item) => item.id === sourceModuleId);
    const targetModule = this.app.state.modules.find((item) => item.id === targetModuleId);
    if (!sourceModule || !targetModule) {
      return;
    }
    if (!this.isModulationSource(sourceModule)) {
      return;
    }

    const existingTarget = this.getModulationByTarget(targetModuleId, targetParamPath);
    if (existingTarget && existingTarget.id !== updateConnectionId) {
      this.app.setStatus("A target parameter can only have one modulation connection.", "error");
      return;
    }

    if (updateConnectionId) {
      const current = this.getModulationById(updateConnectionId);
      if (!current) {
        return;
      }
      current.targetModuleId = targetModuleId;
      current.targetParamPath = targetParamPath;
    } else {
      if (this.getOutgoingModulations(sourceModuleId).length >= 8) {
        this.app.setStatus("Each modulation source can connect up to 8 targets.", "error");
        return;
      }
      const voiceIndex = this.getNextModulationVoiceIndex(sourceModuleId);
      if (voiceIndex < 0) {
        return;
      }
      this.getModulations().push({
        id: `${sourceModuleId}-mod-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        sourceModuleId,
        sourceVoiceIndex: voiceIndex,
        targetModuleId,
        targetParamPath,
        radius: undefined,
      });
    }

    this.app.selectedPresetId = "custom";
    this.app.engine.fullSync(this.app.state);
    this.app.renderAll();
  }

  removeModulationById(connectionId) {
    this.app.state.modulations = this.getModulations().filter((item) => item.id !== connectionId);
    this.app.selectedPresetId = "custom";
  }

  removeOutgoingModulations(sourceModuleId) {
    this.app.state.modulations = this.getModulations().filter((item) => item.sourceModuleId !== sourceModuleId);
    this.app.selectedPresetId = "custom";
  }

  removeModuleModulations(moduleId) {
    this.app.state.modulations = this.getModulations().filter(
      (item) => item.sourceModuleId !== moduleId && item.targetModuleId !== moduleId,
    );
    this.app.selectedPresetId = "custom";
  }

  cancelModulationDrag() {
    this.modulationDrag = {
      active: false,
      pointerId: 0,
      sourceModuleId: "",
      updateConnectionId: "",
      startX: 0,
      startY: 0,
      x: 0,
      y: 0,
    };
    this.renderModulationOverlay();
  }

  getPointInSignalFlowShell(element) {
    const shell = this.app.elements.signalFlowShell;
    if (!shell || !element) {
      return null;
    }
    const shellRect = shell.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left - shellRect.left + rect.width / 2,
      y: rect.top - shellRect.top + rect.height / 2,
    };
  }

  lerpPoint(current, target, damping) {
    current.x += (target.x - current.x) * damping;
    current.y += (target.y - current.y) * damping;
    const dx = Math.abs(target.x - current.x);
    const dy = Math.abs(target.y - current.y);
    const settled = dx < 0.5 && dy < 0.5;
    if (settled) {
      current.x = target.x;
      current.y = target.y;
    }
    return !settled;
  }

  renderModulationOverlay() {
    const shell = this.app.elements.signalFlowShell;
    if (!shell) return;

    if (!this.modulationSvg) {
      this.modulationSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.modulationSvg.classList.add("modulation-cables");
      shell.appendChild(this.modulationSvg);
    }

    const shellRect = shell.getBoundingClientRect();
    const svg = this.modulationSvg;
    svg.setAttribute("width", String(Math.max(1, shellRect.width)));
    svg.setAttribute("height", String(Math.max(1, shellRect.height)));
    svg.innerHTML = "";

    const color = "var(--modulation)";
    const damping = 0.05;
    const activeKeys = new Set();
    let shouldContinue = Boolean(this.modulationDrag.active);

    const createCablePath = (from, to, isGhost = false) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const horizontalDist = Math.abs(to.x - from.x);

      const cx = (from.x + to.x) / 2;

      const sag = 15 + horizontalDist * 0.25;

      const cy = Math.max(from.y, to.y) + sag;

      path.setAttribute("d", `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("opacity", isGhost ? "0.5" : "0.6");

      if (isGhost) path.setAttribute("stroke-dasharray", "6 4");

      svg.appendChild(path);
    };

    const createSocket = (point, interactive = false, meta = null) => {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", String(point.x));
      dot.setAttribute("cy", String(point.y));
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", color);
      dot.setAttribute("opacity", "0.6");

      if (interactive && meta) {
        dot.setAttribute("class", "cable-socket is-interactive");
        dot.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.startModulationDrag({
            event,
            sourceModuleId: meta.sourceModuleId,
            updateConnectionId: meta.connectionId,
          });
        });
      }

      svg.appendChild(dot);
    };

    const renderCable = (route, interactive = true, isGhost = false) => {
      activeKeys.add(route.id);

      const visual = this.cableVisuals.get(route.id) || {
        from: { x: route.from.x, y: route.from.y },
        to: { x: route.to.x, y: route.to.y },
      };

      const movingFrom = this.lerpPoint(visual.from, route.from, damping);
      const movingTo = this.lerpPoint(visual.to, route.to, damping);

      this.cableVisuals.set(route.id, visual);

      if (movingFrom || movingTo) shouldContinue = true;

      createCablePath(visual.from, visual.to, isGhost);

      if (interactive) {
        createSocket(visual.from, false, { sourceModuleId: route.sourceModuleId, connectionId: route.id });
        createSocket(visual.to, false);
      } else {
        createSocket(visual.from, false);
        createSocket(visual.to, false);
      }
    };

    this.getModulations().forEach((connection) => {
      const fromEl = this.app.elements.signalFlow?.querySelector(
        `.module-mod-anchor[data-module-id="${connection.sourceModuleId}"]`,
      );
      const toEl = this.app.elements.signalFlow?.querySelector(
        `.control-readout[data-module-id="${connection.targetModuleId}"][data-param-path="${connection.targetParamPath}"]`,
      );

      const from = this.getPointInSignalFlowShell(fromEl);
      const to = this.getPointInSignalFlowShell(toEl);

      if (from && to) {
        renderCable(
          { id: connection.id, sourceModuleId: connection.sourceModuleId, from, to },
          true,
          false,
        );
      }
    });

    if (this.modulationDrag.active) {
      const fromEl = this.app.elements.signalFlow?.querySelector(
        `.module-mod-anchor[data-module-id="${this.modulationDrag.sourceModuleId}"]`,
      );
      const from = this.getPointInSignalFlowShell(fromEl);

      if (from) {
        renderCable(
          {
            id: "drag",
            from,
            to: { x: this.modulationDrag.x - shellRect.left, y: this.modulationDrag.y - shellRect.top },
          },
          false,
          true,
        );
      }
    }

    this.cableVisuals.forEach((_, key) => {
      if (!activeKeys.has(key)) this.cableVisuals.delete(key);
    });

    if (shouldContinue) {
      this.modulationFrame = requestAnimationFrame(() => this.renderModulationOverlay());
    } else {
      this.modulationFrame = 0;
    }
  }
}
