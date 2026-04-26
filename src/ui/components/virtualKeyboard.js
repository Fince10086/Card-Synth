import { noteFromOffset } from "../../utils/helpers.js";

// 统一的键盘布局定义：按钮和琴键一体化
// 布局比例：按钮占 1 份，白键占 3 份，黑键不占宽度（叠加）
// 总份数 = 1 + 8*3 + 1 = 26
const KEYBOARD_DEF = [
  { type: "octave", delta: -1, label: "<" },
  { type: "white", key: "a", offset: 0, whiteIndex: 0 },
  { type: "black", key: "w", offset: 1, whiteIndex: 0 },
  { type: "white", key: "s", offset: 2, whiteIndex: 1 },
  { type: "black", key: "e", offset: 3, whiteIndex: 1 },
  { type: "white", key: "d", offset: 4, whiteIndex: 2 },
  { type: "white", key: "f", offset: 5, whiteIndex: 3 },
  { type: "black", key: "t", offset: 6, whiteIndex: 3 },
  { type: "white", key: "g", offset: 7, whiteIndex: 4 },
  { type: "black", key: "y", offset: 8, whiteIndex: 4 },
  { type: "white", key: "h", offset: 9, whiteIndex: 5 },
  { type: "black", key: "u", offset: 10, whiteIndex: 5 },
  { type: "white", key: "j", offset: 11, whiteIndex: 6 },
  { type: "white", key: "k", offset: 12, whiteIndex: 7 },
  { type: "octave", delta: 1, label: ">" },
];

const pointerDownMap = new Map();

export function renderKeyboard(
  keyboardElement,
  state,
  inputManager,
  ensureAudioStartedFn,
  heldPointerNotes,
  onOctaveChange
) {
  if (!keyboardElement) {
    return;
  }

  const containerWidth = keyboardElement.clientWidth;
  const totalUnits = 26; // 1 + 8*3 + 1
  const unitWidth = containerWidth / totalUnits;
  const octaveBtnWidth = unitWidth;
  const whiteKeyWidth = unitWidth * 3;
  const blackKeyWidth = whiteKeyWidth * 0.65;

  keyboardElement.style.setProperty("--white-key-width", `${whiteKeyWidth}px`);
  keyboardElement.style.setProperty("--black-key-width", `${blackKeyWidth}px`);
  keyboardElement.style.setProperty("--octave-btn-width", `${octaveBtnWidth}px`);

  const isFirstRender = !keyboardElement.dataset.keyboardBound;

  if (isFirstRender) {
    const fragment = document.createDocumentFragment();

    // 统一创建所有元素
    KEYBOARD_DEF.forEach((def) => {
      const el = document.createElement("div");
      el.setAttribute("aria-hidden", "true");

      if (def.type === "octave") {
        el.className = "octave-btn";
        el.textContent = def.label;
        el.dataset.octave = String(def.delta);
        el.dataset.key = def.delta === -1 ? "z" : "x";
      } else {
        el.className = def.type === "black" ? "black-key" : "white-key";
        el.dataset.key = def.key;
        const cap = document.createElement("div");
        cap.className = "key-cap";
        el.append(cap);
      }

      fragment.append(el);
    });

    keyboardElement.append(fragment);

    // 事件委托 + setPointerCapture，支持滑动切换
    keyboardElement.addEventListener("pointerdown", (e) => {
      const octaveBtn = e.target.closest("[data-octave]");
      if (octaveBtn) {
        e.preventDefault();
        const delta = parseInt(octaveBtn.dataset.octave, 10);
        const newOctave = Math.max(1, Math.min(7, state.global.octave + delta));
        onOctaveChange?.(newOctave);
        return;
      }

      const key = e.target.closest("[data-key]");
      if (!key) return;

      key.setPointerCapture(e.pointerId);

      const note = key.dataset.note;
      inputManager.pressNote(note);
      heldPointerNotes.add(note);
      key.classList.add("active");
      pointerDownMap.set(e.pointerId, { keyElement: key, note });

      ensureAudioStartedFn();
    });

    keyboardElement.addEventListener("pointermove", (e) => {
      const current = pointerDownMap.get(e.pointerId);
      if (!current) return;

      const key = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest("[data-key]");

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

  // 统一计算所有元素的位置和属性
  let currentLeft = 0;

  KEYBOARD_DEF.forEach((def, index) => {
    const el = keyboardElement.children[index];
    if (!el) return;

    if (def.type === "octave") {
      el.style.left = `${currentLeft}px`;
      currentLeft += octaveBtnWidth;
    } else if (def.type === "white") {
      el.style.left = `${currentLeft}px`;
      currentLeft += whiteKeyWidth;

      // 更新 note 和 active 状态
      const note = noteFromOffset(state.global.octave, def.offset);
      el.dataset.note = note;

      if (inputManager.heldComputerKeys.has(def.key)) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    } else if (def.type === "black") {
      // 黑键叠在当前 whiteKey 的起始位置之前的一半
      el.style.left = `${currentLeft - blackKeyWidth / 2}px`;

      // 更新 note 和 active 状态
      const note = noteFromOffset(state.global.octave, def.offset);
      el.dataset.note = note;

      if (inputManager.heldComputerKeys.has(def.key)) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    }
  });
}
