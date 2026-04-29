/**
 * Note voice tracker for envelope voice allocation
 */

export interface VoiceState {
  note: string | null;
  startTime: number;
}

export interface NoteVoiceTracker {
  allocate(note: string, time: number): number;
  releaseByNote(note: string): number;
  clearAll(): void;
  hasActiveNotes(): boolean;
}

export function createNoteVoiceTracker(voiceCount: number): NoteVoiceTracker {
  const voiceStates: VoiceState[] = Array.from({ length: voiceCount }, () => ({
    note: null,
    startTime: 0,
  }));

  const findAvailableVoice = (): number => {
    let oldest: VoiceState | null = null;
    let oldestIndex = -1;

    for (let i = 0; i < voiceStates.length; i++) {
      if (!voiceStates[i].note) {
        return i;
      }
      if (!oldest || voiceStates[i].startTime < oldest.startTime) {
        oldest = voiceStates[i];
        oldestIndex = i;
      }
    }
    return oldest ? oldestIndex : 0;
  };

  return {
    allocate(note: string, time: number): number {
      const index = findAvailableVoice();
      voiceStates[index].note = note;
      voiceStates[index].startTime = time;
      return index;
    },

    releaseByNote(note: string): number {
      const index = voiceStates.findIndex((item) => item.note === note);
      if (index < 0) {
        return -1;
      }
      voiceStates[index].note = null;
      return index;
    },

    clearAll(): void {
      voiceStates.forEach((item) => {
        item.note = null;
        item.startTime = 0;
      });
    },

    hasActiveNotes(): boolean {
      return voiceStates.some((item) => item.note !== null);
    },
  };
}
