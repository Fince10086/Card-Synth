import * as Tone from "tone";
import {
  deepClone,
  safeSet,
  rampParam,
  applyPlayerLikeOptions,
  SOURCE_LIBRARY,
} from "../utils/helpers.js";

/**
 * 创建音符声音追踪器
 * 用于跟踪多个声音（voices）当前正在播放哪些音符
 * 实现了声音分配和释放的核心逻辑
 *
 * @param {number} voiceCount - 声音数量（复音数）
 * @returns {Object} 包含分配、释放和状态查询方法的对象
 */
export function createNoteVoiceTracker(voiceCount) {
  /**
   * 初始化声音状态数组
   * 每个声音包含：
   * - note: 当前播放的音符（null 表示空闲）
   * - startTime: 开始播放的时间戳
   */
  const voiceStates = Array.from({ length: voiceCount }, () => ({
    note: null,
    startTime: 0,
  }));

  /**
   * 查找可用的声音索引
   * 策略：
   * 1. 优先返回空闲的声音（note 为 null）
   * 2. 如果所有声音都在使用，则返回最早开始播放的声音（用于声音窃取）
   *
   * @returns {number} 可用声音的索引
   */
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
    /**
     * 为指定音符分配一个声音
     *
     * @param {string} note - 音符名称（如 "C4"）
     * @param {number} time - 分配时间戳
     * @returns {number} 分配的声音索引
     */
    allocate(note, time) {
      const index = findAvailableVoice();
      voiceStates[index].note = note;
      voiceStates[index].startTime = time;
      return index;
    },

    /**
     * 根据音符释放对应的声音
     *
     * @param {string} note - 要释放的音符
     * @returns {number} 释放的声音索引，如果未找到返回 -1
     */
    releaseByNote(note) {
      const index = voiceStates.findIndex((item) => item.note === note);
      if (index < 0) {
        return -1;
      }
      voiceStates[index].note = null;
      return index;
    },

    /**
     * 清除所有声音状态
     * 通常用于全部停止或重置
     */
    clearAll() {
      voiceStates.forEach((item) => {
        item.note = null;
        item.startTime = 0;
      });
    },

    /**
     * 检查是否有活跃的音符正在播放
     *
     * @returns {boolean} 是否有活跃音符
     */
    hasActiveNotes() {
      return voiceStates.some((item) => item.note !== null);
    },
  };
}

/**
 * 创建音源运行时
 * 这是核心的声音管理器，负责：
 * - 创建和管理多个声音（实现复音）
 * - 处理音符的触发和释放
 * - 管理声音的生命周期状态
 * - 支持多种音源类型（振荡器、噪声、采样器等）
 *
 * @param {Object} options - 配置选项
 * @param {Object} options.module - 模块配置对象
 * @param {Function} options.getVelocityEnabled - 获取是否启用力度响应的函数
 * @returns {Object} 运行时对象，包含声音管理和控制方法
 */
export function createSourceRuntime({
  module,
  getVelocityEnabled = () => true,
  onAllVoicesIdle = null,
}) {
  const definition = SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator;
  let moduleState = deepClone(module);

  /**
   * 常量定义
   */
  const VOICE_COUNT = 8;
  const VOICE_INDEX_RESERVE_SECONDS = 10;
  const ALL_VOICES_IDLE_REBUILD_DELAY = 10; // 10秒后重建信号链

  /**
   * 声音状态枚举
   * - IDLE: 空闲状态，可以分配新音符
   * - ACTIVE: 活跃状态，正在播放音符
   * - RELEASING: 释放中，正在执行释放阶段
   */
  const VOICE_STATE = {
    IDLE: "idle",
    ACTIVE: "active",
    RELEASING: "releasing",
  };

  // 用于延迟重建信号链的定时器
  let allVoicesIdleTimeoutId = null;

  /**
   * 检查是否所有 voice 都处于空闲或正在释放状态
   * 如果是且提供了回调，则设置延迟定时器
   * 从 Release 开始算，而不是从 IDLE 开始算
   */
  const checkAllVoicesIdle = () => {
    if (!onAllVoicesIdle) {
      return;
    }

    // 清除之前的定时器
    if (allVoicesIdleTimeoutId) {
      clearTimeout(allVoicesIdleTimeoutId);
      allVoicesIdleTimeoutId = null;
    }

    // 检查是否所有 voice 都 idle、正在释放中或未初始化
    // 包括：IDLE、RELEASING（无论是否 extended release）
    const allIdleOrReleasing = voices.every((v) =>
      !v.initialized ||
      (v.state === VOICE_STATE.IDLE && !v.note) ||
      v.state === VOICE_STATE.RELEASING
    );

    if (allIdleOrReleasing) {
      allVoicesIdleTimeoutId = setTimeout(() => {
        onAllVoicesIdle();
        allVoicesIdleTimeoutId = null;
      }, ALL_VOICES_IDLE_REBUILD_DELAY * 1000);
    }
  };

  /**
   * 获取频率偏移量
   * 用于微调音高
   *
   * @returns {number} 频率偏移比例（0-2）
   */
  const getFrequencyOffset = () => {
    const offset = Number(moduleState?.options?.frequencyOffset);
    if (!Number.isFinite(offset)) {
      return 1;
    }
    return Math.max(0, Math.min(2, offset));
  };

  /**
   * 将音符名称转换为频率值
   *
   * @param {string} note - 音符名称
   * @returns {number} 频率值（Hz）
   */
  const getNoteFrequency = (note) => Tone.Frequency(note).toFrequency();

  /**
   * 获取音符的基础频率（考虑八度偏移）
   *
   * @param {string} note - 音符名称
   * @returns {number} 调整后的频率值
   */
  const getBaseFrequencyForNote = (note) => {
    let frequency = getNoteFrequency(note);
    const octave = Number(moduleState?.options?.octave) || 0;
    if (octave !== 0) {
      frequency *= Math.pow(2, octave);
    }
    return frequency;
  };

  /**
   * 计算音高比率
   * 用于采样器的播放速率调整，实现不同音高的播放
   *
   * @param {string} note - 目标音符
   * @returns {number} 播放速率比率
   */
  const getPitchRatio = (note) => {
    const root = Tone.Frequency(moduleState.rootNote || "C4").toFrequency();
    return (getBaseFrequencyForNote(note) * getFrequencyOffset()) / root;
  };

  /**
   * 获取调制频率
   * 用于调制模式下的频率控制
   *
   * @returns {number} 调制频率值
   */
  const getModulationFrequency = () => {
    const configuredFrequency = Number(moduleState?.options?.frequency);
    if (Number.isFinite(configuredFrequency) && configuredFrequency > 0) {
      return configuredFrequency;
    }

    const legacyFrequency = Number(moduleState?.modulationFrequency);
    if (Number.isFinite(legacyFrequency) && legacyFrequency > 0) {
      return legacyFrequency;
    }

    return 1;
  };

  /**
   * 提取节点选项（排除特定参数）
   *
   * @param {Object} options - 原始选项
   * @returns {Object} 处理后的节点选项
   */
  const getNodeOptions = (options = {}) => {
    const { gain, frequencyOffset, ...nodeOptions } = options || {};
    return nodeOptions;
  };

  /**
   * 提取音高源节点的选项
   *
   * @param {Object} options - 原始选项
   * @returns {Object} 处理后的节点选项
   */
  const getPitchedNodeOptions = (options = {}) => {
    const { frequency, ...nodeOptions } = getNodeOptions(options);
    return nodeOptions;
  };

  /**
   * 获取音源输出增益
   * 根据是否启用和调制模式计算最终增益值
   *
   * @returns {number} 增益值
   */
  const getSourceOutputGain = () => {
    if (moduleState.modulationMode) {
      if (!moduleState.enabled) {
        return 0;
      }
      const depth = Number(moduleState?.options?.gain);
      return Number.isFinite(depth) ? Math.max(0, depth) : 1;
    }
    return Tone.dbToGain(moduleState.enabled ? moduleState.volume : -48);
  };

  /**
   * 创建占位声音对象（未初始化）
   * @returns {Object} 占位声音对象
   */
  const createVoicePlaceholder = () => ({
    node: null,
    volumeNode: null,
    panNode: null,
    frequencyBaseSignal: null,
    frequencyOffsetParam: null,
    frequencyMultiply: null,
    hiddenAmpEnv: null,
    initialized: false,
    note: null,
    startTime: 0,
    state: VOICE_STATE.IDLE,
    releaseEndTime: 0,
    idleSince: 0,
    extendedReleaseEndTime: 0,
    disposeTimeoutId: null,
  });

  /**
   * 初始化指定索引的声音
   * 创建完整的音频节点链
   *
   * @param {number} index - 声音索引
   * @returns {Object} 初始化后的声音对象
   */
  const initVoice = (index) => {
    const voice = voices[index];
    if (voice.initialized) {
      return voice;
    }

    const volumeNode = new Tone.Gain(getSourceOutputGain());
    const isModulationMode = moduleState.modulationMode;
    let panNode = null;

    const hiddenAmpEnv = new Tone.AmplitudeEnvelope({
      attack: 0.005,
      decay: 0.01,
      sustain: 1,
      release: 0.005,
    });

    if (isModulationMode) {
      volumeNode.connect(hiddenAmpEnv);
    } else {
      panNode = new Tone.Panner(module.pan);
      volumeNode.connect(panNode);
      panNode.connect(hiddenAmpEnv);
    }

    let node;

    if (definition.runtime === "pitchedSource") {
      node = new Tone[module.type](getPitchedNodeOptions(module.options));
      node.connect(volumeNode);
      node.start();
    } else if (definition.runtime === "noise") {
      node = new Tone.Noise(getNodeOptions(module.options));
      node.connect(volumeNode);
      node.start();
    } else if (definition.runtime === "player") {
      const nodeOptions = getNodeOptions(moduleState.options);
      node = new Tone.Player(nodeOptions);
      applyPlayerLikeOptions(node, nodeOptions);
      node.connect(volumeNode);
    } else {
      node = new Tone.Oscillator(getNodeOptions(module.options));
      node.connect(volumeNode);
      node.start();
    }

    voice.node = node;
    voice.volumeNode = volumeNode;
    voice.panNode = panNode;
    voice.hiddenAmpEnv = hiddenAmpEnv;

    // 为 pitchedSource 设置频率控制信号链
    if (definition.runtime === "pitchedSource" && node?.frequency) {
      voice.frequencyBaseSignal = new Tone.Signal(getModulationFrequency());
      voice.frequencyOffsetParam = new Tone.Signal(getFrequencyOffset());
      voice.frequencyMultiply = new Tone.Multiply(1);
      voice.frequencyBaseSignal.connect(voice.frequencyMultiply);
      voice.frequencyOffsetParam.connect(voice.frequencyMultiply.factor);
      if ("value" in node.frequency) {
        node.frequency.value = 0;
      }
      voice.frequencyMultiply.connect(node.frequency);
    }

    voice.initialized = true;

    // 如果 ampEnvRuntime 已设置（由 audioEngine 设置），建立连接
    if (runtime.hasAmpEnv && runtime.ampEnvRuntime?.voices?.[index]) {
      const outputNode = voice.panNode || voice.hiddenAmpEnv;
      outputNode.connect(runtime.ampEnvRuntime.voices[index]);
    } else if (!runtime.hasAmpEnv && runtime.targetNode && voice.hiddenAmpEnv) {
      // 没有 AmpEnv，直接连接到 targetNode
      voice.hiddenAmpEnv.connect(runtime.targetNode);
    }

    console.log(`[VoiceManager] Voice ${index} initialized`);
    return voice;
  };

  /**
   * 获取或初始化指定索引的声音
   *
   * @param {number} index - 声音索引
   * @returns {Object} 声音对象
   */
  const getOrInitVoice = (index) => {
    const voice = voices[index];
    if (!voice.initialized) {
      return initVoice(index);
    }
    return voice;
  };

  /**
   * 创建所有声音占位符
   */
  const voices = Array.from({ length: VOICE_COUNT }, createVoicePlaceholder);

  /**
   * 为声音创建音源节点
   * 支持所有音源类型：pitchedSource、noise、player、默认振荡器
   *
   * @param {Object} voice - 声音对象
   * @returns {Object} 新创建的音源节点
   */
  const createNodeForVoice = (voice) => {
    let node;

    if (definition.runtime === "pitchedSource") {
      node = new Tone[module.type](getPitchedNodeOptions(moduleState.options));
      node.connect(voice.volumeNode);
      node.start();
    } else if (definition.runtime === "noise") {
      node = new Tone.Noise(getNodeOptions(moduleState.options));
      node.connect(voice.volumeNode);
      node.start();
    } else if (definition.runtime === "player") {
      const nodeOptions = getNodeOptions(moduleState.options);
      node = new Tone.Player(nodeOptions);
      applyPlayerLikeOptions(node, nodeOptions);
      node.connect(voice.volumeNode);
    } else {
      node = new Tone.Oscillator(getNodeOptions(moduleState.options));
      node.connect(voice.volumeNode);
      node.start();
    }

    voice.node = node;

    // 为 pitchedSource 重新连接频率控制信号链（如果已存在）
    if (definition.runtime === "pitchedSource" && node?.frequency && voice.frequencyMultiply) {
      if ("value" in node.frequency) {
        node.frequency.value = 0;
      }
      voice.frequencyMultiply.connect(node.frequency);
    }

    console.log(`[VoiceManager] Created ${definition.runtime} node for voice`);
    return node;
  };

  /**
   * 销毁声音的所有音频节点
   *
   * @param {Object} voice - 声音对象
   */
  const disposeVoiceNode = (voice) => {
    // 清理 dispose 定时器
    if (voice.disposeTimeoutId) {
      clearTimeout(voice.disposeTimeoutId);
      voice.disposeTimeoutId = null;
    }

    // 断开并释放音源节点
    if (voice.node && typeof voice.node.dispose === "function") {
      voice.node.dispose();
      voice.node = null;
    }

    // 断开并释放频率控制信号链
    if (voice.frequencyMultiply) {
      voice.frequencyMultiply.dispose();
      voice.frequencyMultiply = null;
    }
    if (voice.frequencyOffsetParam) {
      voice.frequencyOffsetParam.dispose();
      voice.frequencyOffsetParam = null;
    }
    if (voice.frequencyBaseSignal) {
      voice.frequencyBaseSignal.dispose();
      voice.frequencyBaseSignal = null;
    }

    // 释放 hiddenAmpEnv（必须在 panNode/volumeNode 之前，因为它们是输入源）
    if (voice.hiddenAmpEnv) {
      voice.hiddenAmpEnv.dispose();
      voice.hiddenAmpEnv = null;
    }

    // 释放声像节点
    if (voice.panNode) {
      voice.panNode.dispose();
      voice.panNode = null;
    }

    // 释放音量节点
    if (voice.volumeNode) {
      voice.volumeNode.dispose();
      voice.volumeNode = null;
    }

    voice.node = null;
  };

  /**
   * 确保声音有可用的音源节点
   * 如果 voice 未初始化，先初始化；如果节点不存在（被销毁），则重新创建
   *
   * @param {number} voiceIndex - 声音索引
   * @returns {Object} 音源节点
   */
  const ensureVoiceNode = (voiceIndex) => {
    const voice = getOrInitVoice(voiceIndex);
    if (voice.node) {
      return voice.node;
    }
    return createNodeForVoice(voice);
  };

  /**
   * 获取声音的释放持续时间
   * 考虑多种因素：
   * - 调制模式下的声音槽保留
   * - 外部振幅包络的释放时间
   * - 隐藏包络的释放时间
   * - needsExtendedRelease 情况下，AmpEnv release + hiddenAmpEnv release
   *
   * @param {Object} voice - 声音对象
   * @param {number} voiceIndex - 声音索引
   * @returns {number} 释放持续时间（秒）
   */
  const getVoiceReleaseDuration = (voice, voiceIndex) => {
    if (runtime.preserveVoiceSlotsForSourceTargets && moduleState.modulationMode && moduleState.midiOn) {
      return VOICE_INDEX_RESERVE_SECONDS;
    }

    if (runtime.hasAmpEnv) {
      const ampEnvVoice = runtime.ampEnvRuntime?.voices?.[voiceIndex];
      const release = Number(ampEnvVoice?.release);
      if (Number.isFinite(release) && release >= 0) {
        return release;
      }
    }

    if (runtime.needsExtendedRelease) {
      const ampEnvRelease = getAmpEnvReleaseTime(voiceIndex);
      return ampEnvRelease + 0.005;
    }

    const hiddenRelease = Number(voice.hiddenAmpEnv?.release);
    if (Number.isFinite(hiddenRelease) && hiddenRelease >= 0) {
      return hiddenRelease;
    }

    return 0.01;
  };

  /**
   * 刷新单个声音的生命周期状态
   * 处理状态转换：
   * - RELEASING -> IDLE（释放完成）
   * - IDLE -> ACTIVE（有新音符）
   * - 清理长时间空闲的采样器节点
   *
   * @param {Object} voice - 声音对象
   * @param {number} now - 当前时间
   */
  const refreshVoiceLifecycle = (voice, now = Tone.now()) => {
    if (voice.state === VOICE_STATE.RELEASING && now >= voice.releaseEndTime) {
      voice.state = VOICE_STATE.IDLE;
      voice.releaseEndTime = 0;
      voice.idleSince = now;
      if (!voice.note) {
        voice.startTime = 0;
      }
      // 变为 IDLE 后立即 dispose 节点
      if (voice.node) {
        disposeVoiceNode(voice);
        voice.initialized = false;
        console.log(`[VoiceManager] Voice disposed and marked as uninitialized`);
      }
      // 检查是否所有 voice 都 idle
      checkAllVoicesIdle();
    }

    if (voice.state === VOICE_STATE.IDLE && voice.note) {
      voice.state = VOICE_STATE.ACTIVE;
      voice.idleSince = 0;
    }
  };

  /**
   * 刷新所有声音的生命周期状态
   *
   * @param {number} now - 当前时间
   */
  const refreshAllVoiceLifecycles = (now = Tone.now()) => {
    voices.forEach((voice) => {
      if (voice.initialized) {
        refreshVoiceLifecycle(voice, now);
      }
    });
  };

  /**
   * 调度声音释放
   * 设置释放结束时间，将状态转为 RELEASING
   * 并在 release 结束时自动触发 dispose（时间驱动）
   *
   * @param {Object} voice - 声音对象
   * @param {number} voiceIndex - 声音索引
   * @param {number} now - 当前时间
   */
  const scheduleVoiceRelease = (voice, voiceIndex, now = Tone.now()) => {
    voice.state = VOICE_STATE.RELEASING;
    const releaseDuration = getVoiceReleaseDuration(voice, voiceIndex);
    voice.releaseEndTime = now + releaseDuration;
    voice.idleSince = 0;

    // 清除之前的 dispose 定时器（如果有）
    if (voice.disposeTimeoutId) {
      clearTimeout(voice.disposeTimeoutId);
      voice.disposeTimeoutId = null;
    }

    // 设置定时器，在 release 结束时自动 dispose
    voice.disposeTimeoutId = setTimeout(() => {
      if (voice.initialized) {
        refreshVoiceLifecycle(voice, Tone.now());
      }
      voice.disposeTimeoutId = null;
    }, releaseDuration * 1000);
  };

  /**
   * 获取 AmpEnv 的 release 时间
   * 优先使用直接连接的 AmpEnv，否则使用链中的 AmpEnv
   *
   * @param {number} voiceIndex - 声音索引
   * @returns {number} release 时间（秒）
   */
  const getAmpEnvReleaseTime = (voiceIndex) => {
    const ampEnvRuntime = runtime.ampEnvRuntime || runtime.chainedAmpEnvRuntime;
    const ampEnvVoice = ampEnvRuntime?.voices?.[voiceIndex];
    const release = Number(ampEnvVoice?.release);
    return Number.isFinite(release) && release >= 0 ? release : 0.01;
  };

  /**
   * 释放声音
   * 执行实际的释放操作：
   * - 清除音符绑定
   * - 触发振幅包络释放
   * - 停止采样器播放
   * - 调度状态转换
   *
   * @param {Object} voice - 声音对象
   * @param {number} voiceIndex - 声音索引
   * @param {number} now - 当前时间
   */
  const releaseVoice = (voice, voiceIndex, now = Tone.now()) => {
    const hadAssignedNote = voice.note !== null;

    const isLastNote = hadAssignedNote && voices.filter((v, i) => i !== voiceIndex && v.initialized && v.note !== null).length === 0;

    voice.note = null;

    if (runtime.hasAmpEnv) {
      triggerAmpEnvRelease(voiceIndex);
      const ampEnvRelease = getAmpEnvReleaseTime(voiceIndex);
      voice.hiddenAmpEnv.triggerRelease(now + ampEnvRelease);
    } else if (runtime.needsExtendedRelease && isLastNote) {
      const ampEnvRelease = getAmpEnvReleaseTime(voiceIndex);
      voice.hiddenAmpEnv.triggerRelease(now + ampEnvRelease);
      voice.extendedReleaseEndTime = now + ampEnvRelease;
    } else {
      voice.hiddenAmpEnv.triggerRelease(now);
      voice.extendedReleaseEndTime = 0;
    }

    if (definition.runtime === "player") {
      if (voice.node) {
        try {
          voice.node.stop(now);
        } catch {}
      }
    }

    if (hadAssignedNote || voice.state !== VOICE_STATE.IDLE) {
      scheduleVoiceRelease(voice, voiceIndex, now);
    } else {
      refreshVoiceLifecycle(voice, now);
    }

    // Release 开始时检查是否所有 voice 都释放中/空闲
    checkAllVoicesIdle();
  };

  /**
   * 查找可用的声音
   * 策略：
   * 1. 优先查找空闲且无音符绑定的声音
   * 2. 如果没有空闲声音，优先窃取处于 RELEASING 状态的声音（releaseEndTime 最早的）
   * 3. 如果没有 RELEASING 状态的声音，再窃取最早开始的声音（ACTIVE 状态）
   *
   * @returns {Object|null} 包含声音对象和索引的对象，或 null
   */
  const findAvailableVoice = () => {
    const now = Tone.now();
    refreshAllVoiceLifecycles(now);

    // 检查是否有且只有一个 voice 处于 extended release 状态（可打断）
    if (runtime.needsExtendedRelease) {
      const activeVoices = voices.filter((v) => v.initialized && v.note !== null);
      const releasingVoices = voices.filter((v) =>
        v.initialized &&
        v.state === VOICE_STATE.RELEASING &&
        v.extendedReleaseEndTime &&
        now < v.extendedReleaseEndTime
      );
      // 只有当前没有活跃音符，且只有一个 voice 在 extended release 时，打断它
      if (activeVoices.length === 0 && releasingVoices.length === 1) {
        const voice = releasingVoices[0];
        const index = voices.indexOf(voice);
        return { voice, index };
      }
    }

    // 优先找已初始化且空闲的声音（复用资源）
    for (let i = 0; i < voices.length; i++) {
      if (voices[i].initialized && voices[i].state === VOICE_STATE.IDLE && !voices[i].note) {
        return { voice: voices[i], index: i };
      }
    }

    // 找未初始化的声音（需要创建新节点）
    for (let i = 0; i < voices.length; i++) {
      if (!voices[i].initialized) {
        return { voice: getOrInitVoice(i), index: i };
      }
    }

    let oldestReleasing = null;
    let oldestReleasingIndex = -1;
    for (let i = 0; i < voices.length; i++) {
      if (voices[i].state === VOICE_STATE.RELEASING) {
        if (!oldestReleasing || voices[i].releaseEndTime < oldestReleasing.releaseEndTime) {
          oldestReleasing = voices[i];
          oldestReleasingIndex = i;
        }
      }
    }

    if (oldestReleasing) {
      return { voice: oldestReleasing, index: oldestReleasingIndex };
    }

    let oldestStealable = null;
    let oldestStealableIndex = -1;
    for (let i = 0; i < voices.length; i++) {
      if (voices[i].state === VOICE_STATE.IDLE) {
        continue;
      }
      if (!oldestStealable || voices[i].startTime < oldestStealable.startTime) {
        oldestStealable = voices[i];
        oldestStealableIndex = i;
      }
    }

    return oldestStealable ? { voice: oldestStealable, index: oldestStealableIndex } : null;
  };

  /**
   * 根据音符查找对应的声音
   *
   * @param {string} note - 音符名称
   * @returns {Object|null} 包含声音对象和索引的对象，或 null
   */
  const findVoiceByNote = (note) => {
    refreshAllVoiceLifecycles();
    const index = voices.findIndex((v) => v.note === note);
    if (index >= 0 && voices[index].initialized) {
      return { voice: voices[index], index };
    }
    return null;
  };

  /**
   * 触发振幅包络的攻击阶段
   *
   * @param {number} voiceIndex - 声音索引
   * @param {number} velocity - 力度值
   */
  const triggerAmpEnvAttack = (voiceIndex, velocity) => {
    const ampEnv = runtime.ampEnvRuntime;
    if (!ampEnv || typeof ampEnv.triggerVoiceAttack !== "function") {
      return;
    }
    ampEnv.triggerVoiceAttack(voiceIndex, velocity);
  };

  /**
   * 触发振幅包络的释放阶段
   *
   * @param {number} voiceIndex - 声音索引
   */
  const triggerAmpEnvRelease = (voiceIndex) => {
    const ampEnv = runtime.ampEnvRuntime;
    if (!ampEnv || typeof ampEnv.triggerVoiceRelease !== "function") {
      return;
    }
    ampEnv.triggerVoiceRelease(voiceIndex);
  };

  /**
   * 获取活跃声音数量
   *
   * @returns {number} 活跃声音数量
   */
  const getActiveVoiceCount = () => voices.filter((v) => v.initialized && v.note !== null).length;

  /**
   * 更新隐藏振幅包络的释放时间
   */
  const updateHiddenAmpEnvRelease = () => {
  };

  /**
   * 运行时对象
   * 提供对外的 API 接口
   */
  const runtime = {
    type: module.type,
    category: "source",
    voices,
    definition,
    moduleState,
    hasAmpEnv: false,
    ampEnvRuntime: null,
    needsExtendedRelease: false,
    preserveVoiceSlotsForSourceTargets: false,

    /**
     * 获取指定声音的调制输出节点
     *
     * @param {number} voiceIndex - 声音索引
     * @returns {Object|null} 输出节点
     */
    getModulationOutput: (voiceIndex) => {
      const voice = voices[voiceIndex];
      if (!voice || !voice.initialized) {
        return null;
      }
      return voice.panNode || voice.volumeNode;
    },

    /**
     * 应用模块状态更新
     * 更新所有声音的参数，包括：
     * - 音量和声像
     * - 音源特定参数
     * - 频率相关参数
     *
     * @param {Object} nextModule - 新的模块状态
     */
    apply: (nextModule) => {
      moduleState = deepClone(nextModule);
      runtime.moduleState = moduleState;
      refreshAllVoiceLifecycles();
      voices.forEach((voice) => {
        if (!voice.initialized) {
          return;
        }
        const nodeOptions = getNodeOptions(moduleState.options);
        rampParam(voice.volumeNode.gain, getSourceOutputGain());
        if (voice.panNode) {
          rampParam(voice.panNode.pan, moduleState.pan);
        }

        if (definition.runtime === "pitchedSource") {
          const optsForSafeSet = getPitchedNodeOptions(nodeOptions);
          safeSet(voice.node, optsForSafeSet);
          if (voice.frequencyOffsetParam) {
            rampParam(voice.frequencyOffsetParam, getFrequencyOffset());
          }
          if (moduleState.modulationMode && voice.node.frequency) {
            if (moduleState.midiOn && voice.note) {
              const nextFrequency = getBaseFrequencyForNote(voice.note);
              voice.frequencyBaseSignal?.rampTo(nextFrequency, 0.02);
            } else if (!moduleState.midiOn) {
              voice.frequencyBaseSignal?.rampTo(getModulationFrequency(), 0.02);
            }
          }
        } else if (definition.runtime === "noise") {
          safeSet(voice.node, nodeOptions);
        } else if (definition.runtime === "player") {
          if (voice.node) {
            safeSet(voice.node, nodeOptions);
            applyPlayerLikeOptions(voice.node, nodeOptions);
          }
        }
      });
    },

    /**
     * 触发音符攻击（开始播放）
     * 这是 MIDI 音符开始时的核心方法
     *
     * @param {string} note - 音符名称
     * @param {number} velocity - 力度值（0-1）
     */
    triggerAttack: (note, velocity) => {
      if (!moduleState.enabled) {
        return;
      }

      // 如果有新的 note 触发，取消重建信号链的定时器
      if (allVoicesIdleTimeoutId) {
        clearTimeout(allVoicesIdleTimeoutId);
        allVoicesIdleTimeoutId = null;
      }

      const result = findAvailableVoice();
      if (!result) {
        return;
      }
      const { voice, index } = result;
      const now = Tone.now();

      // 检查是否需要打断 extended release 的延迟
      const isInExtendedRelease = voice.state === VOICE_STATE.RELEASING
        && voice.extendedReleaseEndTime
        && now < voice.extendedReleaseEndTime;
      
      if (voice.note && voice.note !== note) {
        releaseVoice(voice, index, now);
      }

      voice.note = note;
      voice.startTime = now;
      voice.state = VOICE_STATE.ACTIVE;
      voice.releaseEndTime = 0;
      voice.idleSince = 0;

      const effectiveVelocity = (!getVelocityEnabled() || moduleState.modulationMode) ? 1 : velocity;

      if (runtime.hasAmpEnv) {
        triggerAmpEnvAttack(index, effectiveVelocity);
      } else if (isInExtendedRelease) {
        voice.hiddenAmpEnv.triggerAttack(now, effectiveVelocity);
        voice.extendedReleaseEndTime = 0;
      } else {
        voice.hiddenAmpEnv.triggerAttack(now, effectiveVelocity);
      }

      const sourceNode = ensureVoiceNode(index);
      if (!sourceNode) {
        releaseVoice(voice, index, now);
        updateHiddenAmpEnvRelease();
        return;
      }

      if (definition.runtime === "pitchedSource") {
        if (sourceNode.frequency) {
          const useMidiPitch = !moduleState.modulationMode || moduleState.midiOn;
          const nextFrequency = useMidiPitch
            ? getBaseFrequencyForNote(note)
            : getModulationFrequency();
          voice.frequencyBaseSignal?.rampTo(nextFrequency, 0.02);
        }
      } else if (definition.runtime === "player") {
        if (!sourceNode.loaded) {
          releaseVoice(voice, index, now);
          updateHiddenAmpEnvRelease();
          return;
        }
        if ("playbackRate" in sourceNode) {
          sourceNode.playbackRate = getPitchRatio(note) * Number(moduleState.options.playbackRate || 1);
        }
        try {
          sourceNode.stop(now);
        } catch {}
        sourceNode.start(now);
      }
      updateHiddenAmpEnvRelease();
    },

    /**
     * 触发音符释放（停止播放）
     * 这是 MIDI 音符结束时的核心方法
     *
     * @param {string} note - 音符名称
     */
    triggerRelease: (note) => {
      const result = findVoiceByNote(note);
      if (!result) {
        return;
      }
      const { voice, index } = result;
      releaseVoice(voice, index);
      updateHiddenAmpEnvRelease();
    },

    /**
     * 释放所有声音
     * 通常用于停止所有播放或紧急停止
     */
    releaseAll: () => {
      const now = Tone.now();
      voices.forEach((voice, index) => {
        if (voice.initialized && (voice.note || voice.state !== VOICE_STATE.IDLE)) {
          releaseVoice(voice, index, now);
        }
      });
      updateHiddenAmpEnvRelease();
    },

    /**
     * 销毁运行时
     * 清理所有音频节点和资源
     */
    dispose: () => {
      console.log(`[VoiceManager] Disposing runtime for ${module.type}`);
      // 清理重建信号链的定时器
      if (allVoicesIdleTimeoutId) {
        clearTimeout(allVoicesIdleTimeoutId);
        allVoicesIdleTimeoutId = null;
      }
      voices.forEach((voice) => {
        // 清理每个 voice 的 dispose 定时器
        if (voice.disposeTimeoutId) {
          clearTimeout(voice.disposeTimeoutId);
          voice.disposeTimeoutId = null;
        }
        if (!voice.initialized) {
          return;
        }
        if (voice.node && typeof voice.node.dispose === "function") {
          voice.node.dispose();
        }
        voice.volumeNode.dispose();
        if (voice.panNode) {
          voice.panNode.dispose();
        }
        if (voice.frequencyBaseSignal) {
          voice.frequencyBaseSignal.dispose();
        }
        if (voice.frequencyOffsetParam) {
          voice.frequencyOffsetParam.dispose();
        }
        if (voice.frequencyMultiply) {
          voice.frequencyMultiply.dispose();
        }
        voice.hiddenAmpEnv.dispose();
      });
      console.log(`[VoiceManager] Runtime disposed for ${module.type}`);
    },
  };

  runtime.apply(moduleState);

  return runtime;
}

/**
 * 创建包络调制运行时
 * 用于创建包络调制效果，如滤波器包络
 * 每个声音有独立的包络发生器和输出增益
 *
 * @param {Object} module - 模块配置
 * @returns {Object} 包络调制运行时对象
 */
export function createEnvelopeModulationRuntime(module) {
  let moduleState = deepClone(module);
  const VOICE_COUNT = 8;

  /**
   * 提取包络选项（排除 gain 参数）
   *
   * @param {Object} options - 原始选项
   * @returns {Object} 包络选项
   */
  const getEnvelopeOptions = (options = {}) => {
    const { gain, ...envelopeOptions } = options || {};
    return envelopeOptions;
  };

  /**
   * 获取调制深度增益值
   *
   * @param {Object} options - 选项对象
   * @returns {number} 增益值
   */
  const getDepthGain = (options = {}) => Number(options?.gain ?? 1);

  /**
   * 为每个声音创建独立的包络发生器
   */
  const voices = Array.from({ length: VOICE_COUNT }, () => new Tone.Envelope(getEnvelopeOptions(moduleState.options)));

  /**
   * 为每个声音创建输出增益节点
   * 用于控制调制深度
   */
  const outputGains = Array.from({ length: VOICE_COUNT }, () => new Tone.Gain(getDepthGain(moduleState.options)));

  voices.forEach((env, index) => env.connect(outputGains[index]));

  const noteTracker = createNoteVoiceTracker(VOICE_COUNT);

  return {
    type: module.type,
    category: "modulation-envelope",
    voices,
    outputGains,
    moduleState,

    /**
     * 获取指定声音的调制输出节点
     *
     * @param {number} voiceIndex - 声音索引
     * @returns {Object|null} 输出增益节点
     */
    getModulationOutput: (voiceIndex) => outputGains[voiceIndex] || null,

    /**
     * 应用模块状态更新
     *
     * @param {Object} nextModule - 新的模块状态
     */
    apply: (nextModule) => {
      moduleState = deepClone(nextModule);
      const envelopeOptions = getEnvelopeOptions(moduleState.options);
      const gainValue = getDepthGain(moduleState.options);
      voices.forEach((env) => safeSet(env, envelopeOptions));
      outputGains.forEach((gainNode) => rampParam(gainNode.gain, gainValue));
    },

    /**
     * 触发音符攻击
     *
     * @param {string} note - 音符名称
     * @param {number} velocity - 力度值
     */
    triggerAttack: (note, velocity) => {
      if (!moduleState.enabled) {
        return;
      }
      const index = noteTracker.allocate(note, Tone.now());
      voices[index].triggerAttack(Tone.now(), velocity);
    },

    /**
     * 触发音符释放
     *
     * @param {string} note - 音符名称
     */
    triggerRelease: (note) => {
      const index = noteTracker.releaseByNote(note);
      if (index < 0) {
        return;
      }
      voices[index].triggerRelease(Tone.now());
    },

    /**
     * 释放所有声音
     */
    releaseAll: () => {
      noteTracker.clearAll();
      voices.forEach((env) => {
        env.triggerRelease(Tone.now());
      });
    },

    /**
     * 销毁运行时
     */
    dispose: () => {
      voices.forEach((env) => env.dispose());
      outputGains.forEach((gainNode) => gainNode.dispose());
    },
  };
}

/**
 * 创建振幅包络运行时
 * 用于管理振幅包络（音量包络）
 * 支持两种模式：
 * 1. 多声音模式：每个声音有独立的振幅包络
 * 2. 全局模式：所有声音共享一个振幅包络
 *
 * @param {Object} module - 模块配置
 * @returns {Object} 振幅包络运行时对象
 */
export function createAmplitudeEnvelopeRuntime(module) {
  const VOICE_COUNT = 8;

  /**
   * 为每个声音创建独立的振幅包络
   */
  const voices = Array.from({ length: VOICE_COUNT }, () => new Tone.AmplitudeEnvelope(module.options));

  /**
   * 全局振幅包络节点
   * 用于非多声音模式
   */
  const node = new Tone.AmplitudeEnvelope(module.options);

  /**
   * 声音引用计数
   * 用于跟踪每个声音被多少音符使用
   */
  const voiceRefCount = new Array(VOICE_COUNT).fill(0);

  /**
   * 全局音符追踪器
   */
  const nodeNoteTracker = createNoteVoiceTracker(VOICE_COUNT);

  return {
    type: module.type,
    category: module.category || "component",
    voices,
    voiceRefCount,
    node,

    /**
     * 应用模块状态更新
     *
     * @param {Object} nextModule - 新的模块状态
     */
    apply: (nextModule) => {
      voices.forEach((env) => safeSet(env, nextModule.options));
      safeSet(node, nextModule.options);
    },

    /**
     * 触发指定声音的攻击阶段
     * 使用引用计数管理声音的生命周期
     *
     * @param {number} voiceIndex - 声音索引
     * @param {number} velocity - 力度值
     */
    triggerVoiceAttack: (voiceIndex, velocity) => {
      if (voiceIndex < 0 || voiceIndex >= VOICE_COUNT) return;
      voiceRefCount[voiceIndex] += 1;
      if (voiceRefCount[voiceIndex] === 1) {
        voices[voiceIndex].triggerAttack(Tone.now(), velocity);
      }
    },

    /**
     * 触发指定声音的释放阶段
     * 使用引用计数确保所有音符释放后才触发包络释放
     *
     * @param {number} voiceIndex - 声音索引
     */
    triggerVoiceRelease: (voiceIndex) => {
      if (voiceIndex < 0 || voiceIndex >= VOICE_COUNT) return;
      voiceRefCount[voiceIndex] = Math.max(0, voiceRefCount[voiceIndex] - 1);
      if (voiceRefCount[voiceIndex] === 0) {
        voices[voiceIndex].triggerRelease(Tone.now());
      }
    },

    /**
     * 触发全局振幅包络攻击
     *
     * @param {string} note - 音符名称
     * @param {number} velocity - 力度值
     */
    triggerAttack: (note, velocity) => {
      nodeNoteTracker.allocate(note, Tone.now());
      node.triggerAttack(Tone.now(), 1);
    },

    /**
     * 触发全局振幅包络释放
     * 只有当所有音符都释放后才触发
     *
     * @param {string} note - 音符名称
     */
    triggerRelease: (note) => {
      const releasedIndex = nodeNoteTracker.releaseByNote(note);
      if (releasedIndex >= 0 && !nodeNoteTracker.hasActiveNotes()) {
        node.triggerRelease(Tone.now());
      }
    },

    /**
     * 释放所有声音
     */
    releaseAll: () => {
      nodeNoteTracker.clearAll();
      node.triggerRelease(Tone.now());
      voices.forEach((env, index) => {
        voiceRefCount[index] = 0;
        env.triggerRelease(Tone.now());
      });
    },

    /**
     * 销毁运行时
     */
    dispose: () => {
      voices.forEach((env) => env.dispose());
      node.dispose();
    },
  };
}
