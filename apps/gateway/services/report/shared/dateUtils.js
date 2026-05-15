"use strict";

function normalizeDateInput(text) {
  const value = String(text || "").trim();
  if (!value) {
    return "";
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function normalizeDailyRangeInput(dateFromText, dateToText) {
  let dateFrom = normalizeDateInput(dateFromText);
  let dateTo = normalizeDateInput(dateToText);
  if (!dateFrom && !dateTo) {
    return { dateFrom: "", dateTo: "" };
  }
  if (!dateFrom) {
    dateFrom = dateTo;
  }
  if (!dateTo) {
    dateTo = dateFrom;
  }
  if (dateFrom > dateTo) {
    const tmp = dateFrom;
    dateFrom = dateTo;
    dateTo = tmp;
  }
  return { dateFrom, dateTo };
}

function buildDefaultDateRangeFromChoices(dateChoices, spanDays = 7) {
  const sorted = Array.from(
    new Set((Array.isArray(dateChoices) ? dateChoices : []).map((item) => normalizeDateInput(item)).filter(Boolean))
  ).sort();
  if (!sorted.length) {
    return { dateFrom: "", dateTo: "" };
  }
  const safeSpan = Math.max(1, Number(spanDays) || 1);
  const endIndex = sorted.length - 1;
  const startIndex = Math.max(0, endIndex - (safeSpan - 1));
  return {
    dateFrom: sorted[startIndex],
    dateTo: sorted[endIndex],
  };
}

function buildAnchorDateRange(anchorDate, spanDays = 7) {
  const safeAnchorDate = normalizeDateInput(anchorDate);
  if (!safeAnchorDate) {
    return { dateFrom: "", dateTo: "" };
  }
  const safeSpan = Math.max(1, Number(spanDays) || 1);
  return {
    dateFrom: shiftDateText(safeAnchorDate, -(safeSpan - 1)),
    dateTo: safeAnchorDate,
  };
}

function toDateText(value) {
  if (!value) {
    return "";
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateTimeText(value) {
  if (!value) {
    return "";
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function parseDateTextUtc(text) {
  const value = normalizeDateInput(text);
  if (!value) {
    return null;
  }
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d;
}

function daysBetweenInclusive(startText, endText) {
  const start = parseDateTextUtc(startText);
  const end = parseDateTextUtc(endText);
  if (!start || !end) {
    return 0;
  }
  const diff = Math.floor((end.getTime() - start.getTime()) / (24 * 3600 * 1000));
  return diff >= 0 ? diff + 1 : 0;
}

function formatDateUtc(dateValue) {
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDateText(dateText, offsetDays) {
  const base = parseDateTextUtc(dateText);
  if (!base) {
    return "";
  }
  const next = new Date(base.getTime());
  next.setUTCDate(next.getUTCDate() + Number(offsetDays || 0));
  return formatDateUtc(next);
}

module.exports = {
  normalizeDateInput,
  normalizeDailyRangeInput,
  buildDefaultDateRangeFromChoices,
  buildAnchorDateRange,
  toDateText,
  dateTimeText,
  parseDateTextUtc,
  daysBetweenInclusive,
  formatDateUtc,
  shiftDateText,
};
