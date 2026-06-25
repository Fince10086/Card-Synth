/**
 * Signal chain connection module - simplified for 4-track player
 */

import type { ModuleConfig } from "../../types";
import type { ToneAudioNode } from "tone";

export interface SignalChainOptions {
  modules: ModuleConfig[];
  runtimeMap: Map<string, Record<string, unknown>>;
  masterVolume: ToneAudioNode;
  isSourceModule(module: ModuleConfig): boolean;
}

export function connectSignalChain({
  modules,
  runtimeMap,
  masterVolume,
  isSourceModule,
}: SignalChainOptions): void {
  modules.forEach((module, index) => {
    const runtime = runtimeMap.get(module.id);
    if (!runtime || !module.enabled) {
      return;
    }

    if (isSourceModule(module)) {
      connectSourceModule({
        modules,
        sourceIndex: index,
        runtime,
        runtimeMap,
        masterVolume,
        isSourceModule,
      });
    } else {
      connectEffectModule({
        modules,
        moduleIndex: index,
        runtime,
        runtimeMap,
        masterVolume,
        isSourceModule,
      });
    }
  });
}

function findNextEffectIndex(
  modules: ModuleConfig[],
  startIndex: number,
  isSourceModule: (module: ModuleConfig) => boolean
): number {
  for (let i = startIndex + 1; i < modules.length; i++) {
    if (!isSourceModule(modules[i]) && modules[i].enabled) {
      return i;
    }
  }
  return -1;
}

function connectSourceModule({
  modules,
  sourceIndex,
  runtime,
  runtimeMap,
  masterVolume,
  isSourceModule,
}: {
  modules: ModuleConfig[];
  sourceIndex: number;
  runtime: Record<string, unknown>;
  runtimeMap: Map<string, Record<string, unknown>>;
  masterVolume: ToneAudioNode;
  isSourceModule: (module: ModuleConfig) => boolean;
}): void {
  const targetIndex = findNextEffectIndex(modules, sourceIndex, isSourceModule);

  const sourceNode = runtime.node as ToneAudioNode;
  if (!sourceNode) return;

  if (targetIndex >= 0) {
    const targetModule = modules[targetIndex];
    const targetRuntime = runtimeMap.get(targetModule.id);
    const targetNode = targetRuntime?.node as ToneAudioNode;
    if (targetNode) {
      sourceNode.disconnect();
      sourceNode.connect(targetNode);
    } else {
      sourceNode.disconnect();
      sourceNode.connect(masterVolume);
    }
  } else {
    sourceNode.disconnect();
    sourceNode.connect(masterVolume);
  }
}

function connectEffectModule({
  modules,
  moduleIndex,
  runtime,
  runtimeMap,
  masterVolume,
  isSourceModule,
}: {
  modules: ModuleConfig[];
  moduleIndex: number;
  runtime: Record<string, unknown>;
  runtimeMap: Map<string, Record<string, unknown>>;
  masterVolume: ToneAudioNode;
  isSourceModule: (module: ModuleConfig) => boolean;
}): void {
  const targetIndex = findNextEffectIndex(modules, moduleIndex, isSourceModule);

  if (targetIndex >= 0) {
    const targetModule = modules[targetIndex];
    const targetRuntime = runtimeMap.get(targetModule.id);
    if (targetRuntime && targetRuntime.node) {
      (runtime.node as ToneAudioNode).disconnect();
      (runtime.node as ToneAudioNode).connect(targetRuntime.node as ToneAudioNode);
    }
  } else {
    (runtime.node as ToneAudioNode).disconnect();
    (runtime.node as ToneAudioNode).connect(masterVolume);
  }
}
