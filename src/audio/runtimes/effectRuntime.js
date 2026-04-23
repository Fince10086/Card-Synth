import * as Tone from "tone";
import { rampParam, safeSet } from "../../utils/helpers.js";
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

  let prevOptions = { ...module.options };

  return {
    type: module.type,
    category: module.category || "component",
    node,
    apply: (nextModule) => {
      const nextOptions = nextModule.options || {};

      if (node instanceof Tone.Filter) {
        if (nextOptions.frequency !== undefined && nextOptions.frequency !== prevOptions.frequency) {
          rampParam(node.frequency, nextOptions.frequency, 0.05);
        }

        const changedOptions = {};
        Object.keys(nextOptions).forEach((key) => {
          if (key !== "frequency" && nextOptions[key] !== prevOptions[key]) {
            changedOptions[key] = nextOptions[key];
          }
        });

        if (Object.keys(changedOptions).length > 0) {
          safeSet(node, changedOptions);
        }
      } else {
        safeSet(node, nextOptions);
      }

      prevOptions = { ...nextOptions };
    },
    dispose: () => {
      if (node && typeof node.dispose === "function") {
        node.dispose();
      }
    },
  };
}
