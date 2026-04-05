/**
 * helpers.js
 * 工具函数集合
 * 
 * 包含：
 * - ID生成器和计数器
 * - 深拷贝和深合并工具
 * - 数值钳制工具
 * - 路径访问工具
 * - 格式化函数
 * - 调制目标收集器
 * - 模块工厂函数
 * - 预设标准化函数
 * - 音频工具函数
 */

/* -------------------------------------------------------------------------- */
/* 模块计数器                                                                 */
/* -------------------------------------------------------------------------- */

let moduleCounter = 1;

/**
 * 生成唯一ID
 * @param {string} prefix - ID前缀
 * @returns {string} - 唯一ID
 */
function createId(prefix) {
  const id = `${prefix}-${String(moduleCounter).padStart(4, "0")}`;
  moduleCounter += 1;
  return id;
}

/* -------------------------------------------------------------------------- */
/* 深拷贝和深合并工具                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 深拷贝只用于可 JSON 化的数据结构，避免直接共享对象引用
 * @param {*} value - 要拷贝的值
 * @returns {*} - 拷贝后的值
 */
function deepClone(value) {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

/**
 * 判断是否为普通对象
 * @param {*} value - 要判断的值
 * @returns {boolean} - 是否为普通对象
 */
function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

/**
 * 深合并用于把用户导入的 preset 补成完整结构，同时保留已有字段
 * @param {*} base - 基础对象
 * @param {*} override - 覆盖对象
 * @returns {*} - 合并后的对象
 */
function deepMerge(base, override) {
  if (override === undefined) {
    return deepClone(base);
  }
  if (base === undefined) {
    return deepClone(override);
  }
  if (Array.isArray(base) || Array.isArray(override)) {
    return deepClone(override);
  }
  if (isObject(base) && isObject(override)) {
    const result = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(override)]);
    keys.forEach((key) => {
      if (override[key] === undefined) {
        result[key] = deepClone(base[key]);
      } else if (base[key] === undefined) {
        result[key] = deepClone(override[key]);
      } else {
        result[key] = deepMerge(base[key], override[key]);
      }
    });
    return result;
  }
  return deepClone(override);
}

/* -------------------------------------------------------------------------- */
/* 数值工具                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 数值钳制工具，避免 UI 和调制系统把参数推到非法范围之外
 * @param {number} value - 要钳制的值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} - 钳制后的值
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/* -------------------------------------------------------------------------- */
/* 路径访问工具                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 通过 "a.b.c" 的路径读取深层字段
 * @param {Object} object - 目标对象
 * @param {string} path - 路径字符串
 * @returns {*} - 找到的值
 */
function getByPath(object, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), object);
}

/**
 * 通过路径写入深层字段，如果中间层不存在则自动补对象
 * @param {Object} object - 目标对象
 * @param {string} path - 路径字符串
 * @param {*} value - 要写入的值
 */
function setByPath(object, path, value) {
  const parts = path.split(".");
  let ref = object;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      ref[part] = value;
      return;
    }
    if (!isObject(ref[part])) {
      ref[part] = {};
    }
    ref = ref[part];
  });
}

/* -------------------------------------------------------------------------- */
/* 音名工具                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 根据基础八度和键位偏移，生成 Tone.js 可识别的音名
 * @param {number} baseOctave - 基础八度
 * @param {number} offset - 半音偏移
 * @returns {string} - 音名
 */
function noteFromOffset(baseOctave, offset) {
  const pitchClass = NOTE_NAMES[offset % 12];
  const octaveShift = Math.floor(offset / 12);
  return `${pitchClass}${baseOctave + octaveShift}`;
}

/* -------------------------------------------------------------------------- */
/* 格式化函数                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 格式化普通数值
 * @param {number} value - 要格式化的值
 * @returns {string} - 格式化后的字符串
 */
function formatPlain(value) {
  return Number(value).toFixed(Math.abs(value) < 10 ? 2 : 1).replace(/\.0+$/, "");
}

/**
 * 格式化秒数
 * @param {number} value - 秒数
 * @returns {string} - 格式化后的字符串
 */
function formatSeconds(value) {
  return `${Number(value).toFixed(value < 0.1 ? 3 : value < 1 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, "")}s`;
}

/**
 * 格式化百分比
 * @param {number} value - 百分比值 (0-1)
 * @returns {string} - 格式化后的字符串
 */
function formatPercent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

/**
 * 格式化分贝值
 * @param {number} value - 分贝值
 * @returns {string} - 格式化后的字符串
 */
function formatDb(value) {
  return `${Number(value).toFixed(1)} dB`;
}

/**
 * 格式化音分值
 * @param {number} value - 音分值
 * @returns {string} - 格式化后的字符串
 */
function formatCents(value) {
  return `${Math.round(value)} ct`;
}

/**
 * 格式化比率
 * @param {number} value - 比率值
 * @returns {string} - 格式化后的字符串
 */
function formatRatio(value) {
  return `${Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}:1`;
}

/**
 * 格式化赫兹值
 * @param {number} value - 赫兹值
 * @returns {string} - 格式化后的字符串
 */
function formatHertz(value) {
  return `${Number(value).toFixed(value < 1 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, "")} Hz`;
}

/**
 * 格式化频率值
 * @param {number} value - 频率值
 * @returns {string} - 格式化后的字符串
 */
function formatFrequency(value) {
  if (value >= 1000) {
    return `${Number(value / 1000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} kHz`;
  }
  return `${Math.round(value)} Hz`;
}

/**
 * 格式化倍数
 * @param {number} value - 倍数值
 * @returns {string} - 格式化后的字符串
 */
function formatMultiplier(value) {
  return `${Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`;
}

/* -------------------------------------------------------------------------- */
/* 调制目标收集器                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 可调制参数配置表
 * 定义每个参数的标签、范围和调制缩放因子
 */
const MODULATABLE_PARAM_CONFIG = {
  "options.harmonicity": { label: "Ratio", min: 0.25, max: 8, scale: () => 2 },
  "options.phase": { label: "Phase", min: 0, max: 360, scale: () => 90 },
  "options.detune": { label: "Detune", min: -1200, max: 1200, scale: () => 420 },
  "options.modulationIndex": { label: "Index", min: 0, max: 60, scale: () => 15 },
  "options.spread": { label: "Spread", min: 0, max: 60, scale: () => 20 },
  "options.count": { label: "Count", min: 1, max: 6, scale: () => 2 },
  "options.grainSize": { label: "Grain", min: 0.01, max: 0.5, scale: () => 0.15 },
  "options.overlap": { label: "Overlap", min: 0.005, max: 0.3, scale: () => 0.08 },
  "options.playbackRate": { label: "Rate", min: 0.2, max: 4, scale: () => 1 },
  "options.width": { label: "Width", min: 0.01, max: 0.99, scale: () => 0.3 },
  "options.modulationFrequency": { label: "PWM Rate", min: 0.05, max: 24, scale: () => 6 },
  "options.fadeIn": { label: "Fade In", min: 0, max: 0.2, scale: () => 0.05 },
  "options.fadeOut": { label: "Fade Out", min: 0.01, max: 0.6, scale: () => 0.15 },
  "options.loopStart": { label: "Loop In", min: 0, max: 12, scale: () => 3 },
  "options.loopEnd": { label: "Loop Out", min: 0, max: 12, scale: () => 3 },
  "options.pitchDecay": { label: "Pitch Dec", min: 0.001, max: 0.6, scale: () => 0.15 },
  "options.octaves": { label: "Octaves", min: 0.5, max: 10, scale: () => 2 },
  "options.resonance": { label: "Resonance", min: 50, max: 8000, scale: () => 1500 },
  "ampEnvelope.attack": { label: "Attack", min: 0.001, max: 1.5, scale: () => 0.3 },
  "ampEnvelope.decay": { label: "Decay", min: 0.001, max: 2, scale: () => 0.4 },
  "ampEnvelope.sustain": { label: "Sustain", min: 0, max: 1, scale: () => 0.3 },
  "ampEnvelope.release": { label: "Release", min: 0.01, max: 4, scale: () => 1 },
  "options.envelope.attack": { label: "Attack", min: 0.001, max: 1.5, scale: () => 0.3 },
  "options.envelope.decay": { label: "Decay", min: 0.001, max: 2, scale: () => 0.4 },
  "options.envelope.sustain": { label: "Sustain", min: 0, max: 1, scale: () => 0.3 },
  "options.envelope.release": { label: "Release", min: 0.01, max: 4, scale: () => 1 },
  "options.frequency": { label: "Rate", min: 0.05, max: 18, scale: () => 4 },
  "options.depth": { label: "Depth", min: 0, max: 1, scale: () => 0.35 },
  "options.wet": { label: "Wet", min: 0, max: 1, scale: () => 0.35 },
  "options.delayTime": { label: "Delay", min: 0.01, max: 0.9, scale: () => 0.25 },
  "options.feedback": { label: "Feedback", min: 0, max: 0.95, scale: () => 0.35 },
  "options.decay": { label: "Decay", min: 0.3, max: 12, scale: () => 3 },
  "options.preDelay": { label: "Pre", min: 0, max: 0.25, scale: () => 0.06 },
  "options.distortion": { label: "Drive", min: 0, max: 1, scale: () => 0.35 },
  "options.bits": { label: "Bits", min: 1, max: 8, scale: () => 2 },
  "options.threshold": { label: "Thresh", min: -60, max: 0, scale: () => 18 },
  "options.ratio": { label: "Ratio", min: 1, max: 20, scale: () => 6 },
  "options.attack": { label: "Attack", min: 0.001, max: 0.5, scale: () => 0.1 },
  "options.release": { label: "Release", min: 0.01, max: 1, scale: () => 0.25 },
  "options.gain": { label: "Gain", min: 0, max: 2, scale: () => 0.6 },
  "options.pan": { label: "Pan", min: -1, max: 1, scale: () => 0.5 },
  "options.volume": { label: "Volume", min: -24, max: 12, scale: () => 8 },
  "options.low": { label: "Low", min: -24, max: 24, scale: () => 8 },
  "options.mid": { label: "Mid", min: -24, max: 24, scale: () => 8 },
  "options.high": { label: "High", min: -24, max: 24, scale: () => 8 },
  "options.lowFrequency": { label: "Lo Freq", min: 80, max: 1200, scale: () => 300 },
  "options.highFrequency": { label: "Hi Freq", min: 1200, max: 8000, scale: () => 2000 },
};

/**
 * 获取当前机架中所有可被调制的目标
 * 只返回当前机架里真实存在、并且允许被调制的目标
 * @param {Object} state - 应用状态
 * @returns {Array} - 调制目标列表
 */
function getModulationTargets(state) {
  const targets = [];

  // 添加滤波器目标
  if (state.ui?.visibleModules?.filter !== false) {
    targets.push(
      {
        label: "Filter Cutoff",
        value: "filter.frequency",
        stage: "filter",
        moduleRef: "filter-core",
        basePath: "filter.frequency",
        min: 20,
        max: 18000,
        scale: (base) => Math.max(120, base * 1.35),
      },
      {
        label: "Filter Resonance",
        value: "filter.Q",
        stage: "filter",
        moduleRef: "filter-core",
        basePath: "filter.Q",
        min: 0.001,
        max: 20,
        scale: () => 8,
      },
    );
  }

  // 添加声源目标
  state.sources.forEach((module, index) => {
    const labelPrefix = `${module.type} ${index + 1}`;
    targets.push(
      {
        label: `${labelPrefix} Level`,
        value: `source:${module.id}:volume`,
        stage: "sources",
        moduleRef: module.id,
        basePath: `sources.${module.id}.volume`,
        min: -36,
        max: 6,
        scale: () => 14,
      },
      {
        label: `${labelPrefix} Pan`,
        value: `source:${module.id}:pan`,
        stage: "sources",
        moduleRef: module.id,
        basePath: `sources.${module.id}.pan`,
        min: -1,
        max: 1,
        scale: () => 1,
      },
    );

    const definition = SOURCE_LIBRARY[module.type];
    if (definition?.controls) {
      definition.controls.forEach((control) => {
        if (control.kind === "range") {
          const config = MODULATABLE_PARAM_CONFIG[control.path];
          if (config) {
            const targetId = `source:${module.id}:${control.path}`;
            targets.push({
              label: `${labelPrefix} ${config.label}`,
              value: targetId,
              stage: "sources",
              moduleRef: module.id,
              basePath: `sources.${module.id}.${control.path}`,
              min: control.min,
              max: control.max,
              scale: config.scale,
            });
          }
        }
      });
    }
  });

  // 添加组件目标
  state.components.forEach((module, index) => {
    const labelPrefix = `${module.type} ${index + 1}`;
    const definition = COMPONENT_LIBRARY[module.type];
    if (definition?.controls) {
      definition.controls.forEach((control) => {
        if (control.kind === "range") {
          const config = MODULATABLE_PARAM_CONFIG[control.path];
          if (config) {
            const targetId = `component:${module.id}:${control.path.replace("options.", "")}`;
            targets.push({
              label: `${labelPrefix} ${config.label}`,
              value: targetId,
              stage: "components",
              moduleRef: module.id,
              basePath: `components.${module.id}.${control.path}`,
              min: control.min,
              max: control.max,
              scale: config.scale,
            });
          }
        }
      });
    }
  });

  // 添加效果器目标
  state.effects.forEach((module, index) => {
    const labelPrefix = `${module.type} ${index + 1}`;
    const definition = EFFECT_LIBRARY[module.type];
    if (definition?.controls) {
      definition.controls.forEach((control) => {
        if (control.kind === "range") {
          const config = MODULATABLE_PARAM_CONFIG[control.path];
          if (config) {
            const targetId = `effect:${module.id}:${control.path.replace("options.", "")}`;
            targets.push({
              label: `${labelPrefix} ${config.label}`,
              value: targetId,
              stage: "effects",
              moduleRef: module.id,
              basePath: `effects.${module.id}.${control.path}`,
              min: control.min,
              max: control.max,
              scale: config.scale,
            });
          }
        }
      });
    }
  });

  return targets;
}

/* -------------------------------------------------------------------------- */
/* 查找工具                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 通过 id 在模块数组里查找具体实例
 * @param {Array} list - 模块数组
 * @param {string} id - 模块ID
 * @returns {Object|undefined} - 找到的模块
 */
function findById(list, id) {
  return list.find((entry) => entry.id === id);
}

/* -------------------------------------------------------------------------- */
/* 模块工厂函数                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 创建声源模块实例
 * @param {string} type - 声源类型
 * @returns {Object} - 声源模块实例
 */
function createSourceModule(type = "Oscillator") {
  const definition = SOURCE_LIBRARY[type] || SOURCE_LIBRARY.Oscillator;
  return {
    id: createId("src"),
    type,
    enabled: true,
    volume: -8,
    pan: 0,
    ...(definition.moduleDefaults ? deepClone(definition.moduleDefaults) : {}),
    options: deepClone(definition.options),
    ampEnvelope: definition.ampEnvelope ? deepClone(definition.ampEnvelope) : undefined,
  };
}

/**
 * 创建效果器模块实例
 * @param {string} type - 效果器类型
 * @returns {Object} - 效果器模块实例
 */
function createEffectModule(type = "Chorus") {
  const definition = EFFECT_LIBRARY[type] || EFFECT_LIBRARY.Chorus;
  return {
    id: createId("fx"),
    type,
    enabled: true,
    options: deepClone(definition.options),
  };
}

/**
 * 创建组件模块实例
 * @param {string} type - 组件类型
 * @returns {Object} - 组件模块实例
 */
function createComponentModule(type = "Compressor") {
  const definition = COMPONENT_LIBRARY[type] || COMPONENT_LIBRARY.Compressor;
  return {
    id: createId("cmp"),
    type,
    enabled: true,
    options: deepClone(definition.options),
  };
}

/**
 * 创建调制路由
 * @param {string} target - 目标参数
 * @param {number} amount - 调制量
 * @returns {Object} - 调制路由实例
 */
function createModRoute(target = "filter.frequency", amount = 0.35) {
  return {
    id: createId("route"),
    target,
    amount,
    enabled: true,
  };
}

/* -------------------------------------------------------------------------- */
/* 模块选项生成器                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 获取可添加模块选项列表
 * 用于顶部 "Add Module" 下拉菜单
 * @returns {Array} - 模块选项列表
 */
function getAddableModuleOptions() {
  return [
    { value: "core:filter", label: "Core / Filter" },
    { value: "core:envelope", label: "Core / Amp Envelope" },
    { value: "core:modEnvelope", label: "Core / Mod Envelope" },
    { value: "core:lfo", label: "Core / LFO" },
    ...Object.keys(SOURCE_LIBRARY).map((type) => ({
      value: `source:${type}`,
      label: `OSC / ${type}`,
    })),
    ...Object.keys(COMPONENT_LIBRARY).map((type) => ({
      value: `component:${type}`,
      label: `Component / ${type}`,
    })),
    ...Object.keys(EFFECT_LIBRARY).map((type) => ({
      value: `effect:${type}`,
      label: `Effect / ${type}`,
    })),
  ];
}

/* -------------------------------------------------------------------------- */
/* 预设标准化函数                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 标准化声源模块
 * @param {Object} module - 声源模块
 * @returns {Object} - 标准化后的模块
 */
function normalizeSourceModule(module) {
  const base = createSourceModule(module?.type || "Oscillator");
  const merged = deepMerge(base, module || {});
  merged.id = module?.id || base.id;
  return merged;
}

/**
 * 标准化效果器模块
 * @param {Object} module - 效果器模块
 * @returns {Object} - 标准化后的模块
 */
function normalizeEffectModule(module) {
  const base = createEffectModule(module?.type || "Chorus");
  const merged = deepMerge(base, module || {});
  merged.id = module?.id || base.id;
  return merged;
}

/**
 * 标准化组件模块
 * @param {Object} module - 组件模块
 * @returns {Object} - 标准化后的模块
 */
function normalizeComponentModule(module) {
  const base = createComponentModule(module?.type || "Compressor");
  const merged = deepMerge(base, module || {});
  merged.id = module?.id || base.id;
  return merged;
}

/**
 * 创建基础预设
 * @returns {Object} - 基础预设
 */
function createBasePreset() {
  return normalizePreset(BUILTIN_PRESET_TEMPLATES.init);
}

/**
 * 标准化预设
 * 把任意导入预设、内置预设或半成品状态统一整形成稳定结构
 * @param {Object} preset - 预设对象
 * @returns {Object} - 标准化后的预设
 */
function normalizePreset(preset = {}) {
  const fallback = {
    name: "Untitled Patch",
    global: { volume: -8, octave: 4, velocity: 0.8 },
    filter: { enabled: true, type: "lowpass", frequency: 2200, Q: 0.6, rolloff: -24 },
    envelope: { enabled: true, attack: 0.02, decay: 0.18, sustain: 0.82, release: 0.65 },
    modEnvelope: { enabled: true, attack: 0.01, decay: 0.24, sustain: 0.36, release: 0.8 },
    lfo: { enabled: true, type: "sine", frequency: 2.1, amount: 1, phase: 0 },
    ui: {
      visibleModules: {
        filter: true,
        envelope: true,
        modEnvelope: true,
        lfo: true,
      },
      cableTension: 0.78,
    },
    modulation: {
      lfoRoutes: [createModRoute("filter.frequency", 0.45)],
      envelopeRoutes: [createModRoute("filter.frequency", 0.4)],
    },
    sources: [createSourceModule("Oscillator")],
    components: [createComponentModule("Compressor")],
    effects: [createEffectModule("Chorus")],
  };

  const merged = deepMerge(fallback, preset);
  const legacyLfoTarget = preset?.lfo?.target;
  const legacyLfoAmount = typeof preset?.lfo?.amount === "number" ? preset.lfo.amount : 0.35;

  merged.sources = Array.isArray(preset.sources)
    ? preset.sources.map((module) => normalizeSourceModule(module))
    : fallback.sources.map((module) => normalizeSourceModule(module));
  merged.components = Array.isArray(preset.components)
    ? preset.components.map((module) => normalizeComponentModule(module))
    : fallback.components.map((module) => normalizeComponentModule(module));
  merged.effects = Array.isArray(preset.effects)
    ? preset.effects.map((module) => normalizeEffectModule(module))
    : fallback.effects.map((module) => normalizeEffectModule(module));
  merged.modEnvelope = deepMerge(fallback.modEnvelope, preset.modEnvelope || {});
  merged.lfo = deepMerge(fallback.lfo, preset.lfo || {});
  merged.filter = deepMerge(fallback.filter, preset.filter || {});
  merged.envelope = deepMerge(fallback.envelope, preset.envelope || {});
  merged.ui = deepMerge(fallback.ui, preset.ui || {});
  merged.modulation = deepMerge(fallback.modulation, preset.modulation || {});
  merged.modulation.lfoRoutes = Array.isArray(preset?.modulation?.lfoRoutes)
    ? preset.modulation.lfoRoutes.map((route) => ({ ...createModRoute(), ...route, id: route?.id || createId("route") }))
    : legacyLfoTarget
      ? [{ ...createModRoute(legacyLfoTarget, legacyLfoAmount), enabled: merged.lfo.enabled }]
      : fallback.modulation.lfoRoutes.map((route) => ({ ...route, id: createId("route") }));
  merged.modulation.envelopeRoutes = Array.isArray(preset?.modulation?.envelopeRoutes)
    ? preset.modulation.envelopeRoutes.map((route) => ({ ...createModRoute(), ...route, id: route?.id || createId("route") }))
    : fallback.modulation.envelopeRoutes.map((route) => ({ ...route, id: createId("route") }));
  merged.global.octave = clamp(Number(merged.global.octave || 4), 1, 7);
  merged.global.velocity = clamp(Number(merged.global.velocity || 0.8), 0.1, 1);
  merged.global.volume = clamp(Number(merged.global.volume || -8), -36, 6);
  return merged;
}

/* -------------------------------------------------------------------------- */
/* 音频状态提取函数                                                           */
/* -------------------------------------------------------------------------- */

/**
 * 获取滤波器音频状态
 * enabled 只是编辑器层的 UI 开关，不直接传给 Tone.Filter
 * @param {Object} filterState - 滤波器状态
 * @returns {Object} - 音频状态
 */
function getFilterAudioState(filterState = {}) {
  const { enabled, ...options } = filterState || {};
  return options;
}

/**
 * 获取包络音频状态
 * @param {Object} envelopeState - 包络状态
 * @returns {Object} - 音频状态
 */
function getEnvelopeAudioState(envelopeState = {}) {
  const { enabled, ...options } = envelopeState || {};
  return options;
}

/* -------------------------------------------------------------------------- */
/* 文件下载工具                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 下载 JSON 文件
 * @param {string} filename - 文件名
 * @param {*} data - 要下载的数据
 */
function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

/* -------------------------------------------------------------------------- */
/* 音频工具函数                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 安全调用 Tone 节点的 set()
 * 避免空对象或不支持 set 的节点报错
 * @param {Object} target - Tone 节点
 * @param {Object} options - 设置选项
 */
function safeSet(target, options) {
  if (!target || !options) {
    return;
  }
  if (typeof target.set === "function") {
    target.set(options);
  }
}

/**
 * 应用 Player 类选项
 * @param {Object} player - Tone.Player 实例
 * @param {Object} options - 选项
 */
function applyPlayerLikeOptions(player, options = {}) {
  if (!player || !options) {
    return;
  }

  [
    "playbackRate",
    "fadeIn",
    "fadeOut",
    "loopStart",
    "loopEnd",
    "grainSize",
    "overlap",
    "detune",
  ].forEach((key) => {
    if (options[key] !== undefined && key in player) {
      if (player[key] && typeof player[key] === "object" && "value" in player[key]) {
        player[key].value = options[key];
      } else {
        player[key] = options[key];
      }
    }
  });

  ["loop", "reverse", "mute"].forEach((key) => {
    if (options[key] !== undefined && key in player) {
      player[key] = Boolean(options[key]);
    }
  });
}

/**
 * 应用 Players 选项
 * @param {Object} bank - Tone.Players 实例
 * @param {Object} options - 选项
 */
function applyPlayersOptions(bank, options = {}) {
  if (!bank || typeof bank.player !== "function") {
    return;
  }

  ["fadeIn", "fadeOut"].forEach((key) => {
    if (options[key] !== undefined && key in bank) {
      bank[key] = options[key];
    }
  });
  if (options.mute !== undefined && "mute" in bank) {
    bank.mute = Boolean(options.mute);
  }

  const keys = new Set(["low", "mid", "high", ...Object.keys(options.urls || {})]);
  keys.forEach((key) => {
    const player = bank.player(key);
    if (player) {
      applyPlayerLikeOptions(player, options);
    }
  });
}

/**
 * 参数平滑更新封装
 * Tone.Param 优先使用 rampTo，否则回退到直接赋值
 * @param {Object} param - Tone 参数
 * @param {number} value - 目标值
 * @param {number} time - 过渡时间
 */
function rampParam(param, value, time = 0.12) {
  if (!param) {
    return;
  }
  if (typeof param.rampTo === "function") {
    param.rampTo(value, time);
  } else if ("value" in param) {
    param.value = value;
  }
}
