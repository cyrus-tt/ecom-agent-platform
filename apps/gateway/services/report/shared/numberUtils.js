"use strict";

function toText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toIntValue(value) {
  return Math.round(toNumber(value));
}

function toPercentText(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const n = toNumber(value) * 100;
  return `${n.toFixed(2)}%`;
}

function roundNumber(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  const p = Math.pow(10, digits);
  return Math.round(n * p) / p;
}

function percentChange(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p)) {
    return null;
  }
  if (p === 0) {
    return c === 0 ? 0 : null;
  }
  return (c - p) / Math.abs(p);
}

module.exports = {
  toText,
  toNumber,
  toIntValue,
  toPercentText,
  roundNumber,
  percentChange,
};
