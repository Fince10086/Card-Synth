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
  }

  initModuleDrag(event, card, moduleIndex) {
    const modules = this.app.state.modules || [];
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

    const container = this.app.elements.signalFlow;

    card.classList.add("dragging");
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
        targetIndex = i;
        break;
      }
    }

    if (targetIndex >= 0) {
      targetIndex += 1;
    }
    if (targetIndex === 0) {
      targetIndex = 1;
    }

    this.dragState.targetIndex = targetIndex;
    this.updateDragIndicator(targetCard, targetIndex);
  }

  updateDragIndicator(targetCard, targetIndex) {
    if (targetCard?.hasAttribute("data-main-card")) {
      this.removeDragIndicator();
      return;
    }

    if (!targetCard && targetIndex !== this.app.state.modules.length) {
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
        let toIndex = this.dragState.targetIndex;

        if (toIndex === 0) {
          toIndex = 1;
        }

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
      placeholder: null,
    };
  }

  reorderModule(fromIndex, toIndex) {
    const modules = this.app.state.modules;

    if (fromIndex < 0 || fromIndex >= modules.length || toIndex < 0 || toIndex >= modules.length) {
      return;
    }

    const [module] = modules.splice(fromIndex, 1);
    modules.splice(toIndex, 0, module);

    this.app.selectedPresetId = "custom";
    this.app.renderAll();
    this.app.engine.fullSync(this.app.state);
  }
}
