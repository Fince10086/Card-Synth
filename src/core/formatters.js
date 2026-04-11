export function formatPlain(value) {
  return Number(value).toFixed(Math.abs(value) < 10 ? 2 : 1).replace(/\.0+$/, "");
}

export function formatSeconds(value) {
  return `${Number(value).toFixed(value < 0.1 ? 3 : value < 1 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, "")}s`;
}

export function formatPercent(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

export function formatDb(value) {
  return `${Number(value).toFixed(1)} dB`;
}

export function formatCents(value) {
  return `${Math.round(value)} ct`;
}

export function formatRatio(value) {
  return `${Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}:1`;
}

export function formatHertz(value) {
  return `${Number(value).toFixed(value < 1 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, "")} Hz`;
}

export function formatFrequency(value) {
  if (value >= 1000) {
    return `${Number(value / 1000).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} kHz`;
  }
  return `${Math.round(value)} Hz`;
}

export function formatMultiplier(value) {
  return `${Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}x`;
}
