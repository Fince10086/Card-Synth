/**
 * Effect runtime - creates Tone.js effect instances
 */

import * as Tone from "tone";
import { rampParam, safeSet } from "../../utils/helpers";
import type { ModuleConfig } from "../../types";

export interface EffectRuntime {
  type: string;
  category: string;
  node: Tone.ToneAudioNode | null;
  apply(nextModule: ModuleConfig): void;
  dispose(): void;
}

export function createEffectRuntime(module: ModuleConfig): EffectRuntime {
  const RuntimeCtor = (Tone as Record<string, unknown>)[module.type];
  if (!RuntimeCtor || typeof RuntimeCtor !== "function") {
    return {
      type: module.type,
      category: module.category || "effect",
      node: null,
      apply: () => {},
      dispose: () => {},
    };
  }

  const node = new (RuntimeCtor as new (options?: unknown) => Tone.ToneAudioNode)(
    module.options
  );

  if (typeof (node as Record<string, unknown>).start === "function") {
    ((node as Record<string, unknown>).start as () => void)();
  }
  if (typeof (node as Record<string, unknown>).generate === "function") {
    ((node as Record<string, unknown>).generate as () => void)();
  }

  let prevOptions: Record<string, unknown> = { ...(module.options as Record<string, unknown>) };

  return {
    type: module.type,
    category: module.category || "effect",
    node,
    apply: (nextModule: ModuleConfig) => {
      const nextOptions = (nextModule.options || {}) as Record<string, unknown>;

      // 1. Extract only changed parameters
      const changedOptions: Record<string, unknown> = {};
      Object.keys(nextOptions).forEach((key) => {
        if (nextOptions[key] !== prevOptions[key]) {
          changedOptions[key] = nextOptions[key];
        }
      });

      if (Object.keys(changedOptions).length === 0) return;

      // 2. Use rampTo for AudioParam/Signal parameters
      Object.keys(changedOptions).forEach((key) => {
        const param = (node as Record<string, unknown>)[key];
        if (
          param &&
          typeof (param as Record<string, unknown>).rampTo === "function" &&
          typeof (param as Record<string, unknown>).value === "number"
        ) {
          rampParam(param as { rampTo(value: number, time: number): void }, changedOptions[key] as number, 0.05);
          delete changedOptions[key];
        }
      });

      // 3. Use safeSet for remaining parameters
      if (Object.keys(changedOptions).length > 0) {
        safeSet(node, changedOptions);
      }

      prevOptions = { ...nextOptions };
    },
    dispose: () => {
      if (node && typeof (node as Record<string, unknown>).dispose === "function") {
        ((node as Record<string, unknown>).dispose as () => void)();
      }
    },
  };
}
