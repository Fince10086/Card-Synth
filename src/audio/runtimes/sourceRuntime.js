import * as Tone from "tone";
import {
  deepClone,
  safeSet,
  rampParam,
  applyPlayerLikeOptions,
  SOURCE_LIBRARY,
} from "../../utils/helpers.js";

/**
 * 创建音源运行时
 *
 * 这是核心的声音管理器，负责：
 * - 创建和管理多个声音（实现复音）
 * - 处理音符的触发和释放
 * - 管理声音的生命周期状态
 * - 支持多种音源类型（振荡器、噪声、采样器等）
 *
 * @param {Object} options - 配置选项
 * @param {Object} options.module - 模块配置对象
 * @param {Function} options.getVelocityEnabled - 获取是否启用力度响应的函数
 * @param {Function} options.onAllVoicesIdle - 所有声音空闲时的回调函数
 * @param {Function} options.onVoiceDisposed - 声音被释放时的回调函数
 * @param {Function} options.onVoiceInitialized - 声音初始化时的回调函数
 * @returns {Object} 运行时对象，包含声音管理和控制方法
 */
export function createSourceRuntime({
  module,
  getVelocityEnabled = () => true,
  onAllVoicesIdle = null,
  onVoiceDisposed = null,
  onVoiceInitialized = null,
}) {
  const definition = SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator;
  let moduleState = deepClone(module);

  // 为 Player 预加载共享 buffer，避免每个 voice 重复异步加载
  let sharedPlayerBuffer = null;
  if (definition.runtime === "player" && moduleState.options?.url) {
    try {
      sharedPlayerBuffer = new Tone.Buffer(moduleState.options.url);
    } catch {
      // 静默忽略 buffer 预加载失败
    }
  }

  // 常量定义
  const VOICE_COUNT = 8;
  const VOICE_INDEX_RESERVE_SECONDS = 10;
  const ALL_VOICES_IDLE_REBUILD_DELAY = 10; // 单位：秒

  /**
   * 声音状态枚举
   *
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
   *
   * 如果是且提供了回调，则设置延迟定时器。
   * 从 Release 开始算，而不是从 IDLE 开始算。
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
   *
   * 用于微调音高。
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
   * 获取音符的基础频率
   *
   * 考虑八度偏移后的频率值。
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
   *
   * 用于采样器的播放速率调整，实现不同音高的播放。
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
   *
   * 用于调制模式下的频率控制。
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
   * 提取节点选项
   *
   * 排除特定参数后的节点选项。
   *
   * @param {Object} options - 原始选项
   * @param {string[]} exclude - 要排除的字段列表
   * @returns {Object} 处理后的节点选项
   */
  const getNodeOptions = (options = {}, exclude = []) => {
    const result = { ...options };
    exclude.forEach((key) => delete result[key]);
    return result;
  };

  /**
   * 获取音源输出增益
   *
   * 根据是否启用和调制模式计算最终增益值。
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
   * 创建占位声音对象
   *
   * 创建未初始化状态的占位对象。
   *
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
   * 创建音源节点
   *
   * 支持所有音源类型（pitchedSource、noise、player、oscillator）。
   *
   * @param {Object} connectTarget - 连接目标节点
   * @returns {Object} 新创建的音源节点
   */
  const createSourceNode = (connectTarget) => {
    let node;

    if (definition.runtime === "pitchedSource") {
      node = new Tone[module.type](getNodeOptions(moduleState.options, ["gain", "frequencyOffset", "frequency"]));
      node.connect(connectTarget);
      node.start();
    } else if (definition.runtime === "noise") {
      node = new Tone.Noise(getNodeOptions(moduleState.options, ["gain", "frequencyOffset"]));
      node.connect(connectTarget);
      node.start();
    } else if (definition.runtime === "player") {
      const nodeOptions = getNodeOptions(moduleState.options, ["gain", "frequencyOffset"]);
      // 使用预加载的共享 buffer 避免重复异步加载
      if (sharedPlayerBuffer) {
        node = new Tone.Player(sharedPlayerBuffer);
      } else {
        node = new Tone.Player(nodeOptions);
      }
      applyPlayerLikeOptions(node, nodeOptions);
      node.connect(connectTarget);
    } else {
      node = new Tone.Oscillator(getNodeOptions(moduleState.options, ["gain", "frequencyOffset"]));
      node.connect(connectTarget);
      node.start();
    }

    return node;
  };

  /**
   * 初始化指定索引的声音
   *
   * 创建完整的音频节点链。
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
      // 调制模式下，不连接 hiddenAmpEnv，让信号直接通过
      // hiddenAmpEnv 仅作为占位符存在
    } else {
      panNode = new Tone.Panner(module.pan);
      volumeNode.connect(panNode);
      panNode.connect(hiddenAmpEnv);
    }

    const node = createSourceNode(volumeNode);

    voice.node = node;
    voice.volumeNode = volumeNode;
    voice.panNode = panNode;
    voice.hiddenAmpEnv = hiddenAmpEnv;
    voice.analyser = new Tone.Analyser("waveform", 256);
    voice.volumeNode.connect(voice.analyser);

    // 为 pitchedSource 设置频率控制信号链
    if (definition.runtime === "pitchedSource" && node?.frequency) {
      const initFreq = getModulationFrequency();
      voice.frequencyBaseSignal = new Tone.Signal(initFreq);
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
    // 注意：调制模式下不建立音频信号链连接，因为 hiddenAmpEnv 未被使用
    if (!isModulationMode) {
      if (runtime.hasAmpEnv && runtime.ampEnvRuntime?.voices?.[index]) {
        const outputNode = voice.panNode || voice.hiddenAmpEnv;
        outputNode.connect(runtime.ampEnvRuntime.voices[index]);
      } else if (!runtime.hasAmpEnv && runtime.targetNode && voice.hiddenAmpEnv) {
        // 没有 AmpEnv，直接连接到 targetNode
        voice.hiddenAmpEnv.connect(runtime.targetNode);
      }
    }

    // 触发 voice 初始化回调（用于重建调制连接）
    if (onVoiceInitialized) {
      onVoiceInitialized(index);
    }

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

  // 创建所有声音占位符
  const voices = Array.from({ length: VOICE_COUNT }, createVoicePlaceholder);

  /**
   * 为声音创建音源节点
   *
   * 支持所有音源类型。
   *
   * @param {Object} voice - 声音对象
   * @returns {Object} 新创建的音源节点
   */
  const createNodeForVoice = (voice) => {
    const node = createSourceNode(voice.volumeNode);
    voice.node = node;

    // 为 pitchedSource 重新连接频率控制信号链（如果已存在）
    if (definition.runtime === "pitchedSource" && node?.frequency && voice.frequencyMultiply) {
      if ("value" in node.frequency) {
        node.frequency.value = 0;
      }
      voice.frequencyMultiply.connect(node.frequency);
    }

    // 对于调制模式，如果之前的 node 已经在运行，尝试保持相位连续性
    // 实际上，新创建的 node 总是会从头开始，这是 Tone.js 的限制
    // 所以我们需要在调制模式下避免频繁 dispose 和 recreate
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

    // 统一释放所有音频节点（按依赖顺序：先释放输入源）
    const nodesToDispose = [
      voice.frequencyMultiply,
      voice.frequencyOffsetParam,
      voice.frequencyBaseSignal,
      voice.node,
      voice.hiddenAmpEnv,
      voice.panNode,
      voice.volumeNode,
      voice.analyser,
    ];
    nodesToDispose.forEach((node) => {
      if (node && typeof node.dispose === "function") {
        node.dispose();
      }
    });

    // 重置所有字段
    voice.node = null;
    voice.volumeNode = null;
    voice.panNode = null;
    voice.frequencyBaseSignal = null;
    voice.frequencyOffsetParam = null;
    voice.frequencyMultiply = null;
    voice.hiddenAmpEnv = null;
    voice.analyser = null;
  };

  /**
   * 确保声音有可用的音源节点
   *
   * 如果 voice 未初始化，先初始化；如果节点不存在（被销毁），则重新创建。
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
   *
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
    // 调制模式：使用较短的释放时间，因为 hiddenAmpEnv 没有被触发 Release
    if (moduleState.modulationMode) {
      return 0.01;
    }
    // Extended release: AmpEnv release + hiddenAmpEnv release
    if (runtime.needsExtendedRelease) {
      const ampEnvRelease = getAmpEnvReleaseTime(voiceIndex);
      return ampEnvRelease + 0.005;
    }
    // Direct AmpEnv: use its release time
    if (runtime.hasAmpEnv) {
      return getAmpEnvReleaseTime(voiceIndex);
    }
    // Default: 10ms
    return 0.01;
  };

  /**
   * 刷新单个声音的生命周期状态
   *
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
      // 注意：调制模式下不 dispose，保持调制波一直运行
      if (voice.node && !moduleState.modulationMode) {
        // Player 需要在 dispose 前先 stop，避免残留播放
        if (definition.runtime === "player" && voice.node) {
          try {
            voice.node.stop(now);
          } catch {}
        }
        disposeVoiceNode(voice);
        voice.initialized = false;
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
   *
   * 设置释放结束时间，将状态转为 RELEASING，
   * 并在 release 结束时自动触发 dispose（时间驱动）。
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
        // 如果 voice 被 dispose 了，触发回调
        if (!voice.initialized && onVoiceDisposed) {
          onVoiceDisposed(voiceIndex);
        }
      }
      voice.disposeTimeoutId = null;
    }, releaseDuration * 1000);
  };

  /**
   * 获取 AmpEnv 的 release 时间
   *
   * 优先使用直接连接的 AmpEnv，否则使用链中的 AmpEnv。
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
   * 获取 AmpEnv 的 attack 时间
   *
   * @param {number} voiceIndex - 声音索引
   * @returns {number} attack 时间（秒）
   */
  const getAmpEnvAttackTime = (voiceIndex) => {
    const ampEnvRuntime = runtime.ampEnvRuntime || runtime.chainedAmpEnvRuntime;
    const ampEnvVoice = ampEnvRuntime?.voices?.[voiceIndex];
    const attack = Number(ampEnvVoice?.attack);
    return Number.isFinite(attack) && attack >= 0 ? attack : 0.01;
  };

  /**
   * 释放声音
   *
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

    // 对于调制模式下的 Source，跳过 hiddenAmpEnv 的 Release
    // 让调制波继续运行，保持相位连续性
    const isModulationMode = moduleState.modulationMode;

    if (isModulationMode) {
      // 调制模式下，不调制 hiddenAmpEnv，调制波继续运行
      // 但仍然需要调度 voice 的释放以进行资源清理
    } else if (runtime.hasAmpEnv) {
      triggerAmpEnvRelease(voiceIndex);
      const ampEnvRelease = getAmpEnvReleaseTime(voiceIndex);
      voice.hiddenAmpEnv.triggerRelease(now + ampEnvRelease);
    } else if (runtime.needsExtendedRelease && isLastNote) {
      // 最后一个音：延迟释放 hiddenAmpEnv
      const ampEnvRelease = getAmpEnvReleaseTime(voiceIndex);
      voice.hiddenAmpEnv.triggerRelease(now + ampEnvRelease);
      voice.extendedReleaseEndTime = now + ampEnvRelease;
    } else if (runtime.needsExtendedRelease && !isLastNote) {
      // 非最后一个音：同步 hiddenAmpEnv.release 与 AmpEnv
      const ampEnvRelease = getAmpEnvReleaseTime(voiceIndex);
      voice.hiddenAmpEnv.release = ampEnvRelease;
      voice.hiddenAmpEnv.triggerRelease(now);
      voice.extendedReleaseEndTime = 0;
    } else {
      voice.hiddenAmpEnv.triggerRelease(now);
      voice.extendedReleaseEndTime = 0;
    }

    // 对于调制模式下的 player，不停止播放，让调制波继续运行
    // 对于有 AmpEnv 的情况，也不立即 stop，让 AmpEnv 的 release 正常生效
    // Player 会在 refreshVoiceLifecycle（RELEASING->IDLE）时被 stop
    if (definition.runtime === "player" && !moduleState.modulationMode) {
      if (voice.node) {
        // 只有没有 AmpEnv 时才立即 stop；有 AmpEnv 时延迟到 release 结束
        if (!runtime.hasAmpEnv && !runtime.needsExtendedRelease) {
          try {
            voice.node.stop(now);
          } catch {}
        }
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
   *
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

  // 运行时对象，提供对外的 API 接口
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
     * 如果 voice 未初始化，会先初始化。
     *
     * @param {number} voiceIndex - 声音索引
     * @returns {Object|null} 输出节点
     */
    getModulationOutput: (voiceIndex) => {
      const voice = getOrInitVoice(voiceIndex);
      if (!voice || !voice.initialized) {
        return null;
      }
      return voice.panNode || voice.volumeNode;
    },

    /**
     * 应用模块状态更新
     *
     * 更新所有声音的参数，包括：
     * - 音量和声像
     * - 音源特定参数
     * - 频率相关参数
     *
     * @param {Object} nextModule - 新的模块状态
     */
    apply: (nextModule) => {
      const prevUrl = moduleState.options?.url;
      moduleState = deepClone(nextModule);
      runtime.moduleState = moduleState;

      // Player: 如果 url 改变，更新共享 buffer
      if (definition.runtime === "player" && moduleState.options?.url !== prevUrl) {
        if (sharedPlayerBuffer) {
          sharedPlayerBuffer.dispose();
          sharedPlayerBuffer = null;
        }
      }

      refreshAllVoiceLifecycles();
      voices.forEach((voice) => {
        if (!voice.initialized) {
          return;
        }
        const nodeOptions = getNodeOptions(moduleState.options, ["gain", "frequencyOffset"]);
        rampParam(voice.volumeNode.gain, getSourceOutputGain());
        if (voice.panNode) {
          rampParam(voice.panNode.pan, moduleState.pan);
        }

        if (definition.runtime === "pitchedSource") {
          const optsForSafeSet = getNodeOptions(nodeOptions, ["frequency"]);
          safeSet(voice.node, optsForSafeSet);
          if (voice.frequencyOffsetParam) {
            rampParam(voice.frequencyOffsetParam, getFrequencyOffset());
          }
          if (voice.node.frequency && voice.frequencyBaseSignal) {
            if (!moduleState.midiOn) {
              // 固定频率模式（调制或非调制）：实时更新
              voice.frequencyBaseSignal.rampTo(getModulationFrequency(), 0.02);
            } else if (moduleState.modulationMode && voice.note) {
              // 调制模式 + MIDI On：跟踪音符
              voice.frequencyBaseSignal.rampTo(getBaseFrequencyForNote(voice.note), 0.02);
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
     *
     * 这是 MIDI 音符开始时的核心方法。
     *
     * @param {string} note - 音符名称
     * @param {number} velocity - 力度值（0-1）
     */
    triggerAttack: (note, velocity, preferredVoiceIndex) => {
      if (!moduleState.enabled) {
        return -1;
      }

      // 如果有新的 note 触发，取消重建信号链的定时器
      if (allVoicesIdleTimeoutId) {
        clearTimeout(allVoicesIdleTimeoutId);
        allVoicesIdleTimeoutId = null;
      }

      let voice, index;

      if (typeof preferredVoiceIndex === 'number' && preferredVoiceIndex >= 0 && preferredVoiceIndex < VOICE_COUNT) {
        voice = voices[preferredVoiceIndex];
        index = preferredVoiceIndex;
        const now = Tone.now();

        // 清除可能存在的 release 定时器
        if (voice.disposeTimeoutId) {
          clearTimeout(voice.disposeTimeoutId);
          voice.disposeTimeoutId = null;
        }

        // 刷新 lifecycle，可能 RELEASING -> IDLE
        refreshVoiceLifecycle(voice, now);

        // 如果 voice 绑定的是另一个 note，先释放
        if (voice.note && voice.note !== note) {
          releaseVoice(voice, index, now);
        }

        // 确保 voice 已初始化
        if (!voice.initialized) {
          initVoice(index);
        }

        // 如果还在 releasing，重置状态以便重新 attack
        if (voice.state === VOICE_STATE.RELEASING) {
          voice.state = VOICE_STATE.IDLE;
          voice.releaseEndTime = 0;
          voice.idleSince = 0;
          voice.extendedReleaseEndTime = 0;
        }
      } else {
        const result = findAvailableVoice();
        if (!result) {
          return -1;
        }
        ({ voice, index } = result);
      }

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
      voice.extendedReleaseEndTime = 0;

      const effectiveVelocity = (!getVelocityEnabled() || moduleState.modulationMode) ? 1 : velocity;

      // 检查是否为第一个音（没有其他活跃音符）
      const isFirstAttack = voices.filter((v, i) => i !== index && v.initialized && v.note !== null).length === 0;

      // 对于调制模式，跳过 hiddenAmpEnv 的触发，保持调制波连续运行
      if (moduleState.modulationMode) {
        // 调制模式下不调制 hiddenAmpEnv，调制波自由运行
      } else if (runtime.hasAmpEnv) {
        triggerAmpEnvAttack(index, effectiveVelocity);
      } else if (isInExtendedRelease) {
        voice.hiddenAmpEnv.triggerAttack(now, effectiveVelocity);
        voice.extendedReleaseEndTime = 0;
      } else if (runtime.needsExtendedRelease && !isFirstAttack) {
        // 非第一个音：同步 hiddenAmpEnv.attack 与 AmpEnv
        const ampEnvAttack = getAmpEnvAttackTime(index);
        voice.hiddenAmpEnv.attack = ampEnvAttack;
        voice.hiddenAmpEnv.triggerAttack(now, effectiveVelocity);
      } else {
        voice.hiddenAmpEnv.triggerAttack(now, effectiveVelocity);
      }

      const sourceNode = ensureVoiceNode(index);
      if (!sourceNode) {
        releaseVoice(voice, index, now);
        return -1;
      }

      if (definition.runtime === "pitchedSource") {
        if (sourceNode.frequency) {
          const useMidiPitch = moduleState.midiOn !== false;
          const nextFrequency = useMidiPitch
            ? getBaseFrequencyForNote(note)
            : getModulationFrequency();
          voice.frequencyBaseSignal?.rampTo(nextFrequency, 0.02);
        }
      } else if (definition.runtime === "player") {
        if (!sourceNode.loaded) {
          releaseVoice(voice, index, now);
          return -1;
        }
        if ("playbackRate" in sourceNode) {
          sourceNode.playbackRate = getPitchRatio(note) * Number(moduleState.options.playbackRate || 1);
        }
        // 对于调制模式，如果 player 已经在运行，不要重新启动，保持调制波连续
        if (moduleState.modulationMode) {
          // 调制模式下，只调整 playbackRate，不重新启动
        } else {
          try {
            sourceNode.stop(now);
          } catch {}
          sourceNode.start(now);
        }
      }

      return index;
    },

    /**
     * 触发音符释放（停止播放）
     *
     * 这是 MIDI 音符结束时的核心方法。
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
    },

    /**
     * 释放所有声音
     *
     * 通常用于停止所有播放或紧急停止。
     */
    releaseAll: () => {
      const now = Tone.now();
      voices.forEach((voice, index) => {
        if (voice.initialized && (voice.note || voice.state !== VOICE_STATE.IDLE)) {
          releaseVoice(voice, index, now);
        }
      });
    },

    /**
     * 获取当前原始波形值（用于调试）
     * 返回所有活跃 voice 的当前瞬时振幅值（范围 -1 到 1）
     */
    getOutputValue: () => {
      let latestValue = 0;
      voices.forEach((voice) => {
        if (voice.initialized && voice.analyser) {
          try {
            const waveform = voice.analyser.getValue();
            if (waveform && waveform.length > 0) {
              // 获取最近的样本值（保留正负号）
              latestValue = waveform[waveform.length - 1];
            }
          } catch {
            // ignore
          }
        }
      });
      return latestValue;
    },

    /**
     * 销毁运行时
     *
     * 清理所有音频节点和资源。
     */
    dispose: () => {
      // 清理重建信号链的定时器
      if (allVoicesIdleTimeoutId) {
        clearTimeout(allVoicesIdleTimeoutId);
        allVoicesIdleTimeoutId = null;
      }
      voices.forEach((voice) => {
        if (voice.initialized) {
          disposeVoiceNode(voice);
        }
      });
      // 释放共享 buffer
      if (sharedPlayerBuffer) {
        sharedPlayerBuffer.dispose();
        sharedPlayerBuffer = null;
      }
    },
  };

  runtime.apply(moduleState);

  return runtime;
}
