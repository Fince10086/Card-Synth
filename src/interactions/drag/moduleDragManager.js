import { EdgeScrollManager } from "../edgeScrollManager.js";

export class ModuleDragManager {
  constructor(app) {
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

  initModuleDrag(event, card, moduleIndex) {
    const modules = this.app.getCurrentModules();
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
      initialScrollX: window.scrollX,
      initialScrollY: window.scrollY,
    };

    card.addEventListener("pointermove", this.handleDragMove.bind(this));
    card.addEventListener("pointerup", this.handleDragEnd.bind(this));
    card.addEventListener("pointercancel", this.handleDragEnd.bind(this));
  }

  handleDragMove(event) {
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

    // 边缘滚动
    this.edgeScroll.update(event);

    const container = this.app.elements.signalFlow;

    // 补偿页面滚动偏移，保持卡片与指针相对静止
    const scrollDeltaX = window.scrollX - (this.dragState.initialScrollX || 0);
    const scrollDeltaY = window.scrollY - (this.dragState.initialScrollY || 0);

    card.classList.add("dragging");
    card.style.left = `${event.clientX - this.dragState.offsetX + scrollDeltaX}px`;
    card.style.top = `${event.clientY - this.dragState.offsetY + scrollDeltaY}px`;

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

    const moduleCards = [...container.querySelectorAll(".module-card:not(.dragging):not([data-main-card='true'])")];
    let targetCard = null;
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
        const modules = this.app.getCurrentModules();
        targetIndex = modules.findIndex((m) => m.id === moduleId);
        break;
      }
    }

    this.dragState.targetIndex = targetIndex;
    this.updateDragIndicator(targetCard, targetIndex);
  }

  updateDragIndicator(targetCard, targetIndex) {
    if (targetCard?.hasAttribute("data-main-card")) {
      this.removeDragIndicator();
      return;
    }

    if (!targetCard && targetIndex !== this.app.getCurrentModules().length) {
      this.removeDragIndicator();
      return;
    }

    if (!this.dragState.indicator) {
      this.dragState.indicator = document.createElement("div");
      this.dragState.indicator.className = "drag-indicator";
      this.app.elements.signalFlow.appendChild(this.dragState.indicator);
    }

    const container = this.app.elements.signalFlow;
    const containerRect = container.getBoundingClientRect();

    if (targetCard) {
      const targetRect = targetCard.getBoundingClientRect();
      this.dragState.indicator.style.left = `${targetRect.left - containerRect.left}px`;
      this.dragState.indicator.style.top = `${targetRect.top - containerRect.top}px`;
      this.dragState.indicator.style.height = `${targetRect.height}px`;
    } else {
      const lastCard = container.querySelector(".module-card:not(.dragging):last-of-type");
      if (lastCard) {
        const lastRect = lastCard.getBoundingClientRect();
        this.dragState.indicator.style.left = `${lastRect.right - containerRect.left}px`;
        this.dragState.indicator.style.top = `${lastRect.top - containerRect.top}px`;
        this.dragState.indicator.style.height = `${lastRect.height}px`;
      }
    }
  }

  removeDragIndicator() {
    if (this.dragState.indicator) {
      this.dragState.indicator.remove();
      this.dragState.indicator = null;
    }
  }

  handleDragEnd(event) {
    if (!this.dragState.dragCard) {
      return;
    }

    // 停止边缘滚动
    this.edgeScroll.stopScrolling();

    const card = this.dragState.dragCard;

    if (this.dragState.hasPointerCapture) {
      card.releasePointerCapture(event.pointerId);
    }

    card.removeEventListener("pointermove", this.handleDragMove.bind(this));
    card.removeEventListener("pointerup", this.handleDragEnd.bind(this));
    card.removeEventListener("pointercancel", this.handleDragEnd.bind(this));

    if (this.dragState.isDragStarted) {
      card.classList.remove("dragging");
      card.style.left = "";
      card.style.top = "";

      this.removeDragIndicator();

      const container = this.app.elements.signalFlow;
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
          this.app.layoutModuleMasonry();
        }
      } else {
        this.app.layoutModuleMasonry();
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
      initialScrollX: 0,
      initialScrollY: 0,
      placeholder: null,
    };
  }

  reorderModule(fromIndex, toIndex) {
    const modules = this.app.getCurrentModules();

    if (fromIndex < 0 || fromIndex >= modules.length || toIndex < 0 || toIndex >= modules.length) {
      return;
    }

    const [module] = modules.splice(fromIndex, 1);
    const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
    modules.splice(insertIndex, 0, module);

    this.app.markUnsaved();
    this.app.renderAll();
    this.app.engine.fullSync(this.app.state);
  }
}
