import * as Tone from "tone";
import { safeSet } from "../../utils/helpers.js";
import { createAmplitudeEnvelopeRuntime } from "./amplitudeEnvelopeRuntime.js";

/**
 * 创建效果器运行时
 *
 * 为大多数非音源、非包络模块创建 Tone.js 组件实例。
 * 特殊处理 AmplitudeEnvelope，委托给专门的振幅包络运行时创建器。
 *
 * @param {Object} module - 模块配置
 * @returns {Object} 效果器运行时对象
 */
export function createEffectRuntime(module) {
  if (module.type === "AmplitudeEnvelope") {
    return createAmplitudeEnvelopeRuntime(module);
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
