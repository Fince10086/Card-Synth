/**
 * Signal chain connection module
 */

import type { ModuleConfig } from "../../types";
import type { ToneAudioNode } from "tone";

export interface SignalChainOptions {
  modules: ModuleConfig[];
  runtimeMap: Map<string, Record<string, unknown>>;
  masterVolume: ToneAudioNode;
  isSourceModule(module: ModuleConfig): boolean;
  isEnvModule(module: ModuleConfig): boolean;
  isInputModule(module: ModuleConfig): boolean;
}

export function connectSignalChain({
  modules,
  runtimeMap,
  masterVolume,
  isSourceModule,
  isEnvModule,
  isInputModule,
}: SignalChainOptions): void {
  const envIndices = new Set<number>();
  modules.forEach((module, index) => {
    if (isEnvModule(module) && module.enabled) {
      envIndices.add(index);
    }
  });

  modules.forEach((module, index) => {
    const runtime = runtimeMap.get(module.id);
    if (!runtime || !module.enabled) {
      return;
    }

    if (isInputModule(module)) {
      return;
    }

    if (isSourceModule(module)) {
      connectSourceModule({
        modules,
        sourceIndex: index,
        runtime,
        envIndices,
        runtimeMap,
        masterVolume,
        isSourceModule,
        isInputModule,
      });
    } else {
      connectNonSourceModule({
        modules,
        moduleIndex: index,
        runtime,
        runtimeMap,
        masterVolume,
        isSourceModule,
        isInputModule,
      });
    }
  });
}

function findNextNonSourceIndex(
  modules: ModuleConfig[],
  startIndex: number,
  isSourceModule: (module: ModuleConfig) => boolean,
  isInputModule: (module: ModuleConfig) => boolean
): number {
  for (let i = startIndex + 1; i < modules.length; i++) {
    if (!isSourceModule(modules[i]) && modules[i].enabled) {
      if (isInputModule(modules[i])) {
        continue;
      }
      if (modules[i].type === "Envelope" && modules[i].modulationMode) {
        continue;
      }
      return i;
    }
  }
  return -1;
}

function connectSourceModule({
  modules,
  sourceIndex,
  runtime,
  envIndices,
  runtimeMap,
  masterVolume,
  isSourceModule,
  isInputModule,
}: {
  modules: ModuleConfig[];
  sourceIndex: number;
  runtime: Record<string, unknown>;
  envIndices: Set<number>;
  runtimeMap: Map<string, Record<string, unknown>>;
  masterVolume: ToneAudioNode;
  isSourceModule: (module: ModuleConfig) => boolean;
  isInputModule: (module: ModuleConfig) => boolean;
}): void {
  const sourceModule = modules[sourceIndex];
  if (sourceModule?.type === "Envelope" && sourceModule?.modulationMode) {
    return;
  }

  if (sourceModule?.modulationMode) {
    return;
  }

  const targetIndex = findNextNonSourceIndex(modules, sourceIndex, isSourceModule, isInputModule);
  const isFirstModuleEnv = targetIndex >= 0 && envIndices.has(targetIndex);

  let hasEnvAnywhere = false;
  for (let i = sourceIndex + 1; i < modules.length; i++) {
    if (envIndices.has(i)) {
      hasEnvAnywhere = true;
      break;
    }
  }

  const needsExtendedRelease = hasEnvAnywhere && !isFirstModuleEnv;
  runtime.needsExtendedRelease = needsExtendedRelease;
  runtime.hasEnv = isFirstModuleEnv;

  if (isFirstModuleEnv) {
    const envModule = modules[targetIndex];
    const envRuntime = runtimeMap.get(envModule.id);
    runtime.envRuntime = envRuntime;

    if (envRuntime) {
      envRuntime.hasPerVoiceConnection = true;
    }

    const voices = runtime.voices as Array<Record<string, unknown>>;
    voices.forEach((voice, i) => {
      if (voice.initialized && envRuntime && envRuntime.voices) {
        const envVoices = envRuntime.voices as Array<ToneAudioNode>;
        const outputNode = (voice.panNode || voice.hiddenEnv) as ToneAudioNode;
        if (outputNode && envVoices[i]) {
          outputNode.connect(envVoices[i]);
        }
      }
    });
  } else {
    runtime.envRuntime = null;

    if (needsExtendedRelease) {
      for (let i = sourceIndex + 1; i < modules.length; i++) {
        if (envIndices.has(i)) {
          const envModule = modules[i];
          runtime.chainedEnvRuntime = runtimeMap.get(envModule.id);
          break;
        }
      }
    }

    let targetNode: ToneAudioNode;
    if (targetIndex >= 0) {
      const targetModule = modules[targetIndex];
      const targetRuntime = runtimeMap.get(targetModule.id);
      targetNode = (targetRuntime?.node as ToneAudioNode) || masterVolume;
    } else {
      targetNode = masterVolume;
    }

    const voices = runtime.voices as Array<Record<string, unknown>>;
    voices.forEach((voice) => {
      if (targetNode && voice.initialized && voice.hiddenEnv) {
        (voice.hiddenEnv as ToneAudioNode).connect(targetNode);
      }
    });

    runtime.targetNode = targetNode;
  }
}

function connectNonSourceModule({
  modules,
  moduleIndex,
  runtime,
  runtimeMap,
  masterVolume,
  isSourceModule,
  isInputModule,
}: {
  modules: ModuleConfig[];
  moduleIndex: number;
  runtime: Record<string, unknown>;
  runtimeMap: Map<string, Record<string, unknown>>;
  masterVolume: ToneAudioNode;
  isSourceModule: (module: ModuleConfig) => boolean;
  isInputModule: (module: ModuleConfig) => boolean;
}): void {
  if (runtime.type === "Envelope" && runtime.modulationMode) {
    return;
  }

  if (runtime.type === "Envelope" && !runtime.modulationMode) {
    const targetIndex = findNextNonSourceIndex(modules, moduleIndex, isSourceModule, isInputModule);

    let targetNode: ToneAudioNode;
    if (targetIndex >= 0) {
      const targetModule = modules[targetIndex];
      const targetRuntime = runtimeMap.get(targetModule.id);
      targetNode = (targetRuntime?.node as ToneAudioNode) || masterVolume;
    } else {
      targetNode = masterVolume;
    }

    if (targetNode) {
      if (runtime.node) {
        (runtime.node as ToneAudioNode).connect(targetNode);
      }
      if (runtime.voices) {
        const voices = runtime.voices as Array<ToneAudioNode>;
        voices.forEach((env) => env.connect(targetNode));
      }
    }
    return;
  }

  const targetIndex = findNextNonSourceIndex(modules, moduleIndex, isSourceModule, isInputModule);

  if (targetIndex >= 0) {
    const targetModule = modules[targetIndex];
    const targetRuntime = runtimeMap.get(targetModule.id);
    if (targetRuntime && targetRuntime.node) {
      (runtime.node as ToneAudioNode).connect(targetRuntime.node as ToneAudioNode);
    }
  } else {
    (runtime.node as ToneAudioNode).connect(masterVolume);
  }
}
