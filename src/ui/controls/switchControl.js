export function createSwitchControl({ label, options, value, onChange, accent }) {
  const wrapper = document.createElement("div");
  wrapper.className = "control";

  const controlLabel = document.createElement("div");
  controlLabel.className = "control-label";
  const strong = document.createElement("strong");
  strong.textContent = label;
  controlLabel.append(strong);

  const buttonGroup = document.createElement("div");
  buttonGroup.className = "switch-button-group";
  buttonGroup.style.display = "flex";
  buttonGroup.style.gap = "4px";
  buttonGroup.style.width = "100%";

  const buttons = [];

  options.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pill-button";
    button.setAttribute("tabindex", "-1");
    button.style.setProperty("--accent", `var(--${accent})`);
    button.style.flex = "1";
    button.textContent = option.label;
    buttons.push({ button, option });

    button.addEventListener("click", (event) => {
      onChange(option.value);
      syncState(option.value);
      event.target.blur();
    });

    buttonGroup.append(button);
  });

  const syncState = (nextValue) => {
    buttons.forEach(({ button, option }) => {
      // Use strict equality for boolean values
      const isActive = option.value === nextValue;
      button.classList.toggle("is-on", isActive);
    });
  };

  syncState(value);

  wrapper.append(controlLabel, buttonGroup);
  return wrapper;
}
