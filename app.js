/**
 * app.js
 * 主应用类 - ModularSynthApp
 * 
 * 这是整个合成器应用的核心 UI 控制器。
 * 负责：
 * - DOM 元素缓存和事件绑定
 * - 状态管理和渲染调度
 * - 模块卡片的创建和管理
 * - 示波器绘制
 */

/* -------------------------------------------------------------------------- */
/* ModularSynthApp 类                                                         */
/* -------------------------------------------------------------------------- */

class ModularSynthApp {
  constructor() {
    this.state = createBasePreset();
    this.engine = new AudioEngine();
    this.selectedPresetId = "init";
    this.audioBooted = false;

    this.heldPointerNotes = new Set();

    this.controlBindings = new Map();

    this.performance = {
      morphA: "init",
      morphB: "fmBell",
      morph: 0,
    };

    this.scopeZoom = {
      horizontal: 1,
      vertical: 1,
    };

    this.dragState = {
      isDragging: false,
      isDragStarted: false,
      hasPointerCapture: false,
      dragCard: null,
      dragIndex: -1,
      pointerId: 0,
      indicator: null,
      startX: 0,
      startY: 0,
      offsetX: 0,
      offsetY: 0,
      placeholder: null,
    };

    this.inputManager = new InputManager({
      onAttack: (note, velocity) => this.engine.attack(note, velocity),
      onRelease: (note) => this.engine.release(note),
      onEnsureAudioStarted: () => this.ensureAudioStarted(),
      onOctaveChange: (octave) => {
        this.state.global.octave = octave;
        this.renderKeyboard();
      },
      onVelocityChange: (velocity) => {
        this.state.global.velocity = velocity;
      },
      onUpdateKeyboardKeyState: (key, active) => this.updateKeyboardKeyState(key, active),
      onRenderGlobalStrip: () => this.renderGlobalStrip(),
      getGlobalState: () => this.state.global,
      getKeyboardElement: () => this.elements.keyboard,
      getTransportInfoElement: () => this.elements.transportInfo,
      onSetCustomPreset: () => {
        this.selectedPresetId = "custom";
      },
    });

    this.cacheElements();
    this.bindEvents();

    this.renderAll();
    this.resizeScopeCanvas();
    this.drawOscilloscope();

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
      signalFlow: document.querySelector(".signal-flow"),
      addModuleCard: document.getElementById("addModuleCard"),
      addModuleDropdown: document.getElementById("addModuleDropdown"),
      keyboard: document.getElementById("virtualKeyboard"),
      oscilloscope: document.getElementById("oscilloscope"),
      presetFileInput: document.getElementById("presetFileInput"),
      transportInfo: document.getElementById("transportInfo"),
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
    const wakeAudio = () => {
      this.ensureAudioStarted();
    };

    document.addEventListener("pointerdown", wakeAudio, { passive: true });
    document.addEventListener("keydown", wakeAudio);

    this.inputManager.bindEvents();

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
      this.inputManager.requestMidiAccess();
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

    this.updatePresetSelect();
    this.updateMasterReadout(this.state.global.volume);
    this.updateMidiStatus();
    this.updateMorphControls();
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
      this.elements.midiStatus.textContent = this.inputManager.getMidiSupported()
        ? this.inputManager.getMidiStatus()
        : "MIDI unsupported";
    }
    if (this.elements.midiBtn) {
      this.elements.midiBtn.textContent = this.inputManager.getMidiInputs().length > 0
        ? "Refresh MIDI"
        : "Enable MIDI";
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
   * 填充下拉菜单
   */
  populateAddModuleDropdown() {
    const dropdown = this.elements.addModuleDropdown;
    if (!dropdown) {
      return;
    }

    dropdown.innerHTML = "";

    const options = getAddableModuleOptions();

    const groups = {
      source: { title: "声源", items: [] },
      component: { title: "组件", items: [] },
      effect: { title: "效果器", items: [] },
    };

    options.forEach((option) => {
      const kind = option.category;
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
   * 根据下拉值把模块添加到 modules 数组，并同步重建音频链
   * @param {string} value - 模块值 (如 "source:Oscillator", "component:Filter")
   */
  handleAddModule(value) {
    if (!value) {
      return;
    }

    const [category, type] = value.split(":");
    const newModule = createModule(category, type);
    this.state.modules.push(newModule);
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
      ["modules", () => this.renderModulesRack()],
      ["keyboard", () => this.renderKeyboard()],
      ["transport", () => this.inputManager.updateTransportInfo()],
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
   * 从左到右、从上到下布局，带智能回绕
   *
   * 布局规则：
   * 1. 默认从左到右依次填充各列
   * 2. 当满足回绕条件时，保持在当前列继续向下填充
   * 3. 到达最后一列后，回到第一列继续
   *
   * 回绕条件（非最后一列）：
   * - 右侧列高度 > 当前列高度 - 卡片高度/2
   * - 且满足以下之一：
   *   a) 当前列比右侧列矮或等高（heightDiff <= 0）
   *   b) 卡片高度 <= 2 × 高度差（避免大卡片错误回绕）
   *
   * 回绕条件（最后一列）：
   * - 第一列高度 > 当前列高度 + 卡片高度/2
   * - 且满足以下之一：
   *   a) 当前列比第一列矮或等高（heightDiff <= 0）
   *   b) 卡片高度 <= 2 × 高度差
   *
   * 特殊处理：
   * - addCard 使用前一个实际模块的高度进行回绕判断
   * - 当没有模块时，addCard 强制放在第一列
   */
  layoutModuleMasonry() {
    const container = this.elements.signalFlow;
    if (!container) {
      return;
    }

    // 收集所有模块卡片和添加按钮
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

    // 计算列数和列宽
    const gap = 10;
    const containerWidth = Math.max(240, container.clientWidth);
    const minColumnWidth = 246;
    const columnCount = Math.max(1, Math.floor((containerWidth + gap) / (minColumnWidth + gap)));
    const columnWidth = Math.floor((containerWidth - gap * (columnCount - 1)) / columnCount);

    // 记录每列的累计高度
    const columnHeights = new Array(columnCount).fill(0);

    // 当前列索引
    let currentColumn = 0;
    // 上一个实际模块的高度（用于 addCard 的回绕判断）
    let lastModuleHeight = 0;

    cards.forEach((card) => {
      card.style.position = "absolute";
      card.style.width = `${columnWidth}px`;

      const cardHeight = card.offsetHeight;
      const isAddCard = card === addCard;
      const isLastColumn = currentColumn === columnCount - 1;

      // 回绕判断使用的高度：addCard 用前一个模块高度，否则用自身高度
      const judgeHeight = isAddCard ? lastModuleHeight : cardHeight;

      let shouldWrap = false;

      if (isAddCard && lastModuleHeight === 0) {
        // 特殊情况：没有模块时，addCard 强制放在第一列
        currentColumn = 0;
      } else if (isLastColumn) {
        // 最后一列：检查是否回绕到第一列下方
        const firstColumnHeight = columnHeights[0];
        // 高度差：当前列比第一列高出多少（正数表示当前列更高）
        const heightDiff = columnHeights[currentColumn] - firstColumnHeight;
        // 基本回绕条件：第一列高度 > 当前列高度 + 卡片高度/2
        const shouldWrapByHeight = firstColumnHeight > columnHeights[currentColumn] + judgeHeight / 2;
        // 完整条件：满足基本条件，且（当前列不比第一列高 或 卡片不会导致布局失衡）
        if (shouldWrapByHeight && (heightDiff <= 0 || judgeHeight <= 2 * heightDiff)) {
          shouldWrap = true;
        }
      } else {
        // 非最后一列：检查是否回绕到当前列下方
        const rightColumnHeight = columnHeights[currentColumn + 1];
        // 高度差：当前列比右侧列高出多少（正数表示当前列更高）
        const heightDiff = columnHeights[currentColumn] - rightColumnHeight;
        // 基本回绕条件：右侧列高度 > 当前列高度 - 卡片高度/2
        const shouldWrapByHeight = rightColumnHeight > columnHeights[currentColumn] - judgeHeight / 2;
        // 完整条件：满足基本条件，且（当前列不比右侧列高 或 卡片不会导致布局失衡）
        if (shouldWrapByHeight && (heightDiff <= 0 || judgeHeight <= 2 * heightDiff)) {
          shouldWrap = true;
        }
      }

      // 根据回绕结果调整列索引
      if (!shouldWrap && !isLastColumn && !(isAddCard && lastModuleHeight === 0)) {
        // 不回绕且不是最后一列：移动到下一列
        currentColumn += 1;
      } else if (!shouldWrap && isLastColumn) {
        // 不回绕且是最后一列：回到第一列
        currentColumn = 0;
      }
      // 回绕时：保持在当前列（currentColumn 不变）

      // 计算并设置卡片位置
      const left = currentColumn * (columnWidth + gap);
      const top = columnHeights[currentColumn];
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;

      // 更新当前列的累计高度
      columnHeights[currentColumn] += cardHeight + gap;

      // 记录实际模块的高度（不记录 addCard）
      if (!isAddCard) {
        lastModuleHeight = cardHeight;
      }
    });

    // 设置容器高度为最高列的高度
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
  }

  /* -------------------------------------------------------------------------- */
  /* 统一模块渲染                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 渲染所有模块到 signalFlow 容器
   * 模块按编号顺序渲染，每个模块显示其编号
   */
  renderModulesRack() {
    const container = this.elements.signalFlow;
    if (!container) {
      return;
    }

    // 保留 addModuleCard，清空其他内容
    const addCard = container.querySelector(".add-module-card");
    container.innerHTML = "";
    if (addCard) {
      container.appendChild(addCard);
    }

    const modules = this.state.modules || [];
    modules.forEach((module, index) => {
      const card = this.renderModuleCard(module, index);
      if (card) {
        container.insertBefore(card, addCard);
      }
    });
  }

  /**
   * 渲染单个模块卡片
   * @param {Object} module - 模块对象
   * @param {number} index - 模块索引
   * @returns {HTMLElement} - 模块卡片元素
   */
  renderModuleCard(module, index) {
    const definition = getModuleDefinition(module);
    const accent = getModuleAccent(module);
    const kicker = getModuleTag(module);

    const card = this.createModuleCard({
      accent,
      kicker,
      title: module.type,
      titleOptions: this.getTitleOptions(module.category),
      onTitleChange: (value) => {
        const replacement = createModule(module.category, value);
        replacement.id = module.id;
        replacement.enabled = module.enabled;
        if (module.category === "source") {
          replacement.volume = module.volume;
          replacement.pan = module.pan;
        }
        this.state.modules[index] = replacement;
        this.selectedPresetId = "custom";
        this.renderAll();
        this.engine.fullSync(this.state);
      },
      moduleRef: module.id,
      enabled: module.enabled,
      onToggleEnabled: () => {
        module.enabled = !module.enabled;
        this.selectedPresetId = "custom";
        this.engine.fullSync(this.state);
        this.renderAll();
      },
      onRemove: () => {
        this.state.modules.splice(index, 1);
        this.selectedPresetId = "custom";
        this.renderAll();
        this.engine.fullSync(this.state);
      },
      removable: true,
      index: index + 1,
    });

    const controls = document.createElement("div");
    controls.className = "module-grid";

    // Source 模块显示音量和声像控件
    if (module.category === "source") {
      controls.append(
        this.createRangeControl({
          label: "Level",
          accent,
          min: -36,
          max: 6,
          step: 0.1,
          value: module.volume,
          path: `modules.${index}.volume`,
          formatter: formatDb,
          onInput: (value) => {
            module.volume = value;
            this.selectedPresetId = "custom";
            this.engine.updateSource(module);
          },
        }),
        this.createRangeControl({
          label: "Pan",
          accent,
          min: -1,
          max: 1,
          step: 0.01,
          value: module.pan,
          path: `modules.${index}.pan`,
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
    }

    // 模块参数控件
    definition.controls.forEach((control) => {
      controls.append(
        this.renderModuleControl(
          module,
          control,
          () => this.engine.updateModule(module.id, module),
          accent,
          `modules.${index}.${control.path}`,
        ),
      );
    });

    card.append(controls);
    return card;
  }

  /**
   * 获取标题选项
   * @param {string} category - 模块类别
   * @returns {Array} - 选项列表
   */
  getTitleOptions(category) {
    if (category === "source") {
      return Object.keys(SOURCE_LIBRARY).map((type) => ({ label: type, value: type }));
    }
    if (category === "effect") {
      return Object.keys(EFFECT_LIBRARY).map((type) => ({ label: type, value: type }));
    }
    return Object.keys(COMPONENT_LIBRARY).map((type) => ({ label: type, value: type }));
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
    this.state.modules[index] = normalizeSourceModule(module);
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
        this.inputManager.pressNote(note);
        this.heldPointerNotes.add(note);
        key.classList.add("active");
      });

      key.addEventListener("pointerup", () => {
        this.inputManager.releaseNote(note);
        this.heldPointerNotes.delete(note);
        key.classList.remove("active");
      });

      key.addEventListener("pointerleave", () => {
        if (this.heldPointerNotes.has(note)) {
          this.inputManager.releaseNote(note);
          this.heldPointerNotes.delete(note);
          key.classList.remove("active");
        }
      });

      if (this.inputManager.heldComputerKeys.has(entry.key)) {
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
    index = null,
  }) {
    const card = document.createElement("section");
    card.className = "module-card";
    if (!enabled) {
      card.classList.add("disabled");
    }
    card.dataset.accent = accent;
    if (moduleRef) {
      card.dataset.moduleRef = moduleRef;
    }

    const head = document.createElement("div");
    head.className = "module-head";

    if (index !== null) {
      const indexBadge = document.createElement("span");
      indexBadge.className = "module-index";
      indexBadge.textContent = `${index}`;
      if (onToggleEnabled) {
        indexBadge.addEventListener("click", onToggleEnabled);
      }
      indexBadge.addEventListener("pointerdown", (e) => {
        this.initModuleDrag(e, card, index - 1);
      });
      head.append(indexBadge);
    }

    if (titleOptions && onTitleChange) {
      head.append(this.createTitleSelect({ accent, title, options: titleOptions, value: title, onChange: onTitleChange }));
    } else {
      const titleNode = document.createElement("h3");
      titleNode.textContent = title;
      head.append(titleNode);
    }

    if (removable && onRemove) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "module-remove";
      removeButton.textContent = "×";
      removeButton.addEventListener("click", onRemove);
      head.append(removeButton);
    }

    card.append(head);

    return card;
  }

  /* -------------------------------------------------------------------------- */
  /* 模块拖拽排序                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 初始化模块拖拽
   *
   * 拖拽流程：
   * 1. pointerdown 时记录初始状态，但不立即设置指针捕获
   * 2. pointermove 时检测移动距离，超过阈值开始拖拽
   * 3. 拖拽开始后设置指针捕获，避免阻止 click 事件
   *
   * 为什么延迟设置指针捕获：
   * - setPointerCapture 会将后续指针事件的目标改为捕获元素
   * - click 事件由 pointerdown + pointerup 合成，目标会变成 card 而非 indexBadge
   * - 延迟捕获可确保单击时 click 事件正常触发
   *
   * @param {PointerEvent} event - pointerdown 事件
   * @param {HTMLElement} card - 被拖拽的卡片元素
   * @param {number} moduleIndex - 模块在数组中的索引
   */
  initModuleDrag(event, card, moduleIndex) {
    // 单模块时禁用拖拽
    const modules = this.state.modules || [];
    if (modules.length <= 1) {
      return;
    }

    // 记录卡片初始位置和鼠标偏移量
    const rect = card.getBoundingClientRect();
    this.dragState = {
      isDragging: false,        // 是否正在拖拽（移动超过阈值后为 true）
      isDragStarted: false,     // 是否已开始拖拽（用于区分单击和拖拽）
      hasPointerCapture: false, // 是否已设置指针捕获
      dragCard: card,           // 被拖拽的卡片元素
      dragIndex: moduleIndex,   // 源模块在数组中的索引
      pointerId: event.pointerId, // 指针 ID，用于后续设置/释放捕获
      indicator: null,          // 插入指示线元素
      startX: event.clientX,    // 拖拽起始 X 坐标
      startY: event.clientY,    // 拖拽起始 Y 坐标
      offsetX: event.clientX - rect.left,  // 鼠标相对卡片左边缘的 X 偏移
      offsetY: event.clientY - rect.top,   // 鼠标相对卡片上边缘的 Y 偏移
      originalRect: rect,       // 卡片原始位置（用于动画回弹）
      targetIndex: -1,          // 目标插入位置索引
    };

    // 添加后续事件监听（不立即设置指针捕获）
    card.addEventListener("pointermove", this.handleDragMove.bind(this));
    card.addEventListener("pointerup", this.handleDragEnd.bind(this));
    card.addEventListener("pointercancel", this.handleDragEnd.bind(this));
  }

  /**
   * 处理拖拽移动
   *
   * 核心逻辑：
   * 1. 计算移动距离，判断是否真正开始拖拽
   * 2. 拖拽开始后设置指针捕获，更新卡片位置
   * 3. 检测悬停目标，显示插入指示线
   *
   * @param {PointerEvent} event - pointermove 事件
   */
  handleDragMove(event) {
    if (!this.dragState.dragCard) {
      return;
    }

    const card = this.dragState.dragCard;

    // 计算鼠标移动距离
    const dx = event.clientX - this.dragState.startX;
    const dy = event.clientY - this.dragState.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // 拖拽阈值判断：移动距离 < 5px 视为单击，不触发拖拽
    if (!this.dragState.isDragStarted) {
      if (distance < 5) {
        return;
      }
      // 超过阈值，正式开始拖拽
      this.dragState.isDragStarted = true;
      this.dragState.isDragging = true;
      // 设置指针捕获，确保后续事件发送到 card 元素
      card.setPointerCapture(this.dragState.pointerId);
      this.dragState.hasPointerCapture = true;
    }

    const container = this.elements.signalFlow;

    // 设置卡片为 fixed 定位并跟随鼠标
    card.classList.add("dragging");
    card.style.left = `${event.clientX - this.dragState.offsetX}px`;
    card.style.top = `${event.clientY - this.dragState.offsetY}px`;

    // 检测是否拖出容器范围
    const containerRect = container.getBoundingClientRect();
    const isOutsideContainer =
      event.clientX < containerRect.left ||
      event.clientX > containerRect.right ||
      event.clientY < containerRect.top ||
      event.clientY > containerRect.bottom;

    // 拖出容器时隐藏指示线，标记无效位置
    if (isOutsideContainer) {
      this.removeDragIndicator();
      this.dragState.targetIndex = -1;
      return;
    }

    // 获取所有非拖拽中的模块卡片
    const moduleCards = [...container.querySelectorAll(".module-card:not(.dragging)")];
    let targetCard = null;
    let targetIndex = -1;

    // 遍历查找鼠标所在位置的卡片
    // 判断规则：鼠标在卡片矩形范围内，则插入到该卡片前面
    for (let i = 0; i < moduleCards.length; i++) {
      const rect = moduleCards[i].getBoundingClientRect();
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        targetCard = moduleCards[i];
        targetIndex = i;
        break;
      }
    }

    // 如果鼠标不在任何卡片范围内，则插入到最后
    if (targetIndex === -1 && moduleCards.length > 0) {
      targetCard = moduleCards[moduleCards.length - 1];
      targetIndex = moduleCards.length;
    }

    this.dragState.targetIndex = targetIndex;
    this.updateDragIndicator(targetCard, targetIndex);
  }

  /**
   * 更新拖拽指示线位置
   *
   * 指示线显示在目标卡片左侧，表示模块将插入到该位置
   *
   * @param {HTMLElement} targetCard - 目标卡片元素（null 表示插入到最后）
   * @param {number} targetIndex - 目标索引
   */
  updateDragIndicator(targetCard, targetIndex) {
    // 无目标卡片且不是插入到最后，则移除指示线
    if (!targetCard && targetIndex !== this.state.modules.length) {
      this.removeDragIndicator();
      return;
    }

    // 创建指示线元素（首次）
    if (!this.dragState.indicator) {
      this.dragState.indicator = document.createElement("div");
      this.dragState.indicator.className = "drag-indicator";
      this.elements.signalFlow.appendChild(this.dragState.indicator);
    }

    const container = this.elements.signalFlow;
    const containerRect = container.getBoundingClientRect();

    if (targetCard) {
      // 指示线显示在目标卡片左侧
      const targetRect = targetCard.getBoundingClientRect();
      this.dragState.indicator.style.left = `${targetRect.left - containerRect.left}px`;
      this.dragState.indicator.style.top = `${targetRect.top - containerRect.top}px`;
      this.dragState.indicator.style.height = `${targetRect.height}px`;
    } else {
      // 插入到最后：指示线显示在最后一个卡片右侧
      const lastCard = container.querySelector(".module-card:not(.dragging):last-of-type");
      if (lastCard) {
        const lastRect = lastCard.getBoundingClientRect();
        this.dragState.indicator.style.left = `${lastRect.right - containerRect.left}px`;
        this.dragState.indicator.style.top = `${lastRect.top - containerRect.top}px`;
        this.dragState.indicator.style.height = `${lastRect.height}px`;
      }
    }
  }

  /**
   * 移除拖拽指示线
   */
  removeDragIndicator() {
    if (this.dragState.indicator) {
      this.dragState.indicator.remove();
      this.dragState.indicator = null;
    }
  }

  /**
   * 处理拖拽结束
   *
   * 结束流程：
   * 1. 释放指针捕获（如果已设置）
   * 2. 移除事件监听器
   * 3. 如果是拖拽操作（非单击），执行重排序
   * 4. 重置拖拽状态
   *
   * @param {PointerEvent} event - pointerup 或 pointercancel 事件
   */
  handleDragEnd(event) {
    if (!this.dragState.dragCard) {
      return;
    }

    const card = this.dragState.dragCard;

    // 释放指针捕获（只有设置了才需要释放）
    if (this.dragState.hasPointerCapture) {
      card.releasePointerCapture(event.pointerId);
    }

    // 移除事件监听器
    card.removeEventListener("pointermove", this.handleDragMove.bind(this));
    card.removeEventListener("pointerup", this.handleDragEnd.bind(this));
    card.removeEventListener("pointercancel", this.handleDragEnd.bind(this));

    // 只有真正开始拖拽才执行重排序逻辑
    if (this.dragState.isDragStarted) {
      // 清理卡片拖拽样式
      card.classList.remove("dragging");
      card.style.left = "";
      card.style.top = "";

      this.removeDragIndicator();

      // 检测是否在容器内释放
      const container = this.elements.signalFlow;
      const containerRect = container.getBoundingClientRect();
      const isOutsideContainer =
        event.clientX < containerRect.left ||
        event.clientX > containerRect.right ||
        event.clientY < containerRect.top ||
        event.clientY > containerRect.bottom;

      // 在容器内且有有效目标位置，执行重排序
      if (!isOutsideContainer && this.dragState.targetIndex >= 0) {
        let toIndex = this.dragState.targetIndex;
        // 向后移动时，由于先移除了源模块，目标索引需要 -1
        if (toIndex > this.dragState.dragIndex) {
          toIndex--;
        }
        // 位置未变化则不执行重排序
        if (toIndex !== this.dragState.dragIndex) {
          this.reorderModule(this.dragState.dragIndex, toIndex);
        }
      }
    }

    // 重置拖拽状态
    this.dragState = {
      isDragging: false,
      isDragStarted: false,
      hasPointerCapture: false,
      dragCard: null,
      dragIndex: -1,
      pointerId: 0,
      indicator: null,
      startX: 0,
      startY: 0,
      offsetX: 0,
      offsetY: 0,
      placeholder: null,
    };
  }

  /**
   * 重排序模块
   *
   * 通过数组操作改变模块顺序，然后重新渲染和同步音频引擎
   *
   * @param {number} fromIndex - 源索引
   * @param {number} toIndex - 目标索引
   */
  reorderModule(fromIndex, toIndex) {
    const modules = this.state.modules;

    // 边界检查
    if (fromIndex < 0 || fromIndex >= modules.length || toIndex < 0 || toIndex >= modules.length) {
      return;
    }

    // 从数组中移除源模块并插入到目标位置
    const [module] = modules.splice(fromIndex, 1);
    modules.splice(toIndex, 0, module);

    // 更新 UI 和音频引擎
    this.selectedPresetId = "custom";
    this.renderAll();
    this.engine.fullSync(this.state);
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

    const blendModuleLists = (listA, listB) => {
      const max = Math.max(listA.length, listB.length);
      const output = [];
      for (let index = 0; index < max; index += 1) {
        const modA = listA[index];
        const modB = listB[index];
        if (!modA) {
          output.push(normalizeAnyModule(modB));
          continue;
        }
        if (!modB) {
          output.push(normalizeAnyModule(modA));
          continue;
        }

        if (modA.type === modB.type && modA.category === modB.category) {
          const blended = blendObject(modA, modB);
          blended.id = createId("morph");
          blended.category = modA.category;
          output.push(normalizeAnyModule(blended));
        } else {
          const chosen = t < 0.5 ? deepClone(modA) : deepClone(modB);
          chosen.id = createId("morph");
          if (
            chosen.category === "source" &&
            typeof chosen.volume === "number" &&
            typeof (t < 0.5 ? modB.volume : modA.volume) === "number"
          ) {
            chosen.volume = blendNumbers(modA.volume ?? chosen.volume, modB.volume ?? chosen.volume);
          }
          if (chosen.category === "source" && typeof chosen.pan === "number" && typeof (t < 0.5 ? modB.pan : modA.pan) === "number") {
            chosen.pan = blendNumbers(modA.pan ?? chosen.pan, modB.pan ?? chosen.pan);
          }
          output.push(normalizeAnyModule(chosen));
        }
      }
      return output;
    };

    return normalizePreset({
      name: `Morph ${presetA.name} / ${presetB.name}`,
      global: blendObject(presetA.global, presetB.global),
      modules: blendModuleLists(presetA.modules || [], presetB.modules || []),
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

    const modules = this.state.modules || [];
    modules.forEach((module) => {
      const definition = getModuleDefinition(module);
      if (module.category === "source") {
        module.volume = randomRange(-18, -4, 0.1);
        module.pan = randomRange(-0.45, 0.45, 0.01);
      }
      applyDefinitionRandomness(module, definition);
    });

    this.selectedPresetId = "custom";
    this.resetPerformanceControls();
    this.renderAll(previousState);
    this.engine.fullSync(this.state);
    this.setStatus("Randomized the current patch.", this.audioBooted ? "live" : "neutral");
  }

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
