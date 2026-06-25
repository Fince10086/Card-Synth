import * as Tone from "tone";
import type { ToneAudioNode } from "tone";
import { deepClone, safeSet, rampParam } from "../../utils/helpers";
import type { ModuleConfig } from "../../types";

export interface TrackPlayerRuntime {
  player: Tone.Player | null;
  gainNode: Tone.Gain;
  panNode: Tone.Panner;
  type: string;
  category: string;
  moduleState: ModuleConfig;
  node: ToneAudioNode;
  isMono: boolean;
  preserveVoiceSlotsForSourceTargets: boolean;
  loaded: Promise<void>;
  apply(nextModule: ModuleConfig): void;
  dispose(): void;
  getModulationOutput(voiceIndex: number): ToneAudioNode | null;
}

export function createTrackPlayerRuntime(
  module: ModuleConfig,
  url: string,
): TrackPlayerRuntime {
  let moduleState = deepClone(module);
  const options = (moduleState.options || {}) as Record<string, unknown>;

  const gainNode = new Tone.Gain(
    moduleState.enabled
      ? Tone.dbToGain((moduleState.volume as number) ?? -8)
      : 0
  );
  const panNode = new Tone.Panner((moduleState.pan as number) ?? 0);

  gainNode.connect(panNode);

  let player: Tone.Player | null = null;

  let resolveLoaded: () => void = () => {};
  const loadedPromise = new Promise<void>((resolve) => {
    resolveLoaded = resolve;
  });

  try {
    player = new Tone.Player({
      url,
      loop: options.loop !== false,
      playbackRate: (options.playbackRate as number) ?? 1,
      reverse: (options.reverse as boolean) ?? false,
      onload: () => {
        player?.sync().start(0);
        resolveLoaded();
      },
    });

    player.connect(gainNode);

    // If already loaded (e.g. from cache), sync and schedule immediately
    if (player.loaded) {
      player.sync().start(0);
      resolveLoaded();
    }
  } catch {
    resolveLoaded(); // Resolve even on error to avoid blocking
  }

  (moduleState.options as Record<string, unknown>).url = url;

  const rt: TrackPlayerRuntime = {
    player,
    gainNode,
    panNode,
    type: module.type as string,
    category: "source",
    node: panNode,
    moduleState,
    isMono: false,
    preserveVoiceSlotsForSourceTargets: false,
    loaded: loadedPromise,

    apply(nextModule: ModuleConfig): void {
      moduleState = deepClone(nextModule);
      rt.moduleState = moduleState;
      const opts = (moduleState.options || {}) as Record<string, unknown>;

      const volume = moduleState.enabled
        ? Tone.dbToGain((moduleState.volume as number) ?? -8)
        : 0;
      rampParam(gainNode.gain, volume);

      rampParam(panNode.pan, (moduleState.pan as number) ?? 0);

      if (player) {
        safeSet(player as unknown as Record<string, unknown>, {
          playbackRate: opts.playbackRate,
          loop: opts.loop !== false,
          reverse: opts.reverse,
        });

        if (opts.loopStart !== undefined) {
          (player as unknown as Record<string, unknown>).loopStart = Number(opts.loopStart);
        }
        if (opts.loopEnd !== undefined) {
          (player as unknown as Record<string, unknown>).loopEnd = Number(opts.loopEnd);
        }
      }
    },

    getModulationOutput(): ToneAudioNode | null {
      return gainNode;
    },

    dispose(): void {
      if (player) {
        player.dispose();
        player = null;
      }
      gainNode.dispose();
      panNode.dispose();
    },
  };

  return rt;
}
