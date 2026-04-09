/**
 * audio-engine.js
 * 音频引擎类
 * 
 * 基于编号的信号链系统：
 * - 所有模块按编号顺序连接
 * - Source 模块绕过后续 Source，连接到下一个非 Source 模块
 * - 每个 Source 自动添加隐藏 AmpEnv（当链路中没有显式 AmpEnv 时启用）
 */

/* -------------------------------------------------------------------------- */
/* AudioEngine 类                                                             */
/* -------------------------------------------------------------------------- */

class AudioEngine {
  constructor() {
    // 引擎状态
    this.ready = false;
    this.state = null;
    
    // 统一的模块运行时映射
    this.moduleRuntimes = new Map();
    
    // 活跃音符集合
    this.activeNotes = new Set();

    // 调制连接运行时（用于统一释放 Tone.Scale）
    this.modulationRuntimes = [];
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
    Tone.context.lookAhead = 0;
    this.state = deepClone(state);
    this.ready = true;

    // 创建主输出节点
    this.masterVolume = new Tone.Volume(state.global.volume);
    this.analyser = new Tone.Analyser("waveform", 1024);

    // 连接主输出
    this.masterVolume.toDestination();
    this.masterVolume.connect(this.analyser);

    // 构建信号链
    this.rebuildSignalChain();
  }

  /**
   * 获取分析器节点
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
   * @param {Object} state - 应用状态
   */
  fullSync(state) {
    this.state = deepClone(state);
    if (!this.ready) {
      return;
    }

    rampParam(this.masterVolume.volume, state.global.volume);
    this.silenceAll();
    this.rebuildSignalChain();
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
  }

  /**
   * 轻量级更新调制范围
   * 只更新 scale 参数，不重建信号链
   * @param {string} modulationId - 调制连接ID
   * @param {number} scaleMin - 最小值
   * @param {number} scaleMax - 最大值
   */
  updateModulationRange(modulationId, scaleMin, scaleMax) {
    const item = this.modulationRuntimes.find((m) => m.id === modulationId);
    if (!item || !item.scale) {
      return;
    }
    const scale = item.scale;
    if ("outputMin" in scale) {
      scale.outputMin = Number(scaleMin ?? 0);
    } else if ("min" in scale) {
      scale.min = Number(scaleMin ?? 0);
    }
    if ("outputMax" in scale) {
      scale.outputMax = Number(scaleMax ?? 1);
    } else if ("max" in scale) {
      scale.max = Number(scaleMax ?? 1);
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 模块类型判断                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 判断模块是否为 Source 类型
   * @param {Object} module - 模块对象
   * @returns {boolean} - 是否为 Source
   */
  isSourceModule(module) {
    return module.type === "Envelope" || module.category === "source" || SOURCE_LIBRARY[module.type] !== undefined;
  }

  /**
   * 判断模块是否为 AmplitudeEnvelope 类型
   * @param {Object} module - 模块对象
   * @returns {boolean} - 是否为 AmplitudeEnvelope
   */
  isAmpEnvModule(module) {
    return module.type === "AmplitudeEnvelope";
  }

  /**
   * 创建按 note 追踪的 voice 状态器
   * @param {number} voiceCount - voice 数量
   * @returns {Object} - 状态器
   */
  createNoteVoiceTracker(voiceCount) {
    const voiceStates = Array.from({ length: voiceCount }, () => ({
      note: null,
      startTime: 0,
    }));

    const findAvailableVoice = () => {
      let oldest = null;
      let oldestIndex = -1;
      for (let i = 0; i < voiceStates.length; i++) {
        if (!voiceStates[i].note) {
          return i;
        }
        if (!oldest || voiceStates[i].startTime < oldest.startTime) {
          oldest = voiceStates[i];
          oldestIndex = i;
        }
      }
      return oldest ? oldestIndex : 0;
    };

    return {
      allocate(note, time) {
        const index = findAvailableVoice();
        voiceStates[index].note = note;
        voiceStates[index].startTime = time;
        return index;
      },
      releaseByNote(note) {
        const index = voiceStates.findIndex((item) => item.note === note);
        if (index < 0) {
          return -1;
        }
        voiceStates[index].note = null;
        return index;
      },
      clearAll() {
        voiceStates.forEach((item) => {
          item.note = null;
          item.startTime = 0;
        });
      },
      hasActiveNotes() {
        return voiceStates.some((item) => item.note !== null);
      },
    };
  }

  /* -------------------------------------------------------------------------- */
  /* 信号链构建                                                                 */
  /* -------------------------------------------------------------------------- */

  /**
   * 重建信号链
   * 核心逻辑：
   * 1. 清理旧运行时
   * 2. 为每个模块创建运行时（Source 额外创建隐藏 AmpEnv）
   * 3. 按编号顺序连接模块，Source 绕过后续 Source
   */
  rebuildSignalChain() {
    if (!this.masterVolume) {
      return;
    }

    // 清理旧运行时
    this.moduleRuntimes.forEach((runtime) => {
      if (runtime.dispose) {
        runtime.dispose();
      }
    });
    this.moduleRuntimes.clear();
    this.modulationRuntimes.forEach((item) => {
      if (item.scale && typeof item.scale.dispose === "function") {
        item.scale.dispose();
      }
    });
    this.modulationRuntimes = [];

    const modules = this.state.modules || [];
    if (modules.length === 0) {
      return;
    }

    // 为每个模块创建运行时
    modules.forEach((module) => {
      const runtime = this.createModuleRuntime(module);
      this.moduleRuntimes.set(module.id, runtime);
    });

    // 构建信号链连接
    this.connectSignalChain(modules);
    // 构建调制连接
    this.connectModulations(modules);
  }

  /**
   * 连接信号链
   * @param {Array} modules - 模块数组（按编号排序）
   */
  connectSignalChain(modules) {
    // 找出所有 AmpEnv 模块的位置
    const ampEnvIndices = new Set();
    modules.forEach((module, index) => {
      if (this.isAmpEnvModule(module) && module.enabled) {
        ampEnvIndices.add(index);
      }
    });

    // 为每个模块确定目标连接
    modules.forEach((module, index) => {
      const runtime = this.moduleRuntimes.get(module.id);
      if (!runtime || !module.enabled) {
        return;
      }

      // Source 模块需要特殊处理
      if (this.isSourceModule(module)) {
        this.connectSourceModule(modules, index, runtime, ampEnvIndices);
      } else {
        // 非 Source 模块连接到下一个非 Source 模块或 masterVolume
        this.connectNonSourceModule(modules, index, runtime);
      }
    });
  }

  /**
   * 连接 Source 模块
   * 当 AmpEnv 在第一个位置时：Voice[i] → AmpEnv.voices[i]
   * 当 AmpEnv 不在第一个位置时：Voice[i] → hiddenAmpEnv → 目标模块（release = 10s）
   * 当没有 AmpEnv 时：Voice[i] → hiddenAmpEnv → 目标模块（release = 0.005s）
   * @param {Array} modules - 模块数组
   * @param {number} sourceIndex - Source 索引
   * @param {Object} runtime - Source 运行时
   * @param {Set} ampEnvIndices - AmpEnv 模块索引集合
   */
  connectSourceModule(modules, sourceIndex, runtime, ampEnvIndices) {
    const sourceModule = modules[sourceIndex];
    if (sourceModule?.type === "Envelope") {
      return;
    }
    if (sourceModule?.modulationMode) {
      runtime.hasAmpEnv = false;
      runtime.ampEnvRuntime = null;
      return;
    }

    // 查找 Source 之后第一个非 Source 模块
    let targetIndex = -1;
    for (let i = sourceIndex + 1; i < modules.length; i++) {
      if (!this.isSourceModule(modules[i]) && modules[i].enabled) {
        targetIndex = i;
        break;
      }
    }

    // 检查第一个非 Source 模块是否为 AmpEnv
    const isFirstModuleAmpEnv = targetIndex >= 0 && ampEnvIndices.has(targetIndex);

    // 检查信号链中是否存在 AmpEnv（用于设置 hiddenAmpEnv release 时间）
    let hasAmpEnvAnywhere = false;
    for (let i = sourceIndex + 1; i < modules.length; i++) {
      if (ampEnvIndices.has(i)) {
        hasAmpEnvAnywhere = true;
        break;
      }
    }

    // 设置 hiddenAmpEnv release 时间
    // 如果 AmpEnv 存在但不在第一个位置，需要根据活跃 voice 数量动态调整 release 时间
    const needsExtendedRelease = hasAmpEnvAnywhere && !isFirstModuleAmpEnv;
    runtime.needsExtendedRelease = needsExtendedRelease;
    runtime.voices.forEach((voice) => {
      voice.hiddenAmpEnv.release = needsExtendedRelease ? 10 : 0.005;
    });

    runtime.hasAmpEnv = isFirstModuleAmpEnv;

    if (isFirstModuleAmpEnv) {
      // AmpEnv 在第一个位置：Voice[i] → AmpEnv.voices[i]
      const ampEnvModule = modules[targetIndex];
      const ampEnvRuntime = this.moduleRuntimes.get(ampEnvModule.id);
      runtime.ampEnvRuntime = ampEnvRuntime;

      runtime.voices.forEach((voice, i) => {
        if (ampEnvRuntime && ampEnvRuntime.voices && ampEnvRuntime.voices[i]) {
          voice.panNode.connect(ampEnvRuntime.voices[i]);
        }
      });
    } else {
      // AmpEnv 不在第一个位置或不存在：Voice[i] → hiddenAmpEnv → 目标模块
      runtime.ampEnvRuntime = null;

      let targetNode;
      if (targetIndex >= 0) {
        const targetModule = modules[targetIndex];
        const targetRuntime = this.moduleRuntimes.get(targetModule.id);
        targetNode = targetRuntime && targetRuntime.node;
      } else {
        targetNode = this.masterVolume;
      }

      runtime.voices.forEach((voice) => {
        if (targetNode) {
          voice.hiddenAmpEnv.connect(targetNode);
        }
      });
    }
  }

  /**
   * 连接非 Source 模块
   * AmplitudeEnvelope 特殊处理：同时支持 node 和 voices 两种输入模式
   * @param {Array} modules - 模块数组
   * @param {number} moduleIndex - 模块索引
   * @param {Object} runtime - 模块运行时
   */
  connectNonSourceModule(modules, moduleIndex, runtime) {
    // AmplitudeEnvelope 特殊处理：node 和 voices 都连接到目标
    if (runtime.type === "AmplitudeEnvelope") {
      let targetIndex = -1;
      for (let i = moduleIndex + 1; i < modules.length; i++) {
        if (!this.isSourceModule(modules[i]) && modules[i].enabled) {
          targetIndex = i;
          break;
        }
      }

      let targetNode;
      if (targetIndex >= 0) {
        const targetModule = modules[targetIndex];
        const targetRuntime = this.moduleRuntimes.get(targetModule.id);
        targetNode = targetRuntime && targetRuntime.node;
      } else {
        targetNode = this.masterVolume;
      }

      if (targetNode) {
        // node 模式连接
        if (runtime.node) {
          runtime.node.connect(targetNode);
        }
        // voices 模式连接
        if (runtime.voices) {
          runtime.voices.forEach((env) => env.connect(targetNode));
        }
      }
      return;
    }

    // 查找下一个非 Source 模块
    let targetIndex = -1;
    for (let i = moduleIndex + 1; i < modules.length; i++) {
      if (!this.isSourceModule(modules[i]) && modules[i].enabled) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex >= 0) {
      // 连接到下一个非 Source 模块
      const targetModule = modules[targetIndex];
      const targetRuntime = this.moduleRuntimes.get(targetModule.id);
      if (targetRuntime && targetRuntime.node) {
        runtime.node.connect(targetRuntime.node);
      }
    } else {
      // 没有下一个模块，连接到 masterVolume
      runtime.node.connect(this.masterVolume);
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 模块运行时创建                                                             */
  /* -------------------------------------------------------------------------- */

  /**
   * 创建模块运行时
   * @param {Object} module - 模块对象
   * @returns {Object} - 运行时对象
   */
  createModuleRuntime(module) {
    if (module.type === "Envelope") {
      return this.createEnvelopeModulationRuntime(module);
    }
    if (this.isSourceModule(module)) {
      return this.createSourceRuntime(module);
    }
    return this.createEffectRuntime(module);
  }

  /**
   * 创建 Source 运行时
   * 使用 Voice 池实现复音，每个 Voice 独立连接到目标模块
   * @param {Object} module - Source 模块
   * @returns {Object} - 运行时对象
   */
  createSourceRuntime(module) {
    const definition = SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator;
    let moduleState = deepClone(module);
    const VOICE_COUNT = 8;

    const getNoteFrequency = (note) => Tone.Frequency(note).toFrequency();
    const getPitchRatio = (note) => {
      const root = Tone.Frequency(moduleState.rootNote || "C4").toFrequency();
      return getNoteFrequency(note) / root;
    };

    /**
     * 创建单个 Voice
     * hiddenAmpEnv 始终作为 gate，空闲时关闭输出
     * @returns {Object} - Voice 对象
     */
    const createVoice = () => {
      const volumeNode = new Tone.Volume(module.enabled ? module.volume : -48);
      const panNode = new Tone.Panner(module.pan);
      volumeNode.connect(panNode);

      const hiddenAmpEnv = new Tone.AmplitudeEnvelope({
        attack: 0.005,
        decay: 0.01,
        sustain: 1,
        release: 0.005,
      });
      panNode.connect(hiddenAmpEnv);

      let node;
      if (definition.runtime === "pitchedSource") {
        node = new Tone[module.type](module.options);
        node.connect(volumeNode);
        node.start();
      } else if (definition.runtime === "noise") {
        node = new Tone.Noise(module.options);
        node.connect(volumeNode);
        node.start();
      } else if (definition.runtime === "player") {
        node = new Tone.Player(moduleState.options);
        applyPlayerLikeOptions(node, moduleState.options);
        node.connect(volumeNode);
      } else {
        node = new Tone.Oscillator(module.options);
        node.connect(volumeNode);
        node.start();
      }

      return {
        node,
        volumeNode,
        panNode,
        hiddenAmpEnv,
        note: null,
        startTime: 0,
      };
    };

    const voices = Array.from({ length: VOICE_COUNT }, createVoice);

    /**
     * 查找可用 Voice：优先空闲，无空闲时复用最旧
     * @returns {Object|null} - { voice, index } 或 null
     */
    const findAvailableVoice = () => {
      let oldest = null;
      let oldestIndex = -1;
      for (let i = 0; i < voices.length; i++) {
        if (!voices[i].note) {
          return { voice: voices[i], index: i };
        }
        if (!oldest || voices[i].startTime < oldest.startTime) {
          oldest = voices[i];
          oldestIndex = i;
        }
      }
      return oldest ? { voice: oldest, index: oldestIndex } : null;
    };

    /**
     * 根据音符查找 Voice
     * @param {string} note - 音符
     * @returns {Object|null} - { voice, index } 或 null
     */
    const findVoiceByNote = (note) => {
      const index = voices.findIndex((v) => v.note === note);
      return index >= 0 ? { voice: voices[index], index } : null;
    };

    /**
     * 触发 AmpEnv 包络（带引用计数）
     * 使用 voices 模式的 triggerVoiceAttack 方法
     * @param {number} voiceIndex - Voice 索引
     * @param {number} velocity - 力度
     */
    const triggerAmpEnvAttack = (voiceIndex, velocity) => {
      const ampEnv = runtime.ampEnvRuntime;
      if (!ampEnv || typeof ampEnv.triggerVoiceAttack !== "function") {
        return;
      }
      ampEnv.triggerVoiceAttack(voiceIndex, velocity);
    };

    /**
     * 释放 AmpEnv 包络（带引用计数）
     * 使用 voices 模式的 triggerVoiceRelease 方法
     * @param {number} voiceIndex - Voice 索引
     */
    const triggerAmpEnvRelease = (voiceIndex) => {
      const ampEnv = runtime.ampEnvRuntime;
      if (!ampEnv || typeof ampEnv.triggerVoiceRelease !== "function") {
        return;
      }
      ampEnv.triggerVoiceRelease(voiceIndex);
    };

    /**
     * 计算当前活跃的 voice 数量
     * @returns {number}
     */
    const getActiveVoiceCount = () => voices.filter((v) => v.note !== null).length;

    /**
     * 更新 hiddenAmpEnv 的 release 时间
     * 当 needsExtendedRelease 为 true 时，只有活跃 voice ≤ 1 时才使用 10 秒 release
     */
    const updateHiddenAmpEnvRelease = () => {
      if (!runtime.needsExtendedRelease) {
        return;
      }
      const activeCount = getActiveVoiceCount();
      const releaseTime = activeCount <= 1 ? 10 : 0.005;
      voices.forEach((voice) => {
        voice.hiddenAmpEnv.release = releaseTime;
      });
    };

    const runtime = {
      type: module.type,
      category: "source",
      voices,
      definition,
      moduleState,
      hasAmpEnv: false,
      ampEnvRuntime: null,
      needsExtendedRelease: false,

      /**
       * 获取指定 Voice 的调制输出节点
       * 调制模式下直接使用 panNode 输出，不经过 hiddenAmpEnv
       * @param {number} voiceIndex - Voice 索引
       * @returns {Tone.ToneAudioNode|null}
       */
      getModulationOutput: (voiceIndex) => {
        const voice = voices[voiceIndex];
        return voice ? voice.panNode : null;
      },

      apply: (nextModule) => {
        const wasModulationMode = Boolean(moduleState?.modulationMode);
        moduleState = deepClone(nextModule);
        voices.forEach((voice) => {
          rampParam(voice.volumeNode.volume, moduleState.enabled ? moduleState.volume : -48);
          rampParam(voice.panNode.pan, moduleState.pan);

          if (definition.runtime === "pitchedSource") {
            safeSet(voice.node, moduleState.options);
          } else if (definition.runtime === "noise") {
            safeSet(voice.node, moduleState.options);
          } else if (definition.runtime === "player") {
            safeSet(voice.node, moduleState.options);
            applyPlayerLikeOptions(voice.node, moduleState.options);
          }

          if (moduleState.modulationMode) {
            // 调制模式下保持 Voice 持续输出，不使用 hiddenAmpEnv。
            voice.hiddenAmpEnv.triggerAttack(Tone.now(), 1);
            if (definition.runtime === "pitchedSource" && voice.node.frequency) {
              voice.node.frequency.rampTo(Number(moduleState.modulationFrequency || 1), 0.02);
            }
            if (definition.runtime === "player") {
              try {
                voice.node.loop = true;
                if (voice.node.loaded) {
                  voice.node.start(Tone.now());
                }
              } catch {}
            }
          } else if (wasModulationMode && !moduleState.modulationMode) {
            // 退出调制模式时释放 hiddenAmpEnv，避免残留门控状态。
            voice.hiddenAmpEnv.triggerRelease(Tone.now());
            if (definition.runtime === "player") {
              try {
                voice.node.stop(Tone.now());
              } catch {}
            }
          }
        });
      },

      triggerAttack: (note, velocity) => {
        if (!moduleState.enabled || moduleState.modulationMode) {
          return;
        }
        const result = findAvailableVoice();
        if (!result) {
          return;
        }
        const { voice, index } = result;

        voice.note = note;
        voice.startTime = Tone.now();

        if (runtime.hasAmpEnv) {
          triggerAmpEnvAttack(index, velocity);
        } else {
          voice.hiddenAmpEnv.triggerAttack(Tone.now(), velocity);
        }

        if (definition.runtime === "pitchedSource") {
          if (voice.node.frequency) {
            voice.node.frequency.rampTo(getNoteFrequency(note), 0.02);
          }
        } else if (definition.runtime === "noise") {
          // Noise 无需特殊处理
        } else if (definition.runtime === "player") {
          if (!voice.node.loaded) {
            voice.note = null;
            if (runtime.hasAmpEnv) {
              triggerAmpEnvRelease(index);
            } else {
              voice.hiddenAmpEnv.triggerRelease(Tone.now());
            }
            updateHiddenAmpEnvRelease();
            return;
          }
          if ("playbackRate" in voice.node) {
            voice.node.playbackRate = getPitchRatio(note) * Number(moduleState.options.playbackRate || 1);
          }
          try {
            voice.node.stop(Tone.now());
          } catch {}
          voice.node.start(Tone.now());
        }
        updateHiddenAmpEnvRelease();
      },

      triggerRelease: (note) => {
        if (moduleState.modulationMode) {
          return;
        }
        const result = findVoiceByNote(note);
        if (!result) {
          return;
        }
        const { voice, index } = result;
        voice.note = null;

        if (runtime.hasAmpEnv) {
          triggerAmpEnvRelease(index);
        } else {
          voice.hiddenAmpEnv.triggerRelease(Tone.now());
        }

        if (definition.runtime === "pitchedSource") {
          // pitchedSource 无需特殊处理
        } else if (definition.runtime === "noise") {
          // Noise 无需特殊处理
        } else if (definition.runtime === "player") {
          try {
            voice.node.stop(Tone.now());
          } catch {}
        }
        updateHiddenAmpEnvRelease();
      },

      releaseAll: () => {
        if (moduleState.modulationMode) {
          return;
        }
        voices.forEach((voice, index) => {
          if (voice.note) {
            voice.note = null;
            if (runtime.hasAmpEnv) {
              triggerAmpEnvRelease(index);
            } else {
              voice.hiddenAmpEnv.triggerRelease(Tone.now());
            }
          }
          if (definition.runtime === "player") {
            try {
              voice.node.stop(Tone.now());
            } catch {}
          }
        });
        updateHiddenAmpEnvRelease();
      },

      dispose: () => {
        voices.forEach((voice) => {
          if (voice.node && typeof voice.node.dispose === "function") {
            voice.node.dispose();
          }
          voice.volumeNode.dispose();
          voice.panNode.dispose();
          voice.hiddenAmpEnv.dispose();
        });
      },
    };

    // 初次创建时同步一次模块状态，确保调制模式 Voice 立即生效。
    runtime.apply(moduleState);

    return runtime;
  }

  /**
   * 创建 Envelope 调制运行时
   * Envelope 只作为调制源，不进入主模块链，且保留 MIDI attack/release。
   * @param {Object} module - Envelope 模块
   * @returns {Object} - 运行时对象
   */
  createEnvelopeModulationRuntime(module) {
    let moduleState = deepClone(module);
    const VOICE_COUNT = 8;
    const voices = Array.from({ length: VOICE_COUNT }, () => new Tone.Envelope(moduleState.options));
    const noteTracker = this.createNoteVoiceTracker(VOICE_COUNT);

    return {
      type: module.type,
      category: "modulation-envelope",
      voices,
      moduleState,
      getModulationOutput: (voiceIndex) => voices[voiceIndex] || null,
      apply: (nextModule) => {
        moduleState = deepClone(nextModule);
        voices.forEach((env) => safeSet(env, moduleState.options));
      },
      triggerAttack: (note, velocity) => {
        if (!moduleState.enabled) {
          return;
        }
        const index = noteTracker.allocate(note, Tone.now());
        voices[index].triggerAttack(Tone.now(), velocity);
      },
      triggerRelease: (note) => {
        const index = noteTracker.releaseByNote(note);
        if (index < 0) {
          return;
        }
        voices[index].triggerRelease(Tone.now());
      },
      releaseAll: () => {
        noteTracker.clearAll();
        voices.forEach((env, index) => {
          env.triggerRelease(Tone.now());
        });
      },
      dispose: () => {
        voices.forEach((env) => env.dispose());
      },
    };
  }

  /**
   * 构建所有调制连接
   * 连接顺序：Voice 输出 -> Tone.Scale -> 目标参数
   * @param {Array} modules - 当前模块数组
   */
  connectModulations(modules) {
    const modulations = Array.isArray(this.state?.modulations) ? this.state.modulations : [];
    if (!modulations.length) {
      return;
    }

    modulations.forEach((modulation) => {
      const sourceRuntime = this.moduleRuntimes.get(modulation.sourceModuleId);
      if (!sourceRuntime || typeof sourceRuntime.getModulationOutput !== "function") {
        return;
      }

      const sourceModule = modules.find((item) => item.id === modulation.sourceModuleId);
      if (!sourceModule || !sourceModule.enabled) {
        return;
      }
      if (sourceModule.type !== "Envelope" && !sourceModule.modulationMode) {
        return;
      }

      const targetModule = modules.find((item) => item.id === modulation.targetModuleId);
      if (!targetModule || !targetModule.enabled) {
        return;
      }

      const sourceOutput = sourceRuntime.getModulationOutput(Number(modulation.sourceVoiceIndex) || 0);
      if (!sourceOutput || typeof sourceOutput.connect !== "function") {
        return;
      }

      const targetParams = this.getModulationTargetParams(targetModule, modulation.targetParamPath);
      if (!targetParams.length) {
        return;
      }

      const scale = new Tone.Scale();
      const isEnvelopeSource = sourceModule.type === "Envelope";
      if ("inputMin" in scale) {
        scale.inputMin = isEnvelopeSource ? 0 : -1;
      }
      if ("inputMax" in scale) {
        scale.inputMax = 1;
      }
      if ("outputMin" in scale) {
        scale.outputMin = Number(modulation.scaleMin ?? 0);
      } else if ("min" in scale) {
        scale.min = Number(modulation.scaleMin ?? 0);
      }
      if ("outputMax" in scale) {
        scale.outputMax = Number(modulation.scaleMax ?? 1);
      } else if ("max" in scale) {
        scale.max = Number(modulation.scaleMax ?? 1);
      }

      sourceOutput.connect(scale);
      targetParams.forEach((param) => {
        try {
          scale.connect(param);
        } catch {}
      });

      this.modulationRuntimes.push({ id: modulation.id, scale });
    });
  }

  /**
   * 解析调制目标参数列表
   * Source 目标会映射到每个 Voice 对应参数，其他模块映射到单节点参数。
   * @param {Object} module - 目标模块
   * @param {string} targetParamPath - 目标参数路径（如 options.frequency / volume）
   * @returns {Array} - Tone 参数数组
   */
  getModulationTargetParams(module, targetParamPath) {
    const runtime = this.moduleRuntimes.get(module.id);
    if (!runtime || !targetParamPath) {
      return [];
    }

    const resolveParam = (target, path) => {
      const value = getByPath(target, path);
      if (!value) {
        return null;
      }
      if (value.value !== undefined || typeof value.rampTo === "function") {
        return value;
      }
      return null;
    };

    if (module.category === "source") {
      if (!Array.isArray(runtime.voices)) {
        return [];
      }
      return runtime.voices
        .map((voice) => {
          if (targetParamPath === "volume") {
            return voice.volumeNode?.volume || null;
          }
          if (targetParamPath === "pan") {
            return voice.panNode?.pan || null;
          }
          return resolveParam(voice.node, targetParamPath.replace(/^options\./, ""));
        })
        .filter(Boolean);
    }

    const node = runtime.node;
    if (!node) {
      return [];
    }
    return [resolveParam(node, targetParamPath.replace(/^options\./, ""))].filter(Boolean);
  }

  /**
   * 创建效果器/组件运行时
   * AmplitudeEnvelope 特殊处理：同时创建 node 和 voices 两种输入模式
   * @param {Object} module - 模块对象
   * @returns {Object} - 运行时对象
   */
  createEffectRuntime(module) {
    // AmplitudeEnvelope 特殊处理：双模式输入
    if (module.type === "AmplitudeEnvelope") {
      const VOICE_COUNT = 8;
      // voices 模式：8 个 AmplitudeEnvelope 节点（用于 Source Voice 连接）
      const voices = Array.from({ length: VOICE_COUNT }, () => new Tone.AmplitudeEnvelope(module.options));
      // node 模式：1 个 AmplitudeEnvelope 节点（用于非 Source 模块连接）
      const node = new Tone.AmplitudeEnvelope(module.options);
      // voices 模式引用计数
      const voiceRefCount = new Array(VOICE_COUNT).fill(0);
      // node 模式按-note状态追踪
      const nodeNoteTracker = this.createNoteVoiceTracker(VOICE_COUNT);

      return {
        type: module.type,
        category: module.category || "component",
        voices,
        voiceRefCount,
        node,
        apply: (nextModule) => {
          voices.forEach((env) => safeSet(env, nextModule.options));
          safeSet(node, nextModule.options);
        },
        // voices 模式触发（由 Source Voice 调用，带引用计数）
        triggerVoiceAttack: (voiceIndex, velocity) => {
          if (voiceIndex < 0 || voiceIndex >= VOICE_COUNT) return;
          voiceRefCount[voiceIndex] += 1;
          if (voiceRefCount[voiceIndex] === 1) {
            voices[voiceIndex].triggerAttack(Tone.now(), velocity);
          }
        },
        triggerVoiceRelease: (voiceIndex) => {
          if (voiceIndex < 0 || voiceIndex >= VOICE_COUNT) return;
          voiceRefCount[voiceIndex] = Math.max(0, voiceRefCount[voiceIndex] - 1);
          if (voiceRefCount[voiceIndex] === 0) {
            voices[voiceIndex].triggerRelease(Tone.now());
          }
        },
        // node 模式触发（由全局 attack/release 调用，无引用计数，忽略力度）
        triggerAttack: (note, velocity) => {
          nodeNoteTracker.allocate(note, Tone.now());
          node.triggerAttack(Tone.now(), 1);
        },
        triggerRelease: (note) => {
          const releasedIndex = nodeNoteTracker.releaseByNote(note);
          if (releasedIndex >= 0 && !nodeNoteTracker.hasActiveNotes()) {
            node.triggerRelease(Tone.now());
          }
        },
        releaseAll: () => {
          // 释放 node 模式
          nodeNoteTracker.clearAll();
          node.triggerRelease(Tone.now());
          // 释放 voices 模式
          voices.forEach((env, index) => {
            voiceRefCount[index] = 0;
            env.triggerRelease(Tone.now());
          });
        },
        dispose: () => {
          voices.forEach((env) => env.dispose());
          node.dispose();
        },
      };
    }

    const RuntimeCtor = Tone[module.type];
    if (!RuntimeCtor) {
      return {
        type: module.type,
        category: module.category || "component",
        node: null,
        dispose: () => {},
      };
    }

    const node = new RuntimeCtor(module.options);

    if (typeof node.start === "function") {
      node.start();
    }
    if (typeof node.generate === "function") {
      node.generate();
    }

    return {
      type: module.type,
      category: module.category || "component",
      node,
      apply: (nextModule) => {
        safeSet(node, nextModule.options);
      },
      dispose: () => {
        if (node && typeof node.dispose === "function") {
          node.dispose();
        }
      },
    };
  }

  /* -------------------------------------------------------------------------- */
  /* 模块更新                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 更新模块
   * @param {string} moduleId - 模块ID
   * @param {Object} updates - 更新内容
   */
  updateModule(moduleId, updates) {
    const moduleIndex = this.state.modules.findIndex((m) => m.id === moduleId);
    if (moduleIndex < 0) {
      return;
    }

    // 更新状态
    this.state.modules[moduleIndex] = { ...this.state.modules[moduleIndex], ...updates };

    if (!this.ready) {
      return;
    }

    const runtime = this.moduleRuntimes.get(moduleId);
    if (runtime && runtime.apply) {
      runtime.apply(this.state.modules[moduleIndex]);
    }
  }

  /**
   * 更新声源模块（兼容旧接口）
   * @param {Object} module - 声源模块
   */
  updateSource(module) {
    this.updateModule(module.id, module);
  }

  /**
   * 更新组件模块（兼容旧接口）
   * @param {Object} module - 组件模块
   */
  updateComponent(module) {
    // 组件更新需要重建信号链
    const moduleIndex = this.state.modules.findIndex((m) => m.id === module.id);
    if (moduleIndex >= 0) {
      this.state.modules[moduleIndex] = deepClone(module);
    }
    if (this.ready) {
      this.rebuildSignalChain();
    }
  }

  /**
   * 更新效果器模块（兼容旧接口）
   * @param {Object} module - 效果器模块
   */
  updateEffect(module) {
    this.updateComponent(module);
  }

  /* -------------------------------------------------------------------------- */
  /* 音符触发                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 触发音符 Attack
   * Source Voice 触发 AmpEnv.voices 模式（由 Source runtime.triggerAttack 处理）
   * AmpEnv.node 模式在此处触发（用于非 Source 模块信号）
   * @param {string} note - 音符
   * @param {number} velocity - 力度
   */
  attack(note, velocity) {
    if (!this.ready) {
      return;
    }

    this.activeNotes.add(note);

    // 触发所有 Source 的 attack（AmpEnv voices 模式或 hiddenAmpEnv 在此触发）
    this.moduleRuntimes.forEach((runtime) => {
      if ((runtime.category === "source" || runtime.category === "modulation-envelope") && runtime.triggerAttack) {
        runtime.triggerAttack(note, velocity);
      }
    });

    // 触发所有 AmpEnv 的 node 模式
    this.moduleRuntimes.forEach((runtime) => {
      if (runtime.type === "AmplitudeEnvelope" && runtime.node && runtime.triggerAttack) {
        runtime.triggerAttack(note, velocity);
      }
    });
  }

  /**
   * 触发音符 Release
   * Source Voice 触发 AmpEnv.voices 模式（由 Source runtime.triggerRelease 处理）
   * AmpEnv.node 模式在此处触发（用于非 Source 模块信号）
   * @param {string} note - 音符
   */
  release(note) {
    if (!this.ready) {
      return;
    }

    this.activeNotes.delete(note);

    // 触发所有 Source 的 release（AmpEnv voices 模式或 hiddenAmpEnv 在此触发）
    this.moduleRuntimes.forEach((runtime) => {
      if ((runtime.category === "source" || runtime.category === "modulation-envelope") && runtime.triggerRelease) {
        runtime.triggerRelease(note);
      }
    });

    // 触发所有 AmpEnv 的 node 模式 release
    this.moduleRuntimes.forEach((runtime) => {
      if (runtime.type === "AmplitudeEnvelope" && runtime.node && runtime.triggerRelease) {
        runtime.triggerRelease(note);
      }
    });
  }

  /**
   * 静音所有音符
   * 释放所有 Source 和 AmpEnv 的 node 模式
   */
  silenceAll() {
    this.activeNotes.clear();
    if (!this.ready) {
      return;
    }

    // 释放所有 Source（AmpEnv voices 模式或 hiddenAmpEnv 在此触发）
    this.moduleRuntimes.forEach((runtime) => {
      if ((runtime.category === "source" || runtime.category === "modulation-envelope") && runtime.releaseAll) {
        runtime.releaseAll();
      }
    });

    // 释放所有 AmpEnv 的 node 模式
    this.moduleRuntimes.forEach((runtime) => {
      if (runtime.type === "AmplitudeEnvelope" && runtime.node && runtime.releaseAll) {
        runtime.releaseAll();
      }
    });
  }
}
