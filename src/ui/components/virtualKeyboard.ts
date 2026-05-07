import { noteFromOffset } from "../../utils/helpers";
import type { InputManager } from "../../input/inputManager";

// ==================== 固定尺寸常量 ====================
const WHITE_KEY_WIDTH = 40;       // 白键固定宽度 (px)
const BLACK_KEY_WIDTH = 26;       // 黑键固定宽度 = 40 * 0.65
const OCTAVE_WIDTH = 320;         // 单八度总宽度 = 8 * 40
const F_SHARP_OFFSET = 160;       // F# 中心在八度内的 x 坐标 (F和G的边界)
const KEYBOARD_HEIGHT = 100;      // 键盘高度

// ==================== 一个八度内的琴键定义 ====================
interface KeyLayoutDef {
  type: "white" | "black";
  offset: number;       // 半音偏移 (0-12, 12是下一个八度的C)
  x: number;            // 相对于八度起始点的 left 坐标
}

// 白键从 0 开始，每隔 40px
// 黑键位于两个白键中间，left = 白键边界 - 黑键宽度/2
const OCTAVE_KEYS: KeyLayoutDef[] = [
  { type: "white", offset: 0,  x: 0 },    // C   [0, 40]
  { type: "black", offset: 1,  x: 27 },   // C#  [27, 53] 中心在 40 (C-D 边界)
  { type: "white", offset: 2,  x: 40 },   // D   [40, 80]
  { type: "black", offset: 3,  x: 67 },   // D#  [67, 93] 中心在 80 (D-E 边界)
  { type: "white", offset: 4,  x: 80 },   // E   [80, 120]
  { type: "white", offset: 5,  x: 120 },  // F   [120, 160]
  { type: "black", offset: 6,  x: 147 },  // F#  [147, 173] 中心在 160 (F-G 边界) ★ 锚点
  { type: "white", offset: 7,  x: 160 },  // G   [160, 200]
  { type: "black", offset: 8,  x: 187 },  // G#  [187, 213] 中心在 200 (G-A 边界)
  { type: "white", offset: 9,  x: 200 },  // A   [200, 240]
  { type: "black", offset: 10, x: 227 },  // A#  [227, 253] 中心在 240 (A-B 边界)
  { type: "white", offset: 11, x: 240 },  // B   [240, 280]
  { type: "white", offset: 12, x: 280 },  // C   [280, 320] (下一个八度)
];

// ==================== 指针状态 ====================
interface PointerDownInfo {
  keyElement: HTMLElement;
  note: string;
}

const pointerDownMap = new Map<number, PointerDownInfo>();

interface KeyboardState {
  global: {
    octave: number;
  };
}

interface RenderedKey {
  el: HTMLElement;
  type: "white" | "black";
  octave: number;
  offset: number;
}

// ==================== 渲染缓存 ====================
let renderedKeys: RenderedKey[] = [];
let isKeyboardBound = false;
let animationTargetOctave = 0;
let animationStartOctave = 0;
let animationStartTime = 0;
let animationFrameId = 0;
const ANIMATION_DURATION = 200; // ms

// ==================== 辅助函数 ====================

/** 计算当前八度的 F# 在卷轴上的绝对 x 坐标 */
function getFSharpX(octave: number): number {
  return octave * OCTAVE_WIDTH + F_SHARP_OFFSET;
}

/** 计算可见键列表 */
function calculateVisibleKeys(
  centerOctave: number,
  screenWidth: number
): Array<{ octave: number; def: KeyLayoutDef; screenX: number; note: string }> {
  const centerX = getFSharpX(centerOctave);
  const viewLeft = centerX - screenWidth / 2;
  const viewRight = centerX + screenWidth / 2;

  // 确定需要渲染的八度范围
  const startOctave = Math.floor(viewLeft / OCTAVE_WIDTH) - 1;
  const endOctave = Math.ceil(viewRight / OCTAVE_WIDTH) + 1;

  const visible: Array<{ octave: number; def: KeyLayoutDef; screenX: number; note: string }> = [];

  for (let oct = startOctave; oct <= endOctave; oct++) {
    for (const def of OCTAVE_KEYS) {
      const absoluteX = oct * OCTAVE_WIDTH + def.x;
      const keyWidth = def.type === "white" ? WHITE_KEY_WIDTH : BLACK_KEY_WIDTH;

      // 只要键的任何部分在视图内就渲染
      if (absoluteX + keyWidth > viewLeft && absoluteX < viewRight) {
        const screenX = absoluteX - viewLeft;
        const note = noteFromOffset(oct, def.offset);
        visible.push({ octave: oct, def, screenX, note });
      }
    }
  }

  return visible;
}

/** 缓动函数 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// ==================== 主渲染函数 ====================
export function renderKeyboard(
  keyboardElement: HTMLElement | null,
  state: KeyboardState,
  inputManager: InputManager,
  ensureAudioStartedFn: () => void,
  heldPointerNotes: Set<string>,
  onOctaveChange?: (octave: number) => void
): void {
  if (!keyboardElement) {
    return;
  }

  const containerWidth = keyboardElement.clientWidth;

  // 设置CSS变量
  keyboardElement.style.setProperty("--white-key-width", `${WHITE_KEY_WIDTH}px`);
  keyboardElement.style.setProperty("--black-key-width", `${BLACK_KEY_WIDTH}px`);

  // 首次渲染：创建所有琴键DOM元素
  if (!isKeyboardBound) {
    // 为可能的可见范围创建足够多的琴键元素（预留3个八度范围）
    const fragment = document.createDocumentFragment();
    const maxVisibleKeys = Math.ceil(containerWidth / WHITE_KEY_WIDTH) + 20;

    for (let i = 0; i < maxVisibleKeys; i++) {
      // 白键
      const whiteKey = document.createElement("div");
      whiteKey.className = "white-key";
      whiteKey.setAttribute("aria-hidden", "true");
      const whiteCap = document.createElement("div");
      whiteCap.className = "key-cap";
      whiteKey.append(whiteCap);
      fragment.append(whiteKey);

      // 黑键
      const blackKey = document.createElement("div");
      blackKey.className = "black-key";
      blackKey.setAttribute("aria-hidden", "true");
      const blackCap = document.createElement("div");
      blackCap.className = "key-cap";
      blackKey.append(blackCap);
      fragment.append(blackKey);
    }

    keyboardElement.append(fragment);

    // 事件委托
    keyboardElement.addEventListener("pointerdown", (e: PointerEvent) => {
      const key = (e.target as HTMLElement).closest(".white-key, .black-key");
      if (!key) return;

      const note = (key as HTMLElement).dataset.note;
      if (!note) return;

      (key as HTMLElement).setPointerCapture(e.pointerId);

      inputManager.pressNote(note);
      heldPointerNotes.add(note);
      (key as HTMLElement).classList.add("active");
      pointerDownMap.set(e.pointerId, { keyElement: key as HTMLElement, note });

      ensureAudioStartedFn();
    });

    keyboardElement.addEventListener("pointermove", (e: PointerEvent) => {
      const current = pointerDownMap.get(e.pointerId);
      if (!current) return;

      const key = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest(".white-key, .black-key");

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
        (key as HTMLElement).setPointerCapture(e.pointerId);

        inputManager.releaseNote(current.note);
        heldPointerNotes.delete(current.note);
        current.keyElement.classList.remove("active");

        const newNote = (key as HTMLElement).dataset.note;
        if (newNote) {
          inputManager.pressNote(newNote);
          heldPointerNotes.add(newNote);
          (key as HTMLElement).classList.add("active");
          pointerDownMap.set(e.pointerId, { keyElement: key as HTMLElement, note: newNote });
        }
      }
    });

    keyboardElement.addEventListener("pointerup", (e: PointerEvent) => {
      const current = pointerDownMap.get(e.pointerId);
      if (!current) return;

      inputManager.releaseNote(current.note);
      heldPointerNotes.delete(current.note);
      current.keyElement.classList.remove("active");
      pointerDownMap.delete(e.pointerId);
    });

    keyboardElement.addEventListener("pointercancel", (e: PointerEvent) => {
      const current = pointerDownMap.get(e.pointerId);
      if (!current) return;

      inputManager.releaseNote(current.note);
      heldPointerNotes.delete(current.note);
      current.keyElement.classList.remove("active");
      pointerDownMap.delete(e.pointerId);
    });

    isKeyboardBound = true;
  }

  // 更新琴键位置
  updateKeyPositions(keyboardElement, state, inputManager, containerWidth, state.global.octave);
}

/** 更新琴键位置（支持动画） */
function updateKeyPositions(
  keyboardElement: HTMLElement,
  state: KeyboardState,
  inputManager: InputManager,
  containerWidth: number,
  currentOctave: number,
  isAnimating = false
): void {
  const visibleKeys = calculateVisibleKeys(currentOctave, containerWidth);
  const children = keyboardElement.children;
  let whiteIndex = 0;
  let blackIndex = 0;

  // 收集白键和黑键元素
  const whiteKeys: HTMLElement[] = [];
  const blackKeys: HTMLElement[] = [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as HTMLElement;
    if (child.classList.contains("white-key")) {
      whiteKeys.push(child);
    } else if (child.classList.contains("black-key")) {
      blackKeys.push(child);
    }
  }

  // 重置所有键
  whiteKeys.forEach((el) => {
    el.style.display = "none";
    el.classList.remove("active");
  });
  blackKeys.forEach((el) => {
    el.style.display = "none";
    el.classList.remove("active");
  });

  // 收集需要渲染的键
  const whiteToRender: typeof visibleKeys = [];
  const blackToRender: typeof visibleKeys = [];

  for (const key of visibleKeys) {
    if (key.def.type === "white") {
      whiteToRender.push(key);
    } else {
      blackToRender.push(key);
    }
  }

  // 渲染白键
  for (let i = 0; i < whiteToRender.length && i < whiteKeys.length; i++) {
    const key = whiteToRender[i];
    const el = whiteKeys[i];
    el.style.display = "block";
    el.style.left = `${key.screenX}px`;
    el.dataset.note = key.note;
    el.dataset.key = getComputerKeyForOffset(key.def.offset);

    if (inputManager.heldComputerKeys.has(getComputerKeyForOffset(key.def.offset))) {
      el.classList.add("active");
    }
  }

  // 渲染黑键
  for (let i = 0; i < blackToRender.length && i < blackKeys.length; i++) {
    const key = blackToRender[i];
    const el = blackKeys[i];
    el.style.display = "block";
    el.style.left = `${key.screenX}px`;
    el.dataset.note = key.note;
    el.dataset.key = getComputerKeyForOffset(key.def.offset);

    if (inputManager.heldComputerKeys.has(getComputerKeyForOffset(key.def.offset))) {
      el.classList.add("active");
    }
  }
}

/** 获取半音偏移对应的电脑键盘键 */
function getComputerKeyForOffset(offset: number): string {
  const map: Record<number, string> = {
    0: "a",   // C
    1: "w",   // C#
    2: "s",   // D
    3: "e",   // D#
    4: "d",   // E
    5: "f",   // F
    6: "t",   // F#
    7: "g",   // G
    8: "y",   // G#
    9: "h",   // A
    10: "u",  // A#
    11: "j",  // B
    12: "k",  // C (下一个八度)
  };
  return map[offset] || "";
}

/** 开始八度切换动画 */
export function animateOctaveChange(
  keyboardElement: HTMLElement | null,
  state: KeyboardState,
  inputManager: InputManager,
  fromOctave: number,
  toOctave: number,
  ensureAudioStartedFn: () => void,
  heldPointerNotes: Set<string>,
  onComplete?: () => void
): void {
  if (!keyboardElement) return;

  // 取消之前的动画
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }

  animationStartOctave = fromOctave;
  animationTargetOctave = toOctave;
  animationStartTime = performance.now();

  const animate = (now: number) => {
    const elapsed = now - animationStartTime;
    const progress = Math.min(elapsed / ANIMATION_DURATION, 1);
    const eased = easeOutCubic(progress);

    // 插值当前八度
    const currentOctave = animationStartOctave + (animationTargetOctave - animationStartOctave) * eased;

    // 更新琴键位置
    const containerWidth = keyboardElement.clientWidth;
    updateKeyPositions(keyboardElement, state, inputManager, containerWidth, currentOctave, true);

    if (progress < 1) {
      animationFrameId = requestAnimationFrame(animate);
    } else {
      animationFrameId = 0;
      onComplete?.();
    }
  };

  animationFrameId = requestAnimationFrame(animate);
}

/** 暴露当前动画状态 */
export function isAnimating(): boolean {
  return animationFrameId !== 0;
}

/** 清理函数 */
export function resetKeyboardState(): void {
  isKeyboardBound = false;
  renderedKeys = [];
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }
}
