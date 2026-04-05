/**
 * audio-engine.js
 * 音频引擎类
 * 
 * AudioEngine 只关心"如何把 state 翻译成可发声的 Tone 节点"。
 * 所有 DOM、渲染和交互状态都不应放在这里。
 */

/* -------------------------------------------------------------------------- */
/* AudioEngine 类                                                             */
/* -------------------------------------------------------------------------- */

class AudioEngine {
  constructor() {
    // 引擎状态
    this.ready = false;
    this.state = null;
    
    // 运行时模块映射
    this.sourceRuntimes = new Map();
    this.componentRuntimes = new Map();
    this.effectRuntimes = new Map();
    
    // 活跃音符集合
    this.activeNotes = new Set();
    
    // 调制循环
    this.modulationFrame = null;
    this.lfoStartTime = 0;
    this.lastModulatedTargets = new Set();
    
    // 调制包络状态机
    this.modEnvelopeState = {
      stage: "idle",
      velocity: 1,
      attackStart: 0,
      attackFrom: 0,
      decayStart: 0,
      releaseStart: 0,
      releaseFrom: 0,
    };
  }

  /* -------------------------------------------------------------------------- */
  /* 初始化和启动                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 启动音频引擎
   * @param {Object} state - 应用状态
   */
  async start(state) {
    if (this.ready) {
      return;
    }

    if (!Tone) {
      throw new Error("Tone.js is not available. Check whether the CDN script loaded successfully.");
    }

    await Tone.start();
    this.state = deepClone(state);
    this.ready = true;

    // 创建主信号链节点
    // sourceBus 是所有 source 的汇总入口
    this.sourceBus = new Tone.Gain(1);
    this.filter = new Tone.Filter(getFilterAudioState(state.filter));
    this.ampEnvelope = new Tone.AmplitudeEnvelope(getEnvelopeAudioState(state.envelope));
    this.ampBypass = new Tone.Gain(1);
    this.masterVolume = new Tone.Volume(state.global.volume);
    this.analyser = new Tone.Analyser("waveform", 1024);
    this.lfoStartTime = Tone.now();

    // 连接主输出
    this.masterVolume.toDestination();
    this.masterVolume.connect(this.analyser);

    // 重建信号链
    this.rebuildEffects();
    this.rebuildSources();
    this.startModulationLoop();
  }

  /**
   * 获取分析器节点
   * 提供给 UI 层的示波器读取入口
   * @returns {Tone.Analyser} - 分析器节点
   */
  getAnalyser() {
    return this.analyser;
  }

  /* -------------------------------------------------------------------------- */
  /* 状态同步                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 完整同步状态
   * 当预设切换、导入 JSON 或大范围结构变化时，直接做一次整链路重建
   * @param {Object} state - 应用状态
   */
  fullSync(state) {
    this.state = deepClone(state);
    if (!this.ready) {
      return;
    }

    safeSet(this.filter, getFilterAudioState(state.filter));
    safeSet(this.ampEnvelope, getEnvelopeAudioState(state.envelope));
    rampParam(this.masterVolume.volume, state.global.volume);
    this.modEnvelopeState = {
      stage: "idle",
      velocity: 1,
      attackStart: 0,
      attackFrom: 0,
      decayStart: 0,
      releaseStart: 0,
      releaseFrom: 0,
    };
    this.silenceAll();
    this.rebuildEffects();
    this.rebuildSources();
    this.applyModulationSnapshot();
  }

  /**
   * 更新全局参数
   * @param {Object} globalState - 全局状态
   */
  updateGlobal(globalState) {
    this.state.global = deepClone(globalState);
    if (!this.ready) {
      return;
    }
    rampParam(this.masterVolume.volume, globalState.volume);
    this.applyModulationSnapshot();
  }

  /* -------------------------------------------------------------------------- */
  /* 核心模块更新                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 更新滤波器
   * filter / envelope 的更新除了改 Tone 参数，还可能改动主链路的串接方式
   * @param {Object} filterState - 滤波器状态
   */
  updateFilter(filterState) {
    this.state.filter = deepClone(filterState);
    if (!this.ready) {
      return;
    }
    safeSet(this.filter, getFilterAudioState(filterState));
    this.rebuildEffects();
    this.applyModulationSnapshot();
  }

  /**
   * 更新音量包络
   * @param {Object} envelopeState - 包络状态
   */
  updateEnvelope(envelopeState) {
    this.state.envelope = deepClone(envelopeState);
    if (!this.ready) {
      return;
    }
    safeSet(this.ampEnvelope, getEnvelopeAudioState(envelopeState));
    this.rebuildEffects();
  }

  /**
   * 更新调制包络
   * @param {Object} modEnvelopeState - 调制包络状态
   */
  updateModEnvelope(modEnvelopeState) {
    this.state.modEnvelope = deepClone(modEnvelopeState);
  }

  /**
   * 更新 LFO
   * @param {Object} lfoState - LFO 状态
   */
  updateLfo(lfoState) {
    this.state.lfo = deepClone(lfoState);
    if (!this.ready) {
      return;
    }
    this.applyModulationSnapshot();
  }

  /**
   * 更新调制路由
   * @param {Object} modulationState - 调制状态
   */
  updateModulation(modulationState) {
    this.state.modulation = deepClone(modulationState);
    if (!this.ready) {
      return;
    }
    this.applyModulationSnapshot();
  }

  /* -------------------------------------------------------------------------- */
  /* 信号链重建                                                                 */
  /* -------------------------------------------------------------------------- */

  /**
   * 重建声源运行时
   * source 的实例化方式差异最大，因此单独重建 source runtime 集合
   */
  rebuildSources() {
    if (!this.ready && !this.sourceBus) {
      return;
    }

    // 清理旧运行时
    this.sourceRuntimes.forEach((runtime) => {
      runtime.dispose();
    });
    this.sourceRuntimes.clear();

    // 创建新运行时
    this.state.sources.forEach((module) => {
      const runtime = this.createSourceRuntime(module);
      this.sourceRuntimes.set(module.id, runtime);
    });
  }

  /**
   * 重建效果器链
   * 主信号链重建器
   * 当前链路顺序固定为：
   * sourceBus -> (filter?) -> (ampEnvelope or bypass) -> components* -> effects* -> masterVolume
   */
  rebuildEffects() {
    if (!this.masterVolume || !this.ampEnvelope || !this.ampBypass || !this.filter) {
      return;
    }

    // 清理旧运行时
    this.componentRuntimes.forEach((runtime) => runtime.dispose());
    this.componentRuntimes.clear();
    this.effectRuntimes.forEach((runtime) => runtime.dispose());
    this.effectRuntimes.clear();

    // 断开所有连接
    this.sourceBus.disconnect();
    this.filter.disconnect();
    this.ampEnvelope.disconnect();
    this.ampBypass.disconnect();

    // 重建信号链
    let cursor = this.sourceBus;

    // filter 与 amp envelope 都允许被当作"核心模块"整体移除或 bypass
    if (this.state.filter.enabled !== false) {
      cursor.connect(this.filter);
      cursor = this.filter;
    }
    if (this.state.envelope.enabled !== false) {
      cursor.connect(this.ampEnvelope);
      cursor = this.ampEnvelope;
    } else {
      cursor.connect(this.ampBypass);
      cursor = this.ampBypass;
    }

    // 添加组件节点
    this.state.components.forEach((module) => {
      if (!module.enabled) {
        return;
      }

      const RuntimeCtor = Tone[module.type];
      if (!RuntimeCtor) {
        return;
      }

      const node = new RuntimeCtor(module.options);
      // 某些 Tone 节点需要 start()/generate() 才会进入可用状态
      if (typeof node.start === "function") {
        node.start();
      }
      if (typeof node.generate === "function") {
        node.generate();
      }

      cursor.connect(node);
      cursor = node;

      this.componentRuntimes.set(module.id, {
        node,
        dispose: () => node.dispose(),
      });
    });

    // 添加效果器节点
    this.state.effects.forEach((module) => {
      if (!module.enabled) {
        return;
      }

      const RuntimeCtor = Tone[module.type];
      if (!RuntimeCtor) {
        return;
      }

      const effectNode = new RuntimeCtor(module.options);
      if (typeof effectNode.start === "function") {
        effectNode.start();
      }
      if (typeof effectNode.generate === "function") {
        effectNode.generate();
      }

      cursor.connect(effectNode);
      cursor = effectNode;

      this.effectRuntimes.set(module.id, {
        node: effectNode,
        dispose: () => effectNode.dispose(),
      });
    });

    cursor.connect(this.masterVolume);
  }

  /* -------------------------------------------------------------------------- */
  /* 模块更新                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 更新声源模块
   * @param {Object} module - 声源模块
   */
  updateSource(module) {
    const existing = this.sourceRuntimes.get(module.id);
    this.state.sources = this.state.sources.map((entry) =>
      entry.id === module.id ? deepClone(module) : entry
    );
    if (!this.ready) {
      return;
    }

    if (!existing) {
      this.rebuildSources();
      return;
    }

    existing.apply(module);
    this.applyModulationSnapshot();
  }

  /**
   * 更新组件模块
   * component / effect 当前都走整段链路重建，逻辑更稳，也便于处理顺序变化
   * @param {Object} module - 组件模块
   */
  updateComponent(module) {
    const existing = this.componentRuntimes.get(module.id);
    this.state.components = this.state.components.map((entry) =>
      entry.id === module.id ? deepClone(module) : entry
    );
    if (!this.ready) {
      return;
    }

    if (!existing) {
      this.rebuildEffects();
      return;
    }

    this.rebuildEffects();
    this.applyModulationSnapshot();
  }

  /**
   * 更新效果器模块
   * @param {Object} module - 效果器模块
   */
  updateEffect(module) {
    const existing = this.effectRuntimes.get(module.id);
    this.state.effects = this.state.effects.map((entry) =>
      entry.id === module.id ? deepClone(module) : entry
    );
    if (!this.ready) {
      return;
    }

    if (!existing) {
      this.rebuildEffects();
      return;
    }

    this.rebuildEffects();
    this.applyModulationSnapshot();
  }

  /* -------------------------------------------------------------------------- */
  /* 调制系统                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 启动调制循环
   * 使用 requestAnimationFrame 做轻量级连续更新，以便同时驱动 LFO 和自定义的 mod envelope
   */
  startModulationLoop() {
    if (this.modulationFrame) {
      cancelAnimationFrame(this.modulationFrame);
    }

    const tick = () => {
      if (this.ready) {
        this.applyModulationSnapshot();
      }
      this.modulationFrame = requestAnimationFrame(tick);
    };

    this.modulationFrame = requestAnimationFrame(tick);
  }

  /**
   * 获取 LFO 值
   * 直接用数学函数生成 LFO 值，避免额外的 Tone.LFO 节点与复杂绑定管理
   * @param {number} time - 当前时间
   * @returns {number} - LFO 值 (-1 到 1)
   */
  getLfoValue(time) {
    if (!this.state.lfo.enabled) {
      return 0;
    }

    const phase = ((this.state.lfo.phase || 0) / 360) * Math.PI * 2;
    const t = (time - this.lfoStartTime) * Number(this.state.lfo.frequency || 0);
    const cycle = t % 1;
    const angle = cycle * Math.PI * 2 + phase;
    const type = this.state.lfo.type || "sine";

    if (type === "triangle") {
      return 1 - 4 * Math.abs(Math.round(cycle - 0.25) - (cycle - 0.25));
    }
    if (type === "square") {
      return Math.sin(angle) >= 0 ? 1 : -1;
    }
    if (type === "sawtooth") {
      return 2 * cycle - 1;
    }
    return Math.sin(angle);
  }

  /**
   * 获取调制包络值
   * 手写一个包络状态机给 modulation 使用
   * 它和音量包络分离，因此不会受 Tone.AmplitudeEnvelope 内部状态限制
   * @param {number} time - 当前时间
   * @returns {number} - 包络值 (0 到 1)
   */
  getModEnvelopeValue(time) {
    if (!this.state.modEnvelope.enabled) {
      return 0;
    }

    const envelope = this.state.modEnvelope;
    const attack = Math.max(0.0001, Number(envelope.attack || 0.0001));
    const decay = Math.max(0.0001, Number(envelope.decay || 0.0001));
    const release = Math.max(0.0001, Number(envelope.release || 0.0001));
    const peak = clamp(Number(this.modEnvelopeState.velocity || 1), 0, 1);
    const sustainLevel = clamp(Number(envelope.sustain || 0), 0, 1) * peak;

    while (true) {
      if (this.modEnvelopeState.stage === "idle") {
        return 0;
      }

      if (this.modEnvelopeState.stage === "attack") {
        const elapsed = time - this.modEnvelopeState.attackStart;
        if (elapsed < attack) {
          const progress = clamp(elapsed / attack, 0, 1);
          return this.modEnvelopeState.attackFrom + (peak - this.modEnvelopeState.attackFrom) * progress;
        }
        this.modEnvelopeState.stage = "decay";
        this.modEnvelopeState.decayStart = this.modEnvelopeState.attackStart + attack;
        continue;
      }

      if (this.modEnvelopeState.stage === "decay") {
        const elapsed = time - this.modEnvelopeState.decayStart;
        if (elapsed < decay) {
          const progress = clamp(elapsed / decay, 0, 1);
          return peak + (sustainLevel - peak) * progress;
        }
        this.modEnvelopeState.stage = "sustain";
        continue;
      }

      if (this.modEnvelopeState.stage === "sustain") {
        return sustainLevel;
      }

      if (this.modEnvelopeState.stage === "release") {
        const elapsed = time - this.modEnvelopeState.releaseStart;
        if (elapsed < release) {
          const progress = clamp(elapsed / release, 0, 1);
          return this.modEnvelopeState.releaseFrom * (1 - progress);
        }
        this.modEnvelopeState.stage = "idle";
        return 0;
      }
    }
  }

  /**
   * 触发调制包络 Attack
   * @param {number} velocity - 力度
   */
  triggerModEnvelopeAttack(velocity = 1) {
    const now = Tone.now();
    const currentValue = this.getModEnvelopeValue(now);
    this.modEnvelopeState = {
      stage: "attack",
      velocity: clamp(velocity, 0.05, 1),
      attackStart: now,
      attackFrom: currentValue,
      decayStart: now,
      releaseStart: now,
      releaseFrom: currentValue,
    };
  }

  /**
   * 触发调制包络 Release
   */
  triggerModEnvelopeRelease() {
    const now = Tone.now();
    this.modEnvelopeState = {
      ...this.modEnvelopeState,
      stage: "release",
      releaseStart: now,
      releaseFrom: this.getModEnvelopeValue(now),
    };
  }

  /* -------------------------------------------------------------------------- */
  /* 调制绑定解析                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 解析调制绑定
   * @param {string} targetId - 目标ID
   * @returns {Object|null} - 调制绑定信息
   */
  resolveModBinding(targetId) {
    const targets = getModulationTargets(this.state);
    const meta = targets.find((entry) => entry.value === targetId);
    if (!meta) {
      return null;
    }

    // 滤波器目标
    if (targetId === "filter.frequency") {
      return {
        ...meta,
        base: Number(this.state.filter.frequency),
        apply: (value) => rampParam(this.filter.frequency, value, 0.03),
      };
    }

    if (targetId === "filter.Q") {
      return {
        ...meta,
        base: Number(this.state.filter.Q),
        apply: (value) => rampParam(this.filter.Q, value, 0.03),
      };
    }

    // 解析目标ID
    const [group, moduleId, ...pathParts] = targetId.split(":");
    const prop = pathParts.join(":");

    // 声源目标
    if (group === "source") {
      const module = findById(this.state.sources, moduleId);
      const runtime = this.sourceRuntimes.get(moduleId);
      if (!module || !runtime) {
        return null;
      }

      if (prop === "volume") {
        return {
          ...meta,
          base: Number(module.volume),
          apply: (value) => rampParam(runtime.volumeNode.volume, value, 0.03),
        };
      }
      if (prop === "pan") {
        return {
          ...meta,
          base: Number(module.pan),
          apply: (value) => rampParam(runtime.panNode.pan, value, 0.03),
        };
      }

      const paramPath = prop;
      if (
        paramPath.startsWith("options.") ||
        paramPath.startsWith("ampEnvelope.") ||
        paramPath.startsWith("options.envelope.")
      ) {
        const baseValue = getByPath(module, paramPath);
        if (typeof baseValue === "number") {
          const toneParam = this.resolveToneParam(runtime.node, paramPath);
          if (toneParam) {
            return {
              ...meta,
              base: Number(baseValue),
              apply: (value) => rampParam(toneParam, value, 0.03),
            };
          }
        }
      }
      return null;
    }

    // 组件目标
    if (group === "component") {
      const module = findById(this.state.components, moduleId);
      const runtime = this.componentRuntimes.get(moduleId)?.node;
      if (!module || !runtime) {
        return null;
      }

      const paramPath = `options.${prop}`;
      const baseValue = getByPath(module, paramPath);
      if (typeof baseValue === "number") {
        const toneParam = this.resolveToneParam(runtime, paramPath);
        if (toneParam) {
          return {
            ...meta,
            base: Number(baseValue),
            apply: (value) => rampParam(toneParam, value, 0.03),
          };
        }
      }
      return null;
    }

    // 效果器目标
    if (group === "effect") {
      const module = findById(this.state.effects, moduleId);
      const runtime = this.effectRuntimes.get(moduleId)?.node;
      if (!module || !runtime) {
        return null;
      }

      const paramPath = `options.${prop}`;
      const baseValue = getByPath(module, paramPath);
      if (typeof baseValue === "number") {
        const toneParam = this.resolveToneParam(runtime, paramPath);
        if (toneParam) {
          return {
            ...meta,
            base: Number(baseValue),
            apply: (value) => rampParam(toneParam, value, 0.03),
          };
        }
      }
      return null;
    }

    return null;
  }

  /**
   * 解析 Tone.js 参数
   * @param {Object} node - Tone 节点
   * @param {string} path - 参数路径
   * @returns {Object|null} - Tone 参数对象
   */
  resolveToneParam(node, path) {
    if (!node) return null;
    const parts = path.split(".");
    let current = node;
    for (let i = 0; i < parts.length; i++) {
      if (current == null) return null;
      const part = parts[i];
      if (i === parts.length - 1) {
        const param = current[part];
        if (param && typeof param.setValueAtTime === "function") {
          return param;
        }
        return null;
      }
      current = current[part];
    }
    return null;
  }

  /* -------------------------------------------------------------------------- */
  /* 调制应用                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 应用调制快照
   * 每一帧把所有启用中的 route 累积成目标参数偏移，并应用到真实 Tone 节点上
   */
  applyModulationSnapshot() {
    if (!this.ready) {
      return;
    }

    const now = Tone.now();
    const lfoSignal = this.getLfoValue(now) * clamp(Number(this.state.lfo.amount ?? 1), 0, 1);
    const envelopeSignal = this.getModEnvelopeValue(now);

    // 合并所有活跃路由
    const activeRoutes = [
      ...(this.state.modulation?.lfoRoutes || []).map((route) => ({
        ...route,
        source: "lfo",
        signal: lfoSignal,
      })),
      ...(this.state.modulation?.envelopeRoutes || []).map((route) => ({
        ...route,
        source: "envelope",
        signal: envelopeSignal,
      })),
    ].filter((route) => route.enabled !== false);

    // 累积调制值
    const accumulator = new Map();
    const targetsToRefresh = new Set([
      ...this.lastModulatedTargets,
      ...activeRoutes.map((route) => route.target),
    ]);

    activeRoutes.forEach((route) => {
      const binding = this.resolveModBinding(route.target);
      if (!binding) {
        return;
      }

      const current = accumulator.get(route.target) || { binding, delta: 0 };
      current.delta += Number(route.amount || 0) * Number(route.signal || 0) * binding.scale(binding.base);
      accumulator.set(route.target, current);
    });

    // 应用调制值
    targetsToRefresh.forEach((targetId) => {
      const entry = accumulator.get(targetId);
      const binding = entry?.binding || this.resolveModBinding(targetId);
      if (!binding) {
        return;
      }
      const nextValue = clamp(binding.base + (entry?.delta || 0), binding.min, binding.max);
      binding.apply(nextValue);
    });

    this.lastModulatedTargets = targetsToRefresh;
  }

  /* -------------------------------------------------------------------------- */
  /* 声源运行时创建                                                             */
  /* -------------------------------------------------------------------------- */

  /**
   * 创建声源运行时
   * source runtime 统一包装出：
   * apply / triggerAttack / triggerRelease / releaseAll / dispose
   * 让上层不用关心当前 source 到底是 oscillator、sample player 还是鼓合成器
   * @param {Object} module - 声源模块
   * @returns {Object} - 运行时对象
   */
  createSourceRuntime(module) {
    const definition = SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator;
    let moduleState = deepClone(module);

    // 创建音量和声像节点
    const volumeNode = new Tone.Volume(module.enabled ? module.volume : -48);
    const panNode = new Tone.Panner(module.pan);
    volumeNode.connect(panNode);
    panNode.connect(this.sourceBus);

    let node;
    let auxEnvelope = null;
    let activePlayerKey = "";

    // 音高计算工具
    const getNoteFrequency = (note) => Tone.Frequency(note).toFrequency();
    const getPitchRatio = (note) => {
      const root = Tone.Frequency(moduleState.rootNote || "C4").toFrequency();
      return getNoteFrequency(note) / root;
    };
    const getPlayersKey = (note) => {
      const octave = Number(String(note).replace(/[^0-9-]/g, "")) || 4;
      if (octave <= 3) {
        return "low";
      }
      if (octave >= 5) {
        return "high";
      }
      return "mid";
    };

    // 根据运行时类型创建节点
    if (definition.runtime === "pitchedSource") {
      node = new Tone[definition.voiceClass](module.options);
      auxEnvelope = new Tone.AmplitudeEnvelope(module.ampEnvelope);
      node.connect(auxEnvelope);
      auxEnvelope.connect(volumeNode);
      node.start();
    } else if (definition.runtime === "noise") {
      node = new Tone.Noise(module.options);
      auxEnvelope = new Tone.AmplitudeEnvelope(module.ampEnvelope);
      node.connect(auxEnvelope);
      auxEnvelope.connect(volumeNode);
      node.start();
    } else if (definition.runtime === "grainPlayer") {
      node = new Tone.GrainPlayer(moduleState.options);
      auxEnvelope = new Tone.AmplitudeEnvelope(module.ampEnvelope);
      node.connect(auxEnvelope);
      auxEnvelope.connect(volumeNode);
      node.start();
    } else if (definition.runtime === "player") {
      node = new Tone.Player(moduleState.options);
      applyPlayerLikeOptions(node, moduleState.options);
      node.connect(volumeNode);
    } else if (definition.runtime === "players") {
      node = new Tone.Players(moduleState.options.urls || {});
      applyPlayersOptions(node, moduleState.options);
      node.connect(volumeNode);
    } else if (definition.runtime === "monoTrigger") {
      node = new Tone[definition.voiceClass](moduleState.options);
      node.connect(volumeNode);
    } else {
      node = new Tone.Oscillator(moduleState.options);
      auxEnvelope = new Tone.AmplitudeEnvelope(module.ampEnvelope);
      node.connect(auxEnvelope);
      auxEnvelope.connect(volumeNode);
      node.start();
    }

    return {
      type: definition.runtime,
      node,
      volumeNode,
      panNode,
      auxEnvelope,

      /**
       * 应用模块状态更新
       * @param {Object} nextModule - 新的模块状态
       */
      apply: (nextModule) => {
        moduleState = deepClone(nextModule);
        // enabled=false 不销毁节点，只把音量拉低，切换时更平滑
        rampParam(volumeNode.volume, moduleState.enabled ? moduleState.volume : -48);
        rampParam(panNode.pan, moduleState.pan);

        if (
          definition.runtime === "pitchedSource" ||
          definition.runtime === "noise" ||
          definition.runtime === "grainPlayer"
        ) {
          safeSet(node, moduleState.options);
          if (definition.runtime === "grainPlayer") {
            applyPlayerLikeOptions(node, moduleState.options);
          }
          if (auxEnvelope) {
            safeSet(auxEnvelope, moduleState.ampEnvelope);
          }
        } else if (definition.runtime === "player") {
          safeSet(node, moduleState.options);
          applyPlayerLikeOptions(node, moduleState.options);
        } else if (definition.runtime === "monoTrigger") {
          safeSet(node, moduleState.options);
        } else {
          Object.entries(moduleState.options.urls || {}).forEach(([key, value]) => {
            if (typeof node.player === "function" && node.player(key)) {
              node.player(key).load(value);
            }
          });
          applyPlayersOptions(node, moduleState.options);
        }
      },

      /**
       * 触发 Attack
       * @param {string} note - 音符
       * @param {number} velocity - 力度
       */
      triggerAttack: (note, velocity) => {
        if (!moduleState.enabled) {
          return;
        }

        if (definition.runtime === "pitchedSource") {
          if (node.frequency) {
            node.frequency.rampTo(getNoteFrequency(note), 0.02);
          }
          auxEnvelope.triggerAttack(Tone.now(), velocity);
        } else if (definition.runtime === "noise") {
          auxEnvelope.triggerAttack(Tone.now(), velocity);
        } else if (definition.runtime === "grainPlayer") {
          if ("playbackRate" in node) {
            node.playbackRate = getPitchRatio(note) * Number(moduleState.options.playbackRate || 1);
          }
          auxEnvelope.triggerAttack(Tone.now(), velocity);
        } else if (definition.runtime === "player") {
          if ("playbackRate" in node) {
            node.playbackRate = getPitchRatio(note) * Number(moduleState.options.playbackRate || 1);
          }
          try {
            node.stop(Tone.now());
          } catch {}
          node.start(Tone.now());
        } else if (definition.runtime === "players") {
          const key = getPlayersKey(note);
          const player = typeof node.player === "function" ? node.player(key) : null;
          if (player) {
            activePlayerKey = key;
            try {
              player.stop(Tone.now());
            } catch {}
            if ("playbackRate" in player) {
              player.playbackRate = getPitchRatio(note) * Number(moduleState.options.playbackRate || 1);
            }
            player.start(Tone.now());
          }
        } else if (definition.runtime === "monoTrigger") {
          node.triggerAttack(note, Tone.now(), velocity);
        }
      },

      /**
       * 触发 Release
       * @param {string} note - 音符
       */
      triggerRelease: (note) => {
        if (
          definition.runtime === "pitchedSource" ||
          definition.runtime === "noise" ||
          definition.runtime === "grainPlayer"
        ) {
          auxEnvelope.triggerRelease(Tone.now());
        } else if (definition.runtime === "player") {
          try {
            node.stop(Tone.now());
          } catch {}
        } else if (definition.runtime === "players") {
          const player =
            activePlayerKey && typeof node.player === "function"
              ? node.player(activePlayerKey)
              : null;
          if (player) {
            try {
              player.stop(Tone.now());
            } catch {}
          }
          activePlayerKey = "";
        } else if (definition.runtime === "monoTrigger" && typeof node.triggerRelease === "function") {
          node.triggerRelease(note, Tone.now());
        }
      },

      /**
       * 释放所有音符
       */
      releaseAll: () => {
        if (
          definition.runtime === "pitchedSource" ||
          definition.runtime === "noise" ||
          definition.runtime === "grainPlayer"
        ) {
          auxEnvelope.triggerRelease(Tone.now());
        } else if (definition.runtime === "player") {
          try {
            node.stop(Tone.now());
          } catch {}
        } else if (definition.runtime === "players") {
          ["low", "mid", "high"].forEach((key) => {
            const player = typeof node.player === "function" ? node.player(key) : null;
            if (player) {
              try {
                player.stop(Tone.now());
              } catch {}
            }
          });
          activePlayerKey = "";
        } else if (definition.runtime === "monoTrigger") {
          if (typeof node.triggerRelease === "function") {
            node.triggerRelease(Tone.now());
          }
        }
      },

      /**
       * 销毁运行时
       */
      dispose: () => {
        if (node && typeof node.dispose === "function") {
          node.dispose();
        }
        if (auxEnvelope) {
          auxEnvelope.dispose();
        }
        volumeNode.dispose();
        panNode.dispose();
      },
    };
  }

  /* -------------------------------------------------------------------------- */
  /* 音符触发                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 触发音符 Attack
   * 全局音量包络和 mod envelope 只在"第一个音开始"时触发一次
   * 避免和多音 source 的内部包络重复冲突
   * @param {string} note - 音符
   * @param {number} velocity - 力度
   */
  attack(note, velocity) {
    if (!this.ready) {
      return;
    }

    if (!this.activeNotes.size) {
      if (this.state.envelope.enabled !== false) {
        this.ampEnvelope.triggerAttack(Tone.now(), velocity);
      }
      if (this.state.modEnvelope.enabled) {
        this.triggerModEnvelopeAttack(velocity);
      }
    }

    this.activeNotes.add(note);
    this.sourceRuntimes.forEach((runtime) => runtime.triggerAttack(note, velocity));
  }

  /**
   * 触发音符 Release
   * @param {string} note - 音符
   */
  release(note) {
    if (!this.ready) {
      return;
    }

    this.activeNotes.delete(note);
    this.sourceRuntimes.forEach((runtime) => runtime.triggerRelease(note));

    if (!this.activeNotes.size) {
      if (this.state.envelope.enabled !== false) {
        this.ampEnvelope.triggerRelease(Tone.now());
      }
      if (this.state.modEnvelope.enabled) {
        this.triggerModEnvelopeRelease();
      }
    }
  }

  /**
   * 静音所有音符
   */
  silenceAll() {
    this.activeNotes.clear();
    if (!this.ready) {
      return;
    }
    this.sourceRuntimes.forEach((runtime) => runtime.releaseAll());
    if (this.state.envelope.enabled !== false) {
      this.ampEnvelope.triggerRelease(Tone.now());
    }
    this.modEnvelopeState = {
      stage: "idle",
      velocity: 1,
      attackStart: 0,
      attackFrom: 0,
      decayStart: 0,
      releaseStart: 0,
      releaseFrom: 0,
    };
  }
}
