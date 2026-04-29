/**
 * Switch control component
 */

export interface SwitchOption {
  label: string;
  value: string | number | boolean;
}

export interface SwitchControlOptions {
  label: string;
  options: SwitchOption[];
  value: string | number | boolean;
  onChange: (value: string | number | boolean) => void;
  accent: string;
}

export function createSwitchControl({
  label,
  options,
  value,
  onChange,
  accent,
}: SwitchControlOptions): HTMLElement {
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

  const buttons: Array<{ button: HTMLButtonElement; option: SwitchOption }> = [];

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
      (event.target as HTMLElement).blur();
    });

    buttonGroup.append(button);
  });

  const syncState = (nextValue: string | number | boolean) => {
    buttons.forEach(({ button, option }) => {
      const isActive = option.value === nextValue;
      button.classList.toggle("is-on", isActive);
    });
  };

  syncState(value);

  wrapper.append(controlLabel, buttonGroup);
  return wrapper;
}
