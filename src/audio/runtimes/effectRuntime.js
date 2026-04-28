import * as Tone from "tone";
import { rampParam, safeSet } from "../../utils/helpers.js";
/**
 * 创建效果器运行时
 *
 * 为大多数非音源、非包络模块创建 Tone.js 组件实例。
 *
 * @param {Object} module - 模块配置
 * @returns {Object} 效果器运行时对象
 */
export function createEffectRuntime(module) {
  const RuntimeCtor = Tone[module.type];
  if (!RuntimeCtor) {
    return {
      type: module.type,
      category: module.category || "effect",
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
    category: module.category || "effect",
    node,
    apply: (nextModule) => {
      const nextOptions = nextModule.options || {};

      // 1. 只提取真正变化的参数
      const changedOptions = {};
      Object.keys(nextOptions).forEach((key) => {
        if (nextOptions[key] !== prevOptions[key]) {
          changedOptions[key] = nextOptions[key];
        }
      });

      if (Object.keys(changedOptions).length === 0) return;

      // 2. 对根级 AudioParam/Signal 使用 rampTo（避免瞬变爆音）
      Object.keys(changedOptions).forEach((key) => {
        const param = node[key];
        if (
          param &&
          typeof param.rampTo === "function" &&
          typeof param.value === "number"
        ) {
          rampParam(param, changedOptions[key], 0.05);
          delete changedOptions[key];
        }
      });

      // 3. 剩余参数（setter、嵌套对象等）走 safeSet
      if (Object.keys(changedOptions).length > 0) {
        safeSet(node, changedOptions);
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
