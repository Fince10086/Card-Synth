/**
 * Audio import control component
 */

export interface AudioImportControlOptions {
  label: string;
  value?: string;
  onSelect: (file: File) => Promise<void>;
  onError?: (message: string) => void;
}

export function createAudioImportControl({
  label,
  value,
  onSelect,
  onError,
}: AudioImportControlOptions): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "control control-file";

  const controlLabel = document.createElement("div");
  controlLabel.className = "control-label";
  const strong = document.createElement("strong");
  strong.textContent = label;
  controlLabel.append(strong);

  const row = document.createElement("div");
  row.className = "file-control-row";

  const fileName = document.createElement("div");
  fileName.className = "file-chip";
  fileName.textContent = value || "Choose audio file";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "action-button file-action";
  trigger.setAttribute("tabindex", "-1");
  trigger.textContent = "Import";

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "audio/*";
  input.className = "file-input";

  trigger.addEventListener("click", () => input.click());
  input.addEventListener("change", async (event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = "";
    if (!file) {
      return;
    }
    try {
      await onSelect(file);
    } catch (error) {
      onError?.((error as Error)?.message || "Unable to import the selected audio file.");
    }
  });

  row.append(fileName, trigger, input);
  wrapper.append(controlLabel, row);
  return wrapper;
}
