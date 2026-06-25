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

  try {
    player = new Tone.Player({
      url,
      loop: options.loop !== false,
      playbackRate: (options.playbackRate as number) ?? 1,
      reverse: (options.reverse as boolean) ?? false,
    }).sync().start(0);

    player.connect(gainNode);
  } catch {
    // Player creation failed
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

    getModulationOutput(voiceIndex: number): ToneAudioNode | null {
      return player && player.loaded ? gainNode : null;
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
