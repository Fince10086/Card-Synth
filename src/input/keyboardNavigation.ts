/**
 * KeyboardNavigationManager - manages card-level Tab navigation
 */

export class KeyboardNavigationManager {
  activeCard: HTMLElement | null;
  private _focusState: FocusState | null;
  private _nextFocusTarget: string | null;
  private _boundOnKeyDown: (event: KeyboardEvent) => void;
  private _boundOnFocusIn: (event: FocusEvent) => void;
  private _boundOnFocusOut: (event: FocusEvent) => void;

  constructor() {
    this.activeCard = null;
    this._focusState = null;
    this._nextFocusTarget = null;
    this._boundOnKeyDown = this._onKeyDown.bind(this);
    this._boundOnFocusIn = this._onFocusIn.bind(this);
    this._boundOnFocusOut = this._onFocusOut.bind(this);
  }

  bind(): void {
    document.addEventListener("keydown", this._boundOnKeyDown, true);
    document.addEventListener("focusin", this._boundOnFocusIn, true);
    document.addEventListener("focusout", this._boundOnFocusOut, true);
  }

  unbind(): void {
    document.removeEventListener("keydown", this._boundOnKeyDown, true);
    document.removeEventListener("focusin", this._boundOnFocusIn, true);
    document.removeEventListener("focusout", this._boundOnFocusOut, true);
  }

  private _isCardElement(el: HTMLElement | null): boolean {
    if (!el) return false;
    return (
      el.classList.contains("module-card") ||
      el.classList.contains("add-module-card")
    );
  }

  private _getCardElement(el: HTMLElement | null): HTMLElement | null {
    if (!el) return null;
    if (this._isCardElement(el)) return el;
    return el.closest(".module-card, .add-module-card") as HTMLElement | null;
  }

  private _getFocusableInside(card: HTMLElement): HTMLElement[] {
    if (!card) return [];
    return Array.from(
      card.querySelectorAll(
        'button:not([disabled]):not([tabindex="-1"]), ' +
          'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"]), ' +
          'select:not([disabled]):not([tabindex="-1"]), ' +
          'textarea:not([disabled]):not([tabindex="-1"]), ' +
          '[tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => (el as HTMLElement).closest(".module-card, .add-module-card") === card) as HTMLElement[];
  }

  private _setCardTabIndex(card: HTMLElement, tabIndex: number): void {
    if (!card) return;
    const inner = card.querySelectorAll(
      'button, input:not([type="hidden"]), select, textarea'
    );
    inner.forEach((el) => {
      if (this._isCardElement(el as HTMLElement)) return;
      (el as HTMLElement).setAttribute("tabindex", String(tabIndex));
    });
  }

  activateCard(card: HTMLElement): void {
    if (!card) return;
    if (this.activeCard && this.activeCard !== card) {
      this._setCardTabIndex(this.activeCard, -1);
      this.activeCard.classList.remove("is-keyboard-active");
    }
    this.activeCard = card;
    this.activeCard.classList.add("is-keyboard-active");
    this._setCardTabIndex(card, 0);
  }

  deactivateCard(): void {
    if (!this.activeCard) return;
    this._setCardTabIndex(this.activeCard, -1);
    this.activeCard.classList.remove("is-keyboard-active");
    this.activeCard = null;
  }

  setNextFocusTarget(cardRef: string): void {
    this._nextFocusTarget = cardRef;
  }

  saveFocusState(): void {
    const active = document.activeElement as HTMLElement | null;
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

    const cardRef =
      card.dataset.moduleRef || card.dataset.mainCard || card.id || "";

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

  restoreFocusState(container: HTMLElement | null): void {
    const nextTarget = this._nextFocusTarget;
    this._nextFocusTarget = null;

    requestAnimationFrame(() => {
      if (!container) return;

      if (nextTarget) {
        let targetCard: HTMLElement | null = null;
        if (nextTarget === "true") {
          targetCard = container.querySelector('.module-card[data-main-card="true"]') as HTMLElement | null;
        } else if (nextTarget === "addModuleCard") {
          targetCard = container.querySelector("#addModuleCard") as HTMLElement | null;
        } else {
          targetCard = container.querySelector(
            `.module-card[data-module-ref="${nextTarget}"]`
          ) as HTMLElement | null;
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

      let card: HTMLElement | null = null;
      if (cardRef === "true") {
        card = container.querySelector('.module-card[data-main-card="true"]') as HTMLElement | null;
      } else if (cardRef === "addModuleCard") {
        card = container.querySelector("#addModuleCard") as HTMLElement | null;
      } else if (cardRef) {
        card = container.querySelector(
          `.module-card[data-module-ref="${cardRef}"]`
        ) as HTMLElement | null;
      }
      if (!card) return;

      if (isActive) {
        this.activateCard(card);
      }

      if (isCardItself) {
        card.focus({ preventScroll: true });
      } else if (innerSelector) {
        const inner = card.querySelector(innerSelector) as HTMLElement | null;
        if (inner) {
          inner.focus({ preventScroll: true });
        } else {
          card.focus({ preventScroll: true });
        }
      }
    });
  }

  private _onFocusIn(event: FocusEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (!this.activeCard) return;

    const card = this._getCardElement(target);
    if (card !== this.activeCard) {
      this.deactivateCard();
    }
  }

  private _onFocusOut(_event: FocusEvent): void {
    // Logic handled in focusin
  }

  private _onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const card = this._getCardElement(target);

    if (event.key === "Escape") {
      if (this.activeCard) {
        event.preventDefault();
        this.deactivateCard();
        this.activeCard?.focus({ preventScroll: true });
      }
      return;
    }

    if (event.key === "Enter") {
      if (card && target === card) {
        event.preventDefault();
        this.activateCard(card);
        const inside = this._getFocusableInside(card);
        if (inside.length) {
          inside[0].focus({ preventScroll: true });
        }
        return;
      }
      return;
    }
  }
}

interface FocusState {
  cardRef: string;
  isActive: boolean;
  isCardItself: boolean;
  innerSelector: string;
  activeElementTag: string;
}
