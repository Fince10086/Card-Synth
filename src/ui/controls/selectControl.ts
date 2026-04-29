/**
 * Select control component
 */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectControlOptions {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}

export function createSelectControl({ label, options, value, onChange }: SelectControlOptions): HTMLElement {
  const wrapper = document.createElement("label");
  wrapper.className = "control";

  const controlLabel = document.createElement("div");
  controlLabel.className = "control-label";
  const strong = document.createElement("strong");
  strong.textContent = label;
  controlLabel.append(strong);

  const select = document.createElement("select");
  select.className = "select-input";
  select.setAttribute("tabindex", "-1");
  options.forEach((option) => {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    if (option.disabled) {
      element.disabled = true;
    }
    select.append(element);
  });
  select.value = value;
  select.addEventListener("change", (event) => {
    onChange((event.target as HTMLSelectElement).value);
    select.blur();
  });

  wrapper.append(controlLabel, select);
  return wrapper;
}
