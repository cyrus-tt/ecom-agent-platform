"use strict";

const {
  INVENTORY_KEYS,
  SALES_QTY_KEYS,
  SKU_DISCOUNT_KEYS,
  STYLE_DISCOUNT_KEYS,
} = require("../constants");
const { toDateText } = require("./dateUtils");
const { toText, toNumber, toIntValue, toPercentText } = require("./numberUtils");

function toWeekRow(row, salesDateOverride = "") {
  return [
    toDateText(salesDateOverride || row.sales_date),
    toText(row.style),
    toText(row.sku),
    toText(row.major_category),
    toText(row.category),
    toText(row.product_name),
    toNumber(row.tag_price),
    toText(row.season),
    toText(row.gender),
    toText(row.story_pack),
    ...INVENTORY_KEYS.map((key) => toIntValue(row[key])),
    ...SALES_QTY_KEYS.map((key) => toIntValue(row[key])),
    ...SKU_DISCOUNT_KEYS.map((key) => toPercentText(row[key])),
    ...STYLE_DISCOUNT_KEYS.map((key) => toPercentText(row[key])),
  ];
}

function toDailyRow(row) {
  return [
    toDateText(row.inventory_snapshot_date),
    toText(row.style),
    toText(row.sku),
    toText(row.major_category),
    toText(row.category),
    toText(row.product_name),
    toNumber(row.tag_price),
    toText(row.season),
    toText(row.gender),
    toText(row.story_pack),
    ...INVENTORY_KEYS.map((key) => toIntValue(row[key])),
    ...SALES_QTY_KEYS.map((key) => toIntValue(row[key])),
    ...SKU_DISCOUNT_KEYS.map((key) => toPercentText(row[key])),
    ...STYLE_DISCOUNT_KEYS.map((key) => toPercentText(row[key])),
  ];
}

module.exports = {
  toWeekRow,
  toDailyRow,
};
