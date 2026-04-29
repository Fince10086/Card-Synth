/**
 * Module drag manager - handles module reordering via drag and drop
 */

import { EdgeScrollManager } from "../edgeScrollManager";

export interface DragState {
  isDragging: boolean;
  isDragStarted: boolean;
  hasPointerCapture: boolean;
  dragCard: HTMLElement | null;
  dragIndex: number;
  pointerId: number;
  indicator: HTMLElement | null;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  originalRect: DOMRect | null;
  targetIndex: number;
}

export class ModuleDragManager {
  app: Record<string, unknown>;
  dragState: DragState;
  edgeScroll: EdgeScrollManager;

  constructor(app: Record<string, unknown>) {
    this.app = app;
    this.dragState = {
      isDragging: false,
      isDragStarted: false,
      hasPointerCapture: false,
      dragCard: null,
      dragIndex: -1,
      pointerId: 0,
      indicator: null,
      startX: 0,
      startY: 0,
      offsetX: 0,
      offsetY: 0,
      originalRect: null,
      targetIndex: -1,
    };
    this.edgeScroll = new EdgeScrollManager();
  }

  initModuleDrag(event: PointerEvent, card: HTMLElement, moduleIndex: number): void {
    const modules = (this.app.getCurrentModules as () => unknown[])?.() || [];
    if (modules.length <= 1) {
      return;
    }

    const rect = card.getBoundingClientRect();
    this.dragState = {
      isDragging: false,
      isDragStarted: false,
      hasPointerCapture: false,
      dragCard: card,
      dragIndex: moduleIndex,
      pointerId: event.pointerId,
      indicator: null,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      originalRect: rect,
      targetIndex: -1,
    };

    card.addEventListener("pointermove", this.handleDragMove.bind(this));
    card.addEventListener("pointerup", this.handleDragEnd.bind(this));
    card.addEventListener("pointercancel", this.handleDragEnd.bind(this));
  }

  handleDragMove(event: PointerEvent): void {
    if (!this.dragState.dragCard) {
      return;
    }

    const card = this.dragState.dragCard;

    const dx = event.clientX - this.dragState.startX;
    const dy = event.clientY - this.dragState.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (!this.dragState.isDragStarted) {
      if (distance < 5) {
        return;
      }
      this.dragState.isDragStarted = true;
      this.dragState.isDragging = true;
      card.setPointerCapture(this.dragState.pointerId);
      this.dragState.hasPointerCapture = true;
    }

    this.edgeScroll.update(event);

    const elements = this.app.elements as Record<string, HTMLElement>;
    const container = elements.signalFlow;

    card.classList.add("dragging");
    card.style.position = "fixed";
    card.style.left = `${event.clientX - this.dragState.offsetX}px`;
    card.style.top = `${event.clientY - this.dragState.offsetY}px`;

    const containerRect = container.getBoundingClientRect();
    const isOutsideContainer =
      event.clientX < containerRect.left ||
      event.clientX > containerRect.right ||
      event.clientY < containerRect.top ||
      event.clientY > containerRect.bottom;

    if (isOutsideContainer) {
      this.removeDragIndicator();
      this.dragState.targetIndex = -1;
      return;
    }

    const moduleCards = [...container.querySelectorAll(".module-card:not(.dragging):not([data-main-card='true'])")] as HTMLElement[];
    let targetCard: HTMLElement | null = null;
    let targetIndex = -1;

    for (let i = 0; i < moduleCards.length; i++) {
      const card = moduleCards[i];

      if (card.hasAttribute("data-main-card")) {
        continue;
      }

      const rect = card.getBoundingClientRect();
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        targetCard = card;
        const moduleId = card.dataset.moduleId;
        const modules = (this.app.getCurrentModules as () => Array<{ id: string }>)?.() || [];
        targetIndex = modules.findIndex((m) => m.id === moduleId);
        break;
      }
    }

    this.dragState.targetIndex = targetIndex;
    this.updateDragIndicator(targetCard, targetIndex);
  }

  updateDragIndicator(targetCard: HTMLElement | null, targetIndex: number): void {
    if (targetCard?.hasAttribute("data-main-card")) {
      this.removeDragIndicator();
      return;
    }

    const modules = (this.app.getCurrentModules as () => unknown[])?.() || [];
    if (!targetCard && targetIndex !== modules.length) {
      this.removeDragIndicator();
      return;
    }

    if (!this.dragState.indicator) {
      this.dragState.indicator = document.createElement("div");
      this.dragState.indicator.className = "drag-indicator";
      const elements = this.app.elements as Record<string, HTMLElement>;
      elements.signalFlow.appendChild(this.dragState.indicator);
    }

    const elements = this.app.elements as Record<string, HTMLElement>;
    const container = elements.signalFlow;
    const containerRect = container.getBoundingClientRect();

    if (targetCard) {
      const targetRect = targetCard.getBoundingClientRect();
      this.dragState.indicator.style.left = `${targetRect.left - containerRect.left}px`;
      this.dragState.indicator.style.top = `${targetRect.top - containerRect.top}px`;
      this.dragState.indicator.style.height = `${targetRect.height}px`;
    } else {
      const lastCard = container.querySelector(".module-card:not(.dragging):last-of-type") as HTMLElement | null;
      if (lastCard) {
        const lastRect = lastCard.getBoundingClientRect();
        this.dragState.indicator.style.left = `${lastRect.right - containerRect.left}px`;
        this.dragState.indicator.style.top = `${lastRect.top - containerRect.top}px`;
        this.dragState.indicator.style.height = `${lastRect.height}px`;
      }
    }
  }

  removeDragIndicator(): void {
    if (this.dragState.indicator) {
      this.dragState.indicator.remove();
      this.dragState.indicator = null;
    }
  }

  handleDragEnd(event: PointerEvent): void {
    if (!this.dragState.dragCard) {
      return;
    }

    this.edgeScroll.stopScrolling();

    const card = this.dragState.dragCard;

    if (this.dragState.hasPointerCapture) {
      card.releasePointerCapture(event.pointerId);
    }

    card.removeEventListener("pointermove", this.handleDragMove.bind(this));
    card.removeEventListener("pointerup", this.handleDragEnd.bind(this));
    card.removeEventListener("pointercancel", this.handleDragEnd.bind(this));

    if (this.dragState.isDragStarted) {
      card.style.position = "";
      card.classList.remove("dragging");
      card.style.left = "";
      card.style.top = "";

      this.removeDragIndicator();

      const elements = this.app.elements as Record<string, HTMLElement>;
      const container = elements.signalFlow;
      const containerRect = container.getBoundingClientRect();
      const isOutsideContainer =
        event.clientX < containerRect.left ||
        event.clientX > containerRect.right ||
        event.clientY < containerRect.top ||
        event.clientY > containerRect.bottom;

      if (!isOutsideContainer && this.dragState.targetIndex >= 0) {
        const toIndex = this.dragState.targetIndex;

        if (toIndex !== this.dragState.dragIndex) {
          this.reorderModule(this.dragState.dragIndex, toIndex);
        } else {
          (this.app.layoutModuleMasonry as () => void)?.();
        }
      } else {
        (this.app.layoutModuleMasonry as () => void)?.();
      }
    }

    this.dragState = {
      isDragging: false,
      isDragStarted: false,
      hasPointerCapture: false,
      dragCard: null,
      dragIndex: -1,
      pointerId: 0,
      indicator: null,
      startX: 0,
      startY: 0,
      offsetX: 0,
      offsetY: 0,
      originalRect: null,
      targetIndex: -1,
    };
  }

  reorderModule(fromIndex: number, toIndex: number): void {
    const modules = (this.app.getCurrentModules as () => Array<unknown>)?.() || [];

    if (fromIndex < 0 || fromIndex >= modules.length || toIndex < 0 || toIndex >= modules.length) {
      return;
    }

    const [module] = modules.splice(fromIndex, 1);
    const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    modules.splice(insertIndex, 0, module);

    (this.app.markUnsaved as () => void)?.();
    (this.app.renderAll as () => void)?.();
    (this.app.engine as unknown as Record<string, (...args: unknown[]) => unknown>)?.fullSync?.(this.app.state);
  }
}
