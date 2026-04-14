import { ModularSynthApp } from "./app/modularSynthApp.js";

window.addEventListener("DOMContentLoaded", () => {
  try {
    const app = new ModularSynthApp();
    if (typeof Tone === "undefined") {
      app.setStatus(
        "Tone.js failed to load. The UI is available, but audio is disabled until the CDN script loads.",
        "error",
      );
    }
  } catch (error) {
    console.error("Failed to initialize ModularSynthApp:", error);
    const status = document.getElementById("statusText");
    const dot = document.getElementById("statusDot");
    if (status) {
      status.textContent = `Initialization failed: ${error.message}`;
    }
    dot?.classList.add("error");
  }
});
