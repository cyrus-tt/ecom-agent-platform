"use strict";

const { COLUMN_HEADERS, buildGroupHeaders, buildRowArray } = require("./reportSchema");

const DAILY_DATE_HEADERS = ["库存快照日期"];
const DAILY_PROMO_HEADERS = ["推广曝光", "推广点击", "推广花费", "推广GMV"];
const DAILY_COLUMN_HEADERS = [...DAILY_DATE_HEADERS, ...COLUMN_HEADERS, ...DAILY_PROMO_HEADERS];

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

function buildDailyGroupHeaders(meta) {
  const base = buildGroupHeaders(meta || {});
  const group = ["", ...base, "", "", "", ""];
  group[DAILY_DATE_HEADERS.length + COLUMN_HEADERS.length] = meta?.promo_group_label || "推广";
  return group;
}

function buildDailyRowArray(raw) {
  const base = buildRowArray(raw || {});
  return [
    toDateText(raw?.inventory_date),
    ...base,
    toNumber(raw?.promo_impressions),
    toNumber(raw?.promo_clicks),
    toNumber(raw?.promo_spend),
    toNumber(raw?.promo_gmv),
  ];
}

module.exports = {
  DAILY_COLUMN_HEADERS,
  buildDailyGroupHeaders,
  buildDailyRowArray,
};
