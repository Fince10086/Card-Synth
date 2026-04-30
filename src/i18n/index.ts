/**
 * Lightweight i18n engine for Card Synth
 */

import { zhTranslations } from "./translations/zh";

export type Language = "en" | "zh";

let currentLanguage: Language = "en";
const listeners = new Set<() => void>();

function loadSavedLanguage(): Language {
  if (typeof window === "undefined") return "en";
  const saved = localStorage.getItem("card-synth-lang");
  if (saved === "en" || saved === "zh") return saved;
  const browserLang = navigator.language.toLowerCase();
  if (browserLang.startsWith("zh")) return "zh";
  return "en";
}

currentLanguage = loadSavedLanguage();

export function setLanguage(lang: Language): void {
  if (currentLanguage === lang) return;
  currentLanguage = lang;
  if (typeof window !== "undefined") {
    localStorage.setItem("card-synth-lang", lang);
  }
  listeners.forEach((fn) => fn());
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function subscribeToLanguageChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: string, params?: Record<string, string | number>): string {
  let text = currentLanguage === "zh" ? zhTranslations[key] : undefined;
  if (text === undefined) text = key;
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.replace(new RegExp(`{{${k}}}`, "g"), String(v));
    });
  }
  return text;
}
