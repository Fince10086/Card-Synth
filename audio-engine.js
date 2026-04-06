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

    // 连接主输出
    this.masterVolume.toDestination();
    this.masterVolume.connect(this.analyser);

    // 重建信号链
    this.rebuildEffects();
    this.rebuildSources();
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
    this.silenceAll();
    this.rebuildEffects();
    this.rebuildSources();
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
    const voices = [];
    const activeVoiceMap = new Map();
    const MAX_VOICES = 10;

    if (definition.runtime === "pitchedSource") {
      for (let i = 0; i < MAX_VOICES; i++) {
        const voiceOsc = new Tone[definition.voiceClass](module.options);
        const voiceEnv = new Tone.AmplitudeEnvelope(module.ampEnvelope);
        voiceOsc.connect(voiceEnv);
        voiceEnv.connect(volumeNode);
        voiceOsc.start();
        voices.push({
          oscillator: voiceOsc,
          envelope: voiceEnv,
          note: null,
          active: false,
          releaseTime: 0,
        });
      }
      node = voices[0].oscillator;
      auxEnvelope = voices[0].envelope;
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
      voices,

      /**
       * 应用模块状态更新
       * @param {Object} nextModule - 新的模块状态
       */
      apply: (nextModule) => {
        moduleState = deepClone(nextModule);
        rampParam(volumeNode.volume, moduleState.enabled ? moduleState.volume : -48);
        rampParam(panNode.pan, moduleState.pan);

        if (definition.runtime === "pitchedSource") {
          voices.forEach((voice) => {
            safeSet(voice.oscillator, moduleState.options);
            safeSet(voice.envelope, moduleState.ampEnvelope);
          });
        } else if (
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
          const polyphony = this.state?.global?.polyphony || 8;
          const availableVoices = voices.slice(0, polyphony);
          let voice = availableVoices.find((v) => !v.active);

          if (!voice) {
            voice = availableVoices.reduce((oldest, v) =>
              v.releaseTime < oldest.releaseTime ? v : oldest
            );
            voice.envelope.triggerRelease(Tone.now());
            if (voice.note) {
              activeVoiceMap.delete(voice.note);
            }
          }

          if (voice.oscillator.frequency) {
            voice.oscillator.frequency.rampTo(getNoteFrequency(note), 0.02);
          }
          voice.envelope.triggerAttack(Tone.now(), velocity);
          voice.note = note;
          voice.active = true;
          voice.releaseTime = Infinity;
          activeVoiceMap.set(note, voice);
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
        if (definition.runtime === "pitchedSource") {
          const voice = activeVoiceMap.get(note);
          if (voice) {
            voice.envelope.triggerRelease(Tone.now());
            voice.active = false;
            voice.releaseTime = Tone.now();
            voice.note = null;
            activeVoiceMap.delete(note);
          }
        } else if (
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
        if (definition.runtime === "pitchedSource") {
          voices.forEach((voice) => {
            if (voice.active) {
              voice.envelope.triggerRelease(Tone.now());
              voice.active = false;
              voice.releaseTime = Tone.now();
              voice.note = null;
            }
          });
          activeVoiceMap.clear();
        } else if (
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
        if (definition.runtime === "pitchedSource") {
          voices.forEach((voice) => {
            if (voice.oscillator && typeof voice.oscillator.dispose === "function") {
              voice.oscillator.dispose();
            }
            if (voice.envelope) {
              voice.envelope.dispose();
            }
          });
        } else {
          if (node && typeof node.dispose === "function") {
            node.dispose();
          }
          if (auxEnvelope) {
            auxEnvelope.dispose();
          }
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
   * 全局音量包络只在"第一个音开始"时触发一次
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
  }

  /**
   * 更新复音数
   * @param {number} polyphony - 复音数 (1-10)
   */
  updatePolyphony(polyphony) {
    this.state.global.polyphony = polyphony;
  }
}
