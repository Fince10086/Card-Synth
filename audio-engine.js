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

  /* -------------------------------------------------------------------------- */
  /* 模块类型判断                                                               */
  /* -------------------------------------------------------------------------- */

  /**
   * 判断模块是否为 Source 类型
   * @param {Object} module - 模块对象
   * @returns {boolean} - 是否为 Source
   */
  isSourceModule(module) {
    return module.category === "source" || SOURCE_LIBRARY[module.type] !== undefined;
  }

  /**
   * 判断模块是否为 AmplitudeEnvelope 类型
   * @param {Object} module - 模块对象
   * @returns {boolean} - 是否为 AmplitudeEnvelope
   */
  isAmpEnvModule(module) {
    return module.type === "AmplitudeEnvelope";
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
   * Source 需要绕过后续 Source，并判断是否启用隐藏 AmpEnv
   * @param {Array} modules - 模块数组
   * @param {number} sourceIndex - Source 索引
   * @param {Object} runtime - Source 运行时
   * @param {Set} ampEnvIndices - AmpEnv 模块索引集合
   */
  connectSourceModule(modules, sourceIndex, runtime, ampEnvIndices) {
    // 查找 Source 之后第一个非 Source 模块
    let targetIndex = -1;
    for (let i = sourceIndex + 1; i < modules.length; i++) {
      if (!this.isSourceModule(modules[i]) && modules[i].enabled) {
        targetIndex = i;
        break;
      }
    }

    // 检查从 Source 到目标之间是否有 AmpEnv
    let hasAmpEnvInPath = false;
    if (targetIndex > sourceIndex) {
      for (let i = sourceIndex + 1; i <= targetIndex; i++) {
        if (ampEnvIndices.has(i)) {
          hasAmpEnvInPath = true;
          break;
        }
      }
    } else {
      // 如果没有目标模块，检查 Source 之后是否有 AmpEnv
      for (let i = sourceIndex + 1; i < modules.length; i++) {
        if (ampEnvIndices.has(i)) {
          hasAmpEnvInPath = true;
          break;
        }
      }
    }

    // 决定是否启用隐藏 AmpEnv
    const useHiddenAmpEnv = !hasAmpEnvInPath;
    runtime.hiddenAmpEnvEnabled = useHiddenAmpEnv;

    // 连接信号链
    const outputNode = useHiddenAmpEnv && runtime.hiddenAmpEnv ? runtime.hiddenAmpEnv : runtime.outputNode;

    if (targetIndex >= 0) {
      // 连接到目标模块
      const targetModule = modules[targetIndex];
      const targetRuntime = this.moduleRuntimes.get(targetModule.id);
      if (targetRuntime && targetRuntime.node) {
        outputNode.connect(targetRuntime.node);
      }
    } else {
      // 没有目标模块，连接到 masterVolume
      outputNode.connect(this.masterVolume);
    }
  }

  /**
   * 连接非 Source 模块
   * @param {Array} modules - 模块数组
   * @param {number} moduleIndex - 模块索引
   * @param {Object} runtime - 模块运行时
   */
  connectNonSourceModule(modules, moduleIndex, runtime) {
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
    if (this.isSourceModule(module)) {
      return this.createSourceRuntime(module);
    }
    return this.createEffectRuntime(module);
  }

  /**
   * 创建 Source 运行时
   * Source 需要额外的 volumeNode、panNode 和隐藏 AmpEnv
   * @param {Object} module - Source 模块
   * @returns {Object} - 运行时对象
   */
  createSourceRuntime(module) {
    const definition = SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator;
    let moduleState = deepClone(module);

    // 创建音量和声像节点
    const volumeNode = new Tone.Volume(module.enabled ? module.volume : -48);
    const panNode = new Tone.Panner(module.pan);
    volumeNode.connect(panNode);

    // 创建隐藏的 AmpEnv（固定 0.05s Attack/Release）
    const hiddenAmpEnv = new Tone.AmplitudeEnvelope({
      attack: 0.05,
      decay: 0.1,
      sustain: 1,
      release: 0.05,
    });
    panNode.connect(hiddenAmpEnv);

    let node;
    const voices = [];
    const activeVoiceMap = new Map();
    const MAX_VOICES = 10;

    const getNoteFrequency = (note) => Tone.Frequency(note).toFrequency();
    const getPitchRatio = (note) => {
      const root = Tone.Frequency(moduleState.rootNote || "C4").toFrequency();
      return getNoteFrequency(note) / root;
    };

    // 根据 runtime 类型创建不同的声源节点
    if (definition.runtime === "pitchedSource") {
      for (let i = 0; i < MAX_VOICES; i++) {
        const voiceOsc = new Tone[definition.voiceClass](module.options);
        voiceOsc.connect(volumeNode);
        voiceOsc.start();
        voices.push({
          oscillator: voiceOsc,
          note: null,
          active: false,
          releaseTime: 0,
        });
      }
      node = voices[0].oscillator;
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
      type: module.type,
      category: "source",
      node,
      volumeNode,
      panNode,
      hiddenAmpEnv,
      hiddenAmpEnvEnabled: false,  // 默认禁用，由 connectSourceModule 决定
      outputNode: hiddenAmpEnv,    // 输出节点指向隐藏 AmpEnv
      voices,
      definition,
      moduleState,

      apply: (nextModule) => {
        moduleState = deepClone(nextModule);
        rampParam(volumeNode.volume, moduleState.enabled ? moduleState.volume : -48);
        rampParam(panNode.pan, moduleState.pan);

        if (definition.runtime === "pitchedSource") {
          voices.forEach((voice) => {
            safeSet(voice.oscillator, moduleState.options);
          });
        } else if (definition.runtime === "noise") {
          safeSet(node, moduleState.options);
        } else if (definition.runtime === "player") {
          safeSet(node, moduleState.options);
          applyPlayerLikeOptions(node, moduleState.options);
        }
      },

      triggerAttack: (note, velocity) => {
        if (!moduleState.enabled) {
          return;
        }

        if (definition.runtime === "pitchedSource") {
          const polyphony = this.state?.global?.polyphony || 8;
          const availableVoices = voices.slice(0, polyphony);
          let voice = availableVoices.find((v) => !v.active);

          if (!voice) {
            voice = availableVoices.reduce((oldest, v) =>
              v.releaseTime < oldest.releaseTime ? v : oldest
            );
            if (voice.note) {
              activeVoiceMap.delete(voice.note);
            }
          }

          if (voice.oscillator.frequency) {
            voice.oscillator.frequency.rampTo(getNoteFrequency(note), 0.02);
          }
          voice.note = note;
          voice.active = true;
          voice.releaseTime = Infinity;
          activeVoiceMap.set(note, voice);
        } else if (definition.runtime === "noise") {
          // Noise 直接启动，无 envelope
        } else if (definition.runtime === "player") {
          if ("playbackRate" in node) {
            node.playbackRate = getPitchRatio(note) * Number(moduleState.options.playbackRate || 1);
          }
          try {
            node.stop(Tone.now());
          } catch {}
          node.start(Tone.now());
        }
      },

      triggerRelease: (note) => {
        if (definition.runtime === "pitchedSource") {
          const voice = activeVoiceMap.get(note);
          if (voice) {
            voice.active = false;
            voice.releaseTime = Tone.now();
            voice.note = null;
            activeVoiceMap.delete(note);
          }
        } else if (definition.runtime === "noise") {
          // Noise 直接停止，无 envelope
        } else if (definition.runtime === "player") {
          try {
            node.stop(Tone.now());
          } catch {}
        }
      },

      releaseAll: () => {
        if (definition.runtime === "pitchedSource") {
          voices.forEach((voice) => {
            if (voice.active) {
              voice.active = false;
              voice.releaseTime = Tone.now();
              voice.note = null;
            }
          });
          activeVoiceMap.clear();
        } else if (definition.runtime === "noise") {
          // Noise 无需处理
        } else if (definition.runtime === "player") {
          try {
            node.stop(Tone.now());
          } catch {}
        }
      },

      dispose: () => {
        if (definition.runtime === "pitchedSource") {
          voices.forEach((voice) => {
            if (voice.oscillator && typeof voice.oscillator.dispose === "function") {
              voice.oscillator.dispose();
            }
          });
        } else {
          if (node && typeof node.dispose === "function") {
            node.dispose();
          }
        }
        volumeNode.dispose();
        panNode.dispose();
        hiddenAmpEnv.dispose();
      },
    };
  }

  /**
   * 创建效果器/组件运行时
   * @param {Object} module - 模块对象
   * @returns {Object} - 运行时对象
   */
  createEffectRuntime(module) {
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

    // 某些 Tone 节点需要 start() 才能工作
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

  /**
   * 更新复音数
   * @param {number} polyphony - 复音数
   */
  updatePolyphony(polyphony) {
    this.state.global.polyphony = polyphony;
  }

  /* -------------------------------------------------------------------------- */
  /* 音符触发                                                                   */
  /* -------------------------------------------------------------------------- */

  /**
   * 触发音符 Attack
   * 触发所有启用的 AmplitudeEnvelope（显式和隐藏的）
   * @param {string} note - 音符
   * @param {number} velocity - 力度
   */
  attack(note, velocity) {
    if (!this.ready) {
      return;
    }

    // 如果没有任何活跃音符，触发所有 AmpEnv 的 attack
    if (!this.activeNotes.size) {
      this.moduleRuntimes.forEach((runtime) => {
        // 触发显式的 AmplitudeEnvelope
        if (runtime.type === "AmplitudeEnvelope" && runtime.node) {
          runtime.node.triggerAttack(Tone.now(), velocity);
        }
        // 触发启用的隐藏 AmpEnv
        if (runtime.hiddenAmpEnvEnabled && runtime.hiddenAmpEnv) {
          runtime.hiddenAmpEnv.triggerAttack(Tone.now(), velocity);
        }
      });
    }

    this.activeNotes.add(note);

    // 触发所有 Source 的 attack
    this.moduleRuntimes.forEach((runtime) => {
      if (runtime.category === "source" && runtime.triggerAttack) {
        runtime.triggerAttack(note, velocity);
      }
    });
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

    // 触发所有 Source 的 release
    this.moduleRuntimes.forEach((runtime) => {
      if (runtime.category === "source" && runtime.triggerRelease) {
        runtime.triggerRelease(note);
      }
    });

    // 当所有音符都释放后，触发所有 AmpEnv 的 release
    if (!this.activeNotes.size) {
      this.moduleRuntimes.forEach((runtime) => {
        // 触发显式的 AmplitudeEnvelope
        if (runtime.type === "AmplitudeEnvelope" && runtime.node) {
          runtime.node.triggerRelease(Tone.now());
        }
        // 触发启用的隐藏 AmpEnv
        if (runtime.hiddenAmpEnvEnabled && runtime.hiddenAmpEnv) {
          runtime.hiddenAmpEnv.triggerRelease(Tone.now());
        }
      });
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

    // 释放所有 Source
    this.moduleRuntimes.forEach((runtime) => {
      if (runtime.category === "source" && runtime.releaseAll) {
        runtime.releaseAll();
      }
    });

    // 强制释放所有 AmpEnv
    this.moduleRuntimes.forEach((runtime) => {
      if (runtime.type === "AmplitudeEnvelope" && runtime.node) {
        runtime.node.triggerRelease(Tone.now());
      }
      if (runtime.hiddenAmpEnvEnabled && runtime.hiddenAmpEnv) {
        runtime.hiddenAmpEnv.triggerRelease(Tone.now());
      }
    });
  }
}
