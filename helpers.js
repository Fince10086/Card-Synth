/**
 * helpers.js
 * 工具函数集合
 * 
 * 包含：
 * - ID生成器和计数器
 * - 深拷贝和深合并工具
 * - 数值钳制工具
 * - 路径访问工具
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

/**
 * 重置模块计数器
 */
function resetModuleCounter() {
  moduleCounter = 1;
}

/* -------------------------------------------------------------------------- */
/* 深拷贝和深合并工具                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 深拷贝只用于可 JSON 化的数据结构
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
 * 深合并用于把用户导入的 preset 补成完整结构
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
 * 数值钳制工具
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
 * 通过路径读取深层字段
 * @param {Object} object - 目标对象
 * @param {string} path - 路径字符串
 * @returns {*} - 找到的值
 */
function getByPath(object, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), object);
}

/**
 * 通过路径写入深层字段
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
 * 根据基础八度和键位偏移，生成音名
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
    category: "source",
    enabled: true,
    volume: -8,
    pan: 0,
    modulationMode: false,
    modulationFrequency: 1,
    index: moduleCounter - 1,
    ...(definition.moduleDefaults ? deepClone(definition.moduleDefaults) : {}),
    options: deepClone(definition.options),
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
    category: "effect",
    enabled: true,
    index: moduleCounter - 1,
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
    category: "component",
    enabled: true,
    index: moduleCounter - 1,
    options: deepClone(definition.options),
  };
}

/**
 * 创建模块实例（统一入口）
 * @param {string} category - 模块类别 (source/component/effect)
 * @param {string} type - 模块类型
 * @returns {Object} - 模块实例
 */
function createModule(category, type) {
  if (category === "source") {
    return createSourceModule(type);
  }
  if (category === "effect") {
    return createEffectModule(type);
  }
  return createComponentModule(type);
}

/* -------------------------------------------------------------------------- */
/* 模块选项生成器                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 获取可添加模块选项列表
 * @returns {Array} - 模块选项列表
 */
function getAddableModuleOptions() {
  return [
    ...Object.keys(SOURCE_LIBRARY).map((type) => ({
      value: `source:${type}`,
      label: `OSC / ${type}`,
      category: "source",
    })),
    ...Object.keys(COMPONENT_LIBRARY).map((type) => ({
      value: `component:${type}`,
      label: `Component / ${type}`,
      category: "component",
    })),
    ...Object.keys(EFFECT_LIBRARY).map((type) => ({
      value: `effect:${type}`,
      label: `Effect / ${type}`,
      category: "effect",
    })),
  ];
}

/* -------------------------------------------------------------------------- */
/* 预设标准化函数                                                             */
/* -------------------------------------------------------------------------- */

/**
 * 标准化模块
 * @param {Object} module - 模块对象
 * @param {string} defaultCategory - 默认类别
 * @param {Function} defaultCreator - 默认创建函数
 * @returns {Object} - 标准化后的模块
 */
function normalizeModule(module, defaultCategory, defaultCreator) {
  const base = defaultCreator(module?.type);
  const merged = deepMerge(base, module || {});
  merged.id = module?.id || base.id;
  merged.category = module?.category || defaultCategory;
  merged.index = module?.index ?? base.index;
  return merged;
}

/**
 * 标准化声源模块
 * @param {Object} module - 声源模块
 * @returns {Object} - 标准化后的模块
 */
function normalizeSourceModule(module) {
  return normalizeModule(module, "source", (type) => createSourceModule(type || "Oscillator"));
}

/**
 * 标准化效果器模块
 * @param {Object} module - 效果器模块
 * @returns {Object} - 标准化后的模块
 */
function normalizeEffectModule(module) {
  return normalizeModule(module, "effect", (type) => createEffectModule(type || "Chorus"));
}

/**
 * 标准化组件模块
 * @param {Object} module - 组件模块
 * @returns {Object} - 标准化后的模块
 */
function normalizeComponentModule(module) {
  return normalizeModule(module, "component", (type) => createComponentModule(type || "Compressor"));
}

/**
 * 标准化模块（统一入口）
 * @param {Object} module - 模块对象
 * @returns {Object} - 标准化后的模块
 */
function normalizeAnyModule(module) {
  const category = module?.category || "component";
  if (category === "source") {
    return normalizeSourceModule(module);
  }
  if (category === "effect") {
    return normalizeEffectModule(module);
  }
  return normalizeComponentModule(module);
}

/* -------------------------------------------------------------------------- */
/* 音频工具函数                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 安全调用 Tone 节点的 set()
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
 * 参数平滑更新封装
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

/* -------------------------------------------------------------------------- */
/* 模块分类工具                                                               */
/* -------------------------------------------------------------------------- */

/**
 * 获取模块定义
 * @param {Object} module - 模块对象
 * @returns {Object} - 模块定义
 */
function getModuleDefinition(module) {
  if (module.category === "source" || SOURCE_LIBRARY[module.type]) {
    return SOURCE_LIBRARY[module.type] || SOURCE_LIBRARY.Oscillator;
  }
  if (module.category === "effect" || EFFECT_LIBRARY[module.type]) {
    return EFFECT_LIBRARY[module.type] || EFFECT_LIBRARY.Chorus;
  }
  return COMPONENT_LIBRARY[module.type] || COMPONENT_LIBRARY.Compressor;
}

/**
 * 获取模块强调色
 * @param {Object} module - 模块对象
 * @returns {string} - 强调色
 */
function getModuleAccent(module) {
  const definition = getModuleDefinition(module);
  return definition.accent || "component";
}

/**
 * 获取模块标签
 * @param {Object} module - 模块对象
 * @returns {string} - 标签
 */
function getModuleTag(module) {
  const definition = getModuleDefinition(module);
  return definition.tag || "Module";
}
