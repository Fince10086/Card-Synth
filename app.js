/**
 * app.js
 * 主应用类 - ModularSynthApp
 * 
 * 这是整个合成器应用的核心 UI 控制器。
 * 负责：
 * - DOM 元素缓存和事件绑定
 * - 状态管理和渲染调度
 * - 用户交互处理（键盘、MIDI、拖拽）
 * - 模块卡片的创建和管理
 * - 调制连线的可视化
 * - 示波器绘制
 */

/* -------------------------------------------------------------------------- */
/* ModularSynthApp 类                                                         */
/* -------------------------------------------------------------------------- */

class ModularSynthApp {
  constructor() {
    // state 是 UI 与音频引擎共享的唯一数据源
    this.state = createBasePreset();
    this.engine = new AudioEngine();
    this.selectedPresetId = "init";
    this.audioBooted = false;

    // 键盘和指针输入状态
    this.heldComputerKeys = new Map();
    this.heldPointerNotes = new Set();
    this.activeNoteRefs = new Map();

    // 控件绑定映射
    this.controlBindings = new Map();
    this.filterVisualizationBinding = null;

    // 拖拽连线状态
    this.dragPatch = null;
    this.dragHoverTarget = "";
    this.dragHoverSource = "";
    this.cableVisuals = new Map();
    this.patchFrame = 0;
    this.patchScene = null;

    // 性能控制参数
    this.performance = {
      morphA: "init",
      morphB: "fmBell",
      morph: 0,
      brightness: 0.5,
      motion: 0.5,
    };

    // 示波器缩放参数
    this.scopeZoom = {
      horizontal: 1,
      vertical: 1,
    };

    // MIDI 状态
    this.midi = {
      supported: typeof navigator !== "undefined" && "requestMIDIAccess" in navigator,
      access: null,
      inputs: [],
      selectedInputId: "",
      status: "MIDI idle",
      activeNotes: new Map(),
    };

    // 初始化
    this.cacheElements();
    this.bindEvents();

    // 应用初始化时只构建界面与动画循环，不主动启动音频上下文
    this.renderAll();
    this.resizeScopeCanvas();
    this.drawOscilloscope();

    // 监听窗口大小变化
    window.addEventListener("resize", () => {
      this.resizeScopeCanvas();
      this.layoutModuleMasonry();
      this.drawPatchCables();
    });
  }

  /* -------------------------------------------------------------------------- */
  /* DOM 缓存                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 集中缓存常用 DOM 节点，后续渲染时直接复用
   */
  cacheElements() {
    this.elements = {
      statusText: document.getElementById("statusText"),
      statusDot: document.getElementById("statusDot"),
      presetControls: document.getElementById("presetControls"),
      masterControls: document.getElementById("masterControls"),
      sourceRack: document.getElementById("sourceRack"),
      filterRack: document.getElementById("filterRack"),
      envelopeRack: document.getElementById("envelopeRack"),
      lfoRack: document.getElementById("lfoRack"),
      componentRack: document.getElementById("componentRack"),
      effectRack: document.getElementById("effectRack"),
      addModuleCard: document.getElementById("addModuleCard"),
      addModuleDropdown: document.getElementById("addModuleDropdown"),
      keyboard: document.getElementById("virtualKeyboard"),
      oscilloscope: document.getElementById("oscilloscope"),
      presetFileInput: document.getElementById("presetFileInput"),
      transportInfo: document.getElementById("transportInfo"),
      patchCables: document.getElementById("patchCables"),
      signalFlow: document.querySelector(".signal-flow"),
      scopeZoomInH: document.getElementById("scopeZoomInH"),
      scopeZoomOutH: document.getElementById("scopeZoomOutH"),
      scopeZoomInV: document.getElementById("scopeZoomInV"),
      scopeZoomOutV: document.getElementById("scopeZoomOutV"),
      scopeHLabel: document.getElementById("scopeHLabel"),
      scopeVLabel: document.getElementById("scopeVLabel"),
    };
    this.scopeContext = this.elements.oscilloscope?.getContext("2d") || null;
  }

  /* -------------------------------------------------------------------------- */
  /* 事件绑定                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 绑定所有事件监听器
   */
  bindEvents() {
    // 所有可能的首次用户手势都尝试唤醒音频，兼容浏览器自动播放限制
    const wakeAudio = () => {
      this.ensureAudioStarted();
    };

    document.addEventListener("pointerdown", wakeAudio, { passive: true });
    document.addEventListener("keydown", wakeAudio);
    document.addEventListener("pointermove", (event) => this.onPatchDragMove(event));
    document.addEventListener("pointerup", (event) => this.onPatchDragEnd(event));
    document.addEventListener("pointercancel", (event) => this.onPatchDragEnd(event));

    window.addEventListener("keydown", (event) => this.onKeyDown(event));
    window.addEventListener("keyup", (event) => this.onKeyUp(event));

    this.populateAddModuleDropdown();
    this.elements.addModuleCard?.addEventListener("click", (e) => {
      if (e.target.closest(".add-module-dropdown-item")) {
        return;
      }
      this.toggleAddModuleDropdown();
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".add-module-card")) {
        this.hideAddModuleDropdown();
      }
    });

    // 预设文件导入
    this.elements.presetFileInput?.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      try {
        const text = await file.text();
        // 导入文件后仍然要走 normalize，保证旧格式和缺省字段都能被兼容
        const preset = normalizePreset(JSON.parse(text));
        const previousState = deepClone(this.state);
        this.state = preset;
        this.selectedPresetId = "custom";
        this.resetPerformanceControls();
        this.renderAll(previousState);
        this.engine.fullSync(this.state);
        this.setStatus(`Imported preset from ${file.name}.`, "live");
      } catch (error) {
        this.setStatus(`Import failed: ${error.message}`, "error");
      } finally {
        event.target.value = "";
      }
    });

    // 示波器缩放控制
    this.elements.scopeZoomInH?.addEventListener("click", () => {
      this.scopeZoom.horizontal = Math.min(8, this.scopeZoom.horizontal * 2);
      this.updateScopeZoomLabels();
    });
    this.elements.scopeZoomOutH?.addEventListener("click", () => {
      this.scopeZoom.horizontal = Math.max(0.25, this.scopeZoom.horizontal / 2);
      this.updateScopeZoomLabels();
    });
    this.elements.scopeZoomInV?.addEventListener("click", () => {
      this.scopeZoom.vertical = Math.min(4, this.scopeZoom.vertical * 1.5);
      this.updateScopeZoomLabels();
    });
    this.elements.scopeZoomOutV?.addEventListener("click", () => {
      this.scopeZoom.vertical = Math.max(0.25, this.scopeZoom.vertical / 1.5);
      this.updateScopeZoomLabels();
    });
    this.updateScopeZoomLabels();
  }

  /**
   * 更新示波器缩放标签显示
   */
  updateScopeZoomLabels() {
    if (this.elements.scopeHLabel) {
      this.elements.scopeHLabel.textContent = `${this.scopeZoom.horizontal}x`;
    }
    if (this.elements.scopeVLabel) {
      this.elements.scopeVLabel.textContent = `${this.scopeZoom.vertical.toFixed(1)}x`;
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 音频启动                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 确保音频已启动
   */
  async ensureAudioStarted() {
    if (this.audioBooted) {
      return;
    }

    try {
      await this.engine.start(this.state);
      this.audioBooted = true;
      this.setStatus("LIVE", "live");
    } catch (error) {
      this.setStatus(`AUDIO START FAILED: ${error.message}`, "error");
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 状态更新                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 统一更新顶部状态提示
   * @param {string} message - 状态消息
   * @param {string} tone - 状态色调 (neutral/live/error)
   */
  setStatus(message, tone = "neutral") {
    if (this.elements.statusText) {
      this.elements.statusText.textContent = message;
    }
    if (this.elements.statusDot) {
      this.elements.statusDot.classList.remove("live", "error");
      if (tone === "live") {
        this.elements.statusDot.classList.add("live");
      }
      if (tone === "error") {
        this.elements.statusDot.classList.add("error");
      }
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 模块添加                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 填充 "Add Module" 下拉菜单
   * 会随着核心模块的显隐动态变化
   */
  populateAddModuleDropdown() {
    const dropdown = this.elements.addModuleDropdown;
    if (!dropdown) {
      return;
    }

    dropdown.innerHTML = "";

    const options = getAddableModuleOptions().filter((option) => {
      if (!option.value.startsWith("core:")) {
        return true;
      }
      const key = option.value.split(":")[1];
      return this.state.ui.visibleModules[key] === false;
    });

    const groups = {
      core: { title: "核心模块", items: [] },
      source: { title: "声源", items: [] },
      component: { title: "组件", items: [] },
      effect: { title: "效果器", items: [] },
    };

    options.forEach((option) => {
      const kind = option.value.split(":")[0];
      if (groups[kind]) {
        groups[kind].items.push(option);
      }
    });

    Object.entries(groups).forEach(([kind, group]) => {
      if (group.items.length === 0) {
        return;
      }

      const groupEl = document.createElement("div");
      groupEl.className = "add-module-dropdown-group";

      const titleEl = document.createElement("div");
      titleEl.className = "add-module-dropdown-group-title";
      titleEl.textContent = group.title;
      groupEl.appendChild(titleEl);

      group.items.forEach((option) => {
        const itemEl = document.createElement("div");
        itemEl.className = "add-module-dropdown-item";
        itemEl.dataset.value = option.value;
        itemEl.textContent = option.label;
        itemEl.addEventListener("click", (e) => {
          e.stopPropagation();
          this.handleAddModule(option.value);
          this.hideAddModuleDropdown();
        });
        groupEl.appendChild(itemEl);
      });

      dropdown.appendChild(groupEl);
    });
  }

  /**
   * 切换添加模块下拉菜单的显示状态
   */
  toggleAddModuleDropdown() {
    const dropdown = this.elements.addModuleDropdown;
    const card = this.elements.addModuleCard;
    if (!dropdown || !card) {
      return;
    }

    const isVisible = dropdown.classList.contains("visible");
    if (isVisible) {
      this.hideAddModuleDropdown();
    } else {
      this.positionDropdown(dropdown, card);
      dropdown.classList.add("visible");
      card.classList.add("active");
    }
  }

  /**
   * 计算下拉菜单的位置，防止超出屏幕
   */
  positionDropdown(dropdown, anchor) {
    const rect = anchor.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const dropdownHeight = 300;
    const dropdownWidth = 180;
    const gap = 4;

    dropdown.style.left = "";
    dropdown.style.top = "";
    dropdown.style.right = "";
    dropdown.style.bottom = "";
    dropdown.classList.remove("above");

    let top;
    const spaceBelow = viewportHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;

    if (spaceBelow >= dropdownHeight || spaceBelow >= spaceAbove) {
      top = rect.bottom + gap;
    } else {
      top = rect.top - gap - dropdownHeight;
      dropdown.classList.add("above");
    }

    let left = rect.left;
    if (left + dropdownWidth > viewportWidth) {
      left = viewportWidth - dropdownWidth - 10;
    }
    if (left < 10) {
      left = 10;
    }

    dropdown.style.left = `${left}px`;
    dropdown.style.top = `${top}px`;
    dropdown.style.width = `${Math.max(rect.width, dropdownWidth)}px`;
  }

  /**
   * 隐藏添加模块下拉菜单
   */
  hideAddModuleDropdown() {
    const dropdown = this.elements.addModuleDropdown;
    const card = this.elements.addModuleCard;
    if (dropdown) {
      dropdown.classList.remove("visible");
      dropdown.classList.remove("above");
    }
    if (card) {
      card.classList.remove("active");
    }
  }

  /**
   * 处理添加模块
   * 根据下拉值把模块加回机架，并同步重建音频链
   * @param {string} value - 模块值 (如 "core:filter", "source:Oscillator")
   */
  handleAddModule(value) {
    if (!value) {
      return;
    }

    const [kind, type] = value.split(":");
    if (kind === "core") {
      this.state.ui.visibleModules[type] = true;
      if (type === "filter") {
        this.state.filter.enabled = true;
      } else if (type === "envelope") {
        this.state.envelope.enabled = true;
      } else if (type === "modEnvelope") {
        this.state.modEnvelope.enabled = true;
      } else if (type === "lfo") {
        this.state.lfo.enabled = true;
      }
    } else if (kind === "source") {
      this.state.sources.push(createSourceModule(type));
    } else if (kind === "component") {
      this.state.components.push(createComponentModule(type));
    } else if (kind === "effect") {
      this.state.effects.push(createEffectModule(type));
    } else {
      return;
    }

    this.selectedPresetId = "custom";
    this.renderAll();
    this.engine.fullSync(this.state);
  }

  /* -------------------------------------------------------------------------- */
  /* 渲染入口                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 全量重渲染入口
   * 当前实现选择"状态驱动整段重建 DOM"，简化了复杂交互下的一致性问题
   * @param {Object|null} previousState - 之前的状态（用于动画过渡）
   */
  renderAll(previousState = null) {
    this.sanitizeModulationState();
    this.populateAddModuleDropdown();
    this.controlBindings = new Map();

    const sections = [
      ["global strip", () => this.renderGlobalStrip()],
      ["sources", () => this.renderSourceRack()],
      ["filter", () => this.renderFilterModule()],
      ["envelope", () => this.renderEnvelopeModule()],
      ["lfo", () => this.renderLfoModule()],
      ["components", () => this.renderComponentsRack()],
      ["effects", () => this.renderEffectRack()],
      ["keyboard", () => this.renderKeyboard()],
      ["transport", () => this.updateTransportInfo()],
    ];

    for (const [label, task] of sections) {
      try {
        task();
      } catch (error) {
        console.error(`Render error in ${label}:`, error);
        this.setStatus(`Render error in ${label}: ${error.message}`, "error");
      }
    }

    this.layoutModuleMasonry();
    this.drawPatchCables();

    if (previousState) {
      this.animateControlTransition(previousState, this.state);
    }
  }

  /**
   * 清理调制状态
   * 删除或隐藏模块后，连到失效目标的 modulation route 会在这里被清理
   */
  sanitizeModulationState() {
    const validTargets = new Set(getModulationTargets(this.state).map((target) => target.value));
    const sanitizeList = (routes) =>
      (routes || [])
        .filter((route) => route && validTargets.has(route.target))
        .map((route) => ({ ...route, id: route.id || createId("route") }));

    this.state.modulation.lfoRoutes = sanitizeList(this.state.modulation?.lfoRoutes);
    this.state.modulation.envelopeRoutes = sanitizeList(this.state.modulation?.envelopeRoutes);

    if (!this.state.modulation.lfoRoutes.length) {
      const firstTarget = getModulationTargets(this.state)[0]?.value;
      if (firstTarget) {
        this.state.modulation.lfoRoutes.push(createModRoute(firstTarget, 0.45));
      }
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 布局                                                                       */
  /* -------------------------------------------------------------------------- */

  /**
   * 手工瀑布流布局
   * 把不同高度的卡片按最短列依次摆放，减少留白
   */
  layoutModuleMasonry() {
    const container = this.elements.signalFlow;
    if (!container) {
      return;
    }

    const moduleCards = [...container.querySelectorAll(".module-card")];
    const addCard = container.querySelector(".add-module-card");
    const cards = [...moduleCards];
    if (addCard) {
      cards.push(addCard);
    }

    if (!cards.length) {
      container.style.height = "0px";
      return;
    }

    const gap = 10;
    const containerWidth = Math.max(240, container.clientWidth);
    const minColumnWidth = 246;
    const columnCount = Math.max(1, Math.floor((containerWidth + gap) / (minColumnWidth + gap)));
    const columnWidth = Math.floor((containerWidth - gap * (columnCount - 1)) / columnCount);
    const columnHeights = new Array(columnCount).fill(0);

    moduleCards.forEach((card) => {
      card.style.position = "absolute";
      card.style.width = `${columnWidth}px`;
      const shortestColumn = columnHeights.indexOf(Math.min(...columnHeights));
      const left = shortestColumn * (columnWidth + gap);
      const top = columnHeights[shortestColumn];
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      columnHeights[shortestColumn] += card.offsetHeight + gap;
    });

    if (addCard) {
      addCard.style.position = "absolute";
      addCard.style.width = `${columnWidth}px`;
      const shortestColumn = columnHeights.indexOf(Math.min(...columnHeights));
      const left = shortestColumn * (columnWidth + gap);
      const top = columnHeights[shortestColumn];
      addCard.style.left = `${left}px`;
      addCard.style.top = `${top}px`;
      columnHeights[shortestColumn] += addCard.offsetHeight + gap;
    }

    container.style.height = `${Math.max(...columnHeights) - gap}px`;
  }

  /* -------------------------------------------------------------------------- */
  /* 全局边栏渲染                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 渲染右侧固定边栏
   * 预设、导入导出、MIDI、宏控制和主音量都在这里生成
   */
  renderGlobalStrip() {
    if (!this.elements.presetControls || !this.elements.masterControls) {
      return;
    }
    this.elements.presetControls.innerHTML = "";
    this.elements.masterControls.innerHTML = "";

    // 预设选择器
    const presetCluster = document.createElement("div");
    presetCluster.className = "compact-block column";

    const presetSelect = this.createSelectControl({
      label: "Built-in Preset",
      options: [
        { label: "Init Patch", value: "init" },
        { label: "FM Bell Stack", value: "fmBell" },
        { label: "Cinematic Dust", value: "cinematicDust" },
        { label: "Percussion Lab", value: "percussionLab" },
        { label: "Current Patch", value: "custom" },
      ],
      value: this.selectedPresetId,
      onChange: (value) => {
        if (value === "custom") {
          return;
        }
        this.applyBuiltinPreset(value);
      },
    });

    // 全局操作按钮
    const globalActions = document.createElement("div");
    globalActions.className = "global-cluster";

    const importButton = document.createElement("button");
    importButton.type = "button";
    importButton.className = "pill-button";
    importButton.textContent = "Import JSON";
    importButton.addEventListener("click", () => this.elements.presetFileInput.click());

    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "pill-button";
    exportButton.textContent = "Export JSON";
    exportButton.addEventListener("click", () => {
      const filename = `${(this.state.name || "tone-preset").toLowerCase().replace(/\s+/g, "-")}.json`;
      downloadJson(filename, this.state);
      this.setStatus(`Exported ${filename}.`, this.audioBooted ? "live" : "neutral");
    });

    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "pill-button";
    resetButton.textContent = "Init Rack";
    resetButton.addEventListener("click", () => this.applyBuiltinPreset("init"));

    const randomButton = document.createElement("button");
    randomButton.type = "button";
    randomButton.className = "pill-button";
    randomButton.textContent = "Randomize";
    randomButton.addEventListener("click", () => this.randomizeCurrentPatch());

    const midiButton = document.createElement("button");
    midiButton.type = "button";
    midiButton.className = "pill-button";
    midiButton.textContent = this.midi.access ? "Refresh MIDI" : "Enable MIDI";
    midiButton.addEventListener("click", () => this.requestMidiAccess());

    globalActions.append(importButton, exportButton, resetButton, randomButton, midiButton);

    // MIDI 状态显示
    const midiCluster = document.createElement("div");
    midiCluster.className = "global-subgrid";
    const midiStatus = document.createElement("div");
    midiStatus.className = "meter-chip";
    midiStatus.textContent = this.midi.supported ? this.midi.status : "Web MIDI unsupported";
    midiCluster.append(midiStatus);
    if (this.midi.inputs.length) {
      midiCluster.append(
        this.createSelectControl({
          label: "MIDI Input",
          options: this.midi.inputs.map((input) => ({ label: input.name || input.id, value: input.id })),
          value: this.midi.selectedInputId,
          onChange: (value) => this.selectMidiInput(value),
        }),
      );
    }

    presetCluster.append(presetSelect, globalActions, midiCluster);
    this.elements.presetControls.append(presetCluster);

    // Morph 控制
    const morphCluster = document.createElement("div");
    morphCluster.className = "compact-block";
    morphCluster.append(
      this.createSelectControl({
        label: "Morph A",
        options: Object.keys(BUILTIN_PRESET_TEMPLATES).map((id) => ({
          label: BUILTIN_PRESET_TEMPLATES[id].name,
          value: id,
        })),
        value: this.performance.morphA,
        onChange: (value) => {
          this.performance.morphA = value;
          this.applyMorphState();
        },
      }),
      this.createSelectControl({
        label: "Morph B",
        options: Object.keys(BUILTIN_PRESET_TEMPLATES).map((id) => ({
          label: BUILTIN_PRESET_TEMPLATES[id].name,
          value: id,
        })),
        value: this.performance.morphB,
        onChange: (value) => {
          this.performance.morphB = value;
          this.applyMorphState();
        },
      }),
      this.createRangeControl({
        label: "Morph",
        variant: "slider",
        accent: "component",
        min: 0,
        max: 1,
        step: 0.01,
        value: this.performance.morph,
        eventName: "change",
        formatter: formatPercent,
        onInput: (value) => {
          this.performance.morph = value;
          this.applyMorphState();
        },
      }),
    );

    // 宏控制
    const macroCluster = document.createElement("div");
    macroCluster.className = "compact-block";
    macroCluster.append(
      this.createRangeControl({
        label: "Brightness",
        accent: "filter",
        min: 0,
        max: 1,
        step: 0.01,
        value: this.performance.brightness,
        formatter: formatPercent,
        onInput: (value) => this.applyBrightnessMacro(value),
      }),
      this.createRangeControl({
        label: "Motion",
        accent: "lfo",
        min: 0,
        max: 1,
        step: 0.01,
        value: this.performance.motion,
        formatter: formatPercent,
        onInput: (value) => this.applyMotionMacro(value),
      }),
      this.createRangeControl({
        label: "Cable Tension",
        accent: "component",
        min: 0.2,
        max: 1,
        step: 0.01,
        value: this.state.ui.cableTension ?? 0.78,
        formatter: formatPercent,
        onInput: (value) => {
          this.state.ui.cableTension = value;
          this.drawPatchCables();
        },
      }),
    );

    this.elements.presetControls.append(morphCluster, macroCluster);

    // 主音量推子
    const masterFader = this.createRangeControl({
      label: "Master",
      variant: "fader",
      accent: "lfo",
      min: -36,
      max: 6,
      step: 0.1,
      value: this.state.global.volume,
      path: "global.volume",
      formatter: formatDb,
      onInput: (value) => {
        this.state.global.volume = value;
        this.selectedPresetId = "custom";
        this.engine.updateGlobal(this.state.global);
        this.updateTransportInfo();
      },
    });

    this.elements.masterControls.append(masterFader);
  }

  /* -------------------------------------------------------------------------- */
  /* 声源机架渲染                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 渲染声源机架
   * Source rack 负责把所有声源实例渲染成模块卡片
   */
  renderSourceRack() {
    if (!this.elements.sourceRack) {
      return;
    }
    this.elements.sourceRack.innerHTML = "";

    this.state.sources.forEach((module, index) => {
      const definition = SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator;
      const card = this.createModuleCard({
        accent: definition.accent,
        kicker: definition.tag,
        title: module.type,
        titleOptions: Object.keys(SOURCE_LIBRARY).map((type) => ({ label: type, value: type })),
        onTitleChange: (value) => {
          const replacement = createSourceModule(value);
          replacement.id = module.id;
          replacement.volume = module.volume;
          replacement.pan = module.pan;
          replacement.enabled = module.enabled;
          this.state.sources[index] = replacement;
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        moduleRef: module.id,
        enabled: module.enabled,
        onToggleEnabled: () => {
          module.enabled = !module.enabled;
          this.selectedPresetId = "custom";
          this.engine.updateSource(module);
          this.renderAll();
        },
        onRemove: () => {
          this.state.sources.splice(index, 1);
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        removable: true,
      });

      const controls = document.createElement("div");
      controls.className = "module-grid";
      controls.append(
        this.createRangeControl({
          label: "Level",
          accent: definition.accent,
          min: -36,
          max: 6,
          step: 0.1,
          value: module.volume,
          path: `sources.${index}.volume`,
          patchPoint: { accent: definition.accent, targetId: `source:${module.id}:volume` },
          formatter: formatDb,
          onInput: (value) => {
            module.volume = value;
            this.selectedPresetId = "custom";
            this.engine.updateSource(module);
          },
        }),
        this.createRangeControl({
          label: "Pan",
          accent: definition.accent,
          min: -1,
          max: 1,
          step: 0.01,
          value: module.pan,
          path: `sources.${index}.pan`,
          patchPoint: { accent: definition.accent, targetId: `source:${module.id}:pan` },
          formatter: (value) => `${value > 0 ? "R" : value < 0 ? "L" : "C"} ${Math.round(Math.abs(value) * 100)}`,
          onInput: (value) => {
            module.pan = value;
            this.selectedPresetId = "custom";
            this.engine.updateSource(module);
          },
        }),
      );

      // 样本导入控件
      this.getSourceSampleSlots(module).forEach((slot) => {
        controls.append(
          this.createAudioImportControl({
            label: slot.label,
            value: getByPath(module, slot.namePath) || slot.fallbackName,
            onSelect: async (file) => {
              await this.importSourceSample(module, index, slot, file);
            },
          }),
        );
      });

      // 模块参数控件
      definition.controls.forEach((control) => {
        let patchTarget = null;
        if (control.kind === "range") {
          patchTarget = `source:${module.id}:${control.path}`;
        }
        controls.append(
          this.renderModuleControl(
            module,
            control,
            () => this.engine.updateSource(module),
            definition.accent,
            `sources.${index}.${control.path}`,
            patchTarget,
          ),
        );
      });

      card.append(controls);
      this.elements.sourceRack.append(card);
    });
  }

  /**
   * 获取声源样本槽位
   * @param {Object} module - 声源模块
   * @returns {Array} - 样本槽位列表
   */
  getSourceSampleSlots(module) {
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

  /**
   * 导入声源样本
   * @param {Object} module - 声源模块
   * @param {number} index - 模块索引
   * @param {Object} slot - 样本槽位
   * @param {File} file - 文件
   */
  async importSourceSample(module, index, slot, file) {
    const dataUrl = await readFileAsDataUrl(file);
    setByPath(module, slot.path, dataUrl);
    setByPath(module, slot.namePath, file.name);
    this.state.sources[index] = normalizeSourceModule(module);
    this.selectedPresetId = "custom";
    this.renderAll();
    this.engine.fullSync(this.state);
    this.setStatus(`Loaded ${file.name} into ${module.type}.`, this.audioBooted ? "live" : "neutral");
  }

  /**
   * 创建音频导入控件
   * @param {Object} options - 选项
   * @returns {HTMLElement} - 控件元素
   */
  createAudioImportControl({ label, value, onSelect }) {
    const wrapper = document.createElement("div");
    wrapper.className = "control control-file";

    const controlLabel = document.createElement("div");
    controlLabel.className = "control-label";
    const strong = document.createElement("strong");
    strong.textContent = label;
    controlLabel.append(strong);

    const row = document.createElement("div");
    row.className = "file-control-row";

    const fileName = document.createElement("div");
    fileName.className = "file-chip";
    fileName.textContent = value || "Choose audio file";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "action-button file-action";
    trigger.textContent = "Import";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.className = "file-input";

    trigger.addEventListener("click", () => input.click());
    input.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      input.value = "";
      if (!file) {
        return;
      }
      try {
        await onSelect(file);
      } catch (error) {
        this.setStatus(error?.message || "Unable to import the selected audio file.", "error");
      }
    });

    row.append(fileName, trigger, input);
    wrapper.append(controlLabel, row);
    return wrapper;
  }

  /* -------------------------------------------------------------------------- */
  /* 滤波器模块渲染                                                             */
  /* -------------------------------------------------------------------------- */

  /**
   * 渲染滤波器模块
   * Filter 属于核心模块，因此支持"隐藏模块"和"仅关闭音频处理"两层状态
   */
  renderFilterModule() {
    if (!this.elements.filterRack) {
      return;
    }
    this.elements.filterRack.innerHTML = "";
    this.filterVisualizationBinding = null;

    if (this.state.ui.visibleModules.filter === false) {
      return;
    }

    const card = this.createModuleCard({
      accent: "filter",
      kicker: "Component",
      title: "Filter",
      moduleRef: "filter-core",
      enabled: this.state.filter.enabled !== false,
      onToggleEnabled: () => {
        this.state.filter.enabled = this.state.filter.enabled === false;
        this.selectedPresetId = "custom";
        this.engine.updateFilter(this.state.filter);
        this.renderAll();
      },
      removable: this.state.ui.visibleModules.filter,
      onRemove: () => {
        this.state.ui.visibleModules.filter = false;
        this.state.filter.enabled = false;
        this.selectedPresetId = "custom";
        this.renderAll();
        this.engine.fullSync(this.state);
      },
    });

    const filterVisualization = this.createFilterVisualization(this.state.filter);
    // 保存 update 引用，方便宏控制直接刷新可视化而不重建整个模块
    this.filterVisualizationBinding = filterVisualization.update;

    const headGrid = document.createElement("div");
    headGrid.className = "module-grid compact";
    headGrid.append(
      this.createSelectControl({
        label: "Filter Type",
        options: FILTER_TYPES,
        value: this.state.filter.type,
        onChange: (value) => {
          this.state.filter.type = value;
          this.selectedPresetId = "custom";
          filterVisualization.update(this.state.filter);
          this.engine.updateFilter(this.state.filter);
        },
      }),
      this.createSelectControl({
        label: "Slope",
        options: [
          { label: "-12 dB", value: "-12" },
          { label: "-24 dB", value: "-24" },
          { label: "-48 dB", value: "-48" },
          { label: "-96 dB", value: "-96" },
        ],
        value: String(this.state.filter.rolloff),
        onChange: (value) => {
          this.state.filter.rolloff = Number(value);
          this.selectedPresetId = "custom";
          filterVisualization.update(this.state.filter);
          this.engine.updateFilter(this.state.filter);
        },
      }),
    );

    const controls = document.createElement("div");
    controls.className = "module-grid";
    card.append(filterVisualization.element);
    controls.append(
      this.createRangeControl({
        label: "Cutoff",
        accent: "filter",
        min: 40,
        max: 12000,
        step: 1,
        value: this.state.filter.frequency,
        path: "filter.frequency",
        patchPoint: { accent: "filter", targetId: "filter.frequency" },
        formatter: formatFrequency,
        onInput: (value) => {
          this.state.filter.frequency = value;
          this.selectedPresetId = "custom";
          filterVisualization.update(this.state.filter);
          this.engine.updateFilter(this.state.filter);
        },
      }),
      this.createRangeControl({
        label: "Q",
        accent: "filter",
        min: 0.001,
        max: 20,
        step: 0.001,
        value: this.state.filter.Q,
        path: "filter.Q",
        patchPoint: { accent: "filter", targetId: "filter.Q" },
        formatter: formatPlain,
        onInput: (value) => {
          this.state.filter.Q = value;
          this.selectedPresetId = "custom";
          filterVisualization.update(this.state.filter);
          this.engine.updateFilter(this.state.filter);
        },
      }),
    );

    card.append(headGrid, controls);
    this.elements.filterRack.append(card);
  }

  /* -------------------------------------------------------------------------- */
  /* 包络模块渲染                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 渲染包络模块
   * Envelope 区同时承载音量包络和调制包络两个模块
   */
  renderEnvelopeModule() {
    if (!this.elements.envelopeRack) {
      return;
    }
    this.elements.envelopeRack.innerHTML = "";

    // 音量包络
    if (this.state.ui.visibleModules.envelope !== false) {
      const ampCard = this.createModuleCard({
        accent: "env",
        kicker: "Component",
        title: "Amp Envelope",
        moduleRef: "amp-envelope",
        enabled: this.state.envelope.enabled !== false,
        onToggleEnabled: () => {
          this.state.envelope.enabled = this.state.envelope.enabled === false;
          this.selectedPresetId = "custom";
          this.engine.updateEnvelope(this.state.envelope);
          this.renderAll();
        },
        removable: this.state.ui.visibleModules.envelope,
        onRemove: () => {
          this.state.ui.visibleModules.envelope = false;
          this.state.envelope.enabled = false;
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
      });

      const controls = document.createElement("div");
      controls.className = "module-grid";
      const ampEnvVisualization = this.createEnvelopeVisualization(this.state.envelope, "env");
      ampCard.append(ampEnvVisualization.element);

      ["attack", "decay", "sustain", "release"].forEach((key) => {
        controls.append(
          this.createRangeControl({
            label: key.charAt(0).toUpperCase() + key.slice(1),
            accent: "env",
            min: key === "sustain" ? 0 : 0.001,
            max: key === "sustain" ? 1 : 4,
            step: key === "sustain" ? 0.01 : 0.001,
            value: this.state.envelope[key],
            path: `envelope.${key}`,
            formatter: key === "sustain" ? formatPercent : formatSeconds,
            onInput: (value) => {
              this.state.envelope[key] = value;
              this.selectedPresetId = "custom";
              ampEnvVisualization.update(this.state.envelope);
              this.engine.updateEnvelope(this.state.envelope);
            },
          }),
        );
      });

      ampCard.append(controls);
      this.elements.envelopeRack.append(ampCard);
    }

    // 调制包络
    if (this.state.ui.visibleModules.modEnvelope === false) {
      return;
    }

    const modCard = this.createModuleCard({
      accent: "env",
      kicker: "Modulation",
      title: "Mod Envelope",
      moduleRef: "mod-envelope",
      headerPatchPoint: { accent: "env", sourceKey: "envelopeRoutes" },
      enabled: this.state.modEnvelope.enabled,
      onToggleEnabled: () => {
        this.state.modEnvelope.enabled = !this.state.modEnvelope.enabled;
        this.selectedPresetId = "custom";
        this.engine.updateModEnvelope(this.state.modEnvelope);
        this.renderAll();
      },
      removable: this.state.ui.visibleModules.modEnvelope,
      onRemove: () => {
        this.state.ui.visibleModules.modEnvelope = false;
        this.state.modEnvelope.enabled = false;
        this.selectedPresetId = "custom";
        this.renderAll();
        this.engine.fullSync(this.state);
      },
    });

    const modControls = document.createElement("div");
    modControls.className = "module-grid";
    const modEnvVisualization = this.createEnvelopeVisualization(this.state.modEnvelope, "env");
    modCard.append(modEnvVisualization.element);

    ["attack", "decay", "sustain", "release"].forEach((key) => {
      modControls.append(
        this.createRangeControl({
          label: key.charAt(0).toUpperCase() + key.slice(1),
          accent: "env",
          min: key === "sustain" ? 0 : 0.001,
          max: key === "sustain" ? 1 : 4,
          step: key === "sustain" ? 0.01 : 0.001,
          value: this.state.modEnvelope[key],
          formatter: key === "sustain" ? formatPercent : formatSeconds,
          onInput: (value) => {
            this.state.modEnvelope[key] = value;
            this.selectedPresetId = "custom";
            modEnvVisualization.update(this.state.modEnvelope);
            this.engine.updateModEnvelope(this.state.modEnvelope);
          },
        }),
      );
    });

    modCard.append(modControls, this.renderRouteRack("envelopeRoutes", "env"));
    this.elements.envelopeRack.append(modCard);
  }

  /* -------------------------------------------------------------------------- */
  /* LFO 模块渲染                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 渲染 LFO 模块
   * LFO 模块既可以作为调制源，也可以被整体移除出机架
   */
  renderLfoModule() {
    if (!this.elements.lfoRack) {
      return;
    }
    this.elements.lfoRack.innerHTML = "";

    if (this.state.ui.visibleModules.lfo === false) {
      return;
    }

    const card = this.createModuleCard({
      accent: "lfo",
      kicker: "Modulation",
      title: "LFO",
      moduleRef: "lfo-core",
      headerPatchPoint: { accent: "lfo", sourceKey: "lfoRoutes" },
      enabled: this.state.lfo.enabled,
      onToggleEnabled: () => {
        this.state.lfo.enabled = !this.state.lfo.enabled;
        this.selectedPresetId = "custom";
        this.engine.updateLfo(this.state.lfo);
        this.renderAll();
      },
      removable: this.state.ui.visibleModules.lfo,
      onRemove: () => {
        this.state.ui.visibleModules.lfo = false;
        this.state.lfo.enabled = false;
        this.selectedPresetId = "custom";
        this.renderAll();
        this.engine.fullSync(this.state);
      },
    });

    const headGrid = document.createElement("div");
    headGrid.className = "module-grid compact";
    headGrid.append(
      this.createSelectControl({
        label: "Wave",
        options: SHARED_WAVE_OPTIONS,
        value: this.state.lfo.type,
        onChange: (value) => {
          this.state.lfo.type = value;
          this.selectedPresetId = "custom";
          this.engine.updateLfo(this.state.lfo);
        },
      }),
    );

    const controls = document.createElement("div");
    controls.className = "module-grid";
    controls.append(
      this.createRangeControl({
        label: "Rate",
        accent: "lfo",
        min: 0.05,
        max: 18,
        step: 0.01,
        value: this.state.lfo.frequency,
        path: "lfo.frequency",
        formatter: formatHertz,
        onInput: (value) => {
          this.state.lfo.frequency = value;
          this.selectedPresetId = "custom";
          this.engine.updateLfo(this.state.lfo);
        },
      }),
      this.createRangeControl({
        label: "Depth",
        accent: "lfo",
        min: 0,
        max: 1,
        step: 0.01,
        value: this.state.lfo.amount,
        path: "lfo.amount",
        formatter: formatPercent,
        onInput: (value) => {
          this.state.lfo.amount = value;
          this.selectedPresetId = "custom";
          this.engine.updateLfo(this.state.lfo);
        },
      }),
      this.createRangeControl({
        label: "Phase",
        accent: "lfo",
        min: 0,
        max: 360,
        step: 1,
        value: this.state.lfo.phase || 0,
        formatter: (value) => `${Math.round(value)}deg`,
        onInput: (value) => {
          this.state.lfo.phase = value;
          this.selectedPresetId = "custom";
          this.engine.updateLfo(this.state.lfo);
        },
      }),
    );

    card.append(headGrid, controls, this.renderRouteRack("lfoRoutes", "lfo"));
    this.elements.lfoRack.append(card);
  }

  /* -------------------------------------------------------------------------- */
  /* 组件机架渲染                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 渲染组件机架
   * Component rack 用于串接压缩、增益、EQ 等工具型节点
   */
  renderComponentsRack() {
    if (!this.elements.componentRack) {
      return;
    }
    this.elements.componentRack.innerHTML = "";

    this.state.components.forEach((module, index) => {
      const definition = COMPONENT_LIBRARY[module.type] || COMPONENT_LIBRARY.Compressor;
      const card = this.createModuleCard({
        accent: definition.accent,
        kicker: definition.tag,
        title: module.type,
        titleOptions: Object.keys(COMPONENT_LIBRARY).map((type) => ({ label: type, value: type })),
        onTitleChange: (value) => {
          const replacement = createComponentModule(value);
          replacement.id = module.id;
          replacement.enabled = module.enabled;
          this.state.components[index] = replacement;
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        moduleRef: module.id,
        enabled: module.enabled,
        onToggleEnabled: () => {
          module.enabled = !module.enabled;
          this.selectedPresetId = "custom";
          this.state.components[index] = module;
          this.engine.fullSync(this.state);
          this.renderAll();
        },
        onRemove: () => {
          this.state.components.splice(index, 1);
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        removable: true,
      });

      const controls = document.createElement("div");
      controls.className = "module-grid";

      definition.controls.forEach((control) => {
        let patchTarget = null;
        if (control.kind === "range") {
          patchTarget = `component:${module.id}:${control.path.replace("options.", "")}`;
        }
        controls.append(
          this.renderModuleControl(
            module,
            control,
            () => this.engine.updateComponent(module),
            definition.accent,
            `components.${index}.${control.path}`,
            patchTarget,
          ),
        );
      });

      card.append(controls);
      this.elements.componentRack.append(card);
    });
  }

  /* -------------------------------------------------------------------------- */
  /* 效果器机架渲染                                                             */
  /* -------------------------------------------------------------------------- */

  /**
   * 渲染效果器机架
   * Effect rack 用于串接带 wet/feedback 等空间与调制效果
   */
  renderEffectRack() {
    if (!this.elements.effectRack) {
      return;
    }
    this.elements.effectRack.innerHTML = "";

    this.state.effects.forEach((module, index) => {
      const definition = EFFECT_LIBRARY[module.type] || EFFECT_LIBRARY.Chorus;
      const card = this.createModuleCard({
        accent: definition.accent,
        kicker: definition.tag,
        title: module.type,
        titleOptions: Object.keys(EFFECT_LIBRARY).map((type) => ({ label: type, value: type })),
        onTitleChange: (value) => {
          const replacement = createEffectModule(value);
          replacement.id = module.id;
          replacement.enabled = module.enabled;
          this.state.effects[index] = replacement;
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        moduleRef: module.id,
        enabled: module.enabled,
        onToggleEnabled: () => {
          module.enabled = !module.enabled;
          this.selectedPresetId = "custom";
          this.state.effects[index] = module;
          this.engine.fullSync(this.state);
          this.renderAll();
        },
        onRemove: () => {
          this.state.effects.splice(index, 1);
          this.selectedPresetId = "custom";
          this.renderAll();
          this.engine.fullSync(this.state);
        },
        removable: true,
      });

      const controls = document.createElement("div");
      controls.className = "module-grid";

      definition.controls.forEach((control) => {
        let patchTarget = null;
        if (control.kind === "range") {
          patchTarget = `effect:${module.id}:${control.path.replace("options.", "")}`;
        }
        controls.append(
          this.renderModuleControl(
            module,
            control,
            () => {
              this.engine.updateEffect(module);
            },
            definition.accent,
            `effects.${index}.${control.path}`,
            patchTarget,
          ),
        );
      });

      card.append(controls);
      this.elements.effectRack.append(card);
    });
  }

  /* -------------------------------------------------------------------------- */
  /* 虚拟键盘渲染                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 渲染虚拟键盘
   * 键盘固定在顶部工具栏中
   */
  renderKeyboard() {
    if (!this.elements.keyboard) {
      return;
    }
    this.elements.keyboard.innerHTML = "";

    const whiteKeyWidth = 38;
    const blackKeyWidth = 28;
    const keyboardPadding = 0;

    this.elements.keyboard.style.setProperty("--white-key-width", `${whiteKeyWidth}px`);
    this.elements.keyboard.style.setProperty("--black-key-width", `${blackKeyWidth}px`);

    KEYBOARD_LAYOUT.forEach((entry) => {
      const note = noteFromOffset(this.state.global.octave, entry.offset);
      const key = document.createElement("button");
      key.type = "button";
      key.className = entry.black ? "black-key" : "white-key";
      key.dataset.note = note;
      key.dataset.key = entry.key;

      const left = entry.black
        ? keyboardPadding + (entry.whiteIndex + 1) * whiteKeyWidth - blackKeyWidth / 2
        : keyboardPadding + entry.whiteIndex * whiteKeyWidth;
      key.style.left = `${left}px`;

      const cap = document.createElement("div");
      cap.className = "key-cap";
      const bind = document.createElement("span");
      bind.className = "key-bind";
      bind.textContent = entry.key.toUpperCase();
      const noteLabel = document.createElement("span");
      noteLabel.className = "key-note";
      noteLabel.textContent = note;
      cap.append(bind, noteLabel);
      key.append(cap);

      key.addEventListener("pointerdown", async () => {
        await this.ensureAudioStarted();
        this.pressNote(note);
        this.heldPointerNotes.add(note);
        key.classList.add("active");
      });

      key.addEventListener("pointerup", () => {
        this.releaseNote(note);
        this.heldPointerNotes.delete(note);
        key.classList.remove("active");
      });

      key.addEventListener("pointerleave", () => {
        if (this.heldPointerNotes.has(note)) {
          this.releaseNote(note);
          this.heldPointerNotes.delete(note);
          key.classList.remove("active");
        }
      });

      if (this.heldComputerKeys.has(entry.key)) {
        key.classList.add("active");
      }

      this.elements.keyboard.append(key);
    });
  }

  /* -------------------------------------------------------------------------- */
  /* 模块控件渲染                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 渲染模块控件
   * 按定义表把模块参数翻译为 select / range 控件
   * @param {Object} module - 模块
   * @param {Object} control - 控件定义
   * @param {Function} onCommit - 提交回调
   * @param {string} accent - 强调色
   * @param {string|null} bindingPath - 绑定路径
   * @param {string|null} patchTarget - 调制目标
   * @returns {HTMLElement} - 控件元素
   */
  renderModuleControl(module, control, onCommit, accent, bindingPath = null, patchTarget = null) {
    const path = control.path;
    const value = getByPath(module, path);

    if (control.kind === "select") {
      return this.createSelectControl({
        label: control.label,
        options: control.options,
        value,
        accent,
        onChange: (nextValue) => {
          setByPath(module, path, nextValue);
          this.selectedPresetId = "custom";
          onCommit();
        },
      });
    }

    if (control.kind === "toggle") {
      return this.createToggleControl({
        label: control.label,
        accent,
        value: Boolean(value),
        onToggle: (nextValue) => {
          setByPath(module, path, nextValue);
          this.selectedPresetId = "custom";
          onCommit();
        },
      });
    }

    return this.createRangeControl({
      label: control.label,
      accent,
      min: control.min,
      max: control.max,
      step: control.step,
      value,
      path: bindingPath,
      patchPoint: patchTarget ? { accent, targetId: patchTarget } : null,
      formatter: control.formatter || formatPlain,
      onInput: (nextValue) => {
        setByPath(module, path, nextValue);
        this.selectedPresetId = "custom";
        onCommit();
      },
    });
  }

  /* -------------------------------------------------------------------------- */
  /* 路由机架渲染                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 渲染路由机架
   * 渲染 LFO / Mod Envelope 的路由列表，同时提供拖线句柄
   * @param {string} routeKey - 路由键
   * @param {string} accent - 强调色
   * @returns {HTMLElement} - 路由机架元素
   */
  renderRouteRack(routeKey, accent) {
    const wrapper = document.createElement("div");
    wrapper.className = "route-rack";

    const routeOptions = getModulationTargets(this.state).map((target) => ({
      label: target.label,
      value: target.value,
    }));
    const routes = this.state.modulation[routeKey];

    routes.forEach((route, index) => {
      const row = document.createElement("div");
      row.className = "route-row";

      const stack = document.createElement("div");
      stack.className = "module-grid compact route-grid";
      stack.append(
        this.createSelectControl({
          label: `Route ${index + 1}`,
          options: routeOptions,
          value: route.target,
          onChange: (value) => {
            route.target = value;
            this.selectedPresetId = "custom";
            this.engine.updateModulation(this.state.modulation);
            this.drawPatchCables();
          },
        }),
        this.createRangeControl({
          label: "Amount",
          accent,
          variant: "slider",
          min: -1,
          max: 1,
          step: 0.01,
          value: route.amount,
          formatter: (value) => `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`,
          onInput: (value) => {
            route.amount = value;
            this.selectedPresetId = "custom";
            this.engine.updateModulation(this.state.modulation);
          },
        }),
      );

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "route-remove";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        this.state.modulation[routeKey].splice(index, 1);
        this.selectedPresetId = "custom";
        this.renderAll();
        this.engine.updateModulation(this.state.modulation);
      });

      row.append(stack, removeButton);
      wrapper.append(row);
    });

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "route-add";
    addButton.textContent = "Add Route";
    addButton.addEventListener("click", () => {
      const firstTarget = routeOptions[0]?.value;
      if (!firstTarget) {
        return;
      }
      this.state.modulation[routeKey].push(createModRoute(firstTarget, 0.35));
      this.selectedPresetId = "custom";
      this.renderAll();
      this.engine.updateModulation(this.state.modulation);
      this.drawPatchCables();
    });

    wrapper.append(addButton);
    return wrapper;
  }

  /* -------------------------------------------------------------------------- */
  /* 模块卡片创建                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 创建模块卡片
   * 所有模块卡片共享同一个骨架结构，避免不同模块出现不同的头部交互模式
   * @param {Object} options - 选项
   * @returns {HTMLElement} - 模块卡片元素
   */
  createModuleCard({
    accent,
    kicker,
    title,
    titleOptions = null,
    onTitleChange = null,
    onRemove = null,
    removable = false,
    moduleRef = null,
    enabled = true,
    onToggleEnabled = null,
    headerPatchPoint = null,
  }) {
    const card = document.createElement("section");
    card.className = "module-card";
    card.dataset.accent = accent;
    if (moduleRef) {
      card.dataset.moduleRef = moduleRef;
    }

    const head = document.createElement("div");
    head.className = "module-head";

    const titleBlock = document.createElement("div");
    titleBlock.className = "module-title-row";

    if (titleOptions && onTitleChange) {
      titleBlock.append(this.createTitleSelect({ accent, title, options: titleOptions, value: title, onChange: onTitleChange }));
    } else {
      const titleNode = document.createElement("h3");
      titleNode.textContent = title;
      titleBlock.append(titleNode);
    }

    if (headerPatchPoint) {
      titleBlock.append(this.createPatchPoint(headerPatchPoint));
    }

    const actions = document.createElement("div");
    actions.className = "module-actions";

    if (onToggleEnabled) {
      actions.append(this.createModuleSwitch({ enabled, accent, onToggle: onToggleEnabled }));
    }

    if (removable && onRemove) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "module-remove";
      removeButton.textContent = "×";
      removeButton.addEventListener("click", onRemove);
      actions.append(removeButton);
    }

    head.append(titleBlock, actions);
    card.append(head);

    return card;
  }

  /**
   * 创建标题选择器
   * 模块标题右侧的小箭头实际上是一个轻量下拉，不额外占一整行表单空间
   * @param {Object} options - 选项
   * @returns {HTMLElement} - 标题选择器元素
   */
  createTitleSelect({ accent, title, value, options, onChange }) {
    const wrap = document.createElement("label");
    wrap.className = "module-title-select";
    wrap.style.setProperty("--accent", `var(--${accent})`);

    const select = document.createElement("select");
    select.className = "module-title-input";
    options.forEach((option) => {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    });
    select.value = value;
    select.setAttribute("aria-label", title);
    select.addEventListener("change", (event) => onChange(event.target.value));
    wrap.append(select);
    return wrap;
  }

  /**
   * 创建模块开关
   * @param {Object} options - 选项
   * @returns {HTMLElement} - 开关元素
   */
  createModuleSwitch({ enabled, accent, onToggle }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `module-switch ${enabled ? "is-on" : ""}`;
    button.style.setProperty("--accent", `var(--${accent})`);
    button.setAttribute("aria-label", enabled ? "Disable module" : "Enable module");
    button.addEventListener("click", onToggle);
    return button;
  }

  /* -------------------------------------------------------------------------- */
  /* 调制点创建                                                                 */
  /* -------------------------------------------------------------------------- */

  /**
   * 判断目标是否已被调制
   * 某个参数是否已被任何调制源连接，用于参数标题后 patch 点的高亮
   * @param {string} targetValue - 目标值
   * @returns {boolean} - 是否已被调制
   */
  isTargetPatched(targetValue) {
    return [...(this.state.modulation?.lfoRoutes || []), ...(this.state.modulation?.envelopeRoutes || [])].some(
      (route) => route.enabled !== false && route.target === targetValue,
    );
  }

  /**
   * 创建调制点
   * patch point 可以表示参数输入端，也可以表示调制源输出端
   * @param {Object} options - 选项
   * @returns {HTMLElement} - 调制点元素
   */
  createPatchPoint({ accent, targetId = null, sourceKey = null }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "patch-point";
    button.style.setProperty("--accent", `var(--${accent})`);

    if (targetId) {
      button.dataset.modTarget = targetId;
      if (this.dragHoverTarget === targetId) {
        button.classList.add("is-hover");
      }
      if (this.isTargetPatched(targetId)) {
        button.classList.add("is-patched");
      }
    }

    if (sourceKey) {
      button.dataset.modSource = sourceKey;
      if (this.dragHoverSource === sourceKey) {
        button.classList.add("is-hover");
      }
    }

    return button;
  }

  /* -------------------------------------------------------------------------- */
  /* 可视化创建                                                                 */
  /* -------------------------------------------------------------------------- */

  /**
   * 创建包络可视化
   * 显示 ADSR 曲线，支持动态更新
   * @param {Object} envelopeState - 包络状态
   * @param {string} accent - 强调色
   * @returns {Object} - 包含元素和更新函数的对象
   */
  createEnvelopeVisualization(envelopeState, accent = "env") {
    const wrap = document.createElement("div");
    wrap.className = "module-visual envelope-visual";
    wrap.style.setProperty("--accent", `var(--${accent})`);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 220 90");

    const config = {
      left: 16,
      right: 204,
      top: 14,
      floor: 76,
      labelY: 86,
    };

    const grid = document.createElementNS("http://www.w3.org/2000/svg", "path");
    grid.setAttribute("fill", "none");
    grid.setAttribute("stroke", "currentColor");
    grid.setAttribute("stroke-opacity", "0.12");
    grid.setAttribute("stroke-width", "1");

    const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
    area.setAttribute("fill", "currentColor");
    area.setAttribute("opacity", "0.16");

    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "2.2");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");

    const phaseLabels = ["A", "D", "S", "R"].map((text, index) => {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("y", "12");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", "9");
      label.setAttribute("font-weight", "600");
      label.setAttribute("fill", "currentColor");
      label.setAttribute("opacity", "0.5");
      label.textContent = text;
      return label;
    });

    const valueLabels = [0, 1, 2, 3].map(() => {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("y", String(config.labelY));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", "8");
      label.setAttribute("fill", "currentColor");
      label.setAttribute("opacity", "0.6");
      return label;
    });

    const update = (state) => {
      const attack = Math.max(0.001, Number(state.attack || 0.01));
      const decay = Math.max(0.001, Number(state.decay || 0.2));
      const sustain = clamp(Number(state.sustain || 0.5), 0, 1);
      const release = Math.max(0.001, Number(state.release || 0.4));

      const sustainDuration = Math.max(attack + decay, 0.1) * 0.8;
      const total = attack + decay + sustainDuration + release;

      const width = config.right - config.left;
      const height = config.floor - config.top;

      const xA = config.left;
      const xPeak = config.left + (attack / total) * width;
      const xSustainStart = xPeak + (decay / total) * width;
      const xSustainEnd = config.left + ((attack + decay + sustainDuration) / total) * width;
      const xR = config.right;

      const yPeak = config.top;
      const ySustain = config.floor - sustain * height;
      const yFloor = config.floor;

      const pathD = [
        `M ${xA} ${yFloor}`,
        `L ${xPeak} ${yPeak}`,
        `L ${xSustainStart} ${ySustain}`,
        `L ${xSustainEnd} ${ySustain}`,
        `L ${xR} ${yFloor}`,
      ].join(" ");

      const fillD = `${pathD} L ${config.right} ${config.floor + 4} L ${config.left} ${config.floor + 4} Z`;

      const gridD = [
        `M ${config.left} ${yFloor} H ${config.right}`,
        `M ${config.left} ${ySustain} H ${config.right}`,
        `M ${config.left} ${yPeak} H ${config.right}`,
      ].join(" ");

      line.setAttribute("d", pathD);
      area.setAttribute("d", fillD);
      grid.setAttribute("d", gridD);

      const labelPositions = [
        (xA + xPeak) / 2,
        (xPeak + xSustainStart) / 2,
        (xSustainStart + xSustainEnd) / 2,
        (xSustainEnd + xR) / 2,
      ];

      phaseLabels.forEach((label, i) => {
        label.setAttribute("x", String(labelPositions[i]));
      });

      const values = [
        formatSeconds(attack),
        formatSeconds(decay),
        `${Math.round(sustain * 100)}%`,
        formatSeconds(release),
      ];
      valueLabels.forEach((label, i) => {
        label.setAttribute("x", String(labelPositions[i]));
        label.textContent = values[i];
      });

      wrap.style.opacity = state.enabled === false ? "0.42" : "1";
    };

    svg.append(grid, area, line, ...phaseLabels, ...valueLabels);
    wrap.append(svg);
    update(envelopeState);
    return { element: wrap, update };
  }

  /**
   * 创建滤波器可视化
   * 显示滤波器响应曲线，支持动态更新
   * @param {Object} filterState - 滤波器状态
   * @returns {Object} - 包含元素和更新函数的对象
   */
  createFilterVisualization(filterState) {
    const wrap = document.createElement("div");
    wrap.className = "module-visual filter-visual";
    wrap.style.setProperty("--accent", "var(--filter)");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 220 90");

    const config = {
      left: 16,
      right: 204,
      top: 14,
      floor: 76,
      plateau: 48,
    };

    const grid = document.createElementNS("http://www.w3.org/2000/svg", "path");
    grid.setAttribute("fill", "none");
    grid.setAttribute("stroke", "currentColor");
    grid.setAttribute("stroke-opacity", "0.12");
    grid.setAttribute("stroke-width", "1");

    const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
    area.setAttribute("fill", "currentColor");
    area.setAttribute("opacity", "0.16");

    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "currentColor");
    line.setAttribute("stroke-width", "2.2");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");

    const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    marker.setAttribute("r", "3.5");
    marker.setAttribute("fill", "currentColor");

    const markerRing = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    markerRing.setAttribute("r", "6");
    markerRing.setAttribute("fill", "none");
    markerRing.setAttribute("stroke", "currentColor");
    markerRing.setAttribute("stroke-opacity", "0.3");
    markerRing.setAttribute("stroke-width", "1.4");

    const freqLabels = ["20", "100", "1k", "10k"].map((text, index) => {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      const freqLog = Math.log10([20, 100, 1000, 10000][index]);
      const minLog = Math.log10(20);
      const maxLog = Math.log10(12000);
      const x = config.left + ((freqLog - minLog) / (maxLog - minLog)) * (config.right - config.left);
      label.setAttribute("x", String(x));
      label.setAttribute("y", "88");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("font-size", "7");
      label.setAttribute("fill", "currentColor");
      label.setAttribute("opacity", "0.4");
      label.textContent = text;
      return label;
    });

    const typeLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    typeLabel.setAttribute("x", String(config.left));
    typeLabel.setAttribute("y", "12");
    typeLabel.setAttribute("font-size", "8");
    typeLabel.setAttribute("font-weight", "600");
    typeLabel.setAttribute("fill", "currentColor");
    typeLabel.setAttribute("opacity", "0.6");

    const infoLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    infoLabel.setAttribute("x", String(config.right));
    infoLabel.setAttribute("y", "12");
    infoLabel.setAttribute("text-anchor", "end");
    infoLabel.setAttribute("font-size", "8");
    infoLabel.setAttribute("fill", "currentColor");
    infoLabel.setAttribute("opacity", "0.5");

    const update = (state) => {
      const type = state.type || "lowpass";
      const frequency = Math.max(20, Number(state.frequency || 1000));
      const Q = Math.max(0.1, Number(state.Q || 1));
      const rolloff = Number(state.rolloff || -24);

      const minLog = Math.log10(20);
      const maxLog = Math.log10(12000);
      const cutoffNorm = clamp((Math.log10(frequency) - minLog) / (maxLog - minLog), 0, 1);
      const cutoffX = config.left + cutoffNorm * (config.right - config.left);

      const resonance = clamp(Q / 20, 0, 1);
      const slopeFactor = clamp(Math.abs(rolloff) / 48, 0.3, 1);
      const bumpHeight = resonance * 20;

      const width = config.right - config.left;
      const shoulder = (1 - slopeFactor) * 30 + 10;
      const halfShoulder = shoulder / 2;

      let pathD;
      let fillD;
      let markerY = config.plateau;

      const safeLeft = Math.max(config.left, cutoffX - shoulder);
      const safeRight = Math.min(config.right, cutoffX + shoulder);

      if (type === "highpass") {
        const peakY = config.plateau - bumpHeight;
        markerY = peakY;
        pathD = [
          `M ${config.left} ${config.floor}`,
          `L ${safeLeft} ${config.floor}`,
          `Q ${cutoffX - halfShoulder * 0.5} ${config.floor} ${cutoffX - halfShoulder * 0.3} ${(config.floor + peakY) / 2}`,
          `Q ${cutoffX - halfShoulder * 0.1} ${peakY} ${cutoffX} ${peakY}`,
          `L ${safeRight} ${config.plateau}`,
          `L ${config.right} ${config.plateau}`,
        ].join(" ");
        fillD = `${pathD} L ${config.right} ${config.floor + 4} L ${config.left} ${config.floor + 4} Z`;
      } else if (type === "bandpass") {
        const bandWidth = Math.max(15, 40 - slopeFactor * 20);
        const peakY = config.top + 5 + (1 - resonance) * 10;
        markerY = peakY;
        const leftEdge = Math.max(config.left, cutoffX - bandWidth);
        const rightEdge = Math.min(config.right, cutoffX + bandWidth);
        pathD = [
          `M ${config.left} ${config.floor}`,
          `L ${leftEdge} ${config.floor}`,
          `Q ${(leftEdge + cutoffX) / 2} ${config.floor} ${cutoffX} ${peakY}`,
          `Q ${(rightEdge + cutoffX) / 2} ${config.floor} ${rightEdge} ${config.floor}`,
          `L ${config.right} ${config.floor}`,
        ].join(" ");
        fillD = `${pathD} L ${config.right} ${config.floor + 4} L ${config.left} ${config.floor + 4} Z`;
      } else if (type === "notch") {
        const notchWidth = Math.max(10, 25 - slopeFactor * 12);
        const notchDepth = 15 + resonance * 15;
        markerY = Math.min(config.floor, config.plateau + notchDepth);
        const leftEdge = Math.max(config.left, cutoffX - notchWidth);
        const rightEdge = Math.min(config.right, cutoffX + notchWidth);
        pathD = [
          `M ${config.left} ${config.plateau}`,
          `L ${leftEdge} ${config.plateau}`,
          `Q ${(leftEdge + cutoffX) / 2} ${config.plateau} ${cutoffX} ${markerY}`,
          `Q ${(rightEdge + cutoffX) / 2} ${config.plateau} ${rightEdge} ${config.plateau}`,
          `L ${config.right} ${config.plateau}`,
        ].join(" ");
        fillD = `${pathD} L ${config.right} ${config.floor + 4} L ${config.left} ${config.floor + 4} Z`;
      } else {
        const peakY = config.plateau - bumpHeight;
        markerY = peakY;
        pathD = [
          `M ${config.left} ${config.plateau}`,
          `L ${safeLeft} ${config.plateau}`,
          `Q ${cutoffX - halfShoulder * 0.3} ${config.plateau} ${cutoffX - halfShoulder * 0.1} ${(config.plateau + peakY) / 2}`,
          `Q ${cutoffX} ${peakY} ${cutoffX + halfShoulder * 0.3} ${(config.plateau + config.floor) / 2}`,
          `L ${safeRight} ${config.floor}`,
          `L ${config.right} ${config.floor}`,
        ].join(" ");
        fillD = `${pathD} L ${config.right} ${config.floor + 4} L ${config.left} ${config.floor + 4} Z`;
      }

      const gridD = `M ${config.left} ${config.floor} H ${config.right} M ${config.left} ${config.plateau} H ${config.right} M ${config.left} ${config.top} H ${config.right}`;

      line.setAttribute("d", pathD);
      area.setAttribute("d", fillD);
      grid.setAttribute("d", gridD);
      marker.setAttribute("cx", String(cutoffX));
      marker.setAttribute("cy", String(markerY));
      markerRing.setAttribute("cx", String(cutoffX));
      markerRing.setAttribute("cy", String(markerY));

      const typeNames = { lowpass: "LP", highpass: "HP", bandpass: "BP", notch: "NT" };
      typeLabel.textContent = typeNames[type] || "LP";
      infoLabel.textContent = `${formatFrequency(frequency)} Q:${Q.toFixed(1)} ${rolloff}dB`;

      wrap.style.opacity = state.enabled === false ? "0.42" : "1";
    };

    svg.append(grid, area, line, markerRing, marker, ...freqLabels, typeLabel, infoLabel);
    wrap.append(svg);
    update(filterState);
    return { element: wrap, update };
  }

  /* -------------------------------------------------------------------------- */
  /* 控件创建                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 创建选择控件
   * Select 控件也可以携带 patch point，因此标题和控件本体拆成两层结构
   * @param {Object} options - 选项
   * @returns {HTMLElement} - 控件元素
   */
  createSelectControl({ label, options, value, onChange, patchPoint = null }) {
    const wrapper = document.createElement("label");
    wrapper.className = "control";

    const controlLabel = document.createElement("div");
    controlLabel.className = "control-label";
    const title = document.createElement("div");
    title.className = "control-title";
    const strong = document.createElement("strong");
    strong.textContent = label;
    title.append(strong);
    if (patchPoint) {
      title.append(this.createPatchPoint(patchPoint));
    }
    controlLabel.append(title);

    const select = document.createElement("select");
    select.className = "select-input";
    options.forEach((option) => {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    });
    select.value = value;
    select.addEventListener("change", (event) => {
      onChange(event.target.value);
      select.blur();
    });

    wrapper.append(controlLabel, select);
    return wrapper;
  }

  /**
   * 创建开关控件
   * @param {Object} options - 选项
   * @returns {HTMLElement} - 控件元素
   */
  createToggleControl({ label, value, onToggle, accent }) {
    const wrapper = document.createElement("div");
    wrapper.className = "control";

    const controlLabel = document.createElement("div");
    controlLabel.className = "control-label";
    const strong = document.createElement("strong");
    strong.textContent = label;
    controlLabel.append(strong);

    const button = document.createElement("button");
    button.type = "button";
    button.className = `pill-button ${value ? "is-on" : ""}`;
    button.style.setProperty("--accent", `var(--${accent})`);

    const syncState = (nextValue) => {
      button.classList.toggle("is-on", nextValue);
      button.textContent = nextValue ? "On" : "Off";
    };

    syncState(Boolean(value));
    button.addEventListener("click", (event) => {
      const nextValue = !button.classList.contains("is-on");
      syncState(nextValue);
      onToggle(nextValue);
      event.target.blur();
    });

    wrapper.append(controlLabel, button);
    return wrapper;
  }

  /**
   * 创建范围控件
   * Range 控件支持 slider / knob / fader 三种可视变体
   * 并统一写入 controlBindings，供预设切换动画和宏控制回写 UI
   * @param {Object} options - 选项
   * @returns {HTMLElement} - 控件元素
   */
  createRangeControl({
    label,
    value,
    min,
    max,
    step,
    formatter,
    onInput,
    accent = "source",
    variant = "slider",
    path = null,
    eventName = "input",
    patchPoint = null,
  }) {
    const wrapper = document.createElement("label");
    wrapper.className = `control control-${variant}`;
    wrapper.style.setProperty("--accent", `var(--${accent})`);

    const controlLabel = document.createElement("div");
    controlLabel.className = "control-label";
    const title = document.createElement("div");
    title.className = "control-title";
    const strong = document.createElement("strong");
    strong.textContent = label;
    const readout = document.createElement("span");
    readout.className = "control-readout";
    title.append(strong);
    if (patchPoint) {
      title.append(this.createPatchPoint(patchPoint));
    }
    controlLabel.append(title, readout);

    const shell = document.createElement("div");
    shell.className = "slider-shell";

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.className = variant === "knob" ? "knob-input" : "slider-input";

    const updateVisual = (nextValue) => {
      const numericValue = Number(nextValue);
      const percent = (numericValue - min) / (max - min);
      readout.textContent = formatter(numericValue);
      shell.style.setProperty("--percent", percent.toString());
      if (variant === "knob" && dial) {
        dial.style.setProperty("--rotation", `${-135 + percent * 270}deg`);
      }
    };

    let dial = null;
    if (variant === "knob") {
      shell.className = "knob-shell";
      dial = document.createElement("div");
      dial.className = "knob-dial";
      shell.append(dial, input);
    } else {
      shell.append(input);
    }

    updateVisual(value);

    if (path) {
      this.controlBindings.set(path, {
        setVisual: (nextValue) => {
          input.value = String(nextValue);
          updateVisual(nextValue);
        },
      });
    }

    input.addEventListener("input", (event) => {
      const nextValue = Number(event.target.value);
      updateVisual(nextValue);
      if (eventName === "input") {
        onInput(nextValue);
      }
    });

    // 滑块拖动结束后失去焦点，恢复键盘演奏
    input.addEventListener("pointerup", () => {
      input.blur();
    });

    if (eventName === "change") {
      input.addEventListener("change", (event) => {
        onInput(Number(event.target.value));
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
      controlLabel.insertBefore(inputField, readout);
      inputField.focus();
      inputField.select();

      const commitValue = () => {
        let newValue = Number(inputField.value);
        if (Number.isNaN(newValue)) {
          newValue = Number(input.value);
        }
        newValue = Math.max(min, Math.min(max, newValue));
        input.value = String(newValue);
        updateVisual(newValue);
        onInput(newValue);
        inputField.remove();
        readout.style.display = "";
      };

      const cancelEdit = () => {
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

    wrapper.append(controlLabel, shell);
    return wrapper;
  }

  /* -------------------------------------------------------------------------- */
  /* 预设管理                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 应用内置预设
   * 内置预设加载与导入 JSON 一样，都走完整的状态替换与重渲染流程
   * @param {string} presetId - 预设ID
   */
  async applyBuiltinPreset(presetId) {
    const template = BUILTIN_PRESET_TEMPLATES[presetId];
    if (!template) {
      return;
    }

    const previousState = deepClone(this.state);
    this.state = normalizePreset(template);
    this.selectedPresetId = presetId;
    this.resetPerformanceControls();
    this.renderAll(previousState);
    this.engine.fullSync(this.state);
    this.setStatus(`LOADED PRESET: ${this.state.name}.`, this.audioBooted ? "live" : "neutral");
  }

  /**
   * 从状态同步控件
   * 当逻辑层直接改了 state，需要把当前已经挂在页面上的控件视觉值同步回来
   */
  syncControlsFromState() {
    this.controlBindings.forEach((binding, path) => {
      const value = getByPath(this.state, path);
      if (typeof value === "number" && Number.isFinite(value)) {
        binding.setVisual(value);
      }
    });
  }

  /**
   * 动画控件过渡
   * 预设切换和 morph 时，对数值控件做一次短暂过渡，避免界面瞬间跳变
   * @param {Object} fromState - 起始状态
   * @param {Object} toState - 目标状态
   */
  animateControlTransition(fromState, toState) {
    const animations = [];

    this.controlBindings.forEach((binding, path) => {
      const startValue = getByPath(fromState, path);
      const endValue = getByPath(toState, path);

      if (
        typeof startValue === "number" &&
        Number.isFinite(startValue) &&
        typeof endValue === "number" &&
        Number.isFinite(endValue)
      ) {
        binding.setVisual(startValue);
        animations.push({ binding, startValue, endValue });
      }
    });

    if (!animations.length) {
      return;
    }

    const duration = 360;
    const startTime = performance.now();
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    const frame = (now) => {
      const progress = clamp((now - startTime) / duration, 0, 1);
      const eased = easeOut(progress);

      animations.forEach(({ binding, startValue, endValue }) => {
        binding.setVisual(startValue + (endValue - startValue) * eased);
      });

      if (progress < 1) {
        requestAnimationFrame(frame);
      }
    };

    requestAnimationFrame(frame);
  }

  /**
   * 重置性能控制参数
   */
  resetPerformanceControls() {
    this.performance.morph = 0;
    this.performance.brightness = 0.5;
    this.performance.motion = 0.5;
  }

  /* -------------------------------------------------------------------------- */
  /* 预设混合                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 混合预设
   * 数值字段线性插值，布尔/字符串按 morph 所在半区择一
   * 模块列表则尽量保留顺序并为结果生成新的临时 id
   * @param {string} aId - 预设A ID
   * @param {string} bId - 预设B ID
   * @param {number} morph - 混合比例
   * @returns {Object} - 混合后的预设
   */
  blendPresets(aId, bId, morph) {
    const presetA = normalizePreset(BUILTIN_PRESET_TEMPLATES[aId]);
    const presetB = normalizePreset(BUILTIN_PRESET_TEMPLATES[bId]);
    const t = clamp(morph, 0, 1);

    const blendNumbers = (a, b) => a + (b - a) * t;

    const blendObject = (a, b) => {
      if (typeof a === "number" && typeof b === "number") {
        return blendNumbers(a, b);
      }
      if (typeof a === "boolean" || typeof b === "boolean") {
        return t < 0.5 ? a : b;
      }
      if (typeof a === "string" || typeof b === "string") {
        return t < 0.5 ? a : b;
      }
      if (Array.isArray(a) && Array.isArray(b)) {
        return t < 0.5 ? deepClone(a) : deepClone(b);
      }
      if (isObject(a) && isObject(b)) {
        const result = {};
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        keys.forEach((key) => {
          if (a[key] === undefined) {
            result[key] = deepClone(b[key]);
          } else if (b[key] === undefined) {
            result[key] = deepClone(a[key]);
          } else {
            result[key] = blendObject(a[key], b[key]);
          }
        });
        return result;
      }
      return t < 0.5 ? deepClone(a) : deepClone(b);
    };

    const blendModuleLists = (listA, listB, normalizer) => {
      const max = Math.max(listA.length, listB.length);
      const output = [];
      for (let index = 0; index < max; index += 1) {
        const modA = listA[index];
        const modB = listB[index];
        if (!modA) {
          output.push(normalizer(modB));
          continue;
        }
        if (!modB) {
          output.push(normalizer(modA));
          continue;
        }

        if (modA.type === modB.type) {
          const blended = blendObject(modA, modB);
          blended.id = createId("morph");
          output.push(normalizer(blended));
        } else {
          const chosen = t < 0.5 ? deepClone(modA) : deepClone(modB);
          chosen.id = createId("morph");
          if (
            typeof chosen.volume === "number" &&
            typeof (t < 0.5 ? modB.volume : modA.volume) === "number"
          ) {
            chosen.volume = blendNumbers(modA.volume ?? chosen.volume, modB.volume ?? chosen.volume);
          }
          if (typeof chosen.pan === "number" && typeof (t < 0.5 ? modB.pan : modA.pan) === "number") {
            chosen.pan = blendNumbers(modA.pan ?? chosen.pan, modB.pan ?? chosen.pan);
          }
          output.push(normalizer(chosen));
        }
      }
      return output;
    };

    const blendRouteLists = (listA, listB) => {
      const max = Math.max(listA.length, listB.length);
      const output = [];
      for (let index = 0; index < max; index += 1) {
        const routeA = listA[index];
        const routeB = listB[index];
        if (!routeA) {
          output.push({ ...deepClone(routeB), id: createId("route") });
          continue;
        }
        if (!routeB) {
          output.push({ ...deepClone(routeA), id: createId("route") });
          continue;
        }

        if (routeA.target === routeB.target) {
          output.push({
            id: createId("route"),
            target: routeA.target,
            enabled: t < 0.5 ? routeA.enabled !== false : routeB.enabled !== false,
            amount: blendNumbers(Number(routeA.amount || 0), Number(routeB.amount || 0)),
          });
          continue;
        }

        output.push({ ...(t < 0.5 ? deepClone(routeA) : deepClone(routeB)), id: createId("route") });
      }
      return output;
    };

    return normalizePreset({
      name: `Morph ${presetA.name} / ${presetB.name}`,
      global: blendObject(presetA.global, presetB.global),
      filter: blendObject(presetA.filter, presetB.filter),
      envelope: blendObject(presetA.envelope, presetB.envelope),
      modEnvelope: blendObject(presetA.modEnvelope, presetB.modEnvelope),
      lfo: blendObject(presetA.lfo, presetB.lfo),
      modulation: {
        lfoRoutes: blendRouteLists(presetA.modulation.lfoRoutes, presetB.modulation.lfoRoutes),
        envelopeRoutes: blendRouteLists(
          presetA.modulation.envelopeRoutes,
          presetB.modulation.envelopeRoutes,
        ),
      },
      sources: blendModuleLists(presetA.sources, presetB.sources, normalizeSourceModule),
      components: blendModuleLists(presetA.components, presetB.components, normalizeComponentModule),
      effects: blendModuleLists(presetA.effects, presetB.effects, normalizeEffectModule),
    });
  }

  /**
   * 应用混合状态
   */
  applyMorphState() {
    const nextState = this.blendPresets(
      this.performance.morphA,
      this.performance.morphB,
      this.performance.morph,
    );
    const previousState = deepClone(this.state);
    this.state = nextState;
    this.selectedPresetId =
      this.performance.morph === 0
        ? this.performance.morphA
        : this.performance.morph === 1
          ? this.performance.morphB
          : "custom";
    this.renderAll(previousState);
    this.engine.fullSync(this.state);
    this.setStatus(
      `Morph ${Math.round(this.performance.morph * 100)}% between presets.`,
      this.audioBooted ? "live" : "neutral",
    );
  }

  /* -------------------------------------------------------------------------- */
  /* 宏控制                                                                     */
  /* -------------------------------------------------------------------------- */

  /**
   * 应用亮度宏
   * Brightness 宏优先映射到滤波器亮度感最强的两个参数：cutoff 与 Q
   * @param {number} value - 亮度值
   */
  applyBrightnessMacro(value) {
    const delta = value - this.performance.brightness;
    this.performance.brightness = value;
    this.selectedPresetId = "custom";

    this.state.filter.frequency = clamp(
      this.state.filter.frequency * Math.pow(2, delta * 2.4),
      40,
      12000,
    );
    this.state.filter.Q = clamp(this.state.filter.Q + delta * 5, 0.001, 20);

    this.filterVisualizationBinding?.(this.state.filter);
    this.engine.updateFilter(this.state.filter);
    this.syncControlsFromState();
  }

  /**
   * 应用运动宏
   * Motion 宏优先映射到 LFO 速度/深度以及可感知明显的 effect wet / feedback
   * @param {number} value - 运动值
   */
  applyMotionMacro(value) {
    const delta = value - this.performance.motion;
    this.performance.motion = value;
    this.selectedPresetId = "custom";

    this.state.lfo.enabled = true;
    this.state.lfo.frequency = clamp(this.state.lfo.frequency + delta * 8, 0.05, 18);
    this.state.lfo.amount = clamp(this.state.lfo.amount + delta * 0.8, 0, 1);

    this.state.effects.forEach((module) => {
      if (typeof module.options.wet === "number") {
        module.options.wet = clamp(module.options.wet + delta * 0.35, 0, 1);
      }
      if (typeof module.options.feedback === "number") {
        module.options.feedback = clamp(module.options.feedback + delta * 0.22, 0, 0.95);
      }
    });

    this.engine.updateLfo(this.state.lfo);
    this.state.effects.forEach((module) => this.engine.updateEffect(module));
    this.syncControlsFromState();
  }

  /* -------------------------------------------------------------------------- */
  /* 随机化                                                                     */
  /* -------------------------------------------------------------------------- */

  /**
   * 随机化当前音色
   * 在保持当前机架结构不变的前提下，给各模块参数和连线路由重新赋值
   */
  randomizeCurrentPatch() {
    const randomChoice = (list) => list[Math.floor(Math.random() * list.length)];
    const randomRange = (min, max, step = 0.01) => {
      const steps = Math.round((max - min) / step);
      return min + Math.floor(Math.random() * (steps + 1)) * step;
    };
    const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const shuffle = (list) => {
      const next = [...list];
      for (let index = next.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
      }
      return next;
    };
    const createRandomRoutes = (targets, maxCount, amountScale = 0.75) =>
      shuffle(targets)
        .slice(0, Math.min(targets.length, maxCount))
        .map((target) => createModRoute(target.value, randomRange(-amountScale, amountScale, 0.01)));

    const applyDefinitionRandomness = (module, definition) => {
      definition.controls.forEach((control) => {
        if (control.kind === "select") {
          setByPath(module, control.path, randomChoice(control.options).value);
        } else {
          setByPath(module, control.path, randomRange(control.min, control.max, control.step));
        }
      });
    };

    const previousState = deepClone(this.state);
    this.state.global.volume = randomRange(-16, -4, 0.1);
    this.state.global.velocity = randomRange(0.55, 1, 0.01);
    this.state.filter.type = randomChoice(FILTER_TYPES).value;
    this.state.filter.frequency = randomRange(180, 8800, 1);
    this.state.filter.Q = randomRange(0.2, 8, 0.01);
    this.state.envelope.attack = randomRange(0.001, 0.18, 0.001);
    this.state.envelope.decay = randomRange(0.04, 0.7, 0.001);
    this.state.envelope.sustain = randomRange(0.2, 0.95, 0.01);
    this.state.envelope.release = randomRange(0.08, 2.8, 0.01);
    this.state.modEnvelope.enabled = Math.random() > 0.15;
    this.state.modEnvelope.attack = randomRange(0.001, 0.6, 0.001);
    this.state.modEnvelope.decay = randomRange(0.03, 1.4, 0.001);
    this.state.modEnvelope.sustain = randomRange(0, 1, 0.01);
    this.state.modEnvelope.release = randomRange(0.05, 3.2, 0.01);
    this.state.lfo.enabled = true;
    this.state.lfo.type = randomChoice(SHARED_WAVE_OPTIONS).value;
    this.state.lfo.frequency = randomRange(0.08, 9.5, 0.01);
    this.state.lfo.amount = randomRange(0.05, 0.75, 0.01);
    this.state.lfo.phase = randomRange(0, 360, 1);

    this.state.sources.forEach((module) => {
      module.volume = randomRange(-18, -4, 0.1);
      module.pan = randomRange(-0.45, 0.45, 0.01);
      applyDefinitionRandomness(module, SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator);
    });

    this.state.components.forEach((module) =>
      applyDefinitionRandomness(module, COMPONENT_LIBRARY[module.type] || COMPONENT_LIBRARY.Compressor),
    );
    this.state.effects.forEach((module) =>
      applyDefinitionRandomness(module, EFFECT_LIBRARY[module.type] || EFFECT_LIBRARY.Chorus),
    );

    const modulationTargets = getModulationTargets(this.state);
    this.state.modulation.lfoRoutes = createRandomRoutes(
      modulationTargets,
      randomInt(1, Math.min(3, modulationTargets.length || 1)),
      0.8,
    );
    this.state.modulation.envelopeRoutes = createRandomRoutes(
      modulationTargets,
      randomInt(1, Math.min(2, modulationTargets.length || 1)),
      0.65,
    );

    this.selectedPresetId = "custom";
    this.resetPerformanceControls();
    this.renderAll(previousState);
    this.engine.fullSync(this.state);
    this.setStatus("Randomized the current patch.", this.audioBooted ? "live" : "neutral");
  }

  /* -------------------------------------------------------------------------- */
  /* MIDI 支持                                                                  */
  /* -------------------------------------------------------------------------- */

  /**
   * 请求 MIDI 访问权限
   */
  async requestMidiAccess() {
    if (!this.midi.supported) {
      this.midi.status = "Web MIDI unsupported";
      this.renderGlobalStrip();
      return;
    }

    try {
      await this.ensureAudioStarted();
      this.midi.access = this.midi.access || (await navigator.requestMIDIAccess());
      this.midi.access.onstatechange = () => {
        this.refreshMidiInputs();
        this.renderGlobalStrip();
        this.drawPatchCables();
      };
      this.refreshMidiInputs();
      this.renderGlobalStrip();
      this.setStatus(
        "MIDI ready. Select an input and play hardware notes.",
        this.audioBooted ? "live" : "neutral",
      );
    } catch (error) {
      this.midi.status = `MIDI failed: ${error.message}`;
      this.renderGlobalStrip();
      this.setStatus(this.midi.status, "error");
    }
  }

  /**
   * 刷新 MIDI 输入设备列表
   */
  refreshMidiInputs() {
    if (!this.midi.access) {
      this.midi.inputs = [];
      this.midi.status = "MIDI idle";
      return;
    }

    this.midi.inputs = Array.from(this.midi.access.inputs.values());
    if (!this.midi.inputs.length) {
      this.midi.selectedInputId = "";
      this.midi.status = "No MIDI inputs";
      return;
    }

    if (!this.midi.inputs.some((input) => input.id === this.midi.selectedInputId)) {
      this.midi.selectedInputId = this.midi.inputs[0].id;
    }

    this.selectMidiInput(this.midi.selectedInputId, false);
  }

  /**
   * 选择 MIDI 输入设备
   * @param {string} inputId - 输入设备ID
   * @param {boolean} rerender - 是否重新渲染
   */
  selectMidiInput(inputId, rerender = true) {
    this.midi.selectedInputId = inputId;
    this.midi.inputs.forEach((input) => {
      input.onmidimessage = input.id === inputId ? (event) => this.handleMidiMessage(event) : null;
    });

    const selected = this.midi.inputs.find((input) => input.id === inputId);
    this.midi.status = selected ? `MIDI ${selected.name || selected.id}` : "No MIDI input";
    if (rerender) {
      this.renderGlobalStrip();
    }
  }

  /**
   * 处理 MIDI 消息
   * 当前只处理音符开/关消息，控制器映射可以后续继续扩展
   * @param {MIDIMessageEvent} event - MIDI 消息事件
   */
  async handleMidiMessage(event) {
    const [status, data1, data2] = event.data;
    const command = status & 0xf0;
    const note = Tone.Frequency(data1, "midi").toNote();

    if (command === 0x90 && data2 > 0) {
      await this.ensureAudioStarted();
      const velocity = clamp(data2 / 127, 0.05, 1);
      this.midi.activeNotes.set(data1, note);
      this.pressNote(note, velocity);
      return;
    }

    if (command === 0x80 || (command === 0x90 && data2 === 0)) {
      this.midi.activeNotes.delete(data1);
      this.releaseNote(note);
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 传输信息更新                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 更新传输信息显示
   */
  updateTransportInfo() {
    if (this.elements.transportInfo) {
      this.elements.transportInfo.textContent = `Oct ${this.state.global.octave} / Vel ${Math.round(this.state.global.velocity * 100)}%`;
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 键盘输入处理                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 处理键盘按下事件
   * 电脑键盘映射：A-K 演奏音高，Z/X 调整八度，C/V 调整默认力度
   * @param {KeyboardEvent} event - 键盘事件
   */
  async onKeyDown(event) {
    const targetTag = event.target?.tagName;
    if (targetTag === "INPUT" || targetTag === "SELECT" || event.repeat) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "z") {
      this.state.global.octave = clamp(this.state.global.octave - 1, 1, 7);
      this.selectedPresetId = "custom";
      this.renderKeyboard();
      this.updateTransportInfo();
      return;
    }
    if (key === "x") {
      this.state.global.octave = clamp(this.state.global.octave + 1, 1, 7);
      this.selectedPresetId = "custom";
      this.renderKeyboard();
      this.updateTransportInfo();
      return;
    }
    if (key === "c") {
      this.state.global.velocity = clamp(Number((this.state.global.velocity - 0.05).toFixed(2)), 0.1, 1);
      this.selectedPresetId = "custom";
      this.updateTransportInfo();
      return;
    }
    if (key === "v") {
      this.state.global.velocity = clamp(Number((this.state.global.velocity + 0.05).toFixed(2)), 0.1, 1);
      this.selectedPresetId = "custom";
      this.updateTransportInfo();
      return;
    }

    const entry = KEYBOARD_LAYOUT.find((item) => item.key === key);
    if (!entry) {
      return;
    }

    await this.ensureAudioStarted();
    const note = noteFromOffset(this.state.global.octave, entry.offset);
    if (!this.heldComputerKeys.has(key)) {
      this.heldComputerKeys.set(key, note);
      this.pressNote(note);
      this.updateKeyboardKeyState(key, true);
    }
  }

  /**
   * 处理键盘释放事件
   * @param {KeyboardEvent} event - 键盘事件
   */
  onKeyUp(event) {
    const key = event.key.toLowerCase();
    const note = this.heldComputerKeys.get(key);
    if (!note) {
      return;
    }

    this.heldComputerKeys.delete(key);
    this.releaseNote(note);
    this.updateKeyboardKeyState(key, false);
  }

  /* -------------------------------------------------------------------------- */
  /* 音符触发                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 按下音符
   * activeNoteRefs 是简单的引用计数器，用来处理多输入源重复按住同一个音的情况
   * @param {string} note - 音符
   * @param {number} velocity - 力度
   */
  pressNote(note, velocity = this.state.global.velocity) {
    const count = this.activeNoteRefs.get(note) || 0;
    this.activeNoteRefs.set(note, count + 1);
    if (!count) {
      this.engine.attack(note, velocity);
    }
  }

  /**
   * 释放音符
   * @param {string} note - 音符
   */
  releaseNote(note) {
    const count = this.activeNoteRefs.get(note) || 0;
    if (count <= 1) {
      this.activeNoteRefs.delete(note);
      this.engine.release(note);
      return;
    }
    this.activeNoteRefs.set(note, count - 1);
  }

  /**
   * 更新键盘按键状态
   * @param {string} boundKey - 绑定的键
   * @param {boolean} active - 是否激活
   */
  updateKeyboardKeyState(boundKey, active) {
    const visualKey = this.elements.keyboard.querySelector(`[data-key="${boundKey}"]`);
    if (!visualKey) {
      return;
    }
    visualKey.classList.toggle("active", active);
  }

  /* -------------------------------------------------------------------------- */
  /* 调制连线拖拽                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 开始拖拽连线
   * 开始拖线时只记录临时状态，不立刻修改实际 route
   * @param {PointerEvent} event - 指针事件
   * @param {string} routeKey - 路由键
   * @param {string} routeId - 路由ID
   * @param {string} accent - 强调色
   * @param {string} endType - 端点类型
   */
  beginPatchDrag(event, routeKey, routeId, accent, endType = "target") {
    const color =
      accent === "lfo" ? "rgba(61, 127, 184, 0.92)" : "rgba(192, 160, 62, 0.92)";
    this.dragPatch = {
      routeKey,
      routeId,
      color,
      endType,
      point: this.getRelativePatchPoint(event.clientX, event.clientY),
    };
    this.updatePatchHoverState();
    this.drawPatchCables();
  }

  /**
   * 获取相对调制点位置
   * @param {number} clientX - 客户端X坐标
   * @param {number} clientY - 客户端Y坐标
   * @returns {Object} - 相对位置
   */
  getRelativePatchPoint(clientX, clientY) {
    const container = this.elements.signalFlow;
    if (!container) {
      return { x: 0, y: 0 };
    }
    const rect = container.getBoundingClientRect();
    return {
      x: clientX - rect.left + container.scrollLeft,
      y: clientY - rect.top + container.scrollTop,
    };
  }

  /**
   * 查找悬停的调制目标
   * @param {number} clientX - 客户端X坐标
   * @param {number} clientY - 客户端Y坐标
   * @returns {HTMLElement|null} - 悬停的元素
   */
  findHoveredPatchTarget(clientX, clientY) {
    const element = document.elementFromPoint(clientX, clientY);
    return element?.closest?.("[data-mod-target]") || null;
  }

  /**
   * 查找悬停的调制源
   * @param {number} clientX - 客户端X坐标
   * @param {number} clientY - 客户端Y坐标
   * @returns {HTMLElement|null} - 悬停的元素
   */
  findHoveredPatchSource(clientX, clientY) {
    const element = document.elementFromPoint(clientX, clientY);
    return element?.closest?.("[data-mod-source]") || null;
  }

  /**
   * 更新调制点悬停状态
   */
  updatePatchHoverState() {
    const container = this.elements.signalFlow;
    if (!container) {
      return;
    }
    container
      .querySelectorAll("[data-mod-target]")
      .forEach((element) =>
        element.classList.toggle("is-hover", element.dataset.modTarget === this.dragHoverTarget),
      );
    container
      .querySelectorAll("[data-mod-source]")
      .forEach((element) =>
        element.classList.toggle("is-hover", element.dataset.modSource === this.dragHoverSource),
      );
  }

  /**
   * 处理拖拽移动事件
   * @param {PointerEvent} event - 指针事件
   */
  onPatchDragMove(event) {
    if (!this.dragPatch) {
      return;
    }
    this.dragPatch.point = this.getRelativePatchPoint(event.clientX, event.clientY);
    if (this.dragPatch.endType === "target") {
      const hoveredTarget = this.findHoveredPatchTarget(event.clientX, event.clientY);
      const nextHoverTarget = hoveredTarget?.dataset.modTarget || "";
      if (nextHoverTarget !== this.dragHoverTarget) {
        this.dragHoverTarget = nextHoverTarget;
        this.updatePatchHoverState();
      }
    } else {
      const hoveredSource = this.findHoveredPatchSource(event.clientX, event.clientY);
      const nextHoverSource = hoveredSource?.dataset.modSource || "";
      if (nextHoverSource !== this.dragHoverSource) {
        this.dragHoverSource = nextHoverSource;
        this.updatePatchHoverState();
      }
    }
    this.drawPatchCables();
  }

  /**
   * 处理拖拽结束事件
   * @param {PointerEvent} event - 指针事件
   */
  onPatchDragEnd(event) {
    if (!this.dragPatch) {
      return;
    }

    let routeChanged = false;
    let routeDeleted = false;

    if (this.dragPatch.endType === "target") {
      const hoveredTarget = this.findHoveredPatchTarget(event.clientX, event.clientY);
      if (hoveredTarget?.dataset.modTarget) {
        const route = findById(
          this.state.modulation[this.dragPatch.routeKey],
          this.dragPatch.routeId,
        );
        if (route && route.target !== hoveredTarget.dataset.modTarget) {
          route.target = hoveredTarget.dataset.modTarget;
          routeChanged = true;
        }
      } else {
        // 线在没有靠近任何点的时候会自动收回，也就是取消这一调制
        const list = this.state.modulation[this.dragPatch.routeKey] || [];
        const routeIndex = list.findIndex((route) => route.id === this.dragPatch.routeId);
        if (routeIndex >= 0) {
          list.splice(routeIndex, 1);
          routeDeleted = true;
        }
      }
    } else {
      const hoveredSource = this.findHoveredPatchSource(event.clientX, event.clientY);
      const nextRouteKey = hoveredSource?.dataset.modSource || "";
      if (nextRouteKey && nextRouteKey !== this.dragPatch.routeKey) {
        const list = this.state.modulation[this.dragPatch.routeKey] || [];
        const routeIndex = list.findIndex((route) => route.id === this.dragPatch.routeId);
        if (routeIndex >= 0) {
          const [route] = list.splice(routeIndex, 1);
          this.state.modulation[nextRouteKey].push(route);
          routeChanged = true;
        }
      } else {
        const list = this.state.modulation[this.dragPatch.routeKey] || [];
        const routeIndex = list.findIndex((route) => route.id === this.dragPatch.routeId);
        if (routeIndex >= 0) {
          list.splice(routeIndex, 1);
          routeDeleted = true;
        }
      }
    }

    if (routeChanged || routeDeleted) {
      this.selectedPresetId = "custom";
      this.engine.updateModulation(this.state.modulation);
    }

    this.dragPatch = null;
    this.dragHoverTarget = "";
    this.dragHoverSource = "";
    this.updatePatchHoverState();
    this.renderAll();
  }

  /* -------------------------------------------------------------------------- */
  /* 调制连线绘制                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 绘制调制连线
   * 所有连线都会根据当前 DOM 位置重算，但真正绘制时会经过一层弹簧插值
   * 这样模块重排和拖线时看起来更像一根有张力的线缆
   */
  drawPatchCables() {
    const svg = this.elements.patchCables;
    const container = this.elements.signalFlow;
    if (!svg || !container) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const width = Math.round(container.scrollWidth || containerRect.width);
    const height = Math.round(container.scrollHeight || containerRect.height);

    const escapeSelector = (value) => {
      if (window.CSS?.escape) {
        return window.CSS.escape(value);
      }
      return String(value).replace(/["\\]/g, "\\$&");
    };

    const anchorSource = (sourceKey) => {
      const node = container.querySelector(`[data-mod-source="${escapeSelector(sourceKey)}"]`);
      if (!node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return {
        x: rect.left - containerRect.left + rect.width * 0.5,
        y: rect.top - containerRect.top + rect.height * 0.5,
      };
    };

    const anchorTarget = (targetId) => {
      const node = container.querySelector(`[data-mod-target="${escapeSelector(targetId)}"]`);
      if (!node) {
        return null;
      }
      const rect = node.getBoundingClientRect();
      return {
        x: rect.left - containerRect.left + rect.width * 0.5,
        y: rect.top - containerRect.top + rect.height * 0.5,
      };
    };

    const modulationTargets = new Map(
      getModulationTargets(this.state).map((target) => [target.value, target]),
    );
    const routes = [
      ...(this.state.modulation?.lfoRoutes || []).map((route) => ({
        ...route,
        accent: "lfo",
        color: "rgba(61, 127, 184, 0.92)",
        sourceKey: "lfoRoutes",
        sourceEnabled: this.state.lfo.enabled,
      })),
      ...(this.state.modulation?.envelopeRoutes || []).map((route) => ({
        ...route,
        accent: "env",
        color: "rgba(192, 160, 62, 0.92)",
        sourceKey: "envelopeRoutes",
        sourceEnabled: this.state.modEnvelope.enabled,
      })),
    ];

    this.patchScene = {
      width,
      height,
      routes: routes
        .filter((route) => route.enabled !== false && modulationTargets.has(route.target))
        .map((route) => ({
          id: route.id,
          routeKey: route.sourceKey,
          accent: route.accent,
          color: route.color,
          sourceEnabled: route.sourceEnabled,
          from: anchorSource(route.sourceKey),
          to: anchorTarget(route.target),
        }))
        .filter((route) => route.from && route.to),
      drag: null,
    };

    if (this.dragPatch) {
      const activeRoute = routes.find((route) => route.id === this.dragPatch.routeId);
      if (activeRoute) {
        const fixedFrom = anchorSource(activeRoute.sourceKey);
        const fixedTo = anchorTarget(activeRoute.target);
        if (fixedFrom && fixedTo) {
          this.patchScene.drag = {
            id: activeRoute.id,
            routeKey: activeRoute.sourceKey,
            accent: activeRoute.accent,
            color: activeRoute.color,
            sourceEnabled: activeRoute.sourceEnabled,
            from: this.dragPatch.endType === "source" ? this.dragPatch.point : fixedFrom,
            to: this.dragPatch.endType === "target" ? this.dragPatch.point : fixedTo,
          };
        }
      }
    }

    if (!this.patchFrame) {
      this.animatePatchCables();
    }
  }

  /**
   * 步进线缆锚点
   * @param {Object} anchorState - 锚点状态
   * @param {Object} target - 目标位置
   * @param {number} spring - 弹簧系数
   * @param {number} damping - 阻尼系数
   * @returns {boolean} - 是否仍在移动
   */
  stepCableAnchor(anchorState, target, spring, damping) {
    const dx = target.x - anchorState.x;
    const dy = target.y - anchorState.y;
    anchorState.vx = (anchorState.vx + dx * spring) * damping;
    anchorState.vy = (anchorState.vy + dy * spring) * damping;
    anchorState.x += anchorState.vx;
    anchorState.y += anchorState.vy;

    const settled =
      Math.abs(dx) < 0.2 &&
      Math.abs(dy) < 0.2 &&
      Math.abs(anchorState.vx) < 0.2 &&
      Math.abs(anchorState.vy) < 0.2;
    if (settled) {
      anchorState.x = target.x;
      anchorState.y = target.y;
      anchorState.vx = 0;
      anchorState.vy = 0;
    }
    return !settled;
  }

  /**
   * 动画调制连线
   * 使用二次贝塞尔曲线实现张力效果
   * 张力 100 = 紧绷/直线
   * 张力 0 = 最大下垂（受虚拟重力影响）
   */
  animatePatchCables() {
    const svg = this.elements.patchCables;
    const scene = this.patchScene;
    if (!svg || !scene) {
      this.patchFrame = 0;
      return;
    }

    this.patchFrame = 0;
    svg.setAttribute("viewBox", `0 0 ${scene.width} ${scene.height}`);
    svg.innerHTML = "";

    // 张力控制：张力 1 = 紧绷，张力 0 = 最大下垂
    const tension = clamp(Number(this.state.ui?.cableTension ?? 0.78), 0, 1);
    const sagAmount = (1 - tension) * 80; // 下垂幅度
    let shouldContinue = Boolean(this.dragPatch);
    const activeKeys = new Set();

    /**
     * 创建线缆路径
     * 使用二次贝塞尔曲线实现下垂效果
     */
    const createCablePath = (from, to, stroke, opacity) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;

      // 下垂量随距离增加而增加，但有上限
      const sag = sagAmount * Math.min(1, distance / 200);
      const controlY = midY + sag;

      // 二次贝塞尔曲线：Q 控制点 终点
      const pathD = `M ${from.x} ${from.y} Q ${midX} ${controlY} ${to.x} ${to.y}`;

      path.setAttribute("d", pathD);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", stroke);
      path.setAttribute("stroke-width", "2.4");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("opacity", String(opacity));
      svg.append(path);
    };

    /**
     * 创建插座点
     */
    const createSocket = (point, fill, meta = null) => {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", String(point.x));
      dot.setAttribute("cy", String(point.y));
      dot.setAttribute("r", "5");
      dot.setAttribute("fill", fill);
      dot.setAttribute("opacity", "0.34");
      if (meta) {
        dot.setAttribute("class", "cable-socket is-interactive");
        dot.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.beginPatchDrag(event, meta.routeKey, meta.routeId, meta.accent, meta.endType);
        });
      }
      svg.append(dot);
    };

    /**
     * 渲染单条线缆
     */
    const renderCable = (route, interactive = true) => {
      activeKeys.add(route.id);
      const visual = this.cableVisuals.get(route.id) || {
        from: { x: route.from.x, y: route.from.y, vx: 0, vy: 0 },
        to: { x: route.to.x, y: route.to.y, vx: 0, vy: 0 },
      };

      const spring = 0.15;
      const damping = 0.85;
      const movingFrom = this.stepCableAnchor(visual.from, route.from, spring, damping);
      const movingTo = this.stepCableAnchor(visual.to, route.to, spring, damping);
      this.cableVisuals.set(route.id, visual);
      if (movingFrom || movingTo) {
        shouldContinue = true;
      }

      const opacity = route.sourceEnabled ? 0.46 : 0.18;
      createCablePath(visual.from, visual.to, route.color, opacity);
      if (interactive) {
        createSocket(visual.from, route.color, {
          routeKey: route.routeKey,
          routeId: route.id,
          accent: route.accent,
          endType: "source",
        });
        createSocket(visual.to, route.color, {
          routeKey: route.routeKey,
          routeId: route.id,
          accent: route.accent,
          endType: "target",
        });
      } else {
        createSocket(visual.from, route.color);
        createSocket(visual.to, route.color);
      }
    };

    scene.routes.forEach((route) => {
      if (scene.drag?.id === route.id) {
        return;
      }
      renderCable(route, true);
    });

    if (scene.drag) {
      renderCable(scene.drag, false);
    }

    // 清理不再活跃的线缆视觉状态
    this.cableVisuals.forEach((_value, key) => {
      if (!activeKeys.has(key)) {
        this.cableVisuals.delete(key);
      }
    });

    if (shouldContinue) {
      this.patchFrame = requestAnimationFrame(() => this.animatePatchCables());
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 示波器绘制                                                                 */
  /* -------------------------------------------------------------------------- */

  /**
   * 使用自相关算法计算波形的基频周期
   * 用于稳定波形显示位置
   * @param {Float32Array} waveform - 波形数据
   * @param {number} minPeriod - 最小周期（采样点数）
   * @param {number} maxPeriod - 最大周期（采样点数）
   * @returns {number} - 周期位置（采样点偏移）
   */
  findAutocorrelationPeak(waveform, minPeriod = 32, maxPeriod = 512) {
    const n = waveform.length;
    const searchMin = Math.max(1, minPeriod);
    const searchMax = Math.min(n / 2, maxPeriod);

    let bestCorrelation = -Infinity;
    let bestOffset = 0;

    for (let lag = searchMin; lag < searchMax; lag++) {
      let correlation = 0;
      for (let i = 0; i < n - lag; i++) {
        correlation += waveform[i] * waveform[i + lag];
      }
      correlation /= n - lag;

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = lag;
      }
    }

    return bestOffset;
  }

  /**
   * 调整示波器画布大小
   * 把 canvas 的实际像素尺寸同步到 CSS 尺寸 * DPR，避免高分屏模糊
   */
  resizeScopeCanvas() {
    const canvas = this.elements.oscilloscope;
    if (!canvas || !this.scopeContext) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    this.scopeContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * 绘制示波器
   * 示例波器持续重绘；当音频尚未启动时则显示占位提示文本
   * 支持横向和纵向缩放，使用自相关算法稳定波形显示位置
   */
  drawOscilloscope() {
    requestAnimationFrame(() => this.drawOscilloscope());

    const canvas = this.elements.oscilloscope;
    const context = this.scopeContext;
    if (!canvas || !context) {
      return;
    }
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#f5f7fb";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "rgba(42, 36, 27, 0.08)";
    context.lineWidth = 1;
    for (let x = 0; x <= width; x += width / 12) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y <= height; y += height / 6) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    context.strokeStyle = "rgba(61, 127, 184, 0.22)";
    context.beginPath();
    context.moveTo(0, height / 2);
    context.lineTo(width, height / 2);
    context.stroke();

    const analyser = this.engine.getAnalyser();
    if (!analyser || !this.audioBooted) {
      context.fillStyle = "rgba(114, 103, 87, 0.78)";
      context.font = '500 14px "IBM Plex Sans"';
      context.fillText("点击任意位置启动音频", 24, height / 2 + 5);
      return;
    }

    const waveform = analyser.getValue();
    const zoomH = this.scopeZoom.horizontal;
    const zoomV = this.scopeZoom.vertical;

    const period = this.findAutocorrelationPeak(waveform);
    const startOffset = period > 0 ? period : 0;

    const samplesPerScreen = Math.floor(waveform.length / zoomH);
    const visibleSamples = Math.min(samplesPerScreen, waveform.length - startOffset);

    context.strokeStyle = "#2e8ea7";
    context.lineWidth = Math.max(1.5, 2.5 / zoomH);
    context.beginPath();

    for (let i = 0; i < visibleSamples; i++) {
      const sampleIndex = (startOffset + i) % waveform.length;
      const x = (i / (visibleSamples - 1)) * width;
      const sample = waveform[sampleIndex];
      const y = height * 0.5 + sample * height * 0.4 * zoomV;
      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }

    context.stroke();
  }
}

/* -------------------------------------------------------------------------- */
/* 应用初始化                                                                 */
/* -------------------------------------------------------------------------- */

window.addEventListener("DOMContentLoaded", () => {
  try {
    // 页面加载完成后创建应用实例，音频仍然等待第一次真实交互再启动
    const app = new ModularSynthApp();
    if (!Tone) {
      app.setStatus(
        "Tone.js failed to load. The UI is available, but audio is disabled until the CDN script loads.",
        "error",
      );
    }
  } catch (error) {
    console.error("Failed to initialize ModularSynthApp:", error);
    const status = document.getElementById("statusText");
    const dot = document.getElementById("statusDot");
    if (status) {
      status.textContent = `Initialization failed: ${error.message}`;
    }
    dot?.classList.add("error");
  }
});
