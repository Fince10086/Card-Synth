export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const KEYBOARD_LAYOUT = [
  { key: "a", offset: 0, whiteIndex: 0, black: false },
  { key: "w", offset: 1, whiteIndex: 0, black: true },
  { key: "s", offset: 2, whiteIndex: 1, black: false },
  { key: "e", offset: 3, whiteIndex: 1, black: true },
  { key: "d", offset: 4, whiteIndex: 2, black: false },
  { key: "f", offset: 5, whiteIndex: 3, black: false },
  { key: "t", offset: 6, whiteIndex: 3, black: true },
  { key: "g", offset: 7, whiteIndex: 4, black: false },
  { key: "y", offset: 8, whiteIndex: 4, black: true },
  { key: "h", offset: 9, whiteIndex: 5, black: false },
  { key: "u", offset: 10, whiteIndex: 5, black: true },
  { key: "j", offset: 11, whiteIndex: 6, black: false },
  { key: "k", offset: 12, whiteIndex: 7, black: false },
  { key: "o", offset: 13, whiteIndex: 7, black: true },
  { key: "l", offset: 14, whiteIndex: 8, black: false },
  { key: "p", offset: 15, whiteIndex: 8, black: true },
  { key: ";", offset: 16, whiteIndex: 9, black: false },
  { key: "'", offset: 17, whiteIndex: 10, black: false },
];

export const KEY_MAP = new Map(KEYBOARD_LAYOUT.map((item) => [item.key, item]));

export function noteFromOffset(baseOctave, offset) {
  const pitchClass = NOTE_NAMES[offset % 12];
  const octaveShift = Math.floor(offset / 12);
  return `${pitchClass}${baseOctave + octaveShift}`;
}
