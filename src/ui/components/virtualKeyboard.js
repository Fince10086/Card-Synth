import { KEYBOARD_LAYOUT, noteFromOffset } from "../../utils/helpers.js";

const ONE_OCTAVE_LAYOUT = KEYBOARD_LAYOUT.slice(0, 13);

const pointerDownMap = new Map();

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
      key.setAttribute("tabindex", "-1");
      key.dataset.key = entry.key;
      
      const cap = document.createElement("div");
      cap.className = "key-cap";
      key.append(cap);
      
      fragment.append(key);
    });
    
    keyboardElement.append(fragment);
    
    // 事件委托 + setPointerCapture，支持滑动切换
    keyboardElement.addEventListener("pointerdown", async (e) => {
      const key = e.target.closest('[data-key]');
      if (!key) return;

      key.setPointerCapture(e.pointerId);

      await ensureAudioStartedFn();
      const note = key.dataset.note;
      inputManager.pressNote(note);
      heldPointerNotes.add(note);
      key.classList.add("active");
      pointerDownMap.set(e.pointerId, { keyElement: key, note });
    });

    keyboardElement.addEventListener("pointermove", (e) => {
      const current = pointerDownMap.get(e.pointerId);
      if (!current) return;

      const key = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-key]');

      if (!key) {
        inputManager.releaseNote(current.note);
        heldPointerNotes.delete(current.note);
        current.keyElement.classList.remove("active");
        current.keyElement.releasePointerCapture(e.pointerId);
        pointerDownMap.delete(e.pointerId);
        return;
      }

      if (key !== current.keyElement) {
        current.keyElement.releasePointerCapture(e.pointerId);
        key.setPointerCapture(e.pointerId);

        inputManager.releaseNote(current.note);
        heldPointerNotes.delete(current.note);
        current.keyElement.classList.remove("active");

        const newNote = key.dataset.note;
        inputManager.pressNote(newNote);
        heldPointerNotes.add(newNote);
        key.classList.add("active");

        pointerDownMap.set(e.pointerId, { keyElement: key, note: newNote });
      }
    });

    keyboardElement.addEventListener("pointerup", (e) => {
      const current = pointerDownMap.get(e.pointerId);
      if (!current) return;

      inputManager.releaseNote(current.note);
      heldPointerNotes.delete(current.note);
      current.keyElement.classList.remove("active");
      pointerDownMap.delete(e.pointerId);
    });

    keyboardElement.addEventListener("pointercancel", (e) => {
      const current = pointerDownMap.get(e.pointerId);
      if (!current) return;

      inputManager.releaseNote(current.note);
      heldPointerNotes.delete(current.note);
      current.keyElement.classList.remove("active");
      pointerDownMap.delete(e.pointerId);
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
