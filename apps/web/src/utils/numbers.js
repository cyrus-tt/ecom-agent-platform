export function toFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export const TABLE_NUMBER_ALIGN = "center";

export function formatInteger(value) {
  const num = toFiniteNumber(value);
  if (num === null) {
    return "-";
  }
  return Math.round(num).toLocaleString("zh-CN");
}

export function formatDecimal(value, digits = 2) {
  const num = toFiniteNumber(value);
  if (num === null) {
    return "-";
  }
  return num.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatSmartNumber(value, digits = 2) {
  const num = toFiniteNumber(value);
  if (num === null) {
    return "-";
  }
  if (Math.abs(num - Math.round(num)) < 1e-9) {
    return formatInteger(num);
  }
  return formatDecimal(num, digits);
}

export function formatWan(value, digits = 2) {
  const num = toFiniteNumber(value);
  if (num === null) {
    return "-";
  }
  return (num / 10000).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatPercent(value, digits = 1) {
  const num = toFiniteNumber(value);
  if (num === null) {
    return "-";
  }
  return `${(num * 100).toFixed(digits)}%`;
}

export function formatPercentInteger(value) {
  const num = toFiniteNumber(value);
  if (num === null) {
    return "-";
  }
  return `${Math.round(num * 100)}%`;
}

export function formatSignedPoints(value, digits = 1) {
  const num = toFiniteNumber(value);
  if (num === null) {
    return "-";
  }
  const prefix = num > 0 ? "+" : "";
  return `${prefix}${num.toFixed(digits)}pp`;
}

export function formatTextOrDash(value) {
  const text = String(value ?? "").trim();
  return text || "-";
}
