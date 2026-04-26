export function createTitleSelect({ accent, title, value, options, onChange }) {
  const wrap = document.createElement("label");
  wrap.className = "module-title-select";

  const select = document.createElement("select");
  select.className = "module-title-input";
  select.setAttribute("tabindex", "-1");
  options.forEach((option) => {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    select.append(element);
  });
  select.value = value;
  select.setAttribute("aria-label", title);
  select.addEventListener("change", (event) => onChange(event.target.value));
  wrap.append(select);
  return wrap;
}

export function createModuleCard({
  accent,
  kicker,
  title,
  titleOptions = null,
  onTitleChange = null,
  onRemove = null,
  removable = false,
  moduleRef = null,
  enabled = true,
  onToggleEnabled = null,
  index = null,
  modulationEnabled = false,
  showModulationToggle = false,
  onToggleModulation = null,
  showModulationAnchor = false,
  onModulationAnchorPointerDown = null,
  isMainCard = false,
  initModuleDrag = null,
  showOutputLevel = false,
}) {
  if (isMainCard) {
    accent = "indigo";
    title = "Main";
    removable = false;
    index = null;
    onRemove = null;
  }

  const card = document.createElement("section");
  card.className = "module-card";
  card.setAttribute("tabindex", "0");
  card.setAttribute("role", "region");
  card.setAttribute("aria-label", isMainCard ? "Main controls" : `${title} module`);
  if (!enabled) {
    card.classList.add("disabled");
  }
  card.dataset.accent = accent;
  if (isMainCard) {
    card.dataset.mainCard = "true";
  }
  if (moduleRef) {
    card.dataset.moduleRef = moduleRef;
    card.dataset.moduleId = moduleRef;
  }
  if (modulationEnabled) {
    card.classList.add("module-card--modulation");
  }

  const head = document.createElement("div");
  head.className = "module-head";

  if (index !== null && !isMainCard) {
    const indexBadge = document.createElement("span");
    indexBadge.className = "module-index";
    indexBadge.textContent = `${index}`;
    if (onToggleEnabled) {
      indexBadge.addEventListener("click", onToggleEnabled);
    }
    indexBadge.addEventListener("pointerdown", (e) => {
      if (initModuleDrag) {
        initModuleDrag(e, card, index - 1);
      }
    });
    head.append(indexBadge);
  }

  if ((titleOptions && onTitleChange) && !isMainCard) {
    head.append(createTitleSelect({ accent, title, options: titleOptions, value: title, onChange: onTitleChange }));
  } else {
    const titleWrap = document.createElement("div");
    titleWrap.className = isMainCard ? "module-title" : "";
    const titleNode = document.createElement(isMainCard ? "span" : "h3");
    titleNode.className = isMainCard ? "module-title-input" : "";
    titleNode.textContent = title;
    titleWrap.append(titleNode);
    head.append(titleWrap);
  }

  if (removable && onRemove && !isMainCard) {
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "module-remove";
    removeButton.textContent = "×";
    removeButton.setAttribute("tabindex", "-1");
    removeButton.addEventListener("click", onRemove);
    head.append(removeButton);
  }

  // Debug: 输出电平显示（仅 Source 模块）
  let outputLevelDisplay = null;
  if (showOutputLevel) {
    outputLevelDisplay = document.createElement("span");
    outputLevelDisplay.className = "module-output-level";
    outputLevelDisplay.textContent = "-∞";
    head.append(outputLevelDisplay);
  }

  card.append(head);

  if (showModulationToggle) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = `module-mod-toggle ${modulationEnabled ? "is-on" : ""}`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("viewBox", "0 0 24 24");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "/icons.svg#mod-toggle");
    svg.appendChild(use);
    toggle.appendChild(svg);
    toggle.setAttribute("tabindex", "-1");
    if (onToggleModulation) {
      toggle.addEventListener("click", onToggleModulation);
    }
    card.append(toggle);
  }

  if (showModulationAnchor && moduleRef) {
    const anchor = document.createElement("button");
    anchor.type = "button";
    anchor.className = "module-mod-anchor";
    anchor.setAttribute("tabindex", "-1");
    anchor.dataset.moduleId = moduleRef;
    anchor.addEventListener("pointerdown", (event) => {
      if (onModulationAnchorPointerDown) {
        onModulationAnchorPointerDown(event);
      }
    });
    card.append(anchor);
  }

  // Attach output level display reference to card for external updates
  if (outputLevelDisplay) {
    card.outputLevelDisplay = outputLevelDisplay;
  }

  return card;
}
