import { KEYBOARD_LAYOUT, noteFromOffset } from "../../utils/helpers.js";

const ONE_OCTAVE_LAYOUT = KEYBOARD_LAYOUT.slice(0, 13);

export function renderKeyboard(keyboardElement, state, inputManager, ensureAudioStartedFn, heldPointerNotes) {
  if (!keyboardElement) {
    return;
  }

  const containerWidth = keyboardElement.clientWidth;
  const whiteKeyCount = ONE_OCTAVE_LAYOUT.filter((e) => !e.black).length;
  const whiteKeyWidth = containerWidth / whiteKeyCount;
  const blackKeyWidth = whiteKeyWidth * 0.65;

  keyboardElement.style.setProperty("--white-key-width", `${whiteKeyWidth}px`);
  keyboardElement.style.setProperty("--black-key-width", `${blackKeyWidth}px`);

  const isFirstRender = !keyboardElement.dataset.keyboardBound;
  
  if (isFirstRender) {
    const fragment = document.createDocumentFragment();
    
    ONE_OCTAVE_LAYOUT.forEach((entry) => {
      const key = document.createElement("button");
      key.type = "button";
      key.className = entry.black ? "black-key" : "white-key";
      key.dataset.key = entry.key;
      
      const cap = document.createElement("div");
      cap.className = "key-cap";
      key.append(cap);
      
      fragment.append(key);
    });
    
    keyboardElement.append(fragment);
    
    // 事件委托 + setPointerCapture
    keyboardElement.addEventListener("pointerdown", async (e) => {
      const key = e.target.closest('[data-key]');
      if (!key) return;
      
      key.setPointerCapture(e.pointerId);
      
      await ensureAudioStartedFn();
      const note = key.dataset.note;
      inputManager.pressNote(note);
      heldPointerNotes.add(note);
      key.classList.add("active");
    });

    keyboardElement.addEventListener("pointerup", (e) => {
      const key = e.target.closest('[data-key]');
      if (!key) return;
      
      const note = key.dataset.note;
      if (heldPointerNotes.has(note)) {
        inputManager.releaseNote(note);
        heldPointerNotes.delete(note);
        key.classList.remove("active");
      }
    });
    
    keyboardElement.dataset.keyboardBound = "true";
  }

  // 更新所有键的位置、note 和 active 状态
  ONE_OCTAVE_LAYOUT.forEach((entry, index) => {
    const key = keyboardElement.children[index];
    if (!key) return;
    
    const note = noteFromOffset(state.global.octave, entry.offset);
    key.dataset.note = note;
    
    const left = entry.black
      ? (entry.whiteIndex + 1) * whiteKeyWidth - blackKeyWidth / 2
      : entry.whiteIndex * whiteKeyWidth;
    key.style.left = `${left}px`;
    
    if (inputManager.heldComputerKeys.has(entry.key)) {
      key.classList.add("active");
    } else {
      key.classList.remove("active");
    }
  });
}
