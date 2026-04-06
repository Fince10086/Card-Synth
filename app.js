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

    // 性能控制参数
    this.performance = {
      morphA: "init",
      morphB: "fmBell",
      morph: 0,
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
      componentRack: document.getElementById("componentRack"),
      effectRack: document.getElementById("effectRack"),
      addModuleCard: document.getElementById("addModuleCard"),
      addModuleDropdown: document.getElementById("addModuleDropdown"),
      keyboard: document.getElementById("virtualKeyboard"),
      oscilloscope: document.getElementById("oscilloscope"),
      presetFileInput: document.getElementById("presetFileInput"),
      transportInfo: document.getElementById("transportInfo"),
      signalFlow: document.querySelector(".signal-flow"),
      scopeZoomInH: document.getElementById("scopeZoomInH"),
      scopeZoomOutH: document.getElementById("scopeZoomOutH"),
      scopeZoomInV: document.getElementById("scopeZoomInV"),
      scopeZoomOutV: document.getElementById("scopeZoomOutV"),
      scopeHLabel: document.getElementById("scopeHLabel"),
      scopeVLabel: document.getElementById("scopeVLabel"),
      bottomBar: document.getElementById("bottomBar"),
      bottomBarHandle: document.getElementById("bottomBarHandle"),
      presetSelect: document.getElementById("presetSelect"),
      importBtn: document.getElementById("importBtn"),
      exportBtn: document.getElementById("exportBtn"),
      resetBtn: document.getElementById("resetBtn"),
      randomBtn: document.getElementById("randomBtn"),
      midiBtn: document.getElementById("midiBtn"),
      midiStatus: document.getElementById("midiStatus"),
      masterFader: document.getElementById("masterFader"),
      masterReadout: document.getElementById("masterReadout"),
      morphASelect: document.getElementById("morphASelect"),
      morphBSelect: document.getElementById("morphBSelect"),
      morphSlider: document.getElementById("morphSlider"),
      morphReadout: document.getElementById("morphReadout"),
      voicesSlider: document.getElementById("voicesSlider"),
      voicesReadout: document.getElementById("voicesReadout"),
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

    this.initBottomBarResize();
    this.bindStaticControls();
  }

  initBottomBarResize() {
    const handle = this.elements.bottomBarHandle;
    const bottomBar = this.elements.bottomBar;
    if (!handle || !bottomBar) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    handle.addEventListener("pointerdown", (e) => {
      isResizing = true;
      startY = e.clientY;
      startHeight = bottomBar.offsetHeight;
      handle.setPointerCapture(e.pointerId);
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
    });

    handle.addEventListener("pointermove", (e) => {
      if (!isResizing) return;
      const deltaY = startY - e.clientY;
      const newHeight = Math.max(120, Math.min(400, startHeight + deltaY));
      bottomBar.style.height = `${newHeight}px`;
      this.resizeScopeCanvas();
      this.layoutModuleMasonry();
    });

    handle.addEventListener("pointerup", (e) => {
      isResizing = false;
      handle.releasePointerCapture(e.pointerId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    });

    handle.addEventListener("pointercancel", (e) => {
      isResizing = false;
      handle.releasePointerCapture(e.pointerId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    });
  }

  bindStaticControls() {
    this.elements.presetSelect?.addEventListener("change", (e) => {
      const value = e.target.value;
      if (value !== "custom") {
        this.applyBuiltinPreset(value);
      }
    });

    this.elements.importBtn?.addEventListener("click", () => {
      this.elements.presetFileInput?.click();
    });

    this.elements.exportBtn?.addEventListener("click", () => {
      const filename = `${(this.state.name || "tone-preset").toLowerCase().replace(/\s+/g, "-")}.json`;
      downloadJson(filename, this.state);
      this.setStatus(`Exported ${filename}.`, this.audioBooted ? "live" : "neutral");
    });

    this.elements.resetBtn?.addEventListener("click", () => {
      this.applyBuiltinPreset("init");
    });

    this.elements.randomBtn?.addEventListener("click", () => {
      this.randomizeCurrentPatch();
    });

    this.elements.midiBtn?.addEventListener("click", () => {
      this.requestMidiAccess();
    });

    this.elements.masterFader?.addEventListener("input", (e) => {
      const value = Number(e.target.value);
      this.state.global.volume = value;
      this.selectedPresetId = "custom";
      this.engine.updateGlobal(this.state.global);
      this.updateMasterReadout(value);
      const shell = e.target.closest(".slider-shell");
      if (shell) {
        const percent = (value + 36) / 42;
        shell.style.setProperty("--percent", percent.toString());
      }
    });

    this.elements.morphASelect?.addEventListener("change", (e) => {
      this.performance.morphA = e.target.value;
      this.applyMorphState();
    });

    this.elements.morphBSelect?.addEventListener("change", (e) => {
      this.performance.morphB = e.target.value;
      this.applyMorphState();
    });

    this.elements.morphSlider?.addEventListener("input", (e) => {
      const value = Number(e.target.value);
      this.performance.morph = value;
      this.updateMorphReadout(value);
      this.applyMorphState();
      const shell = e.target.closest(".slider-shell");
      if (shell) {
        shell.style.setProperty("--percent", value.toString());
      }
    });

    this.elements.voicesSlider?.addEventListener("input", (e) => {
      const value = Number(e.target.value);
      this.state.global.polyphony = value;
      this.selectedPresetId = "custom";
      this.updateVoicesReadout(value);
      this.engine.updatePolyphony(value);
    });

    this.updatePresetSelect();
    this.updateMasterReadout(this.state.global.volume);
    this.updateMidiStatus();
    this.updateMorphControls();
    this.updateVoicesReadout(this.state.global.polyphony);
  }

  updatePresetSelect() {
    if (this.elements.presetSelect) {
      this.elements.presetSelect.value = this.selectedPresetId;
    }
  }

  updateMasterReadout(value) {
    if (this.elements.masterReadout) {
      this.elements.masterReadout.textContent = formatDb(value);
    }
    if (this.elements.masterFader) {
      this.elements.masterFader.value = String(value);
      const shell = this.elements.masterFader.closest(".slider-shell");
      if (shell) {
        const percent = (value + 36) / 42;
        shell.style.setProperty("--percent", percent.toString());
      }
    }
  }

  updateMidiStatus() {
    if (this.elements.midiStatus) {
      this.elements.midiStatus.textContent = this.midi.supported ? this.midi.status : "MIDI unsupported";
    }
    if (this.elements.midiBtn) {
      this.elements.midiBtn.textContent = this.midi.access ? "Refresh MIDI" : "Enable MIDI";
    }
  }

  updateMorphControls() {
    if (this.elements.morphASelect) {
      this.elements.morphASelect.value = this.performance.morphA;
    }
    if (this.elements.morphBSelect) {
      this.elements.morphBSelect.value = this.performance.morphB;
    }
    this.updateMorphReadout(this.performance.morph);
  }

  updateMorphReadout(value) {
    if (this.elements.morphReadout) {
      this.elements.morphReadout.textContent = formatPercent(value);
    }
    if (this.elements.morphSlider) {
      this.elements.morphSlider.value = String(value);
      const shell = this.elements.morphSlider.closest(".slider-shell");
      if (shell) {
        shell.style.setProperty("--percent", value.toString());
      }
    }
  }

  updateVoicesReadout(value) {
    if (this.elements.voicesReadout) {
      this.elements.voicesReadout.textContent = String(value);
    }
    if (this.elements.voicesSlider) {
      this.elements.voicesSlider.value = String(value);
      const shell = this.elements.voicesSlider.closest(".slider-shell");
      if (shell) {
        const percent = (value - 1) / 9;
        shell.style.setProperty("--percent", percent.toString());
      }
    }
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

  /**
   * 确保音频引擎已启动
   * 浏览器要求音频上下文必须由用户手势触发，首次交互时调用此方法启动音频
   */
  async ensureAudioStarted() {
    if (this.audioBooted) {
      return;
    }
    try {
      await this.engine.start(this.state);
      this.audioBooted = true;
      this.setStatus("Audio ready.", "live");
    } catch (error) {
      this.setStatus(`Audio failed: ${error.message}`, "error");
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 模块添加                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 填充 "Add Module" 下拉菜单
   */
  populateAddModuleDropdown() {
    const dropdown = this.elements.addModuleDropdown;
    if (!dropdown) {
      return;
    }

    dropdown.innerHTML = "";

    const options = getAddableModuleOptions();

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
   * @param {string} value - 模块值 (如 "source:Oscillator", "component:Filter")
   */
  handleAddModule(value) {
    if (!value) {
      return;
    }

    const [kind, type] = value.split(":");
    if (kind === "source") {
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
    this.populateAddModuleDropdown();
    this.controlBindings = new Map();

    const sections = [
      ["global strip", () => this.renderGlobalStrip()],
      ["sources", () => this.renderSourceRack()],
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

    if (previousState) {
      this.animateControlTransition(previousState, this.state);
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

  renderGlobalStrip() {
    this.updatePresetSelect();
    this.updateMasterReadout(this.state.global.volume);
    this.updateMidiStatus();
    this.updateMorphControls();
    this.updateVoicesReadout(this.state.global.polyphony);
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
        controls.append(
          this.renderModuleControl(
            module,
            control,
            () => this.engine.updateSource(module),
            definition.accent,
            `sources.${index}.${control.path}`,
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
  /* 组件机架渲染                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 渲染组件机架
   * Component rack 用于串接压缩、增益、EQ、Filter、AmplitudeEnvelope 等工具型节点
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
        controls.append(
          this.renderModuleControl(
            module,
            control,
            () => this.engine.updateComponent(module),
            definition.accent,
            `components.${index}.${control.path}`,
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
        controls.append(
          this.renderModuleControl(
            module,
            control,
            () => {
              this.engine.updateEffect(module);
            },
            definition.accent,
            `effects.${index}.${control.path}`,
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
   * @returns {HTMLElement} - 控件元素
   */
  renderModuleControl(module, control, onCommit, accent, bindingPath = null) {
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
      formatter: control.formatter || formatPlain,
      onInput: (nextValue) => {
        setByPath(module, path, nextValue);
        this.selectedPresetId = "custom";
        onCommit();
      },
    });
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
  /* 控件创建                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 创建选择控件
   * Select 控件也可以携带 patch point，因此标题和控件本体拆成两层结构
   * @param {Object} options - 选项
   * @returns {HTMLElement} - 控件元素
   */
  createSelectControl({ label, options, value, onChange }) {
    const wrapper = document.createElement("label");
    wrapper.className = "control";

    const controlLabel = document.createElement("div");
    controlLabel.className = "control-label";
    const strong = document.createElement("strong");
    strong.textContent = label;
    controlLabel.append(strong);

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
  }) {
    const wrapper = document.createElement("label");
    wrapper.className = `control control-${variant}`;
    wrapper.style.setProperty("--accent", `var(--${accent})`);

    const controlLabel = document.createElement("div");
    controlLabel.className = "control-label";
    const strong = document.createElement("strong");
    strong.textContent = label;
    const readout = document.createElement("span");
    readout.className = "control-readout";
    controlLabel.append(strong, readout);

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

    return normalizePreset({
      name: `Morph ${presetA.name} / ${presetB.name}`,
      global: blendObject(presetA.global, presetB.global),
      filter: blendObject(presetA.filter, presetB.filter),
      envelope: blendObject(presetA.envelope, presetB.envelope),
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
