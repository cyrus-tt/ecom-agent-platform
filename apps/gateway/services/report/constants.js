"use strict";

// ============================================================================
// Table names + base SQL filters
// ============================================================================

const SALES_HISTORY_TABLE = "anta_daily.src_sales_history";
const SALES_DAILY_TABLE = "anta_daily.rpt_sales_sku_daily";
const INVENTORY_LATEST_TABLE = "anta_daily.rpt_inventory_sku_latest";
const SKU_FILTER_SQL = "coalesce(sku, '') not ilike '%u%' and coalesce(sku, '') not ilike '%v%'";

// ============================================================================
// Dashboard "未标记/未分类" 标签 + 派生 SQL coalesce 表达式
// ============================================================================

const DASHBOARD_UNCATEGORIZED_LABEL = "未分类";
const DASHBOARD_UNMARKED_STYLE_LABEL = "未标记款号";
const DASHBOARD_UNMARKED_SKU_LABEL = "未标记货号";
const DASHBOARD_UNMARKED_SEASON_LABEL = "未标记产品季";
const DASHBOARD_UNMARKED_MAJOR_CATEGORY_LABEL = "未标记大类";
const DASHBOARD_CATEGORY_SQL = `coalesce(nullif(trim(category), ''), '${DASHBOARD_UNCATEGORIZED_LABEL}')`;
const DASHBOARD_STYLE_SQL = `coalesce(nullif(trim(style), ''), '${DASHBOARD_UNMARKED_STYLE_LABEL}')`;
const DASHBOARD_SKU_SQL = `coalesce(nullif(trim(sku), ''), '${DASHBOARD_UNMARKED_SKU_LABEL}')`;
const DASHBOARD_SEASON_SQL = `coalesce(nullif(trim(season), ''), '${DASHBOARD_UNMARKED_SEASON_LABEL}')`;
const DASHBOARD_MAJOR_CATEGORY_SQL = `coalesce(nullif(trim(major_category), ''), '${DASHBOARD_UNMARKED_MAJOR_CATEGORY_LABEL}')`;

// ============================================================================
// Column key arrays
// ============================================================================

const BASIC_KEYS = [
  "style",
  "sku",
  "major_category",
  "category",
  "product_name",
  "tag_price",
  "season",
  "gender",
  "story_pack",
];

const INVENTORY_KEYS = [
  "inv_huotong_qty",
  "inv_women_qty",
  "inv_outdoor_qty",
  "inv_trend_qty",
  "inv_casual_qty",
  "inv_c_store_qty",
  "inv_category_shared_qty",
  "inv_tmall_outlet_qty",
  "inv_shared_qty",
  "inv_tmall_flagship_qty",
  "inv_tmall_franchise_qty",
  "inv_shanghai_franchise_qty",
  "inv_jd_flagship_qty",
  "inv_jd_franchise_qty",
  "inv_jd_self_qty",
  "inv_dewu_qty",
  "inv_interest_qty",
  "inv_vip_qty",
  "inv_pdd_qty",
  "inv_distributor_qty",
  "inv_other_qty",
  "inventory_total_qty",
];

const SALES_QTY_KEYS = [
  "sales_women_qty",
  "sales_outdoor_qty",
  "sales_trend_qty",
  "sales_casual_qty",
  "sales_tmall_badminton_qty",
  "sales_tmall_outlet_qty",
  "sales_c_store_qty",
  "sales_outlet_anjianli_qty",
  "sales_tmall_flagship_qty",
  "sales_tmall_franchise_qty",
  "sales_shanghai_franchise_qty",
  "sales_jd_flagship_qty",
  "sales_jd_franchise_qty",
  "sales_jd_self_qty",
  "sales_dewu_qty",
  "sales_vip_qty",
  "sales_pdd_qty",
  "sales_interest_qty",
  "sales_official_qty",
  "sales_group_buy_qty",
  "sales_distributor_qty",
  "sales_other_qty",
  "sales_total_qty",
];
const DASHBOARD_NET_SALES_QTY_KEYS = SALES_QTY_KEYS.filter((key) => key !== "sales_total_qty");
// Dashboard quantity must align with the net channel quantities shown in other boards.
const DASHBOARD_NET_QTY_EXPR = `(${DASHBOARD_NET_SALES_QTY_KEYS.map((key) => `coalesce(${key}, 0)`).join(" + ")})`;

const SKU_DISCOUNT_KEYS = [
  "sku_discount_women",
  "sku_discount_outdoor",
  "sku_discount_trend",
  "sku_discount_casual",
  "sku_discount_tmall_badminton",
  "sku_discount_tmall_outlet",
  "sku_discount_c_store",
  "sku_discount_outlet_anjianli",
  "sku_discount_tmall_flagship",
  "sku_discount_tmall_franchise",
  "sku_discount_shanghai_franchise",
  "sku_discount_jd_flagship",
  "sku_discount_jd_franchise",
  "sku_discount_jd_self",
  "sku_discount_dewu",
  "sku_discount_vip",
  "sku_discount_pdd",
  "sku_discount_interest",
  "sku_discount_official",
  "sku_discount_group_buy",
  "sku_discount_distributor",
  "sku_discount_other",
  "sku_discount_total",
];

const STYLE_DISCOUNT_KEYS = [
  "style_discount_women",
  "style_discount_outdoor",
  "style_discount_trend",
  "style_discount_casual",
  "style_discount_tmall_badminton",
  "style_discount_tmall_outlet",
  "style_discount_c_store",
  "style_discount_outlet_anjianli",
  "style_discount_tmall_flagship",
  "style_discount_tmall_franchise",
  "style_discount_shanghai_franchise",
  "style_discount_jd_flagship",
  "style_discount_jd_franchise",
  "style_discount_jd_self",
  "style_discount_dewu",
  "style_discount_vip",
  "style_discount_pdd",
  "style_discount_interest",
  "style_discount_official",
  "style_discount_group_buy",
  "style_discount_distributor",
  "style_discount_other",
  "style_discount_total",
];

// ============================================================================
// 派生 SQL 模板（依赖上面的 KEYS 数组，必须保持声明顺序）
// ============================================================================

const SALES_SUM_SQL = SALES_QTY_KEYS.map((k) => `coalesce(sum(${k}), 0) as ${k}`).join(",\n        ");
const SKU_DISCOUNT_AVG_SQL = SKU_DISCOUNT_KEYS.map((k) => `avg(${k}) as ${k}`).join(",\n        ");
const STYLE_DISCOUNT_AVG_SQL = STYLE_DISCOUNT_KEYS.map((k) => `avg(${k}) as ${k}`).join(",\n        ");
const INVENTORY_PICK_SQL = INVENTORY_KEYS.map((k) => `coalesce(${k}, 0) as ${k}`).join(",\n        ");
const INVENTORY_MERGE_SQL = INVENTORY_KEYS.map((k) => `coalesce(iv.${k}, 0) as ${k}`).join(",\n      ");
const SALES_MERGE_SQL = SALES_QTY_KEYS.map((k) => `coalesce(sa.${k}, 0) as ${k}`).join(",\n      ");
const SKU_DISCOUNT_MERGE_SQL = SKU_DISCOUNT_KEYS.map((k) => `sa.${k} as ${k}`).join(",\n      ");
const STYLE_DISCOUNT_MERGE_SQL = STYLE_DISCOUNT_KEYS.map((k) => `sa.${k} as ${k}`).join(",\n      ");

module.exports = {
  SALES_HISTORY_TABLE,
  SALES_DAILY_TABLE,
  INVENTORY_LATEST_TABLE,
  SKU_FILTER_SQL,
  DASHBOARD_UNCATEGORIZED_LABEL,
  DASHBOARD_UNMARKED_STYLE_LABEL,
  DASHBOARD_UNMARKED_SKU_LABEL,
  DASHBOARD_UNMARKED_SEASON_LABEL,
  DASHBOARD_UNMARKED_MAJOR_CATEGORY_LABEL,
  DASHBOARD_CATEGORY_SQL,
  DASHBOARD_STYLE_SQL,
  DASHBOARD_SKU_SQL,
  DASHBOARD_SEASON_SQL,
  DASHBOARD_MAJOR_CATEGORY_SQL,
  BASIC_KEYS,
  INVENTORY_KEYS,
  SALES_QTY_KEYS,
  DASHBOARD_NET_SALES_QTY_KEYS,
  DASHBOARD_NET_QTY_EXPR,
  SKU_DISCOUNT_KEYS,
  STYLE_DISCOUNT_KEYS,
  SALES_SUM_SQL,
  SKU_DISCOUNT_AVG_SQL,
  STYLE_DISCOUNT_AVG_SQL,
  INVENTORY_PICK_SQL,
  INVENTORY_MERGE_SQL,
  SALES_MERGE_SQL,
  SKU_DISCOUNT_MERGE_SQL,
  STYLE_DISCOUNT_MERGE_SQL,
};
