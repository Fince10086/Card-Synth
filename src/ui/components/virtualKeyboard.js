import { KEYBOARD_LAYOUT, noteFromOffset } from "../../utils/helpers.js";

export function renderKeyboard(keyboardElement, state, inputManager, ensureAudioStartedFn, heldPointerNotes) {
  if (!keyboardElement) {
    return;
  }
  keyboardElement.innerHTML = "";

  const ONE_OCTAVE_LAYOUT = KEYBOARD_LAYOUT.slice(0, 13);

  const containerWidth = keyboardElement.clientWidth;
  const whiteKeyCount = ONE_OCTAVE_LAYOUT.filter((e) => !e.black).length;
  const whiteKeyWidth = containerWidth / whiteKeyCount;
  const blackKeyWidth = whiteKeyWidth * 0.65;
  const keyboardPadding = 0;

  keyboardElement.style.setProperty("--white-key-width", `${whiteKeyWidth}px`);
  keyboardElement.style.setProperty("--black-key-width", `${blackKeyWidth}px`);

  ONE_OCTAVE_LAYOUT.forEach((entry) => {
    const note = noteFromOffset(state.global.octave, entry.offset);
    const key = document.createElement("button");
    key.type = "button";
    key.className = entry.black ? "black-key" : "white-key";
    key.dataset.note = note;
    key.dataset.key = entry.key;

    const left = entry.black
      ? keyboardPadding + (entry.whiteIndex + 1) * whiteKeyWidth - blackKeyWidth / 2
      : keyboardPadding + entry.whiteIndex * whiteKeyWidth;
    key.style.left = `${left}px`;

    const cap = document.createElement("div");
    cap.className = "key-cap";
    key.append(cap);

    key.addEventListener("pointerdown", async () => {
      await ensureAudioStartedFn();
      inputManager.pressNote(note);
      heldPointerNotes.add(note);
      key.classList.add("active");
    });

    key.addEventListener("pointerup", () => {
      inputManager.releaseNote(note);
      heldPointerNotes.delete(note);
      key.classList.remove("active");
    });

    key.addEventListener("pointerleave", () => {
      if (heldPointerNotes.has(note)) {
        inputManager.releaseNote(note);
        heldPointerNotes.delete(note);
        key.classList.remove("active");
      }
    });

    if (inputManager.heldComputerKeys.has(entry.key)) {
      key.classList.add("active");
    }

    keyboardElement.append(key);
  });
}
