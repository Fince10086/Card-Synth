/** KeyboardNavigationManager — 管理卡片级 Tab 导航
 *
 * 行为：
 * - 卡片级元素（.module-card, .add-module-card）默认可 Tab 聚焦。
 * - 卡片内部所有可聚焦控件（button / input / select / textarea）默认 tabindex="-1"，
 *   避免 Tab 直接跳进卡片内部。
 * - 聚焦到某个卡片后按 Enter，将该卡片标记为“激活”，内部控件恢复 tabindex="0"，
 *   此时 Tab 会在该卡片内部循环（焦点陷阱）。
 * - 按 Escape 或再次按 Enter（或 Tab 到卡片外部）退出激活状态，
 *   内部控件重新设为 tabindex="-1"，焦点回到卡片本身。
 * - 渲染重建（renderAll）前可调用 saveFocusState() 保存当前聚焦卡片标识，
 *   重建后调用 restoreFocusState() 自动恢复。
 */
export class KeyboardNavigationManager {
  constructor() {
    this.activeCard = null;
    this._focusState = null;
    this._nextFocusTarget = null;
    this._boundOnKeyDown = this._onKeyDown.bind(this);
    this._boundOnFocusIn = this._onFocusIn.bind(this);
    this._boundOnFocusOut = this._onFocusOut.bind(this);
  }

  bind() {
    document.addEventListener("keydown", this._boundOnKeyDown, true);
    document.addEventListener("focusin", this._boundOnFocusIn, true);
    document.addEventListener("focusout", this._boundOnFocusOut, true);
  }

  unbind() {
    document.removeEventListener("keydown", this._boundOnKeyDown, true);
    document.removeEventListener("focusin", this._boundOnFocusIn, true);
    document.removeEventListener("focusout", this._boundOnFocusOut, true);
  }

  /** 判断元素是否为“卡片级”可聚焦元素 */
  _isCardElement(el) {
    if (!el) return false;
    return (
      el.classList.contains("module-card") ||
      el.classList.contains("add-module-card")
    );
  }

  /** 获取元素所在的卡片（或自身） */
  _getCardElement(el) {
    if (!el) return null;
    if (this._isCardElement(el)) return el;
    return el.closest(".module-card, .add-module-card");
  }

  /** 收集某卡片内部所有可聚焦元素 */
  _getFocusableInside(card) {
    if (!card) return [];
    return Array.from(
      card.querySelectorAll(
        'button:not([disabled]):not([tabindex="-1"]), ' +
          'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), ' +
          'select:not([disabled]):not([tabindex="-1"]), ' +
          'textarea:not([disabled]):not([tabindex="-1"]), ' +
          '[tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => el.closest(".module-card, .add-module-card") === card);
  }

  /** 设置某卡片内部所有天然可聚焦元素的 tabindex */
  _setCardTabIndex(card, tabIndex) {
    if (!card) return;
    const inner = card.querySelectorAll(
      'button, input:not([type="hidden"]), select, textarea'
    );
    inner.forEach((el) => {
      // 跳过卡片本身（如果卡片内部有 role 或 tabindex 的嵌套元素）
      if (this._isCardElement(el)) return;
      el.setAttribute("tabindex", String(tabIndex));
    });
  }

  /** 激活卡片：内部控件可 Tab */
  activateCard(card) {
    if (!card) return;
    // 先取消上一个激活
    if (this.activeCard && this.activeCard !== card) {
      this._setCardTabIndex(this.activeCard, -1);
      this.activeCard.classList.remove("is-keyboard-active");
    }
    this.activeCard = card;
    this.activeCard.classList.add("is-keyboard-active");
    this._setCardTabIndex(card, 0);
  }

  /** 取消激活：内部控件不可 Tab */
  deactivateCard() {
    if (!this.activeCard) return;
    this._setCardTabIndex(this.activeCard, -1);
    this.activeCard.classList.remove("is-keyboard-active");
    this.activeCard = null;
  }

  /** 设置重建后的优先聚焦目标（如删除模块后聚焦到前一个卡片） */
  setNextFocusTarget(cardRef) {
    this._nextFocusTarget = cardRef;
  }

  /** 保存当前聚焦状态（供 renderAll 重建前调用） */
  saveFocusState() {
    const active = document.activeElement;
    if (!active) {
      this._focusState = null;
      return;
    }

    const card = this._getCardElement(active);
    if (!card) {
      this._focusState = null;
      return;
    }

    const isCardItself = active === card;
    const isActive = card === this.activeCard;

    // 用 moduleRef / data-main-card 作为卡片唯一标识
    const cardRef =
      card.dataset.moduleRef || card.dataset.mainCard || card.id || "";

    // 如果焦点在卡片内部某个控件上，记录其选择器路径
    let innerSelector = "";
    if (!isCardItself) {
      const tag = active.tagName.toLowerCase();
      const id = active.id;
      const cls = active.className
        .split(" ")
        .filter((c) => c)
        .join(".");
      const type = active.getAttribute("type");
      const ariaLabel = active.getAttribute("aria-label");

      let selector = tag;
      if (id) selector += `#${id}`;
      if (cls) selector += `.${cls}`;
      if (type) selector += `[type="${type}"]`;
      if (ariaLabel) selector += `[aria-label="${ariaLabel}"]`;
      innerSelector = selector;
    }

    this._focusState = {
      cardRef,
      isActive,
      isCardItself,
      innerSelector,
      activeElementTag: active.tagName,
    };
  }

  /** 重建后恢复焦点 */
  restoreFocusState(container) {
    // 如果有预设的下一个聚焦目标（如删除后），优先使用
    const nextTarget = this._nextFocusTarget;
    this._nextFocusTarget = null;

    // 延时恢复，确保 DOM 已插入并 layout
    requestAnimationFrame(() => {
      if (!container) return;

      // 优先处理 _nextFocusTarget
      if (nextTarget) {
        let targetCard = null;
        if (nextTarget === "true") {
          targetCard = container.querySelector('.module-card[data-main-card="true"]');
        } else if (nextTarget === "addModuleCard") {
          targetCard = container.querySelector("#addModuleCard");
        } else {
          targetCard = container.querySelector(
            `.module-card[data-module-ref="${nextTarget}"]`
          );
        }
        if (targetCard) {
          this.deactivateCard();
          targetCard.focus({ preventScroll: true });
          return;
        }
      }

      if (!this._focusState) return;
      const { cardRef, isActive, isCardItself, innerSelector } = this._focusState;
      this._focusState = null;

      let card = null;
      if (cardRef === "true") {
        card = container.querySelector('.module-card[data-main-card="true"]');
      } else if (cardRef === "addModuleCard") {
        card = container.querySelector("#addModuleCard");
      } else if (cardRef) {
        card = container.querySelector(
          `.module-card[data-module-ref="${cardRef}"]`
        );
      }
      if (!card) return;

      if (isActive) {
        this.activateCard(card);
      }

      if (isCardItself) {
        card.focus({ preventScroll: true });
      } else if (innerSelector) {
        const inner = card.querySelector(innerSelector);
        if (inner) {
          inner.focus({ preventScroll: true });
        } else {
          // 找不到内部元素，回退到聚焦卡片
          card.focus({ preventScroll: true });
        }
      }
    });
  }

  /** 监听 focusin：如果 Tab 跳出激活卡片，自动退出激活状态 */
  _onFocusIn(event) {
    const target = event.target;
    if (!target) return;
    if (!this.activeCard) return;

    const card = this._getCardElement(target);
    if (card !== this.activeCard) {
      // 焦点离开了当前激活卡片，取消激活
      this.deactivateCard();
    }
  }

  /** focusout 不需要做太多，主要是 focusin 判断 */
  _onFocusOut(event) {
    // 留空，逻辑在 focusin 处理即可
  }

  /** 键盘事件处理 */
  _onKeyDown(event) {
    const target = event.target;
    if (!target) return;

    const card = this._getCardElement(target);

    // Escape：如果当前有激活卡片，退出激活并焦点回到卡片
    if (event.key === "Escape") {
      if (this.activeCard) {
        event.preventDefault();
        this.deactivateCard();
        this.activeCard?.focus({ preventScroll: true });
      }
      return;
    }

    // Enter：聚焦在卡片本身时激活它；聚焦在卡片内部时把焦点送回卡片
    if (event.key === "Enter") {
      if (card && target === card) {
        // 在卡片上按 Enter，激活卡片并把焦点移到第一个内部控件
        event.preventDefault();
        this.activateCard(card);
        const inside = this._getFocusableInside(card);
        if (inside.length) {
          inside[0].focus({ preventScroll: true });
        }
        return;
      }
      // 如果焦点在卡片内部的某个控件上按 Enter，不处理（让控件自己的行为生效）
      return;
    }
  }
}
