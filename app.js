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
      onRenderMainCardContent: () => this.renderMainCardContent(),
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
      this.renderModulationOverlay();
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
      signalFlow: document.querySelector(".signal-flow"),
      signalFlowShell: document.querySelector(".signal-flow-shell"),
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
        const preset = await importPresetFromFile(file);
        const previousState = deepClone(this.state);
        this.state = preset;
        this.selectedPresetId = "custom";
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

    this.bindStaticControls();
    this.bindModulationEvents();
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
      const filename = exportPresetToFile(this.state);
      this.setStatus(`Exported ${filename}.`, this.audioBooted ? "live" : "neutral");
    });

    this.elements.resetBtn?.addEventListener("click", () => {
      this.applyBuiltinPreset("init");
    });

    this.elements.randomBtn?.addEventListener("click", () => {
      this.randomizeCurrentPatch();
    });

    this.elements.midiBtn?.addEventListener("click", () => {
      if (this.inputManager.getMidiInputs().length > 0) {
        this.inputManager.closeMidi();
      } else {
        this.inputManager.requestMidiAccess();
      }
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

    this.updatePresetSelect();
    this.updateMasterReadout(this.state.global.volume);
    this.updateMidiStatus();
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
    const container = this.elements.midiSelecter;
    if (!container) return;

    const supported = this.inputManager.getMidiSupported();
    const inputs = this.inputManager.getMidiInputs();
    const selectedId = this.inputManager.getMidiSelectedInputId();

    if (this.elements.midiBtn) {
      this.elements.midiBtn.textContent = inputs.length > 0 ? "MIDI Off" : "MIDI On";
    }

    const options = inputs.map((input) => ({
      value: input.id,
      label: input.name || input.id,
    }));

    const selectControl = this.createSelectControl({
      label: "MIDI",
      options: options.length > 0 ? options : [{ value: "", label: supported ? "No devices" : "Unsupported" }],
      value: selectedId || "",
      onChange: (value) => {
        if (value) {
          this.inputManager.selectMidiInput(value);
        }
      },
    });

    selectControl.classList.add("midi-selecter-control");
    const selectEl = selectControl.querySelector(".select-input");
    if (!supported || inputs.length === 0) {
      selectEl.disabled = true;
    }

    container.innerHTML = "";
    container.appendChild(selectControl);
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
      ["main-card content", () => this.renderMainCardContent()],
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

    // 重新缓存 Main Card 内部创建的动态元素(keyboard, oscilloscope 等)
    this.cacheDynamicElements();

    this.layoutModuleMasonry();
    this.renderModulationOverlay();

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

    // Main Card 高度感知变量
    let mainCardHeight = 0;

    // 识别 Main Card 并优先处理
    const mainCard = container.querySelector('.module-card[data-main-card="true"]');
    if (mainCard) {
      // 从 cards 数组中移除 main-card
      const mainCardIndex = cards.indexOf(mainCard);
      if (mainCardIndex > -1) {
        cards.splice(mainCardIndex, 1);
      }

      // 固定 Main Card 位置：第 0 列起始位置
      mainCard.style.position = "absolute";
      mainCard.style.width = `${columnWidth}px`;
      mainCard.style.left = `0px`;
      mainCard.style.top = `0px`;

      // 记录 main-card 高度并更新第 0 列高度
      mainCardHeight = mainCard.offsetHeight;
      columnHeights[0] += mainCardHeight + gap;
    }

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

      if (isLastColumn) {
        // 新增：Main Card 高度感知
        const shouldSkipToNextColumn = mainCardHeight > 0 && columnHeights[currentColumn] < mainCardHeight;

        if (shouldSkipToNextColumn) {
          // 跳过规则：最后一列高度不足，直接跳到第1列（Main Card 所在列的下一列）
          currentColumn = 1;
          // 直接设置位置并更新高度，跳过后续回绕判断
          const left = currentColumn * (columnWidth + gap);
          const top = columnHeights[currentColumn];
          card.style.left = `${left}px`;
          card.style.top = `${top}px`;
          columnHeights[currentColumn] += cardHeight + gap;
          if (!isAddCard) {
            lastModuleHeight = cardHeight;
          }
          return;  // 在 forEach 中使用 return 跳过后续逻辑
        } else {
          // 原有回绕逻辑保持不变
          const firstColumnHeight = columnHeights[0];
          // 高度差：当前列比第一列高出多少（正数表示当前列更高）
          const heightDiff = columnHeights[currentColumn] - firstColumnHeight;
          // 基本回绕条件：第一列高度 > 当前列高度 + 卡片高度/2
          const shouldWrapByHeight = firstColumnHeight > columnHeights[currentColumn] + judgeHeight / 2;
          // 完整条件：满足基本条件，且（当前列不比第一列高 或 卡片不会导致布局失衡）
          if (shouldWrapByHeight && (heightDiff <= 0 || judgeHeight <= 2 * heightDiff)) {
            shouldWrap = true;
          }
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
  /* 调制连线                                                                    */
  /* -------------------------------------------------------------------------- */

  /**
   * 绑定调制拖拽事件
   */
  bindModulationEvents() {
    document.addEventListener("pointermove", (event) => this.handleModulationPointerMove(event));
    document.addEventListener("pointerup", (event) => this.handleModulationPointerUp(event));
    document.addEventListener("pointercancel", () => this.cancelModulationDrag());
  }

  /**
   * 判断模块是否可作为调制源
   * @param {Object} module - 模块对象
   * @returns {boolean}
   */
  isModulationSource(module) {
    if (!module) {
      return false;
    }
    if (module.type === "Envelope") {
      return true;
    }
    return module.category === "source" && Boolean(module.modulationMode);
  }

  /**
   * 获取所有调制连接
   * @returns {Array}
   */
  getModulations() {
    if (!Array.isArray(this.state.modulations)) {
      this.state.modulations = [];
    }
    return this.state.modulations;
  }

  /**
   * 获取指定源模块的调制输出
   * @param {string} sourceModuleId - 源模块 ID
   * @returns {Array}
   */
  getOutgoingModulations(sourceModuleId) {
    return this.getModulations().filter((item) => item.sourceModuleId === sourceModuleId);
  }

  /**
   * 获取指定目标参数的调制连接
   * @param {string} targetModuleId - 目标模块 ID
   * @param {string} targetParamPath - 目标参数路径
   * @returns {Object|null}
   */
  getModulationByTarget(targetModuleId, targetParamPath) {
    return this.getModulations().find(
      (item) => item.targetModuleId === targetModuleId && item.targetParamPath === targetParamPath,
    ) || null;
  }

  /**
   * 获取调制连接（按 ID）
   * @param {string} connectionId - 连接 ID
   * @returns {Object|null}
   */
  getModulationById(connectionId) {
    return this.getModulations().find((item) => item.id === connectionId) || null;
  }

  /**
   * 获取源模块下一个可用 Voice 索引
   * @param {string} sourceModuleId - 源模块 ID
   * @returns {number}
   */
  getNextModulationVoiceIndex(sourceModuleId) {
    const used = new Set(this.getOutgoingModulations(sourceModuleId).map((item) => Number(item.sourceVoiceIndex)));
    for (let i = 0; i < 8; i += 1) {
      if (!used.has(i)) {
        return i;
      }
    }
    return -1;
  }

  /**
   * 开始调制连线拖拽
   * @param {Object} options - 拖拽选项
   */
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

  /**
   * 处理调制拖拽移动
   * @param {PointerEvent} event - 指针事件
   */
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

  /**
   * 处理调制拖拽结束
   * 仅在拖拽状态下且 pointerup 命中 slider 时建立连接。
   * @param {PointerEvent} event - 指针事件
   */
  handleModulationPointerUp(event) {
    if (!this.modulationDrag.active) {
      return;
    }

    const drag = { ...this.modulationDrag };
    const targetControl = event.target?.closest?.(".control.control-slider[data-module-id][data-param-path]");

    // 检查是否位于 Main Card 内，防止 Main Card 参数被调制
    if (targetControl) {
      const mainCard = targetControl.closest(".module-card[data-main-card='true']");
      if (mainCard) {
        // 目标控件在 Main Card 内,拒绝连接
        document.querySelectorAll(".control.mod-target-hover").forEach((node) => {
          node.classList.remove("mod-target-hover");
        });
        this.setStatus("Main Card parameters cannot be modulated.", "error");
        this.cancelModulationDrag();
        return;
      }
    }

    document.querySelectorAll(".control.mod-target-hover").forEach((node) => {
      node.classList.remove("mod-target-hover");
    });

    if (!targetControl) {
      // 重连时释放到空白处表示删除该连接。
      if (drag.updateConnectionId) {
        this.removeModulationById(drag.updateConnectionId);
        this.engine.fullSync(this.state);
        this.renderAll();
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

  /**
   * 提交调制连接目标
   * @param {Object} options - 连接选项
   */
  commitModulationTarget({ sourceModuleId, targetModuleId, targetParamPath, updateConnectionId = "" }) {
    if (!sourceModuleId || !targetModuleId || !targetParamPath || sourceModuleId === targetModuleId) {
      return;
    }

    // 检查目标模块是否是 Main Card,防止 Main Card 参数被调制
    const targetModuleCard = document.querySelector(`.module-card[data-module-id="${targetModuleId}"][data-main-card='true']`);
    if (targetModuleCard) {
      this.setStatus("Main Card parameters cannot be modulated.", "error");
      return;
    }

    const sourceModule = this.state.modules.find((item) => item.id === sourceModuleId);
    const targetModule = this.state.modules.find((item) => item.id === targetModuleId);
    if (!sourceModule || !targetModule) {
      return;
    }
    if (!this.isModulationSource(sourceModule)) {
      return;
    }

    const existingTarget = this.getModulationByTarget(targetModuleId, targetParamPath);
    if (existingTarget && existingTarget.id !== updateConnectionId) {
      this.setStatus("A target parameter can only have one modulation connection.", "error");
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
        this.setStatus("Each modulation source can connect up to 8 targets.", "error");
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
        rangeRadius: 0.15,  // 默认15%的范围半径
      });
    }

    this.selectedPresetId = "custom";
    this.engine.fullSync(this.state);
    this.renderAll();
  }

  /**
   * 删除调制连接（按 ID）
   * @param {string} connectionId - 连接 ID
   */
  removeModulationById(connectionId) {
    this.state.modulations = this.getModulations().filter((item) => item.id !== connectionId);
    this.selectedPresetId = "custom";
  }

  /**
   * 删除某个源模块的全部调制输出
   * @param {string} sourceModuleId - 源模块 ID
   */
  removeOutgoingModulations(sourceModuleId) {
    this.state.modulations = this.getModulations().filter((item) => item.sourceModuleId !== sourceModuleId);
    this.selectedPresetId = "custom";
  }

  /**
   * 删除某个模块相关的调制连接（作为源或目标）
   * @param {string} moduleId - 模块 ID
   */
  removeModuleModulations(moduleId) {
    this.state.modulations = this.getModulations().filter(
      (item) => item.sourceModuleId !== moduleId && item.targetModuleId !== moduleId,
    );
    this.selectedPresetId = "custom";
  }

  /**
   * 取消当前调制拖拽
   */
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

  /**
   * 获取元素中心点（相对于 signalFlowShell）
   * @param {HTMLElement} element - 目标元素
   * @returns {{x:number,y:number}|null}
   */
  getPointInSignalFlowShell(element) {
    const shell = this.elements.signalFlowShell;
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

  /**
   * 平滑插值 - 使用 damping 实现弹性效果
   */
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

  /**
   * 渲染调制线缆叠加层
   */
  renderModulationOverlay() {
    const shell = this.elements.signalFlowShell;
    if (!shell) return;

    // 延迟创建 SVG 容器，首次调用时才初始化
    if (!this.modulationSvg) {
      this.modulationSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.modulationSvg.classList.add("modulation-cables");
      shell.appendChild(this.modulationSvg);
    }

    // 设置 SVG 尺寸与容器一致
    const shellRect = shell.getBoundingClientRect();
    const svg = this.modulationSvg;
    svg.setAttribute("width", String(Math.max(1, shellRect.width)));
    svg.setAttribute("height", String(Math.max(1, shellRect.height)));
    svg.innerHTML = "";  // 清空上一帧内容

    // 配置参数
    const color = "var(--modulation)";  // 线缆颜色
    const damping = 0.05;               // 阻尼系数：值越小动画越平滑但越慢
    const activeKeys = new Set();       // 当前帧渲染的线缆 ID 集合
    let shouldContinue = Boolean(this.modulationDrag.active);  // 是否需要继续动画

    /**
     * 创建贝塞尔曲线路径
     * 使用二次贝塞尔曲线 (Q 命令) 模拟线缆受重力下垂的效果
     *
     * @param {Object} from - 起点 { x, y }
     * @param {Object} to - 终点 { x, y }
     * @param {boolean} isGhost - 是否为虚线（拖拽预览）
     */
    const createCablePath = (from, to, isGhost = false) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const horizontalDist = Math.abs(to.x - from.x);

      // 控制点 x 坐标：起点和终点的中点
      const cx = (from.x + to.x) / 2;

      // 下垂量：基础下垂 + 水平距离贡献
      // 水平距离越大，下垂越多，模拟真实线缆的重力效果
      const sag = 15 + horizontalDist * 0.25;

      // 控制点 y 坐标：取两点中较低的位置，再向下偏移下垂量
      const cy = Math.max(from.y, to.y) + sag;

      // 二次贝塞尔曲线：M 移动到起点，Q 绘制曲线到终点
      path.setAttribute("d", `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("opacity", isGhost ? "0.5" : "0.6");

      // 拖拽中的线缆显示虚线
      if (isGhost) path.setAttribute("stroke-dasharray", "6 4");

      svg.appendChild(path);
    };

    /**
     * 创建圆圈端点
     * 在线缆两端绘制小圆圈，标记连接位置
     *
     * @param {Object} point - 圆心位置 { x, y }
     * @param {boolean} interactive - 是否可交互（起点可点击重新拖拽）
     * @param {Object|null} meta - 交互元数据 { sourceModuleId, connectionId }
     */
    const createSocket = (point, interactive = false, meta = null) => {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", String(point.x));
      dot.setAttribute("cy", String(point.y));
      dot.setAttribute("r", "4");
      dot.setAttribute("fill", color);
      dot.setAttribute("opacity", "0.6");

      // 可交互的端点（起点）支持点击重新拖拽
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

    /**
     * 渲染单条线缆
     * 应用 damping 插值实现弹性动画效果
     *
     * @param {Object} route - 线缆数据 { id, sourceModuleId, from, to }
     * @param {boolean} interactive - 是否渲染可交互端点
     * @param {boolean} isGhost - 是否为虚线预览
     */
    const renderCable = (route, interactive = true, isGhost = false) => {
      activeKeys.add(route.id);  // 记录已渲染的线缆

      // 获取或创建端点的视觉状态（用于动画插值）
      const visual = this.cableVisuals.get(route.id) || {
        from: { x: route.from.x, y: route.from.y },
        to: { x: route.to.x, y: route.to.y },
      };

      // 应用 damping 插值，返回是否仍在运动
      const movingFrom = this.lerpPoint(visual.from, route.from, damping);
      const movingTo = this.lerpPoint(visual.to, route.to, damping);

      // 保存更新后的视觉状态
      this.cableVisuals.set(route.id, visual);

      // 如果端点仍在运动，需要继续动画
      if (movingFrom || movingTo) shouldContinue = true;

      // 渲染线缆路径
      createCablePath(visual.from, visual.to, isGhost);

      // 渲染端点圆圈
      if (interactive) {
        // 已建立的连接：起点可交互，终点不可交互
        createSocket(visual.from, false, { sourceModuleId: route.sourceModuleId, connectionId: route.id });
        createSocket(visual.to, false);
      } else {
        // 拖拽中的线缆：两端都不可交互
        createSocket(visual.from, false);
        createSocket(visual.to, false);
      }
    };

    // 渲染所有已建立的调制连接
    this.getModulations().forEach((connection) => {
      // 查找源模块的调制锚点元素
      const fromEl = this.elements.signalFlow?.querySelector(
        `.module-mod-anchor[data-module-id="${connection.sourceModuleId}"]`,
      );
      // 查找目标参数的显示元素
      const toEl = this.elements.signalFlow?.querySelector(
        `.control-readout[data-module-id="${connection.targetModuleId}"][data-param-path="${connection.targetParamPath}"]`,
      );

      // 获取元素在 SVG 坐标系中的中心点
      const from = this.getPointInSignalFlowShell(fromEl);
      const to = this.getPointInSignalFlowShell(toEl);

      if (from && to) {
        renderCable(
          { id: connection.id, sourceModuleId: connection.sourceModuleId, from, to },
          true,   // interactive: 可交互
          false,  // isGhost: 不是虚线
        );
      }
    });

    // 渲染拖拽中的线缆（虚线预览）
    if (this.modulationDrag.active) {
      const fromEl = this.elements.signalFlow?.querySelector(
        `.module-mod-anchor[data-module-id="${this.modulationDrag.sourceModuleId}"]`,
      );
      const from = this.getPointInSignalFlowShell(fromEl);

      if (from) {
        // 终点跟随鼠标位置
        renderCable(
          {
            id: "drag",
            from,
            to: { x: this.modulationDrag.x - shellRect.left, y: this.modulationDrag.y - shellRect.top },
          },
          false,  // interactive: 不可交互
          true,   // isGhost: 显示虚线
        );
      }
    }

    // 清理已删除线缆的视觉状态
    // 避免内存泄漏，删除不再存在的线缆数据
    this.cableVisuals.forEach((_, key) => {
      if (!activeKeys.has(key)) this.cableVisuals.delete(key);
    });

    // 动画循环控制
    // 如果需要继续动画（端点在运动或正在拖拽），请求下一帧
    if (shouldContinue) {
      this.modulationFrame = requestAnimationFrame(() => this.renderModulationOverlay());
    } else {
      this.modulationFrame = 0;  // 停止动画
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 全局边栏渲染                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 渲染 Main Card 内容
   * 更新 Main Card 内的全局控件状态(Preset、Master Volume、MIDI)
   */
  renderMainCardContent() {
    this.updatePresetSelect();
    this.updateMasterReadout(this.state.global.volume);
    this.updateMidiStatus();
  }

  /**
   * 缓存 Main Card 内部动态创建的 DOM 元素
   * 在 renderModulesRack() 之后调用,因为 keyboard/oscilloscope 等元素在 renderMainCard() 中创建
   */
  cacheDynamicElements() {
    this.elements.keyboard = document.getElementById("virtualKeyboard");
    this.elements.oscilloscope = document.getElementById("oscilloscope");
    this.scopeContext = this.elements.oscilloscope?.getContext("2d") || null;
    
    // 示波器控制按钮(可能在 Main Card 创建后才能获取到)
    this.elements.scopeZoomInH = document.getElementById("scopeZoomInH");
    this.elements.scopeZoomOutH = document.getElementById("scopeZoomOutH");
    this.elements.scopeZoomInV = document.getElementById("scopeZoomInV");
    this.elements.scopeZoomOutV = document.getElementById("scopeZoomOutV");
    this.elements.scopeHLabel = document.getElementById("scopeHLabel");
    this.elements.scopeVLabel = document.getElementById("scopeVLabel");
  }

  renderMainCard() {
    const card = this.createModuleCard({
      accent: "indigo",
      title: "Main",
      isMainCard: true,
    });

    const controls = document.createElement("div");
    controls.className = "module-grid";

    controls.append(
      this.createSelectControl({
        label: "Preset",
        options: [
          { value: "init", label: "Init Patch" },
          { value: "fmBell", label: "FM Bell Stack" },
          { value: "cinematicDust", label: "Cinematic Dust" },
          { value: "percussionLab", label: "Percussion Lab" },
          { value: "custom", label: "Current Patch" },
        ],
        value: this.selectedPresetId,
        onChange: (value) => {
          if (value !== "custom") {
            this.applyBuiltinPreset(value);
          }
        },
      })
    );

    const buttonRow = document.createElement("div");
    buttonRow.className = "preset-buttons";
    ["Import", "Export", "Reset", "Random", "MIDI"].forEach((label) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-button";
      btn.textContent = label;

      if (label === "Import") {
        btn.addEventListener("click", () => this.elements.presetFileInput?.click());
      } else if (label === "Export") {
        btn.addEventListener("click", () => {
          const filename = exportPresetToFile(this.state);
          this.setStatus(`Exported ${filename}.`, this.audioBooted ? "live" : "neutral");
        });
      } else if (label === "Reset") {
        btn.addEventListener("click", () => this.applyBuiltinPreset("init"));
      } else if (label === "Random") {
        btn.addEventListener("click", () => this.randomizeCurrentPatch());
      } else if (label === "MIDI") {
        btn.addEventListener("click", () => {
          if (this.inputManager.getMidiInputs().length > 0) {
            this.inputManager.closeMidi();
          } else {
            this.inputManager.requestMidiAccess();
          }
        });
      }

      buttonRow.append(btn);
    });
    controls.append(buttonRow);

    const midiContainer = document.createElement("div");
    midiContainer.id = "midiSelecter";
    midiContainer.className = "midi-selecter";
    controls.append(midiContainer);

    // 故意不设置 moduleId 和 paramPath,防止此控件成为调制目标
    controls.append(
      this.createSliderControl({
        label: "Master",
        min: -36,
        max: 6,
        step: 0.1,
        value: this.state.global.volume,
        formatter: formatDb,
        onInput: (value) => {
          this.state.global.volume = value;
          this.selectedPresetId = "custom";
          this.engine.updateGlobal(this.state.global);
        },
      })
    );

    const scopeContainer = document.createElement("div");
    scopeContainer.className = "main-card__scope";

    const scopeCanvas = document.createElement("canvas");
    scopeCanvas.id = "oscilloscope";
    scopeContainer.append(scopeCanvas);

    const scopeControls = document.createElement("div");
    scopeControls.className = "scope-controls";
    ["scopeZoomOutH", "scopeZoomInH", "scopeZoomOutV", "scopeZoomInV"].forEach((id) => {
      const btn = document.createElement("button");
      btn.className = "scope-btn";
      btn.id = id;
      if (id.includes("H")) {
        btn.textContent = id.includes("Out") ? "◀" : "▶";
      } else {
        btn.textContent = id.includes("Out") ? "▼" : "▲";
      }
      scopeControls.append(btn);
    });

    const hLabel = document.createElement("span");
    hLabel.className = "scope-label";
    hLabel.id = "scopeHLabel";
    hLabel.textContent = "1x";

    const vLabel = document.createElement("span");
    vLabel.className = "scope-label";
    vLabel.id = "scopeVLabel";
    vLabel.textContent = "1x";

    scopeControls.append(hLabel, vLabel);
    scopeContainer.append(scopeControls);
    controls.append(scopeContainer);

    const keyboardHint = document.createElement("div");
    keyboardHint.className = "keyboard-hint";
    ["A-K 演奏", "Z/X 八度", "C/V 力度"].forEach((text) => {
      const span = document.createElement("span");
      span.textContent = text;
      keyboardHint.append(span);
    });
    controls.append(keyboardHint);

    const keyboard = document.createElement("div");
    keyboard.id = "virtualKeyboard";
    keyboard.className = "virtual-keyboard virtual-keyboard--compact";
    controls.append(keyboard);

    card.append(controls);
    return card;
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

    const addCard = container.querySelector(".add-module-card");
    container.innerHTML = "";
    if (addCard) {
      container.appendChild(addCard);
    }

    const mainCard = this.renderMainCard();
    if (mainCard) {
      container.insertBefore(mainCard, addCard);
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
    const modulationSource = this.isModulationSource(module);
    const accent = modulationSource ? "modulation" : getModuleAccent(module);
    const kicker = getModuleTag(module);
    const canToggleModulation = module.category === "source";
    const canCreateCable = modulationSource;

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
          replacement.modulationMode = module.modulationMode;
          replacement.modulationFrequency = module.modulationFrequency;
        }
        if (!this.isModulationSource(replacement)) {
          this.removeOutgoingModulations(module.id);
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
        this.removeModuleModulations(module.id);
        this.state.modules.splice(index, 1);
        this.selectedPresetId = "custom";
        this.renderAll();
        this.engine.fullSync(this.state);
      },
      modulationEnabled: modulationSource,
      showModulationToggle: canToggleModulation,
      onToggleModulation: () => {
        module.modulationMode = !module.modulationMode;
        if (!module.modulationMode) {
          this.removeOutgoingModulations(module.id);
        }
        this.selectedPresetId = "custom";
        this.renderAll();
        this.engine.fullSync(this.state);
      },
      showModulationAnchor: canCreateCable,
      onModulationAnchorPointerDown: (event) => {
        if (this.getOutgoingModulations(module.id).length >= 8) {
          return;
        }
        this.startModulationDrag({ event, sourceModuleId: module.id });
      },
      removable: true,
      index: index + 1,
    });

    const controls = document.createElement("div");
    controls.className = "module-grid";

    // Source 模块的样本导入控件
    if (module.category === "source") {
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

    // Oscillator / PulseOscillator 在调制模式下新增 Frequency 控件。
    if (
      module.category === "source" &&
      module.modulationMode &&
      (module.type === "Oscillator" || module.type === "PulseOscillator")
    ) {
      controls.append(
        this.createSliderControl({
          label: "Frequency",
          accent: "modulation",
          min: 0.1,
          max: 100,
          step: 0.01,
          value: Number(module.modulationFrequency || 1),
          path: `modules.${index}.modulationFrequency`,
          moduleId: module.id,
          paramPath: "modulationFrequency",
          formatter: formatHertz,
          onInput: (value) => {
            module.modulationFrequency = value;
            this.selectedPresetId = "custom";
            this.engine.updateSource(module);
          },
        }),
      );
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

    return this.createSliderControl({
      label: control.label,
      accent,
      min: control.min,
      max: control.max,
      step: control.step,
      value,
      path: bindingPath,
      moduleId: module.id,
      paramPath: control.path,
      modulation: this.getModulationByTarget(module.id, control.path),
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
    modulationEnabled = false,
    showModulationToggle = false,
    onToggleModulation = null,
    showModulationAnchor = false,
    onModulationAnchorPointerDown = null,
    isMainCard = false,
  }) {
    if (isMainCard) {
      accent = "indigo";
      title = "Main";
      removable = false;
      index = null;
      onRemove = null;
    }

    const card = document.createElement("section");
    card.className = "module-card";
    if (!enabled) {
      card.classList.add("disabled");
    }
    card.dataset.accent = accent;
    if (isMainCard) {
      card.dataset.mainCard = "true";
    }
    if (moduleRef) {
      card.dataset.moduleRef = moduleRef;
      card.dataset.moduleId = moduleRef;
    }
    if (modulationEnabled) {
      card.classList.add("module-card--modulation");
    }

    const head = document.createElement("div");
    head.className = "module-head";

    if (index !== null && !isMainCard) {
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

    if ((titleOptions && onTitleChange) && !isMainCard) {
      head.append(this.createTitleSelect({ accent, title, options: titleOptions, value: title, onChange: onTitleChange }));
    } else {
      const titleWrap = document.createElement("div");
      titleWrap.className = isMainCard ? "module-title" : "";
      const titleNode = document.createElement(isMainCard ? "span" : "h3");
      titleNode.className = isMainCard ? "module-title-input" : "";
      titleNode.textContent = title;
      titleWrap.append(titleNode);
      head.append(titleWrap);
    }

    if (removable && onRemove && !isMainCard) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "module-remove";
      removeButton.textContent = "×";
      removeButton.addEventListener("click", onRemove);
      head.append(removeButton);
    }

    card.append(head);

    if (showModulationToggle) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = `module-mod-toggle ${modulationEnabled ? "is-on" : ""}`;
      toggle.textContent = "◣";
      if (onToggleModulation) {
        toggle.addEventListener("click", onToggleModulation);
      }
      card.append(toggle);
    }

    if (showModulationAnchor && moduleRef) {
      const anchor = document.createElement("button");
      anchor.type = "button";
      anchor.className = "module-mod-anchor";
      anchor.dataset.moduleId = moduleRef;
      anchor.addEventListener("pointerdown", (event) => {
        if (onModulationAnchorPointerDown) {
          onModulationAnchorPointerDown(event);
        }
      });
      card.append(anchor);
    }

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

    // 获取所有非拖拽中的模块卡片,排除 Main Card（Main Card 保护机制）
    const moduleCards = [...container.querySelectorAll(".module-card:not(.dragging):not([data-main-card='true'])")];
    let targetCard = null;
    let targetIndex = -1;

    // 遍历查找鼠标所在位置的卡片
    // 判断规则：鼠标在卡片矩形范围内，则插入到该卡片前面
    for (let i = 0; i < moduleCards.length; i++) {
      const card = moduleCards[i];

      // 跳过 Main Card（双重保护）
      if (card.hasAttribute("data-main-card")) {
        continue;
      }

      const rect = card.getBoundingClientRect();
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        targetCard = card;
        targetIndex = i;
        break;
      }
    }

    // Main Card 保护：防止拖拽到 Main Card 位置（index=0 是 Main Card）
    // 由于排除了 Main Card，实际索引需要 +1 来对应 modules 数组中的真实位置
    if (targetIndex >= 0) {
      targetIndex += 1; // 补偿 Main Card 占用的位置
    }
    // 防止目标索引为 0（Main Card 位置）
    if (targetIndex === 0) {
      targetIndex = 1; // 强制插入到 Main Card 后面
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
    // Main Card 保护：如果目标卡片是 Main Card，则不显示指示线
    if (targetCard?.hasAttribute("data-main-card")) {
      this.removeDragIndicator();
      return;
    }

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

        // Main Card 保护：防止将模块移动到 Main Card 位置（index 0）
        if (toIndex === 0) {
          toIndex = 1; // 强制放到位置 1（Main Card 后面）
        }

        // 位置未变化则不执行重排序
        if (toIndex !== this.dragState.dragIndex) {
          this.reorderModule(this.dragState.dragIndex, toIndex);
        } else {
          // 位置未变化，仍需重新布局以恢复卡片位置
          this.layoutModuleMasonry();
        }
      } else {
        // 拖出容器或无有效目标，重新布局恢复原位
        this.layoutModuleMasonry();
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
   * 创建滑块控件
   * @param {Object} options - 选项
   * @returns {HTMLElement} - 控件元素
   */
  createSliderControl({
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
    moduleId = "",
    paramPath = "",
    modulation = null,
  }) {
    const wrapper = document.createElement("label");
    wrapper.className = `control control-${variant}`;
    if (moduleId && paramPath && variant === "slider") {
      wrapper.dataset.moduleId = moduleId;
      wrapper.dataset.paramPath = paramPath;
    }

    const controlLabel = document.createElement("div");
    controlLabel.className = "control-label";
    const strong = document.createElement("strong");
    strong.textContent = label;
    const readout = document.createElement("span");
    readout.className = "control-readout";
    if (moduleId && paramPath) {
      readout.dataset.moduleId = moduleId;
      readout.dataset.paramPath = paramPath;
    }
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

    let paintRange = null;

    input.addEventListener("input", (event) => {
      const nextValue = Number(event.target.value);
      updateVisual(nextValue);
      if (eventName === "input") {
        onInput(nextValue);
      }
      if (modulation && paintRange) {
        paintRange();
        this.engine.updateModulationRange(
          modulation.id,
          modulation.rangeRadius ?? 0.15,
          nextValue,
          min,
          max
        );
      }
    });

    input.addEventListener("pointerup", () => {
      input.blur();
    });

    if (eventName === "change") {
      input.addEventListener("change", (event) => {
        const nextValue = Number(event.target.value);
        onInput(nextValue);
        input.blur();
        if (modulation && paintRange) {
          paintRange();
          this.engine.updateModulationRange(
            modulation.id,
            modulation.rangeRadius ?? 0.15,
            nextValue,
            min,
            max
          );
        }
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
        if (modulation && paintRange) {
          paintRange();
          this.engine.updateModulationRange(
            modulation.id,
            modulation.rangeRadius ?? 0.15,
            newValue,
            min,
            max
          );
        }
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
      const toPercent = (next) => (next - min) / (max - min || 1);
      const clamp01 = (next) => Math.max(0, Math.min(1, next));
      const safeNumber = (next, fallback) => {
        const numeric = Number(next);
        return Number.isFinite(numeric) ? numeric : fallback;
      };

      if (modulation.rangeRadius === undefined) {
        if (modulation.scaleMin !== undefined && modulation.scaleMax !== undefined) {
          const currentScaleMin = snap(safeNumber(modulation.scaleMin, value));
          const currentScaleMax = snap(safeNumber(modulation.scaleMax, value));
          const sliderPercent = toPercent(value);
          const minPercent = toPercent(currentScaleMin);
          const maxPercent = toPercent(currentScaleMax);
          modulation.rangeRadius = Math.max(
            Math.abs(sliderPercent - minPercent),
            Math.abs(sliderPercent - maxPercent)
          );
        } else {
          modulation.rangeRadius = 0.15;
        }
      }

      const calculateRangeFromRadius = (currentValue, paramMin, paramMax, rangeRadius) => {
        const sliderPercent = (currentValue - paramMin) / (paramMax - paramMin);

        const minPercent = clamp01(sliderPercent - rangeRadius);
        const maxPercent = clamp01(sliderPercent + rangeRadius);

        const minValue = paramMin + (paramMax - paramMin) * minPercent;
        const maxValue = paramMin + (paramMax - paramMin) * maxPercent;

        return { minValue, maxValue, minPercent, maxPercent };
      };

      paintRange = () => {
        const { minValue, maxValue, minPercent, maxPercent } = calculateRangeFromRadius(
          Number(input.value), min, max, modulation.rangeRadius ?? 0.15
        );

        shell.style.setProperty("--range-start", `${Math.min(minPercent, maxPercent) * 100}%`);
        shell.style.setProperty("--range-end", `${Math.max(minPercent, maxPercent) * 100}%`);
        markerMin.style.left = `${minPercent * 100}%`;
        markerMax.style.left = `${maxPercent * 100}%`;
        markerMinValue.textContent = minValue.toFixed(2);
        markerMaxValue.textContent = maxValue.toFixed(2);
      };

      const commitRange = () => {
        this.selectedPresetId = "custom";
      };

      const bindMarkerDrag = (marker) => {
        marker.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          const updateFromPointer = (clientX) => {
            const rect = shell.getBoundingClientRect();
            if (!rect.width) {
              return;
            }
            const markerPercent = clamp01((clientX - rect.left) / rect.width);
            const currentValue = Number(input.value);
            const sliderPercent = toPercent(currentValue);
            const newRadius = Math.abs(markerPercent - sliderPercent);
            modulation.rangeRadius = newRadius;
            paintRange();
            this.engine.updateModulationRange(
              modulation.id,
              modulation.rangeRadius,
              currentValue,
              modulation.rangeRadius !== undefined ? calculateRangeFromRadius(currentValue, min, max, modulation.rangeRadius).minValue : min,
              modulation.rangeRadius !== undefined ? calculateRangeFromRadius(currentValue, min, max, modulation.rangeRadius).maxValue : max
            );
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
   * 预设切换时，对数值控件做一次短暂过渡，避免界面瞬间跳变
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
