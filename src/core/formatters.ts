/**
 * Value formatters for display
 */

import { t } from "../i18n";

export type FormatterFunction = (value: number) => string;

export function formatPlain(value: number): string {
  return Number(value).toFixed(Math.abs(value) < 10 ? 2 : 1).replace(/\.0+$/, "");
}

export function formatSeconds(value: number): string {
  return `${Number(value).toFixed(value < 0.1 ? 3 : value < 1 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, "")}${t("s")}`;
}
(formatSeconds as FormatterFunction & { unit?: string }).unit = "log";

export function formatPercent(value: number): string {
  return `${Math.round(Number(value) * 100)}${t("%")}`;
}

export function formatDb(value: number): string {
  return `${Number(value).toFixed(1)}${t(" dB")}`;
}

export function formatCents(value: number): string {
  return `${Math.round(value)}${t(" ct")}`;
}

export function formatRatio(value: number): string {
  return `${Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}${t(":1")}`;
}

export function formatHertz(value: number): string {
  return `${Number(value).toFixed(value < 1 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, "")}${t(" Hz")}`;
}
(formatHertz as FormatterFunction & { unit?: string }).unit = "log";

export function formatFrequency(value: number): string {
  if (value >= 1000) {
    return `${Number(value / 1000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}${t(" kHz")}`;
  }
  return `${Math.round(value)}${t(" Hz")}`;
}
(formatFrequency as FormatterFunction & { unit?: string }).unit = "log";

export function formatMultiplier(value: number): string {
  return `${Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}${t("x")}`;
}
