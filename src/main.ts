/**
 * Main entry point
 */

import { ModularSynthApp } from "./app/modularSynthApp";

declare const Tone: typeof import("tone") | undefined;

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const app = new ModularSynthApp();
    await app.init();
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
      status.textContent = `Initialization failed: ${(error as Error).message}`;
    }
    dot?.classList.add("error");
  }
});
