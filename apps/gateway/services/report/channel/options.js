"use strict";

const CHANNEL_DASHBOARD_MAX_CHANNELS = 4;
const CHANNEL_DASHBOARD_OPTIONS = [
  {
    code: "women",
    label: "女子",
    includeCategoryShared: true,
    salesQtyKey: "sales_women_qty",
    inventoryQtyKey: "inv_women_qty",
    skuDiscountKey: "sku_discount_women",
    styleDiscountKey: "style_discount_women",
  },
  {
    code: "outdoor",
    label: "户外",
    includeCategoryShared: true,
    salesQtyKey: "sales_outdoor_qty",
    inventoryQtyKey: "inv_outdoor_qty",
    skuDiscountKey: "sku_discount_outdoor",
    styleDiscountKey: "style_discount_outdoor",
  },
  {
    code: "trend",
    label: "潮流",
    includeCategoryShared: true,
    salesQtyKey: "sales_trend_qty",
    inventoryQtyKey: "inv_trend_qty",
    skuDiscountKey: "sku_discount_trend",
    styleDiscountKey: "style_discount_trend",
  },
  {
    code: "casual",
    label: "休闲",
    includeCategoryShared: true,
    salesQtyKey: "sales_casual_qty",
    inventoryQtyKey: "inv_casual_qty",
    skuDiscountKey: "sku_discount_casual",
    styleDiscountKey: "style_discount_casual",
  },
  {
    code: "tmall_badminton",
    label: "天猫羽球",
    includeCategoryShared: true,
    salesQtyKey: "sales_tmall_badminton_qty",
    inventoryQtyKey: "",
    skuDiscountKey: "sku_discount_tmall_badminton",
    styleDiscountKey: "style_discount_tmall_badminton",
  },
  {
    code: "tmall_outlet",
    label: "天猫奥莱",
    includeCategoryShared: false,
    salesQtyKey: "sales_tmall_outlet_qty",
    inventoryQtyKey: "inv_tmall_outlet_qty",
    skuDiscountKey: "sku_discount_tmall_outlet",
    styleDiscountKey: "style_discount_tmall_outlet",
  },
  {
    code: "c_store",
    label: "C店",
    includeCategoryShared: false,
    salesQtyKey: "sales_c_store_qty",
    inventoryQtyKey: "inv_c_store_qty",
    skuDiscountKey: "sku_discount_c_store",
    styleDiscountKey: "style_discount_c_store",
  },
  {
    code: "outlet_anjianli",
    label: "奥莱安建立",
    includeCategoryShared: false,
    salesQtyKey: "sales_outlet_anjianli_qty",
    inventoryQtyKey: "",
    skuDiscountKey: "sku_discount_outlet_anjianli",
    styleDiscountKey: "style_discount_outlet_anjianli",
  },
  {
    code: "tmall_flagship",
    label: "天猫旗舰",
    includeCategoryShared: false,
    salesQtyKey: "sales_tmall_flagship_qty",
    inventoryQtyKey: "inv_tmall_flagship_qty",
    skuDiscountKey: "sku_discount_tmall_flagship",
    styleDiscountKey: "style_discount_tmall_flagship",
  },
  {
    code: "tmall_franchise",
    label: "天猫专卖",
    includeCategoryShared: false,
    salesQtyKey: "sales_tmall_franchise_qty",
    inventoryQtyKey: "inv_tmall_franchise_qty",
    skuDiscountKey: "sku_discount_tmall_franchise",
    styleDiscountKey: "style_discount_tmall_franchise",
  },
  {
    code: "shanghai_franchise",
    label: "上海专卖",
    includeCategoryShared: false,
    salesQtyKey: "sales_shanghai_franchise_qty",
    inventoryQtyKey: "inv_shanghai_franchise_qty",
    skuDiscountKey: "sku_discount_shanghai_franchise",
    styleDiscountKey: "style_discount_shanghai_franchise",
  },
  {
    code: "jd_flagship",
    label: "京东旗舰",
    includeCategoryShared: false,
    salesQtyKey: "sales_jd_flagship_qty",
    inventoryQtyKey: "inv_jd_flagship_qty",
    skuDiscountKey: "sku_discount_jd_flagship",
    styleDiscountKey: "style_discount_jd_flagship",
  },
  {
    code: "jd_franchise",
    label: "京东专卖",
    includeCategoryShared: false,
    salesQtyKey: "sales_jd_franchise_qty",
    inventoryQtyKey: "inv_jd_franchise_qty",
    skuDiscountKey: "sku_discount_jd_franchise",
    styleDiscountKey: "style_discount_jd_franchise",
  },
  {
    code: "jd_self",
    label: "京自营",
    includeCategoryShared: false,
    salesQtyKey: "sales_jd_self_qty",
    inventoryQtyKey: "inv_jd_self_qty",
    skuDiscountKey: "sku_discount_jd_self",
    styleDiscountKey: "style_discount_jd_self",
  },
  {
    code: "dewu",
    label: "得物",
    includeCategoryShared: false,
    salesQtyKey: "sales_dewu_qty",
    inventoryQtyKey: "inv_dewu_qty",
    skuDiscountKey: "sku_discount_dewu",
    styleDiscountKey: "style_discount_dewu",
  },
  {
    code: "vip",
    label: "唯品",
    includeCategoryShared: false,
    salesQtyKey: "sales_vip_qty",
    inventoryQtyKey: "inv_vip_qty",
    skuDiscountKey: "sku_discount_vip",
    styleDiscountKey: "style_discount_vip",
  },
  {
    code: "pdd",
    label: "拼多多",
    includeCategoryShared: false,
    salesQtyKey: "sales_pdd_qty",
    inventoryQtyKey: "inv_pdd_qty",
    skuDiscountKey: "sku_discount_pdd",
    styleDiscountKey: "style_discount_pdd",
  },
  {
    code: "interest",
    label: "兴趣",
    includeCategoryShared: false,
    salesQtyKey: "sales_interest_qty",
    inventoryQtyKey: "inv_interest_qty",
    skuDiscountKey: "sku_discount_interest",
    styleDiscountKey: "style_discount_interest",
  },
  {
    code: "official",
    label: "官网",
    includeCategoryShared: false,
    salesQtyKey: "sales_official_qty",
    inventoryQtyKey: "",
    skuDiscountKey: "sku_discount_official",
    styleDiscountKey: "style_discount_official",
  },
  {
    code: "group_buy",
    label: "团购",
    includeCategoryShared: false,
    salesQtyKey: "sales_group_buy_qty",
    inventoryQtyKey: "",
    skuDiscountKey: "sku_discount_group_buy",
    styleDiscountKey: "style_discount_group_buy",
  },
  {
    code: "distributor",
    label: "经销",
    includeCategoryShared: false,
    salesQtyKey: "sales_distributor_qty",
    inventoryQtyKey: "inv_distributor_qty",
    skuDiscountKey: "sku_discount_distributor",
    styleDiscountKey: "style_discount_distributor",
  },
  {
    code: "other",
    label: "其他",
    includeCategoryShared: false,
    salesQtyKey: "sales_other_qty",
    inventoryQtyKey: "inv_other_qty",
    skuDiscountKey: "sku_discount_other",
    styleDiscountKey: "style_discount_other",
  },
];
const CHANNEL_DASHBOARD_OPTION_MAP = new Map(CHANNEL_DASHBOARD_OPTIONS.map((item) => [item.code, item]));
const CHANNEL_DASHBOARD_DEFAULT_CODES = CHANNEL_DASHBOARD_OPTIONS.slice(0, CHANNEL_DASHBOARD_MAX_CHANNELS).map(
  (item) => item.code
);
const DASHBOARD_COMPARE_MAX_CHANNELS = 2;
const DASHBOARD_COMPARE_DEFAULT_CODES = CHANNEL_DASHBOARD_OPTIONS.slice(0, DASHBOARD_COMPARE_MAX_CHANNELS).map(
  (item) => item.code
);

function getChannelDashboardAvailableChannels() {
  return CHANNEL_DASHBOARD_OPTIONS.map((item) => ({
    code: item.code,
    label: item.label,
    inventory_supported: true,
  }));
}

function normalizeChannelCodes(rawValue, maxCount, fallbackCodes) {
  const values = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  const unique = [];
  values.forEach((value) => {
    const code = String(value || "").trim().toLowerCase();
    if (!code || unique.includes(code) || !CHANNEL_DASHBOARD_OPTION_MAP.has(code)) {
      return;
    }
    unique.push(code);
  });
  if (unique.length > 0) {
    return unique.slice(0, Math.max(1, Number(maxCount) || 1));
  }
  return Array.isArray(fallbackCodes) ? fallbackCodes.slice(0, Math.max(1, Number(maxCount) || 1)) : [];
}

function normalizeChannelDashboardCodes(rawValue) {
  return normalizeChannelCodes(rawValue, CHANNEL_DASHBOARD_MAX_CHANNELS, CHANNEL_DASHBOARD_DEFAULT_CODES);
}

function normalizeDashboardCompareCodes(rawValue) {
  return normalizeChannelCodes(rawValue, DASHBOARD_COMPARE_MAX_CHANNELS, DASHBOARD_COMPARE_DEFAULT_CODES);
}

module.exports = {
  CHANNEL_DASHBOARD_MAX_CHANNELS,
  CHANNEL_DASHBOARD_OPTIONS,
  CHANNEL_DASHBOARD_OPTION_MAP,
  CHANNEL_DASHBOARD_DEFAULT_CODES,
  DASHBOARD_COMPARE_MAX_CHANNELS,
  DASHBOARD_COMPARE_DEFAULT_CODES,
  getChannelDashboardAvailableChannels,
  normalizeChannelCodes,
  normalizeChannelDashboardCodes,
  normalizeDashboardCompareCodes,
};
