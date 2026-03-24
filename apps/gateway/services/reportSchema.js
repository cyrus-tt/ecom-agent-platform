"use strict";

const INVENTORY_CHANNELS = [
  "女子",
  "跑步",
  "篮球",
  "滑板",
  "C店",
  "品类共享",
  "天猫奥莱",
  "新品共享",
  "共享仓",
  "降解共享",
  "线下奥莱共享",
  "天猫旗舰",
  "京东旗舰",
  "社交",
  "天猫专卖",
  "京东专卖",
  "上海专卖",
  "得物",
  "京自营",
  "??",
  "PDD",
  "官网",
  "经销",
  "降解独享仓",
];

const SALES_CHANNELS = [
  "天猫奥莱",
  "女子旗舰",
  "篮球旗舰",
  "跑步旗舰",
  "滑板旗舰",
  "天猫羽球",
  "奥莱安建立",
  "C店",
  "天猫旗舰",
  "??",
  "拼多多",
  "社交",
  "京东旗舰",
  "天猫专卖",
  "京东专卖",
  "上海专卖",
  "得物",
  "官网",
];

const BASE_HEADERS = [
  "款号",
  "货号",
  "归宗货号",
  "大类",
  "中类",
  "品名",
  "零售价",
  "年季",
  "性别",
  "故事包",
  "??",
  "品类独享仓",
  "品类可用",
  "货通同步",
  "天猫奥莱可用仓库存",
];

const COLUMN_HEADERS = [
  ...BASE_HEADERS,
  ...INVENTORY_CHANNELS,
  "全渠道库存",
  ...SALES_CHANNELS,
  "电商整体销售",
  ...SALES_CHANNELS,
  ...SALES_CHANNELS,
];

if (COLUMN_HEADERS.length !== 95) {
  throw new Error(`Column header size mismatch: ${COLUMN_HEADERS.length}`);
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function parseJsonMap(value) {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function buildGroupHeaders(meta) {
  const group = Array(COLUMN_HEADERS.length).fill("");
  group[14] = meta?.stock_group_label || "可用库存";
  group[40] = meta?.sales_qty_group_label || "销售数量";
  group[59] = meta?.sku_discount_group_label || "销售折扣";
  group[77] = meta?.style_discount_group_label || "销售折扣";
  return group;
}

function buildRowArray(raw) {
  const inventoryMap = parseJsonMap(raw.inventory_json);
  const salesMap = parseJsonMap(raw.sales_json);
  const skuDiscountMap = parseJsonMap(raw.sku_discount_json);
  const styleDiscountMap = parseJsonMap(raw.style_discount_json);

  return [
    toText(raw.style),
    toText(raw.sku),
    "",
    toText(raw.major_category),
    toText(raw.category),
    toText(raw.product_name),
    toNumber(raw.tag_price),
    toText(raw.season),
    toText(raw.gender),
    toText(raw.story_pack),
    toText(raw.color),
    toNumber(raw.category_exclusive_qty),
    toNumber(raw.category_available_qty),
    toNumber(raw.pool_sync_qty),
    toNumber(raw.olai_sync_qty),
    ...INVENTORY_CHANNELS.map((channel) => toNumber(inventoryMap[channel])),
    toNumber(raw.full_stock_qty),
    ...SALES_CHANNELS.map((channel) => toNumber(salesMap[channel])),
    toNumber(raw.ecommerce_sales_qty),
    ...SALES_CHANNELS.map((channel) => toNumber(skuDiscountMap[channel])),
    ...SALES_CHANNELS.map((channel) => toNumber(styleDiscountMap[channel])),
  ];
}

module.exports = {
  INVENTORY_CHANNELS,
  SALES_CHANNELS,
  COLUMN_HEADERS,
  buildGroupHeaders,
  buildRowArray,
};
