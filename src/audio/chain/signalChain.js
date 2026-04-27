/**
 * 信号链连接模块
 *
 * 负责构建和连接模块间的音频信号流。
 * 区分 Source 模块、AmplitudeEnvelope 模块和其他 Effect 模块的连接策略。
 */

/**
 * 连接整个信号链
 *
 * @param {Object} options - 配置选项
 * @param {Array} options.modules - 模块列表
 * @param {Map} options.runtimeMap - 运行时映射
 * @param {Object} options.masterVolume - 主音量节点
 * @param {Function} options.isSourceModule - 判断是否为音源模块
 * @param {Function} options.isAmpEnvModule - 判断是否为振幅包络模块
 */
export function connectSignalChain({ modules, runtimeMap, masterVolume, isSourceModule, isAmpEnvModule, isInputModule }) {
  const ampEnvIndices = new Set();
  modules.forEach((module, index) => {
    if (isAmpEnvModule(module) && module.enabled) {
      ampEnvIndices.add(index);
    }
  });

  modules.forEach((module, index) => {
    const runtime = runtimeMap.get(module.id);
    if (!runtime || !module.enabled) {
      return;
    }

    // Input 模块不参与音频信号链连接
    if (isInputModule && isInputModule(module)) {
      return;
    }

    if (isSourceModule(module)) {
      connectSourceModule({ modules, sourceIndex: index, runtime, ampEnvIndices, runtimeMap, masterVolume, isSourceModule, isInputModule });
    } else {
      connectNonSourceModule({ modules, moduleIndex: index, runtime, runtimeMap, masterVolume, isSourceModule, isInputModule });
    }
  });
}

/**
 * 查找下一个非音源且启用的模块索引
 *
 * @param {Array} modules - 模块列表
 * @param {number} startIndex - 起始索引
 * @param {Function} isSourceModule - 判断是否为音源模块
 * @returns {number} 目标模块索引，未找到返回 -1
 */
function findNextNonSourceIndex(modules, startIndex, isSourceModule, isInputModule) {
  for (let i = startIndex + 1; i < modules.length; i++) {
    if (!isSourceModule(modules[i]) && modules[i].enabled) {
      // 跳过 Input 模块，它们不参与音频路由
      if (isInputModule && isInputModule(modules[i])) {
        continue;
      }
      return i;
    }
  }
  return -1;
}

/**
 * 连接音源模块
 *
 * @param {Object} params - 参数对象
 * @param {Array} params.modules - 模块列表
 * @param {number} params.sourceIndex - 音源模块索引
 * @param {Object} params.runtime - 音源运行时
 * @param {Set} params.ampEnvIndices - 振幅包络索引集合
 * @param {Map} params.runtimeMap - 运行时映射
 * @param {Object} params.masterVolume - 主音量节点
 * @param {Function} params.isSourceModule - 判断是否为音源模块
 */
function connectSourceModule({ modules, sourceIndex, runtime, ampEnvIndices, runtimeMap, masterVolume, isSourceModule, isInputModule }) {
  const sourceModule = modules[sourceIndex];
  if (sourceModule?.type === "Envelope") {
    return;
  }

  if (sourceModule?.modulationMode) {
    return;
  }

  const targetIndex = findNextNonSourceIndex(modules, sourceIndex, isSourceModule, isInputModule);
  const isFirstModuleAmpEnv = targetIndex >= 0 && ampEnvIndices.has(targetIndex);

  let hasAmpEnvAnywhere = false;
  for (let i = sourceIndex + 1; i < modules.length; i++) {
    if (ampEnvIndices.has(i)) {
      hasAmpEnvAnywhere = true;
      break;
    }
  }

  const needsExtendedRelease = hasAmpEnvAnywhere && !isFirstModuleAmpEnv;
  runtime.needsExtendedRelease = needsExtendedRelease;

    runtime.hasAmpEnv = isFirstModuleAmpEnv;

    if (isFirstModuleAmpEnv) {
      const ampEnvModule = modules[targetIndex];
      const ampEnvRuntime = runtimeMap.get(ampEnvModule.id);
      runtime.ampEnvRuntime = ampEnvRuntime;

      // 标记 AmpEnv 为 per-voice 连接模式
      if (ampEnvRuntime) {
        ampEnvRuntime.hasPerVoiceConnection = true;
      }

      runtime.voices.forEach((voice, i) => {
        if (voice.initialized && ampEnvRuntime && ampEnvRuntime.voices && ampEnvRuntime.voices[i]) {
          const outputNode = voice.panNode || voice.hiddenAmpEnv;
          outputNode.connect(ampEnvRuntime.voices[i]);
        }
      });
    } else {
    runtime.ampEnvRuntime = null;

    if (needsExtendedRelease) {
      for (let i = sourceIndex + 1; i < modules.length; i++) {
        if (ampEnvIndices.has(i)) {
          const ampEnvModule = modules[i];
          runtime.chainedAmpEnvRuntime = runtimeMap.get(ampEnvModule.id);
          break;
        }
      }
    }

    let targetNode;
    if (targetIndex >= 0) {
      const targetModule = modules[targetIndex];
      const targetRuntime = runtimeMap.get(targetModule.id);
      targetNode = targetRuntime && targetRuntime.node;
    } else {
      targetNode = masterVolume;
    }

    runtime.voices.forEach((voice) => {
      if (targetNode && voice.initialized && voice.hiddenAmpEnv) {
        voice.hiddenAmpEnv.connect(targetNode);
      }
    });

    // 存储 targetNode 供懒加载的 voice 使用
    runtime.targetNode = targetNode;
  }
}

/**
 * 连接非音源模块
 *
 * @param {Object} params - 参数对象
 * @param {Array} params.modules - 模块列表
 * @param {number} params.moduleIndex - 当前模块索引
 * @param {Object} params.runtime - 当前运行时
 * @param {Map} params.runtimeMap - 运行时映射
 * @param {Object} params.masterVolume - 主音量节点
 * @param {Function} params.isSourceModule - 判断是否为音源模块
 */
function connectNonSourceModule({ modules, moduleIndex, runtime, runtimeMap, masterVolume, isSourceModule, isInputModule }) {
  if (runtime.type === "AmplitudeEnvelope") {
    const targetIndex = findNextNonSourceIndex(modules, moduleIndex, isSourceModule, isInputModule);

    let targetNode;
    if (targetIndex >= 0) {
      const targetModule = modules[targetIndex];
      const targetRuntime = runtimeMap.get(targetModule.id);
      targetNode = targetRuntime && targetRuntime.node;
    } else {
      targetNode = masterVolume;
    }

    if (targetNode) {
      if (runtime.node) {
        runtime.node.connect(targetNode);
      }
      if (runtime.voices) {
        runtime.voices.forEach((env) => env.connect(targetNode));
      }
    }
    return;
  }

  const targetIndex = findNextNonSourceIndex(modules, moduleIndex, isSourceModule, isInputModule);

  if (targetIndex >= 0) {
    const targetModule = modules[targetIndex];
    const targetRuntime = runtimeMap.get(targetModule.id);
    if (targetRuntime && targetRuntime.node) {
      runtime.node.connect(targetRuntime.node);
    }
  } else {
    runtime.node.connect(masterVolume);
  }
}
