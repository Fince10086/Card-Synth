/**
 * Toggle control component
 */

export interface ToggleControlOptions {
  label: string;
  value: boolean;
  onToggle: (value: boolean) => void;
  accent: string;
  onLabel?: string;
  offLabel?: string;
}

export function createToggleControl({
  label,
  value,
  onToggle,
  accent,
  onLabel = "On",
  offLabel = "Off",
}: ToggleControlOptions): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "control";

  const controlLabel = document.createElement("div");
  controlLabel.className = "control-label";
  const strong = document.createElement("strong");
  strong.textContent = label;
  controlLabel.append(strong);

  const button = document.createElement("button");
  button.type = "button";
  button.className = `pill-button ${value ? "is-on" : ""}`;
  button.setAttribute("tabindex", "-1");
  button.style.setProperty("--accent", `var(--${accent})`);

  const syncState = (nextValue: boolean) => {
    button.classList.toggle("is-on", nextValue);
    button.textContent = nextValue ? onLabel : offLabel;
  };

  syncState(Boolean(value));
  button.addEventListener("click", (event) => {
    const nextValue = !button.classList.contains("is-on");
    syncState(nextValue);
    onToggle(nextValue);
    (event.target as HTMLElement).blur();
  });

  wrapper.append(controlLabel, button);
  return wrapper;
}
