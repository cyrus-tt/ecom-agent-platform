"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const BASE_DIR = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(BASE_DIR, "config.json");

const SLOW_SQL_THRESHOLD_MS = 300;
const REPORT_CACHE_TTL_MS = readPositiveInt(process.env.REPORT_CACHE_TTL_MS, 5 * 60 * 1000);
const REPORT_CACHE_MAX_ENTRIES = readPositiveInt(process.env.REPORT_CACHE_MAX_ENTRIES, 120);
const DAILY_UNION_CACHE_TTL_MS = readPositiveInt(process.env.DAILY_UNION_CACHE_TTL_MS, REPORT_CACHE_TTL_MS);
const DATE_CHOICES_CACHE_TTL_MS = readPositiveInt(process.env.DATE_CHOICES_CACHE_TTL_MS, REPORT_CACHE_TTL_MS);
const DASHBOARD_CACHE_TTL_MS = readPositiveInt(process.env.DASHBOARD_CACHE_TTL_MS, REPORT_CACHE_TTL_MS);
const CHANNEL_DASHBOARD_CACHE_TTL_MS = readPositiveInt(process.env.CHANNEL_DASHBOARD_CACHE_TTL_MS, REPORT_CACHE_TTL_MS);

const SALES_HISTORY_TABLE = "anta_daily.src_sales_history";
const SALES_DAILY_TABLE = "anta_daily.rpt_sales_sku_daily";
const INVENTORY_LATEST_TABLE = "anta_daily.rpt_inventory_sku_latest";
const SKU_FILTER_SQL = "coalesce(sku, '') not ilike '%u%' and coalesce(sku, '') not ilike '%v%'";
const DASHBOARD_UNCATEGORIZED_LABEL = "\u672a\u5206\u7c7b";
const DASHBOARD_UNMARKED_STYLE_LABEL = "\u672a\u6807\u8bb0\u6b3e\u53f7";
const DASHBOARD_UNMARKED_SKU_LABEL = "\u672a\u6807\u8bb0\u8d27\u53f7";
const DASHBOARD_UNMARKED_SEASON_LABEL = "\u672a\u6807\u8bb0\u4ea7\u54c1\u5b63";
const DASHBOARD_UNMARKED_MAJOR_CATEGORY_LABEL = "\u672a\u6807\u8bb0\u5927\u7c7b";
const DASHBOARD_CATEGORY_SQL = `coalesce(nullif(trim(category), ''), '${DASHBOARD_UNCATEGORIZED_LABEL}')`;
const DASHBOARD_STYLE_SQL = `coalesce(nullif(trim(style), ''), '${DASHBOARD_UNMARKED_STYLE_LABEL}')`;
const DASHBOARD_SKU_SQL = `coalesce(nullif(trim(sku), ''), '${DASHBOARD_UNMARKED_SKU_LABEL}')`;
const DASHBOARD_SEASON_SQL = `coalesce(nullif(trim(season), ''), '${DASHBOARD_UNMARKED_SEASON_LABEL}')`;
const DASHBOARD_MAJOR_CATEGORY_SQL = `coalesce(nullif(trim(major_category), ''), '${DASHBOARD_UNMARKED_MAJOR_CATEGORY_LABEL}')`;

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
// The ETL builds these from sales, return, and exchange documents.
const DASHBOARD_SALES_AMOUNT_EXPR = "coalesce(sales_total_amount, 0)";
const DASHBOARD_TAG_AMOUNT_EXPR = "coalesce(sales_total_tag_amount, 0)";

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
const CHANNEL_DASHBOARD_DEFAULT_CODES = [];
const DASHBOARD_COMPARE_MAX_CHANNELS = 2;
const DASHBOARD_COMPARE_DEFAULT_CODES = [];

const WEEK_COLUMN_HEADERS = [
  "出库时间",
  "款号",
  "货号",
  "大类",
  "中类",
  "品名",
  "吊牌价",
  "产品季",
  "性别",
  "故事包",
  "货通",
  "女子",
  "户外",
  "潮流",
  "休闲",
  "C店",
  "品类共享",
  "天猫奥莱",
  "共享",
  "天猫旗舰",
  "天猫专卖",
  "上海专卖",
  "京东旗舰",
  "京东专卖",
  "京自营",
  "得物",
  "兴趣",
  "唯品",
  "拼多多",
  "经销",
  "其他",
  "全渠道库存",
  "女子",
  "户外",
  "潮流",
  "休闲",
  "天猫羽球",
  "天猫奥莱",
  "C店",
  "奥莱安建立",
  "天猫旗舰",
  "天猫专卖",
  "上海专卖",
  "京东旗舰",
  "京东专卖",
  "京自营",
  "得物",
  "唯品",
  "拼多多",
  "兴趣",
  "官网",
  "团购",
  "经销",
  "其他",
  "全渠道销售",
  "女子",
  "户外",
  "潮流",
  "休闲",
  "天猫羽球",
  "天猫奥莱",
  "C店",
  "奥莱安建立",
  "天猫旗舰",
  "天猫专卖",
  "上海专卖",
  "京东旗舰",
  "京东专卖",
  "京自营",
  "得物",
  "唯品",
  "拼多多",
  "兴趣",
  "官网",
  "团购",
  "经销",
  "其他",
  "全渠道折扣（货号层级）",
  "女子",
  "户外",
  "潮流",
  "休闲",
  "天猫羽球",
  "天猫奥莱",
  "C店",
  "奥莱安建立",
  "天猫旗舰",
  "天猫专卖",
  "上海专卖",
  "京东旗舰",
  "京东专卖",
  "京自营",
  "得物",
  "唯品",
  "拼多多",
  "兴趣",
  "官网",
  "团购",
  "经销",
  "其他",
  "全渠道折扣（款号层级）",
];

const DAILY_COLUMN_HEADERS = ["库存快照日期", ...WEEK_COLUMN_HEADERS.slice(1)];

const SALES_SUM_SQL = SALES_QTY_KEYS.map((k) => `coalesce(sum(${k}), 0) as ${k}`).join(",\n        ");
const SKU_DISCOUNT_AVG_SQL = SKU_DISCOUNT_KEYS.map((k) => `avg(${k}) as ${k}`).join(",\n        ");
const STYLE_DISCOUNT_AVG_SQL = STYLE_DISCOUNT_KEYS.map((k) => `avg(${k}) as ${k}`).join(",\n        ");
const INVENTORY_PICK_SQL = INVENTORY_KEYS.map((k) => `coalesce(${k}, 0) as ${k}`).join(",\n        ");
const INVENTORY_MERGE_SQL = INVENTORY_KEYS.map((k) => `coalesce(iv.${k}, 0) as ${k}`).join(",\n      ");
const SALES_MERGE_SQL = SALES_QTY_KEYS.map((k) => `coalesce(sa.${k}, 0) as ${k}`).join(",\n      ");
const SKU_DISCOUNT_MERGE_SQL = SKU_DISCOUNT_KEYS.map((k) => `sa.${k} as ${k}`).join(",\n      ");
const STYLE_DISCOUNT_MERGE_SQL = STYLE_DISCOUNT_KEYS.map((k) => `sa.${k} as ${k}`).join(",\n      ");

const DAILY_UNION_SQL = `
with sales_agg as (
    select
        sku,
        max(style) as style,
        max(major_category) as major_category,
        max(category) as category,
        max(product_name) as product_name,
        max(tag_price) as tag_price,
        max(season) as season,
        max(gender) as gender,
        max(story_pack) as story_pack,
        ${SALES_SUM_SQL},
        ${SKU_DISCOUNT_AVG_SQL},
        ${STYLE_DISCOUNT_AVG_SQL},
        max(loaded_at) as loaded_at
    from ${SALES_DAILY_TABLE}
    where sales_date between $1 and $2
      and ${SKU_FILTER_SQL}
    group by sku
),
inv as (
    select
        sku,
        inventory_snapshot_date,
        style,
        major_category,
        category,
        product_name,
        tag_price,
        season,
        gender,
        story_pack,
        ${INVENTORY_PICK_SQL},
        loaded_at
    from ${INVENTORY_LATEST_TABLE}
    where ${SKU_FILTER_SQL}
)
select
    coalesce(sa.sku, iv.sku) as sku,
    coalesce(sa.style, iv.style) as style,
    coalesce(sa.major_category, iv.major_category) as major_category,
    coalesce(sa.category, iv.category) as category,
    coalesce(sa.product_name, iv.product_name) as product_name,
    coalesce(sa.tag_price, iv.tag_price) as tag_price,
    coalesce(sa.season, iv.season) as season,
    coalesce(sa.gender, iv.gender) as gender,
    coalesce(sa.story_pack, iv.story_pack) as story_pack,
    iv.inventory_snapshot_date,
    ${INVENTORY_MERGE_SQL},
    ${SALES_MERGE_SQL},
    ${SKU_DISCOUNT_MERGE_SQL},
    ${STYLE_DISCOUNT_MERGE_SQL},
    greatest(
      coalesce(sa.loaded_at, to_timestamp(0)),
      coalesce(iv.loaded_at, to_timestamp(0))
    ) as loaded_at
from sales_agg sa
full outer join inv iv on iv.sku = sa.sku
where not (
  coalesce(iv.inventory_total_qty, 0) = 0
  and coalesce(sa.sales_total_qty, 0) = 0
)
order by coalesce(sa.sku, iv.sku)
`;

let poolPromise = null;
let analysisTableReadyPromise = null;
const DAILY_UNION_CACHE = new Map();
const DAILY_UNION_IN_FLIGHT = new Map();
const DASHBOARD_OVERVIEW_CACHE = new Map();
const DASHBOARD_OVERVIEW_IN_FLIGHT = new Map();
const DASHBOARD_COMPARE_CACHE = new Map();
const DASHBOARD_COMPARE_IN_FLIGHT = new Map();
const DASHBOARD_DRILLDOWN_CACHE = new Map();
const DASHBOARD_DRILLDOWN_IN_FLIGHT = new Map();
const CHANNEL_DASHBOARD_CACHE = new Map();
const CHANNEL_DASHBOARD_IN_FLIGHT = new Map();
const CHANNEL_DRILLDOWN_CACHE = new Map();
const CHANNEL_DRILLDOWN_IN_FLIGHT = new Map();
let dateChoicesPromise = null;
let dashboardDatesPromise = null;
let dateChoicesCache = {
  savedAt: 0,
  payload: null,
};
let dashboardDatesCache = {
  savedAt: 0,
  payload: null,
};

function readPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function getMapCache(cache, key, ttlMs) {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - Number(cached.savedAt || 0) > ttlMs) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, cached);
  return cached.payload;
}

function setMapCache(cache, key, payload, maxEntries = REPORT_CACHE_MAX_ENTRIES) {
  if (!key) {
    return;
  }
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, {
    savedAt: Date.now(),
    payload,
  });
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
}

async function withSingleFlight(inFlightMap, key, factory) {
  const existing = inFlightMap.get(key);
  if (existing) {
    return existing;
  }
  const request = Promise.resolve().then(factory);
  inFlightMap.set(key, request);
  try {
    return await request;
  } finally {
    inFlightMap.delete(key);
  }
}

function clearReportCaches(reason = "manual") {
  const before = getCacheStats();
  DAILY_UNION_CACHE.clear();
  DASHBOARD_OVERVIEW_CACHE.clear();
  DASHBOARD_COMPARE_CACHE.clear();
  DASHBOARD_DRILLDOWN_CACHE.clear();
  CHANNEL_DASHBOARD_CACHE.clear();
  CHANNEL_DRILLDOWN_CACHE.clear();
  dateChoicesCache = { savedAt: 0, payload: null };
  dashboardDatesCache = { savedAt: 0, payload: null };
  return {
    reason,
    cleared_at: new Date().toISOString(),
    before,
    after: getCacheStats(),
  };
}

function getCacheStats() {
  return {
    ttl_ms: REPORT_CACHE_TTL_MS,
    max_entries: REPORT_CACHE_MAX_ENTRIES,
    caches: {
      daily_union: DAILY_UNION_CACHE.size,
      dashboard_overview: DASHBOARD_OVERVIEW_CACHE.size,
      dashboard_compare: DASHBOARD_COMPARE_CACHE.size,
      dashboard_drilldown: DASHBOARD_DRILLDOWN_CACHE.size,
      channel_dashboard: CHANNEL_DASHBOARD_CACHE.size,
      channel_drilldown: CHANNEL_DRILLDOWN_CACHE.size,
      date_choices: dateChoicesCache.payload ? 1 : 0,
      dashboard_dates: dashboardDatesCache.payload ? 1 : 0,
    },
    in_flight: {
      daily_union: DAILY_UNION_IN_FLIGHT.size,
      dashboard_overview: DASHBOARD_OVERVIEW_IN_FLIGHT.size,
      dashboard_compare: DASHBOARD_COMPARE_IN_FLIGHT.size,
      dashboard_drilldown: DASHBOARD_DRILLDOWN_IN_FLIGHT.size,
      channel_dashboard: CHANNEL_DASHBOARD_IN_FLIGHT.size,
      channel_drilldown: CHANNEL_DRILLDOWN_IN_FLIGHT.size,
      date_choices: dateChoicesPromise ? 1 : 0,
      dashboard_dates: dashboardDatesPromise ? 1 : 0,
    },
  };
}

function readConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(text)) {
    return true;
  }
  if (["0", "false", "no", "n"].includes(text)) {
    return false;
  }
  return fallback;
}

function buildPgConfig(pgConfig) {
  const statementTimeout = Number(pgConfig?.statement_timeout_ms || 120000);
  const connectionTimeout = Number(pgConfig?.connection_timeout_ms || 10000);
  const idleTimeout = Number(pgConfig?.idle_timeout_ms || 30000);
  return {
    host: String(pgConfig?.host || "127.0.0.1"),
    port: Number(pgConfig?.port || 5432),
    database: String(pgConfig?.database || "ecom_dashboard_v2"),
    user: String(pgConfig?.user || "ecom_app"),
    password: String(pgConfig?.password || "ecom123456"),
    max: Number(pgConfig?.max_pool_size || 10),
    statement_timeout: Number.isFinite(statementTimeout) && statementTimeout > 0 ? statementTimeout : 120000,
    connectionTimeoutMillis: Number.isFinite(connectionTimeout) && connectionTimeout > 0 ? connectionTimeout : 10000,
    idleTimeoutMillis: Number.isFinite(idleTimeout) && idleTimeout > 0 ? idleTimeout : 30000,
    ssl: toBool(pgConfig?.ssl, false) ? { rejectUnauthorized: false } : false,
  };
}

function compactSqlText(queryText) {
  return String(queryText || "").replace(/\s+/g, " ").trim().slice(0, 260);
}

async function timedQuery(pool, queryText, values, tag) {
  const startedAt = Date.now();
  try {
    return await pool.query(queryText, values);
  } finally {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > SLOW_SQL_THRESHOLD_MS) {
      const label = tag ? `[${tag}]` : "";
      console.warn(`[reportRepo][slow-sql]${label} ${elapsedMs}ms ${compactSqlText(queryText)}`);
    }
  }
}

async function getPool() {
  if (poolPromise) {
    return poolPromise;
  }
  const cfg = readConfig();
  const pgCfg = buildPgConfig(cfg.postgres || {});
  const pool = new Pool(pgCfg);
  poolPromise = pool
    .query("select 1 as ok")
    .then(() => pool)
    .catch(async (err) => {
      poolPromise = null;
      try {
        await pool.end();
      } catch (_err) {
        // ignore
      }
      throw err;
    });
  return poolPromise;
}

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

function buildWeekGroupHeaders() {
  const group = Array(WEEK_COLUMN_HEADERS.length).fill("");
  group[0] = "日期";
  group[1] = "基础信息";
  group[10] = "库存";
  group[32] = "销售";
  group[55] = "货号折扣";
  group[78] = "款号折扣";
  return group;
}

function buildDailyGroupHeaders() {
  const group = Array(DAILY_COLUMN_HEADERS.length).fill("");
  group[0] = "库存快照";
  group[1] = "基础信息";
  group[10] = "库存";
  group[32] = "销售";
  group[55] = "货号折扣";
  group[78] = "款号折扣";
  return group;
}

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

function makeDailyUnionCacheKey(dateFrom, dateTo) {
  return `${dateFrom}|${dateTo}`;
}

function getDailyUnionCache(dateFrom, dateTo) {
  return getMapCache(DAILY_UNION_CACHE, makeDailyUnionCacheKey(dateFrom, dateTo), DAILY_UNION_CACHE_TTL_MS);
}

function setDailyUnionCache(dateFrom, dateTo, rows) {
  setMapCache(DAILY_UNION_CACHE, makeDailyUnionCacheKey(dateFrom, dateTo), Array.isArray(rows) ? rows : []);
}

function makeChannelDashboardCacheKey(dateFrom, dateTo, selectedChannelCodes, comparisonDateFrom = "", comparisonDateTo = "") {
  return `${dateFrom}|${dateTo}|${comparisonDateFrom}|${comparisonDateTo}|${(selectedChannelCodes || []).join(",")}`;
}

function getChannelDashboardCache(dateFrom, dateTo, selectedChannelCodes, comparisonDateFrom = "", comparisonDateTo = "") {
  return getMapCache(
    CHANNEL_DASHBOARD_CACHE,
    makeChannelDashboardCacheKey(dateFrom, dateTo, selectedChannelCodes, comparisonDateFrom, comparisonDateTo),
    CHANNEL_DASHBOARD_CACHE_TTL_MS
  );
}

function setChannelDashboardCache(dateFrom, dateTo, selectedChannelCodes, comparisonDateFrom, comparisonDateTo, payload) {
  setMapCache(
    CHANNEL_DASHBOARD_CACHE,
    makeChannelDashboardCacheKey(dateFrom, dateTo, selectedChannelCodes, comparisonDateFrom, comparisonDateTo),
    payload
  );
}

async function getDateChoices() {
  if (dateChoicesCache.payload && Date.now() - Number(dateChoicesCache.savedAt || 0) <= DATE_CHOICES_CACHE_TTL_MS) {
    return dateChoicesCache.payload;
  }
  if (dateChoicesPromise) {
    return dateChoicesPromise;
  }

  const pool = await getPool();
  dateChoicesPromise = (async () => {
    try {
      const result = await timedQuery(
        pool,
        `
          select to_char(sales_date, 'YYYY-MM-DD') as sales_date
          from ${SALES_DAILY_TABLE}
          where ${SKU_FILTER_SQL}
          group by sales_date
          order by sales_date desc
        `,
        [],
        "getDateChoices"
      );
      const salesDates = result.rows.map((row) => row.sales_date).filter(Boolean);
      const payload = { salesDates, defaultSalesDate: salesDates[0] || "" };
      dateChoicesCache = {
        savedAt: Date.now(),
        payload,
      };
      return payload;
    } catch (_err) {
      const fallback = await timedQuery(
        pool,
        `
          select to_char(sales_date, 'YYYY-MM-DD') as sales_date
          from ${SALES_HISTORY_TABLE}
          where ${SKU_FILTER_SQL}
          group by sales_date
          order by sales_date desc
        `,
        [],
        "getDateChoices.fallback"
      );
      const salesDates = fallback.rows.map((row) => row.sales_date).filter(Boolean);
      const payload = { salesDates, defaultSalesDate: salesDates[0] || "" };
      dateChoicesCache = {
        savedAt: Date.now(),
        payload,
      };
      return payload;
    } finally {
      dateChoicesPromise = null;
    }
  })();

  return dateChoicesPromise;
}

async function getDashboardDateChoices() {
  if (dashboardDatesCache.payload && Date.now() - Number(dashboardDatesCache.savedAt || 0) <= DASHBOARD_CACHE_TTL_MS) {
    return dashboardDatesCache.payload;
  }
  if (dashboardDatesPromise) {
    return dashboardDatesPromise;
  }

  dashboardDatesPromise = (async () => {
    try {
      const choices = await getDateChoices();
      const defaultRange = buildDefaultDateRangeFromChoices(choices.salesDates, 7);
      const payload = {
        anchor_dates: choices.salesDates || [],
        default_anchor_date: choices.defaultSalesDate || "",
        sales_dates: choices.salesDates || [],
        default_date_from: defaultRange.dateFrom || "",
        default_date_to: defaultRange.dateTo || "",
      };
      dashboardDatesCache = {
        savedAt: Date.now(),
        payload,
      };
      return payload;
    } finally {
      dashboardDatesPromise = null;
    }
  })();

  return dashboardDatesPromise;
}

async function resolveDashboardAnchorDate(anchorDateText) {
  const { anchor_dates: anchorDates, default_anchor_date: defaultAnchorDate } = await getDashboardDateChoices();
  if (!Array.isArray(anchorDates) || anchorDates.length === 0) {
    return { anchorDate: "", anchorDates: [] };
  }

  const normalized = normalizeDateInput(anchorDateText);
  if (!normalized) {
    return { anchorDate: defaultAnchorDate || anchorDates[0], anchorDates };
  }
  if (anchorDates.includes(normalized)) {
    return { anchorDate: normalized, anchorDates };
  }
  const fallback = anchorDates.find((d) => d <= normalized) || anchorDates[0];
  return { anchorDate: fallback, anchorDates };
}

async function resolveDashboardRange({ dateFromText, dateToText, anchorDateText, defaultSpanDays = 7 }) {
  const choices = await getDailyDateChoices();
  const salesDates = Array.isArray(choices.salesDates) ? choices.salesDates : [];
  const validDates = new Set(salesDates);
  const normalized = normalizeDailyRangeInput(dateFromText, dateToText);
  let dateFrom = normalized.dateFrom;
  let dateTo = normalized.dateTo;

  if (dateFrom && dateTo && validDates.has(dateFrom) && validDates.has(dateTo)) {
    if (dateFrom > dateTo) {
      const tmp = dateFrom;
      dateFrom = dateTo;
      dateTo = tmp;
    }
  } else if (normalizeDateInput(anchorDateText)) {
    const { anchorDate } = await resolveDashboardAnchorDate(anchorDateText);
    const derivedRange = buildAnchorDateRange(anchorDate, defaultSpanDays);
    dateFrom = derivedRange.dateFrom;
    dateTo = derivedRange.dateTo;
  } else {
    const fallback = buildDefaultDateRangeFromChoices(salesDates, defaultSpanDays);
    dateFrom = fallback.dateFrom;
    dateTo = fallback.dateTo;
  }

  const periodDays = Math.max(1, daysBetweenInclusive(dateFrom, dateTo));
  const comparisonTo = dateFrom ? shiftDateText(dateFrom, -1) : "";
  const comparisonFrom = comparisonTo ? shiftDateText(comparisonTo, -(periodDays - 1)) : "";
  return {
    salesDates,
    anchorDate: dateTo,
    dateFrom,
    dateTo,
    comparisonFrom,
    comparisonTo,
    periodDays,
  };
}

async function resolveOptionalDashboardRange({ dateFromText, dateToText }) {
  const choices = await getDailyDateChoices();
  const salesDates = Array.isArray(choices.salesDates) ? choices.salesDates : [];
  const validDates = new Set(salesDates);
  const normalized = normalizeDailyRangeInput(dateFromText, dateToText);
  const dateFrom = normalized.dateFrom;
  const dateTo = normalized.dateTo;

  if (!dateFrom || !dateTo || !validDates.has(dateFrom) || !validDates.has(dateTo)) {
    return {
      salesDates,
      dateFrom: "",
      dateTo: "",
      periodDays: 0,
    };
  }

  return {
    salesDates,
    dateFrom,
    dateTo,
    periodDays: Math.max(1, daysBetweenInclusive(dateFrom, dateTo)),
  };
}

function normalizeDashboardDrilldownLevel(value) {
  const text = String(value || "").trim().toLowerCase();
  return text === "style" || text === "sku" ? text : "";
}

function buildDashboardDrilldownBaseSql(styleParamIndex) {
  const styleFilterSql = styleParamIndex ? `and ${DASHBOARD_STYLE_SQL} = $${styleParamIndex}` : "";
  return `
    with sales_sku as (
      select
        ${DASHBOARD_STYLE_SQL} as style_label,
        ${DASHBOARD_SKU_SQL} as sku_label,
        max(nullif(trim(product_name), '')) as product_name,
        max(coalesce(tag_price, 0))::numeric as tag_price,
        coalesce(sum(${DASHBOARD_SALES_AMOUNT_EXPR}), 0)::numeric as gmv,
        coalesce(sum(${DASHBOARD_NET_QTY_EXPR}), 0)::numeric as qty,
        coalesce(sum(${DASHBOARD_SALES_AMOUNT_EXPR}), 0)::numeric as discount_num,
        coalesce(sum(${DASHBOARD_TAG_AMOUNT_EXPR}), 0)::numeric as discount_den
      from ${SALES_DAILY_TABLE}
      where sales_date between $1 and $2
        and ${SKU_FILTER_SQL}
        and ${DASHBOARD_CATEGORY_SQL} = $3
        ${styleFilterSql}
      group by 1, 2
    ),
    inventory_sku as (
      select
        ${DASHBOARD_STYLE_SQL} as style_label,
        ${DASHBOARD_SKU_SQL} as sku_label,
        max(nullif(trim(product_name), '')) as product_name,
        max(coalesce(tag_price, 0))::numeric as tag_price,
        coalesce(sum(inventory_total_qty), 0)::numeric as inventory_qty
      from ${INVENTORY_LATEST_TABLE}
      where ${SKU_FILTER_SQL}
        and ${DASHBOARD_CATEGORY_SQL} = $3
        ${styleFilterSql}
      group by 1, 2
    ),
    joined as (
      select
        coalesce(s.style_label, i.style_label, '${DASHBOARD_UNMARKED_STYLE_LABEL}') as style_label,
        coalesce(s.sku_label, i.sku_label, '${DASHBOARD_UNMARKED_SKU_LABEL}') as sku_label,
        coalesce(s.product_name, i.product_name, '') as product_name,
        coalesce(s.tag_price, i.tag_price, 0)::numeric as tag_price,
        coalesce(s.gmv, 0)::numeric as gmv,
        coalesce(s.qty, 0)::numeric as qty,
        coalesce(s.discount_num, 0)::numeric as discount_num,
        coalesce(s.discount_den, 0)::numeric as discount_den,
        coalesce(i.inventory_qty, 0)::numeric as inventory_qty
      from sales_sku s
      full outer join inventory_sku i
        on i.style_label = s.style_label
       and i.sku_label = s.sku_label
    )
  `;
}

function buildDashboardDrilldownEmptyPayload({ anchorDate, dateFrom, dateTo, category, level, style, page, pageSize }) {
  return {
    meta: {
      anchor_date: anchorDate,
      date_from: dateFrom,
      date_to: dateTo,
      category,
      level,
      style: style || "",
    },
    summary: {
      gmv: 0,
      qty: 0,
      inventory_qty: 0,
      row_count: 0,
    },
    items: [],
    total: 0,
    page,
    pageSize,
  };
}

function toDashboardSummary(row) {
  return {
    gmv: roundNumber(row?.gmv, 2),
    qty: roundNumber(row?.qty, 2),
    inventory_qty: roundNumber(row?.inventory_qty, 2),
    row_count: Math.max(0, Math.round(toNumber(row?.row_count))),
  };
}

function toDashboardStyleDrilldownRow(row) {
  const qty = toNumber(row?.qty);
  const inventoryQty = toNumber(row?.inventory_qty);
  return {
    style: toText(row?.style) || DASHBOARD_UNMARKED_STYLE_LABEL,
    gmv: roundNumber(row?.gmv, 2),
    qty: roundNumber(qty, 2),
    inventory_qty: roundNumber(inventoryQty, 2),
    discount_rate: roundNumber(row?.discount_rate, 6),
    sell_through: inventoryQty > 0 ? roundNumber(qty / inventoryQty, 6) : 0,
  };
}

function toDashboardSkuDrilldownRow(row) {
  const qty = toNumber(row?.qty);
  const inventoryQty = toNumber(row?.inventory_qty);
  return {
    style: toText(row?.style) || DASHBOARD_UNMARKED_STYLE_LABEL,
    sku: toText(row?.sku) || DASHBOARD_UNMARKED_SKU_LABEL,
    product_name: toText(row?.product_name),
    tag_price: roundNumber(row?.tag_price, 2),
    gmv: roundNumber(row?.gmv, 2),
    qty: roundNumber(qty, 2),
    inventory_qty: roundNumber(inventoryQty, 2),
    discount_rate: roundNumber(row?.discount_rate, 6),
    sell_through: inventoryQty > 0 ? roundNumber(qty / inventoryQty, 6) : 0,
  };
}

async function queryDashboardStyleDrilldown(pool, dateFrom, dateTo, category, page, pageSize) {
  const offset = (Math.max(1, Number(page) || 1) - 1) * Math.max(1, Number(pageSize) || 20);
  const safePageSize = Math.max(1, Number(pageSize) || 20);
  const baseSql = buildDashboardDrilldownBaseSql(0);
  const summaryResult = await timedQuery(
    pool,
    `
      ${baseSql},
      grouped as (
        select
          style_label as style,
          coalesce(sum(gmv), 0)::numeric as gmv,
          coalesce(sum(qty), 0)::numeric as qty,
          coalesce(sum(discount_num), 0)::numeric as discount_num,
          coalesce(sum(discount_den), 0)::numeric as discount_den,
          coalesce(sum(inventory_qty), 0)::numeric as inventory_qty
        from joined
        group by 1
      )
      select
        coalesce(sum(gmv), 0)::numeric as gmv,
        coalesce(sum(qty), 0)::numeric as qty,
        coalesce(sum(inventory_qty), 0)::numeric as inventory_qty,
        count(*)::integer as row_count
      from grouped
    `,
    [dateFrom, dateTo, category],
    "queryDashboardStyleDrilldown.summary"
  );
  const rowsResult = await timedQuery(
    pool,
    `
      ${baseSql},
      grouped as (
        select
          style_label as style,
          coalesce(sum(gmv), 0)::numeric as gmv,
          coalesce(sum(qty), 0)::numeric as qty,
          coalesce(sum(discount_num), 0)::numeric as discount_num,
          coalesce(sum(discount_den), 0)::numeric as discount_den,
          coalesce(sum(inventory_qty), 0)::numeric as inventory_qty
        from joined
        group by 1
      )
      select
        style,
        gmv,
        qty,
        inventory_qty,
        case when discount_den = 0 then 0 else discount_num / discount_den end as discount_rate
      from grouped
      order by gmv desc, qty desc, style asc
      offset $4 limit $5
    `,
    [dateFrom, dateTo, category, offset, safePageSize],
    "queryDashboardStyleDrilldown.rows"
  );

  return {
    summary: toDashboardSummary(summaryResult.rows[0]),
    items: (rowsResult.rows || []).map((row) => toDashboardStyleDrilldownRow(row)),
  };
}

async function queryDashboardSkuDrilldown(pool, dateFrom, dateTo, category, style, page, pageSize) {
  const offset = (Math.max(1, Number(page) || 1) - 1) * Math.max(1, Number(pageSize) || 20);
  const safePageSize = Math.max(1, Number(pageSize) || 20);
  const baseSql = buildDashboardDrilldownBaseSql(4);
  const summaryResult = await timedQuery(
    pool,
    `
      ${baseSql}
      select
        coalesce(sum(gmv), 0)::numeric as gmv,
        coalesce(sum(qty), 0)::numeric as qty,
        coalesce(sum(inventory_qty), 0)::numeric as inventory_qty,
        count(*)::integer as row_count
      from joined
    `,
    [dateFrom, dateTo, category, style],
    "queryDashboardSkuDrilldown.summary"
  );
  const rowsResult = await timedQuery(
    pool,
    `
      ${baseSql}
      select
        style_label as style,
        sku_label as sku,
        product_name,
        tag_price,
        gmv,
        qty,
        inventory_qty,
        case when discount_den = 0 then 0 else discount_num / discount_den end as discount_rate
      from joined
      order by gmv desc, qty desc, sku asc
      offset $5 limit $6
    `,
    [dateFrom, dateTo, category, style, offset, safePageSize],
    "queryDashboardSkuDrilldown.rows"
  );

  return {
    summary: toDashboardSummary(summaryResult.rows[0]),
    items: (rowsResult.rows || []).map((row) => toDashboardSkuDrilldownRow(row)),
  };
}

function makeDashboardDrilldownCacheKey({ dateFrom, dateTo, category, level, style, page, pageSize }) {
  return `${dateFrom}|${dateTo}|${category}|${level}|${style}|${page}|${pageSize}`;
}

async function getDashboardDrilldown({ anchorDateText, dateFromText, dateToText, category, level, style, page, pageSize }) {
  const safeCategory = toText(category);
  const safeLevel = normalizeDashboardDrilldownLevel(level);
  const safeStyle = toText(style);
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const range = await resolveDashboardRange({
    dateFromText,
    dateToText,
    anchorDateText,
    defaultSpanDays: 7,
  });
  const anchorDate = range.anchorDate;
  const dateFrom = range.dateFrom;
  const dateTo = range.dateTo;

  if (!dateFrom || !dateTo || !safeCategory || !safeLevel) {
    return buildDashboardDrilldownEmptyPayload({
      anchorDate,
      dateFrom,
      dateTo,
      category: safeCategory,
      level: safeLevel,
      style: safeStyle,
      page: safePage,
      pageSize: safePageSize,
    });
  }

  const cacheKey = makeDashboardDrilldownCacheKey({
    dateFrom,
    dateTo,
    category: safeCategory,
    level: safeLevel,
    style: safeLevel === "sku" ? safeStyle : "",
    page: safePage,
    pageSize: safePageSize,
  });
  const cached = getMapCache(DASHBOARD_DRILLDOWN_CACHE, cacheKey, DASHBOARD_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  return withSingleFlight(DASHBOARD_DRILLDOWN_IN_FLIGHT, cacheKey, async () => {
    const nextCached = getMapCache(DASHBOARD_DRILLDOWN_CACHE, cacheKey, DASHBOARD_CACHE_TTL_MS);
    if (nextCached) {
      return nextCached;
    }

    const pool = await getPool();
    const payload =
      safeLevel === "sku"
        ? await queryDashboardSkuDrilldown(pool, dateFrom, dateTo, safeCategory, safeStyle, safePage, safePageSize)
        : await queryDashboardStyleDrilldown(pool, dateFrom, dateTo, safeCategory, safePage, safePageSize);
    const response = {
      meta: {
        anchor_date: anchorDate,
        date_from: dateFrom,
        date_to: dateTo,
        category: safeCategory,
        level: safeLevel,
        style: safeLevel === "sku" ? safeStyle : "",
      },
      summary: payload.summary,
      items: payload.items,
      total: payload.summary.row_count,
      page: safePage,
      pageSize: safePageSize,
    };
    setMapCache(DASHBOARD_DRILLDOWN_CACHE, cacheKey, response);
    return response;
  });
}

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

function buildChannelDashboardInventoryExpr(option, inventoryAlias = "") {
  const prefix = inventoryAlias ? `${inventoryAlias}.` : "";
  const exclusiveInventorySql = option.inventoryQtyKey ? `coalesce(${prefix}${option.inventoryQtyKey}, 0)` : "0";
  return option.includeCategoryShared
    ? `${exclusiveInventorySql} + coalesce(${prefix}inv_huotong_qty, 0) + coalesce(${prefix}inv_shared_qty, 0) + coalesce(${prefix}inv_category_shared_qty, 0)`
    : `${exclusiveInventorySql} + coalesce(${prefix}inv_huotong_qty, 0) + coalesce(${prefix}inv_shared_qty, 0)`;
}

function buildChannelDashboardSql(option) {
  const availableInventorySql = buildChannelDashboardInventoryExpr(option);

  return `
    with
    product_master as (
      select
        ${DASHBOARD_STYLE_SQL.replace(/style/g, "src_product_master_current.style")} as style_label,
        max(nullif(trim(story_pack), '')) as story_pack
      from anta_daily.src_product_master_current
      group by 1
    ),
    sales_detail as (
      select
        ${DASHBOARD_CATEGORY_SQL} as category_label,
        ${DASHBOARD_STYLE_SQL} as style_label,
        ${DASHBOARD_SKU_SQL} as sku_label,
        coalesce(sum(
          coalesce(tag_price, 0) * coalesce(${option.salesQtyKey}, 0) *
          coalesce(nullif(${option.skuDiscountKey}, 0), nullif(${option.styleDiscountKey}, 0), 1)
        ), 0)::numeric as gmv,
        coalesce(sum(coalesce(${option.salesQtyKey}, 0)), 0)::numeric as qty,
        coalesce(sum(
          coalesce(${option.salesQtyKey}, 0) *
          coalesce(nullif(${option.skuDiscountKey}, 0), nullif(${option.styleDiscountKey}, 0), 1)
        ), 0)::numeric as discount_num
      from ${SALES_DAILY_TABLE}
      where sales_date between $1 and $2
        and ${SKU_FILTER_SQL}
        and coalesce(${option.salesQtyKey}, 0) <> 0
      group by 1, 2, 3
    ),
    sales_style as (
      select
        style_label as style,
        max(category_label) as category,
        coalesce(sum(gmv), 0)::numeric as gmv,
        coalesce(sum(qty), 0)::numeric as qty,
        coalesce(sum(discount_num), 0)::numeric as discount_num
      from sales_detail
      group by 1
    ),
    inventory_style as (
      select
        ${DASHBOARD_STYLE_SQL} as style_label,
        max(${DASHBOARD_CATEGORY_SQL}) as category_label,
        coalesce(sum(${availableInventorySql}), 0)::numeric as inventory_qty
      from ${INVENTORY_LATEST_TABLE}
      where ${SKU_FILTER_SQL}
      group by 1
    ),
    top_sku as (
      select
        style_label as style,
        sku_label as top_sku,
        row_number() over (partition by style_label order by qty desc, gmv desc, sku_label asc) as rn
      from sales_detail
    ),
    anchor_day as (
      select
        coalesce(sum(
          coalesce(${option.salesQtyKey}, 0) *
          coalesce(nullif(${option.skuDiscountKey}, 0), nullif(${option.styleDiscountKey}, 0), 1)
        ), 0)::numeric as discount_num,
        coalesce(sum(coalesce(${option.salesQtyKey}, 0)), 0)::numeric as qty
      from ${SALES_DAILY_TABLE}
      where sales_date = $2
        and ${SKU_FILTER_SQL}
        and coalesce(${option.salesQtyKey}, 0) <> 0
    )
    select
      s.style,
      s.category,
      coalesce(pm.story_pack, '') as story_pack,
      s.gmv,
      s.qty,
      coalesce(i.inventory_qty, 0)::numeric as inventory_qty,
      case when s.qty = 0 then 0 else s.discount_num / s.qty end as discount_rate,
      coalesce(t.top_sku, '${DASHBOARD_UNMARKED_SKU_LABEL}') as top_sku,
      case when ad.qty = 0 then 0 else ad.discount_num / ad.qty end as anchor_discount_rate
    from sales_style s
    left join inventory_style i on i.style_label = s.style
    left join product_master pm on pm.style_label = s.style
    left join top_sku t on t.style = s.style and t.rn = 1
    cross join anchor_day ad
    order by s.gmv desc, s.qty desc, s.style asc
  `;
}

function toMainColorText(skuText) {
  const sku = toText(skuText);
  if (!sku) {
    return "";
  }
  const parts = sku.split("-");
  return parts.length > 1 ? toText(parts[parts.length - 1]) : sku;
}

function toChannelDashboardItem(row, index, periodDays, inventorySupported) {
  const qty = toNumber(row?.qty);
  const inventoryQty = inventorySupported ? toNumber(row?.inventory_qty) : 0;
  const avgDailyQty = periodDays > 0 ? qty / periodDays : 0;
  const turnoverMonth = inventorySupported && avgDailyQty > 0 ? inventoryQty / (avgDailyQty * 30) : null;
  const topSku = toText(row?.top_sku) || DASHBOARD_UNMARKED_SKU_LABEL;
  return {
    rank: index + 1,
    style: toText(row?.style) || DASHBOARD_UNMARKED_STYLE_LABEL,
    category: toText(row?.category) || DASHBOARD_UNCATEGORIZED_LABEL,
    story_pack: toText(row?.story_pack),
    gmv: roundNumber(row?.gmv, 2),
    qty: roundNumber(qty, 2),
    inventory_qty: inventorySupported ? roundNumber(inventoryQty, 2) : null,
    discount_rate: roundNumber(row?.discount_rate, 6),
    turnover_month: turnoverMonth === null ? null : roundNumber(turnoverMonth, 6),
    top_sku: topSku,
    main_color: toMainColorText(topSku),
  };
}

function summarizeChannelDashboardRows(rows) {
  return (Array.isArray(rows) ? rows : []).reduce(
    (acc, row, index) => {
      const gmv = toNumber(row?.gmv);
      acc.gmv += gmv;
      acc.qty += toNumber(row?.qty);
      acc.inventory_qty += toNumber(row?.inventory_qty);
      acc.row_count += 1;
      if (index < 20) {
        acc.top20_gmv += gmv;
      }
      return acc;
    },
    { gmv: 0, qty: 0, inventory_qty: 0, row_count: 0, top20_gmv: 0 }
  );
}

function buildChannelDashboardPanel(option, channelRows, periodDays) {
  const summary = summarizeChannelDashboardRows(channelRows);
  return {
    code: option.code,
    label: option.label,
    inventory_supported: true,
    summary: {
      gmv: roundNumber(summary.gmv, 2),
      qty: roundNumber(summary.qty, 2),
      inventory_qty: roundNumber(summary.inventory_qty, 2),
      row_count: summary.row_count,
      top20_gmv_share: summary.gmv > 0 ? roundNumber(summary.top20_gmv / summary.gmv, 6) : 0,
      anchor_discount_rate: roundNumber(channelRows[0]?.anchor_discount_rate, 6),
    },
    items: channelRows.slice(0, 20).map((row, index) => toChannelDashboardItem(row, index, periodDays, true)),
  };
}

function buildChannelDashboardPanels(options, rows, periodDays) {
  return (Array.isArray(options) ? options : []).map((option) => {
    const channelRows = (Array.isArray(rows) ? rows : []).filter((row) => String(row.channel_code || "") === option.code);
    return buildChannelDashboardPanel(option, channelRows, periodDays);
  });
}

function buildChannelDashboardCombinedSql(options) {
  const uniqueKeys = (keys) => [...new Set(keys.filter(Boolean))];
  const salesQtyKeys = uniqueKeys(options.map((item) => item.salesQtyKey));
  const skuDiscountKeys = uniqueKeys(options.map((item) => item.skuDiscountKey));
  const styleDiscountKeys = uniqueKeys(options.map((item) => item.styleDiscountKey));
  const inventoryQtyKeys = uniqueKeys(options.map((item) => item.inventoryQtyKey));

  const salesBaseColumns = [
    ...salesQtyKeys.map((key) => `coalesce(${key}, 0)::numeric as ${key}`),
    ...skuDiscountKeys.map((key) => `coalesce(${key}, 0)::numeric as ${key}`),
    ...styleDiscountKeys.map((key) => `coalesce(${key}, 0)::numeric as ${key}`),
  ].join(",\n        ");

  const inventoryBaseColumns = [
    "coalesce(sum(coalesce(inv_huotong_qty, 0)), 0)::numeric as inv_huotong_qty",
    "coalesce(sum(coalesce(inv_shared_qty, 0)), 0)::numeric as inv_shared_qty",
    "coalesce(sum(coalesce(inv_category_shared_qty, 0)), 0)::numeric as inv_category_shared_qty",
    ...inventoryQtyKeys.map((key) => `coalesce(sum(coalesce(${key}, 0)), 0)::numeric as ${key}`),
  ].join(",\n        ");

  const salesFilterSql = salesQtyKeys.map((key) => `coalesce(${key}, 0) <> 0`).join(" or ");

  const channelCtes = options
    .map((option) => {
      const inventoryExpr = buildChannelDashboardInventoryExpr(option, "i");
      return `
    ${option.code}_sales_detail as (
      select
        category_label,
        style_label,
        sku_label,
        coalesce(sum(
          tag_price * ${option.salesQtyKey} *
          coalesce(nullif(${option.skuDiscountKey}, 0), nullif(${option.styleDiscountKey}, 0), 1)
        ), 0)::numeric as gmv,
        coalesce(sum(${option.salesQtyKey}), 0)::numeric as qty,
        coalesce(sum(
          ${option.salesQtyKey} *
          coalesce(nullif(${option.skuDiscountKey}, 0), nullif(${option.styleDiscountKey}, 0), 1)
        ), 0)::numeric as discount_num
      from sales_base
      where ${option.salesQtyKey} <> 0
      group by 1, 2, 3
    ),
    ${option.code}_sales_style as (
      select
        style_label as style,
        max(category_label) as category,
        coalesce(sum(gmv), 0)::numeric as gmv,
        coalesce(sum(qty), 0)::numeric as qty,
        coalesce(sum(discount_num), 0)::numeric as discount_num
      from ${option.code}_sales_detail
      group by 1
    ),
    ${option.code}_top_sku as (
      select
        style_label as style,
        sku_label as top_sku,
        row_number() over (partition by style_label order by qty desc, gmv desc, sku_label asc) as rn
      from ${option.code}_sales_detail
    ),
    ${option.code}_anchor_day as (
      select
        coalesce(sum(
          ${option.salesQtyKey} *
          coalesce(nullif(${option.skuDiscountKey}, 0), nullif(${option.styleDiscountKey}, 0), 1)
        ), 0)::numeric as discount_num,
        coalesce(sum(${option.salesQtyKey}), 0)::numeric as qty
      from sales_base
      where sales_date = $2
        and ${option.salesQtyKey} <> 0
    ),
    ${option.code}_result as (
      select
        '${option.code}'::text as channel_code,
        '${option.label}'::text as channel_label,
        s.style,
        s.category,
        coalesce(pm.story_pack, '') as story_pack,
        s.gmv,
        s.qty,
        (${inventoryExpr})::numeric as inventory_qty,
        case when s.qty = 0 then 0 else s.discount_num / s.qty end as discount_rate,
        coalesce(t.top_sku, '${DASHBOARD_UNMARKED_SKU_LABEL}') as top_sku,
        case when ad.qty = 0 then 0 else ad.discount_num / ad.qty end as anchor_discount_rate
      from ${option.code}_sales_style s
      left join inventory_base i on i.style_label = s.style
      left join product_master pm on pm.style_label = s.style
      left join ${option.code}_top_sku t on t.style = s.style and t.rn = 1
      cross join ${option.code}_anchor_day ad
    )
`;
    })
    .join(",\n");

  const unionSql = options.map((option) => `select * from ${option.code}_result`).join("\n      union all\n      ");

  return `
    with
    product_master as (
      select
        ${DASHBOARD_STYLE_SQL.replace(/style/g, "src_product_master_current.style")} as style_label,
        max(nullif(trim(story_pack), '')) as story_pack
      from anta_daily.src_product_master_current
      group by 1
    ),
    sales_base as (
      select
        sales_date,
        ${DASHBOARD_CATEGORY_SQL} as category_label,
        ${DASHBOARD_STYLE_SQL} as style_label,
        ${DASHBOARD_SKU_SQL} as sku_label,
        coalesce(tag_price, 0)::numeric as tag_price,
        ${salesBaseColumns}
      from ${SALES_DAILY_TABLE}
      where sales_date between $1 and $2
        and ${SKU_FILTER_SQL}
        and (${salesFilterSql})
    ),
    inventory_base as (
      select
        ${DASHBOARD_STYLE_SQL} as style_label,
        ${inventoryBaseColumns}
      from ${INVENTORY_LATEST_TABLE}
      where ${SKU_FILTER_SQL}
      group by 1
    ),
${channelCtes}
    select *
    from (
      ${unionSql}
    ) merged
    order by channel_code asc, gmv desc, qty desc, style asc
  `;
}

function buildChannelDashboardStyleDrilldownBaseSql(option, styleParamIndex) {
  const inventoryExpr = buildChannelDashboardInventoryExpr(option);
  const styleFilterSql = styleParamIndex ? `and ${DASHBOARD_STYLE_SQL} = $${styleParamIndex}` : "";
  return `
    with
    product_master as (
      select
        ${DASHBOARD_STYLE_SQL.replace(/style/g, "src_product_master_current.style")} as style_label,
        max(nullif(trim(story_pack), '')) as story_pack
      from anta_daily.src_product_master_current
      group by 1
    ),
    sales_sku as (
      select
        ${DASHBOARD_CATEGORY_SQL} as category_label,
        ${DASHBOARD_STYLE_SQL} as style_label,
        ${DASHBOARD_SKU_SQL} as sku_label,
        max(nullif(trim(product_name), '')) as product_name,
        max(coalesce(tag_price, 0))::numeric as tag_price,
        coalesce(sum(
          coalesce(tag_price, 0) * coalesce(${option.salesQtyKey}, 0) *
          coalesce(nullif(${option.skuDiscountKey}, 0), nullif(${option.styleDiscountKey}, 0), 1)
        ), 0)::numeric as gmv,
        coalesce(sum(coalesce(${option.salesQtyKey}, 0)), 0)::numeric as qty,
        coalesce(sum(
          coalesce(${option.salesQtyKey}, 0) *
          coalesce(nullif(${option.skuDiscountKey}, 0), nullif(${option.styleDiscountKey}, 0), 1)
        ), 0)::numeric as discount_num
      from ${SALES_DAILY_TABLE}
      where sales_date between $1 and $2
        and ${SKU_FILTER_SQL}
        and coalesce(${option.salesQtyKey}, 0) <> 0
        ${styleFilterSql}
      group by 1, 2, 3
    ),
    inventory_sku as (
      select
        max(${DASHBOARD_CATEGORY_SQL}) as category_label,
        ${DASHBOARD_STYLE_SQL} as style_label,
        ${DASHBOARD_SKU_SQL} as sku_label,
        max(nullif(trim(product_name), '')) as product_name,
        max(coalesce(tag_price, 0))::numeric as tag_price,
        coalesce(sum(${inventoryExpr}), 0)::numeric as inventory_qty
      from ${INVENTORY_LATEST_TABLE}
      where ${SKU_FILTER_SQL}
        ${styleFilterSql}
      group by 2, 3
    ),
    joined as (
      select
        coalesce(s.category_label, i.category_label, '${DASHBOARD_UNCATEGORIZED_LABEL}') as category_label,
        coalesce(s.style_label, i.style_label, '${DASHBOARD_UNMARKED_STYLE_LABEL}') as style_label,
        coalesce(s.sku_label, i.sku_label, '${DASHBOARD_UNMARKED_SKU_LABEL}') as sku_label,
        coalesce(s.product_name, i.product_name, '') as product_name,
        coalesce(s.tag_price, i.tag_price, 0)::numeric as tag_price,
        coalesce(s.gmv, 0)::numeric as gmv,
        coalesce(s.qty, 0)::numeric as qty,
        coalesce(s.discount_num, 0)::numeric as discount_num,
        coalesce(i.inventory_qty, 0)::numeric as inventory_qty
      from sales_sku s
      full outer join inventory_sku i
        on i.style_label = s.style_label
       and i.sku_label = s.sku_label
    )
  `;
}

function buildChannelDashboardStyleDrilldownEmptyPayload({
  anchorDate,
  dateFrom,
  dateTo,
  channelCode,
  channelLabel,
  style,
}) {
  return {
    meta: {
      anchor_date: anchorDate,
      date_from: dateFrom,
      date_to: dateTo,
      channel: channelCode,
      channel_label: channelLabel,
      style: style || "",
    },
    style_summary: {
      style: style || DASHBOARD_UNMARKED_STYLE_LABEL,
      category: DASHBOARD_UNCATEGORIZED_LABEL,
      story_pack: "",
      gmv: 0,
      qty: 0,
      inventory_qty: 0,
      discount_rate: 0,
      sell_through: 0,
      turnover_month: null,
      sku_count: 0,
      top_sku: DASHBOARD_UNMARKED_SKU_LABEL,
      top_sku_gmv_share: 0,
      top_sku_qty_share: 0,
    },
    items: [],
  };
}

function toChannelDashboardStyleSummary(row, periodDays) {
  const qty = toNumber(row?.qty);
  const inventoryQty = toNumber(row?.inventory_qty);
  const avgDailyQty = periodDays > 0 ? qty / periodDays : 0;
  const turnoverMonth = inventoryQty > 0 && avgDailyQty > 0 ? inventoryQty / (avgDailyQty * 30) : null;
  const gmv = toNumber(row?.gmv);
  const topSkuGmv = toNumber(row?.top_sku_gmv);
  const topSkuQty = toNumber(row?.top_sku_qty);
  return {
    style: toText(row?.style) || DASHBOARD_UNMARKED_STYLE_LABEL,
    category: toText(row?.category) || DASHBOARD_UNCATEGORIZED_LABEL,
    story_pack: toText(row?.story_pack),
    gmv: roundNumber(gmv, 2),
    qty: roundNumber(qty, 2),
    inventory_qty: roundNumber(inventoryQty, 2),
    discount_rate: roundNumber(row?.discount_rate, 6),
    sell_through: inventoryQty > 0 ? roundNumber(qty / inventoryQty, 6) : 0,
    turnover_month: turnoverMonth === null ? null : roundNumber(turnoverMonth, 6),
    sku_count: Math.max(0, Math.round(toNumber(row?.sku_count))),
    top_sku: toText(row?.top_sku) || DASHBOARD_UNMARKED_SKU_LABEL,
    top_sku_gmv_share: gmv > 0 ? roundNumber(topSkuGmv / gmv, 6) : 0,
    top_sku_qty_share: qty > 0 ? roundNumber(topSkuQty / qty, 6) : 0,
  };
}

function toChannelDashboardStyleDrilldownItem(row, summary) {
  const qty = toNumber(row?.qty);
  const inventoryQty = toNumber(row?.inventory_qty);
  const summaryGmv = toNumber(summary?.gmv);
  const summaryQty = toNumber(summary?.qty);
  const gmv = toNumber(row?.gmv);
  return {
    style: toText(row?.style) || DASHBOARD_UNMARKED_STYLE_LABEL,
    sku: toText(row?.sku) || DASHBOARD_UNMARKED_SKU_LABEL,
    product_name: toText(row?.product_name),
    tag_price: roundNumber(row?.tag_price, 2),
    gmv: roundNumber(gmv, 2),
    gmv_share_pct: summaryGmv > 0 ? roundNumber(gmv / summaryGmv, 6) : 0,
    qty: roundNumber(qty, 2),
    qty_share_pct: summaryQty > 0 ? roundNumber(qty / summaryQty, 6) : 0,
    inventory_qty: roundNumber(inventoryQty, 2),
    discount_rate: roundNumber(row?.discount_rate, 6),
    sell_through: inventoryQty > 0 ? roundNumber(qty / inventoryQty, 6) : 0,
  };
}

async function getChannelDashboardStyleDrilldown({
  anchorDateText,
  dateFromText,
  dateToText,
  channelCode,
  style,
}) {
  const safeChannelCode = toText(channelCode).toLowerCase();
  const safeStyle = toText(style);
  const option = CHANNEL_DASHBOARD_OPTION_MAP.get(safeChannelCode);
  const range = await resolveDashboardRange({
    dateFromText,
    dateToText,
    anchorDateText,
    defaultSpanDays: 7,
  });
  const anchorDate = range.anchorDate;
  const dateFrom = range.dateFrom;
  const dateTo = range.dateTo;

  if (!dateFrom || !dateTo || !option || !safeStyle) {
    return buildChannelDashboardStyleDrilldownEmptyPayload({
      anchorDate,
      dateFrom,
      dateTo,
      channelCode: option?.code || safeChannelCode,
      channelLabel: option?.label || safeChannelCode,
      style: safeStyle,
    });
  }

  const pool = await getPool();
  const periodDays = Math.max(1, daysBetweenInclusive(dateFrom, dateTo));
  const baseSql = buildChannelDashboardStyleDrilldownBaseSql(option, 3);
  const [summaryResult, rowsResult] = await Promise.all([
    timedQuery(
      pool,
      `
        ${baseSql}
        select
          coalesce((select max(category_label) from joined), '${DASHBOARD_UNCATEGORIZED_LABEL}') as category,
          $3::text as style,
          coalesce((select max(story_pack) from product_master where style_label = $3), '') as story_pack,
          coalesce((select sum(gmv) from joined), 0)::numeric as gmv,
          coalesce((select sum(qty) from joined), 0)::numeric as qty,
          coalesce((select sum(inventory_qty) from joined), 0)::numeric as inventory_qty,
          case
            when coalesce((select sum(qty) from joined), 0) = 0
              then 0
            else coalesce((select sum(discount_num) from joined), 0) / nullif((select sum(qty) from joined), 0)
          end as discount_rate,
          coalesce((select count(*) from joined), 0)::integer as sku_count,
          coalesce((select sku_label from joined order by gmv desc, qty desc, sku_label asc limit 1), '${DASHBOARD_UNMARKED_SKU_LABEL}') as top_sku,
          coalesce((select gmv from joined order by gmv desc, qty desc, sku_label asc limit 1), 0)::numeric as top_sku_gmv,
          coalesce((select qty from joined order by gmv desc, qty desc, sku_label asc limit 1), 0)::numeric as top_sku_qty
      `,
      [dateFrom, dateTo, safeStyle],
      `getChannelDashboardStyleDrilldown.summary.${option.code}`
    ),
    timedQuery(
      pool,
      `
        ${baseSql}
        select
          style_label as style,
          sku_label as sku,
          product_name,
          tag_price,
          gmv,
          qty,
          inventory_qty,
          case when qty = 0 then 0 else discount_num / qty end as discount_rate
        from joined
        order by gmv desc, qty desc, sku asc
      `,
      [dateFrom, dateTo, safeStyle],
      `getChannelDashboardStyleDrilldown.rows.${option.code}`
    ),
  ]);

  const styleSummary = toChannelDashboardStyleSummary(summaryResult.rows[0], periodDays);
  return {
    meta: {
      anchor_date: anchorDate,
      date_from: dateFrom,
      date_to: dateTo,
      channel: option.code,
      channel_label: option.label,
      style: safeStyle,
    },
    style_summary: styleSummary,
    items: (rowsResult.rows || []).map((row) => toChannelDashboardStyleDrilldownItem(row, styleSummary)),
  };
}

async function queryChannelDashboardPanel(pool, dateFrom, dateTo, option) {
  const periodDays = Math.max(1, daysBetweenInclusive(dateFrom, dateTo));
  const result = await timedQuery(
    pool,
    buildChannelDashboardSql(option),
    [dateFrom, dateTo],
    `queryChannelDashboardPanel.${option.code}`
  );
  const rows = Array.isArray(result.rows) ? result.rows : [];
  return buildChannelDashboardPanel(option, rows, periodDays);
}

async function getChannelDashboard({
  anchorDateText,
  dateFromText,
  dateToText,
  channelCodesText,
  comparisonDateFromText,
  comparisonDateToText,
}) {
  const range = await resolveDashboardRange({
    dateFromText,
    dateToText,
    anchorDateText,
    defaultSpanDays: 7,
  });
  const comparisonRange = await resolveOptionalDashboardRange({
    dateFromText: comparisonDateFromText,
    dateToText: comparisonDateToText,
  });
  const anchorDate = range.anchorDate;
  const anchorDates = range.salesDates;
  const dateFrom = range.dateFrom;
  const dateTo = range.dateTo;
  const comparisonDateFrom = comparisonRange.dateFrom;
  const comparisonDateTo = comparisonRange.dateTo;
  const selectedChannelCodes = normalizeChannelDashboardCodes(channelCodesText);
  const availableChannels = getChannelDashboardAvailableChannels();

  if (!dateFrom || !dateTo) {
    return {
      sales_dates: anchorDates || [],
      anchor_dates: anchorDates || [],
      anchor_date: anchorDate,
      date_from: dateFrom,
      date_to: dateTo,
      comparison_date_from: comparisonDateFrom,
      comparison_date_to: comparisonDateTo,
      available_channels: availableChannels,
      selected_channels: selectedChannelCodes,
      channels: [],
    };
  }

  const cached = getChannelDashboardCache(dateFrom, dateTo, selectedChannelCodes, comparisonDateFrom, comparisonDateTo);
  if (cached) {
    return {
      sales_dates: anchorDates || [],
      anchor_dates: anchorDates || [],
      ...cached,
    };
  }

  const pool = await getPool();
  const selectedOptions = selectedChannelCodes
    .map((code) => CHANNEL_DASHBOARD_OPTION_MAP.get(code))
    .filter(Boolean);
  if (!selectedOptions.length) {
    const payload = {
      anchor_date: anchorDate,
      date_from: dateFrom,
      date_to: dateTo,
      comparison_date_from: comparisonDateFrom,
      comparison_date_to: comparisonDateTo,
      available_channels: availableChannels,
      selected_channels: selectedChannelCodes,
      channels: [],
    };
    setChannelDashboardCache(dateFrom, dateTo, selectedChannelCodes, comparisonDateFrom, comparisonDateTo, payload);
    return {
      sales_dates: anchorDates || [],
      anchor_dates: anchorDates || [],
      ...payload,
    };
  }
  const combinedSql = buildChannelDashboardCombinedSql(selectedOptions);
  const periodDays = Math.max(1, daysBetweenInclusive(dateFrom, dateTo));
  const comparisonPeriodDays = comparisonDateFrom && comparisonDateTo ? comparisonRange.periodDays : 0;
  const [currentResult, comparisonResult] = await Promise.all([
    timedQuery(pool, combinedSql, [dateFrom, dateTo], "getChannelDashboard.current"),
    comparisonDateFrom && comparisonDateTo
      ? timedQuery(pool, combinedSql, [comparisonDateFrom, comparisonDateTo], "getChannelDashboard.comparison")
      : Promise.resolve({ rows: [] }),
  ]);
  const currentPanels = buildChannelDashboardPanels(selectedOptions, currentResult.rows, periodDays);
  const comparisonPanels = comparisonDateFrom && comparisonDateTo
    ? buildChannelDashboardPanels(selectedOptions, comparisonResult.rows, comparisonPeriodDays)
    : [];
  const comparisonPanelMap = new Map(comparisonPanels.map((panel) => [panel.code, panel]));
  const channels = currentPanels.map((panel) => {
    const comparisonPanel = comparisonPanelMap.get(panel.code);
    return {
      ...panel,
      comparison_summary: comparisonPanel ? comparisonPanel.summary : null,
      comparison_items: comparisonPanel ? comparisonPanel.items : [],
    };
  });

  const payload = {
    anchor_date: anchorDate,
    date_from: dateFrom,
    date_to: dateTo,
    comparison_date_from: comparisonDateFrom,
    comparison_date_to: comparisonDateTo,
    available_channels: availableChannels,
    selected_channels: selectedChannelCodes,
    channels,
  };
  setChannelDashboardCache(dateFrom, dateTo, selectedChannelCodes, comparisonDateFrom, comparisonDateTo, payload);
  return {
    sales_dates: anchorDates || [],
    anchor_dates: anchorDates || [],
    ...payload,
  };
}

function normalizeDashboardCompareChange(current, previous) {
  const change = percentChange(current, previous);
  return change === null ? null : roundNumber(change, 6);
}

function computePiecePrice(gmv, qty) {
  const safeQty = toNumber(qty);
  if (safeQty <= 0) {
    return null;
  }
  return toNumber(gmv) / safeQty;
}

function getDashboardCompareLabelFallback(dimensionKey) {
  if (dimensionKey === "season") {
    return DASHBOARD_UNMARKED_SEASON_LABEL;
  }
  if (dimensionKey === "major_category") {
    return DASHBOARD_UNMARKED_MAJOR_CATEGORY_LABEL;
  }
  return DASHBOARD_UNCATEGORIZED_LABEL;
}

function makeDashboardCompareCacheKey(range, selectedChannelCodes) {
  return `${range.dateFrom}|${range.dateTo}|${range.comparisonFrom}|${range.comparisonTo}|${(selectedChannelCodes || []).join(",")}`;
}

function buildDashboardCompareDimensionSql(option, dimensionKey) {
  const gmvExpr = `
        coalesce(sum(
          coalesce(tag_price, 0) * coalesce(${option.salesQtyKey}, 0) *
          coalesce(nullif(${option.skuDiscountKey}, 0), nullif(${option.styleDiscountKey}, 0), 1)
        ), 0)::numeric
  `;
  const qtyExpr = `coalesce(sum(coalesce(${option.salesQtyKey}, 0)), 0)::numeric`;

  if (dimensionKey === "category") {
    return `
      with current_period as (
        select
          ${DASHBOARD_MAJOR_CATEGORY_SQL} as major_label,
          ${DASHBOARD_CATEGORY_SQL} as dimension_label,
          ${gmvExpr} as gmv_current,
          ${qtyExpr} as qty_current
        from ${SALES_DAILY_TABLE}
        where sales_date between $1 and $2
          and ${SKU_FILTER_SQL}
          and coalesce(${option.salesQtyKey}, 0) <> 0
        group by 1, 2
      ),
      previous_period as (
        select
          ${DASHBOARD_MAJOR_CATEGORY_SQL} as major_label,
          ${DASHBOARD_CATEGORY_SQL} as dimension_label,
          ${gmvExpr} as gmv_prev,
          ${qtyExpr} as qty_prev
        from ${SALES_DAILY_TABLE}
        where sales_date between $3 and $4
          and ${SKU_FILTER_SQL}
          and coalesce(${option.salesQtyKey}, 0) <> 0
        group by 1, 2
      )
      select
        coalesce(c.major_label, p.major_label) as major_label,
        coalesce(c.dimension_label, p.dimension_label) as dimension_label,
        coalesce(c.gmv_current, 0)::numeric as gmv_current,
        coalesce(c.qty_current, 0)::numeric as qty_current,
        coalesce(p.gmv_prev, 0)::numeric as gmv_prev,
        coalesce(p.qty_prev, 0)::numeric as qty_prev
      from current_period c
      full outer join previous_period p
        on p.major_label = c.major_label
       and p.dimension_label = c.dimension_label
      order by
        coalesce(c.gmv_current, 0) desc,
        coalesce(c.qty_current, 0) desc,
        coalesce(c.major_label, p.major_label) asc,
        coalesce(c.dimension_label, p.dimension_label) asc
    `;
  }

  const labelSql =
    dimensionKey === "season" ? `${DASHBOARD_SEASON_SQL} as dimension_label` : `${DASHBOARD_MAJOR_CATEGORY_SQL} as dimension_label`;

  return `
    with current_period as (
      select
        ${labelSql},
        ${gmvExpr} as gmv_current,
        ${qtyExpr} as qty_current
      from ${SALES_DAILY_TABLE}
      where sales_date between $1 and $2
        and ${SKU_FILTER_SQL}
        and coalesce(${option.salesQtyKey}, 0) <> 0
      group by 1
    ),
    previous_period as (
      select
        ${labelSql},
        ${gmvExpr} as gmv_prev,
        ${qtyExpr} as qty_prev
      from ${SALES_DAILY_TABLE}
      where sales_date between $3 and $4
        and ${SKU_FILTER_SQL}
        and coalesce(${option.salesQtyKey}, 0) <> 0
      group by 1
    )
    select
      ''::text as major_label,
      coalesce(c.dimension_label, p.dimension_label) as dimension_label,
      coalesce(c.gmv_current, 0)::numeric as gmv_current,
      coalesce(c.qty_current, 0)::numeric as qty_current,
      coalesce(p.gmv_prev, 0)::numeric as gmv_prev,
      coalesce(p.qty_prev, 0)::numeric as qty_prev
    from current_period c
    full outer join previous_period p
      on p.dimension_label = c.dimension_label
    order by
      coalesce(c.gmv_current, 0) desc,
      coalesce(c.qty_current, 0) desc,
      coalesce(c.dimension_label, p.dimension_label) asc
  `;
}

function toDashboardCompareSummary(rows) {
  const totals = (Array.isArray(rows) ? rows : []).reduce(
    (acc, row) => {
      acc.gmv += toNumber(row?.gmv_current);
      acc.qty += toNumber(row?.qty_current);
      acc.gmv_prev += toNumber(row?.gmv_prev);
      acc.qty_prev += toNumber(row?.qty_prev);
      return acc;
    },
    { gmv: 0, qty: 0, gmv_prev: 0, qty_prev: 0 }
  );

  const piecePrice = computePiecePrice(totals.gmv, totals.qty);
  const piecePricePrev = computePiecePrice(totals.gmv_prev, totals.qty_prev);
  return {
    gmv: roundNumber(totals.gmv, 2),
    qty: roundNumber(totals.qty, 2),
    piece_price: piecePrice === null ? null : roundNumber(piecePrice, 2),
    gmv_week_pct: normalizeDashboardCompareChange(totals.gmv, totals.gmv_prev),
    qty_week_pct: normalizeDashboardCompareChange(totals.qty, totals.qty_prev),
    piece_price_week_pct: normalizeDashboardCompareChange(piecePrice, piecePricePrev),
  };
}

function toDashboardCompareRows(rows, dimensionKey) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const totalGmv = safeRows.reduce((sum, row) => sum + toNumber(row?.gmv_current), 0);
  const totalQty = safeRows.reduce((sum, row) => sum + toNumber(row?.qty_current), 0);
  const fallbackLabel = getDashboardCompareLabelFallback(dimensionKey);

  return safeRows
    .map((row) => {
      const gmv = toNumber(row?.gmv_current);
      const qty = toNumber(row?.qty_current);
      const gmvPrev = toNumber(row?.gmv_prev);
      const qtyPrev = toNumber(row?.qty_prev);
      const piecePrice = computePiecePrice(gmv, qty);
      const piecePricePrev = computePiecePrice(gmvPrev, qtyPrev);
      const majorCategory =
        dimensionKey === "category" ? toText(row?.major_label) || DASHBOARD_UNMARKED_MAJOR_CATEGORY_LABEL : "";
      const label = toText(row?.dimension_label) || fallbackLabel;
      return {
        key: dimensionKey === "category" ? `${majorCategory}__${label}` : label,
        label,
        major_category: majorCategory,
        gmv_share_pct: totalGmv > 0 ? roundNumber(gmv / totalGmv, 6) : 0,
        qty_share_pct: totalQty > 0 ? roundNumber(qty / totalQty, 6) : 0,
        piece_price: piecePrice === null ? null : roundNumber(piecePrice, 2),
        gmv_week_pct: normalizeDashboardCompareChange(gmv, gmvPrev),
        qty_week_pct: normalizeDashboardCompareChange(qty, qtyPrev),
        piece_price_week_pct: normalizeDashboardCompareChange(piecePrice, piecePricePrev),
      };
    })
    .sort((left, right) => {
      const shareDiff = toNumber(right.gmv_share_pct) - toNumber(left.gmv_share_pct);
      if (Math.abs(shareDiff) > 1e-9) {
        return shareDiff;
      }
      const qtyDiff = toNumber(right.qty_share_pct) - toNumber(left.qty_share_pct);
      if (Math.abs(qtyDiff) > 1e-9) {
        return qtyDiff;
      }
      if (dimensionKey === "category") {
        const majorDiff = String(left.major_category || "").localeCompare(String(right.major_category || ""), "zh-CN");
        if (majorDiff !== 0) {
          return majorDiff;
        }
      }
      return String(left.label || "").localeCompare(String(right.label || ""), "zh-CN");
    });
}

async function queryDashboardCompareSection(pool, range, option, dimensionKey) {
  const result = await timedQuery(
    pool,
    buildDashboardCompareDimensionSql(option, dimensionKey),
    [range.dateFrom, range.dateTo, range.comparisonFrom, range.comparisonTo],
    `queryDashboardCompareSection.${option.code}.${dimensionKey}`
  );
  const rows = Array.isArray(result.rows) ? result.rows : [];
  return {
    summary: toDashboardCompareSummary(rows),
    items: toDashboardCompareRows(rows, dimensionKey),
  };
}

async function buildDashboardCompareChannel(pool, range, option) {
  const [season, majorCategory, category] = await Promise.all([
    queryDashboardCompareSection(pool, range, option, "season"),
    queryDashboardCompareSection(pool, range, option, "major_category"),
    queryDashboardCompareSection(pool, range, option, "category"),
  ]);

  return {
    code: option.code,
    label: option.label,
    summary: season.summary,
    sections: {
      season: season.items,
      major_category: majorCategory.items,
      category: category.items,
    },
  };
}

async function getDashboardChannelCompare({ dateFromText, dateToText, channelCodesText }) {
  const range = await resolveDashboardCompareRange(dateFromText, dateToText);
  const availableChannels = getChannelDashboardAvailableChannels();
  const selectedChannelCodes = normalizeDashboardCompareCodes(channelCodesText);

  if (!range.dateFrom || !range.dateTo) {
    return {
      sales_dates: Array.isArray(range.salesDates) ? range.salesDates : [],
      date_from: range.dateFrom,
      date_to: range.dateTo,
      comparison_from: range.comparisonFrom,
      comparison_to: range.comparisonTo,
      available_channels: availableChannels,
      selected_channels: selectedChannelCodes,
      channels: [],
    };
  }

  const cacheKey = makeDashboardCompareCacheKey(range, selectedChannelCodes);
  const cached = getMapCache(DASHBOARD_COMPARE_CACHE, cacheKey, DASHBOARD_CACHE_TTL_MS);
  if (cached) {
    return cached;
  }

  return withSingleFlight(DASHBOARD_COMPARE_IN_FLIGHT, cacheKey, async () => {
    const nextCached = getMapCache(DASHBOARD_COMPARE_CACHE, cacheKey, DASHBOARD_CACHE_TTL_MS);
    if (nextCached) {
      return nextCached;
    }

    const pool = await getPool();
    const selectedOptions = selectedChannelCodes
      .map((code) => CHANNEL_DASHBOARD_OPTION_MAP.get(code))
      .filter(Boolean);
    const channels = await Promise.all(selectedOptions.map((option) => buildDashboardCompareChannel(pool, range, option)));
    const payload = {
      sales_dates: Array.isArray(range.salesDates) ? range.salesDates : [],
      date_from: range.dateFrom,
      date_to: range.dateTo,
      comparison_from: range.comparisonFrom,
      comparison_to: range.comparisonTo,
      available_channels: availableChannels,
      selected_channels: selectedChannelCodes,
      channels,
    };
    setMapCache(DASHBOARD_COMPARE_CACHE, cacheKey, payload);
    return payload;
  });
}

async function queryDashboardOverviewMetrics(pool, dateFrom, dateTo, comparisonFrom, comparisonTo) {
  const result = await timedQuery(
    pool,
    `
      with inventory as (
        select coalesce(sum(inventory_total_qty), 0)::numeric as inventory_qty
        from ${INVENTORY_LATEST_TABLE}
        where ${SKU_FILTER_SQL}
      ),
      sales as (
        select
          coalesce(sum(${DASHBOARD_SALES_AMOUNT_EXPR}) filter (where sales_date between $1 and $2), 0)::numeric as current_gmv,
          coalesce(sum(${DASHBOARD_NET_QTY_EXPR}) filter (where sales_date between $1 and $2), 0)::numeric as current_qty,
          coalesce(sum(${DASHBOARD_SALES_AMOUNT_EXPR}) filter (where sales_date between $1 and $2), 0)::numeric as current_discount_num,
          coalesce(sum(${DASHBOARD_TAG_AMOUNT_EXPR}) filter (where sales_date between $1 and $2), 0)::numeric as current_discount_den,
          coalesce(sum(${DASHBOARD_SALES_AMOUNT_EXPR}) filter (where sales_date between $3 and $4), 0)::numeric as previous_gmv,
          coalesce(sum(${DASHBOARD_NET_QTY_EXPR}) filter (where sales_date between $3 and $4), 0)::numeric as previous_qty,
          coalesce(sum(${DASHBOARD_SALES_AMOUNT_EXPR}) filter (where sales_date between $3 and $4), 0)::numeric as previous_discount_num,
          coalesce(sum(${DASHBOARD_TAG_AMOUNT_EXPR}) filter (where sales_date between $3 and $4), 0)::numeric as previous_discount_den
        from ${SALES_DAILY_TABLE}
        where sales_date between $3 and $2
          and ${SKU_FILTER_SQL}
      )
      select *
      from sales
      cross join inventory
    `,
    [dateFrom, dateTo, comparisonFrom, comparisonTo],
    "queryDashboardOverviewMetrics"
  );

  const row = result.rows[0] || {};
  const inventoryQty = toNumber(row.inventory_qty);
  const currentQty = toNumber(row.current_qty);
  const previousQty = toNumber(row.previous_qty);
  const currentDiscountDen = toNumber(row.current_discount_den);
  const previousDiscountDen = toNumber(row.previous_discount_den);

  return {
    current: {
      gmv: toNumber(row.current_gmv),
      qty: currentQty,
      discount_rate: currentDiscountDen !== 0 ? toNumber(row.current_discount_num) / currentDiscountDen : 0,
      sell_through: inventoryQty > 0 ? currentQty / inventoryQty : 0,
    },
    previous: {
      gmv: toNumber(row.previous_gmv),
      qty: previousQty,
      discount_rate: previousDiscountDen !== 0 ? toNumber(row.previous_discount_num) / previousDiscountDen : 0,
      sell_through: inventoryQty > 0 ? previousQty / inventoryQty : 0,
    },
  };
}

async function queryDashboardDailyTrend(pool, dateFrom, dateTo) {
  const result = await timedQuery(
    pool,
    `
      with days as (
        select generate_series($1::date, $2::date, interval '1 day')::date as sales_date
      ),
      sales as (
        select
          sales_date,
          coalesce(sum(${DASHBOARD_SALES_AMOUNT_EXPR}), 0)::numeric as gmv,
          coalesce(sum(${DASHBOARD_NET_QTY_EXPR}), 0)::numeric as qty
        from ${SALES_DAILY_TABLE}
        where sales_date between $1 and $2
          and ${SKU_FILTER_SQL}
        group by sales_date
      )
      select
        to_char(days.sales_date, 'YYYY-MM-DD') as date,
        coalesce(sales.gmv, 0)::numeric as gmv,
        coalesce(sales.qty, 0)::numeric as qty
      from days
      left join sales on sales.sales_date = days.sales_date
      order by days.sales_date
    `,
    [dateFrom, dateTo],
    "queryDashboardDailyTrend"
  );

  return (result.rows || []).map((row) => ({
    date: String(row.date || ""),
    gmv: roundNumber(row.gmv, 2),
    qty: roundNumber(row.qty, 2),
  }));
}

async function queryDashboardWeeklyTrend(pool, dateFrom, dateTo) {
  const result = await timedQuery(
    pool,
    `
      with params as (
        select
          $1::date as range_start,
          $2::date as range_end
      ),
      buckets as (
        select generate_series(
          0,
          greatest(0, ((select range_end from params) - (select range_start from params)) / 7)
        ) as bucket_index
      ),
      bucket_ranges as (
        select
          buckets.bucket_index,
          ((select range_start from params) + (buckets.bucket_index * interval '7 day'))::date as bucket_start,
          least(
            (select range_end from params),
            ((select range_start from params) + (buckets.bucket_index * interval '7 day') + interval '6 day')::date
          ) as bucket_end
        from buckets
      ),
      sales as (
        select
          ((sales_date - $1::date) / 7) as bucket_index,
          coalesce(sum(${DASHBOARD_SALES_AMOUNT_EXPR}), 0)::numeric as gmv,
          coalesce(sum(${DASHBOARD_NET_QTY_EXPR}), 0)::numeric as qty
        from ${SALES_DAILY_TABLE}
        where sales_date between $1 and $2
          and ${SKU_FILTER_SQL}
        group by 1
      )
      select
        to_char(bucket_ranges.bucket_start, 'YYYY-MM-DD') as week_start,
        to_char(bucket_ranges.bucket_end, 'YYYY-MM-DD') as week_end,
        case
          when bucket_ranges.bucket_start = bucket_ranges.bucket_end then to_char(bucket_ranges.bucket_start, 'YYYY-MM-DD')
          else to_char(bucket_ranges.bucket_start, 'YYYY-MM-DD') || ' ~ ' || to_char(bucket_ranges.bucket_end, 'YYYY-MM-DD')
        end as week_label,
        coalesce(sales.gmv, 0)::numeric as gmv,
        coalesce(sales.qty, 0)::numeric as qty
      from bucket_ranges
      left join sales on sales.bucket_index = bucket_ranges.bucket_index
      order by bucket_ranges.bucket_index
    `,
    [dateFrom, dateTo],
    "queryDashboardWeeklyTrend"
  );

  return (result.rows || []).map((row) => ({
    bucket_start: String(row.week_start || ""),
    week_start: String(row.week_label || row.week_start || ""),
    week_end: String(row.week_end || ""),
    week_label: String(row.week_label || row.week_start || ""),
    gmv: roundNumber(row.gmv, 2),
    qty: roundNumber(row.qty, 2),
  }));
}

async function queryDashboardCategoryStructure(pool, dateFrom, dateTo) {
  const result = await timedQuery(
    pool,
    `
      with sales as (
        select
          coalesce(nullif(trim(category), ''), '未分类') as category,
          coalesce(sum(${DASHBOARD_SALES_AMOUNT_EXPR}), 0)::numeric as gmv
        from ${SALES_DAILY_TABLE}
        where sales_date between $1 and $2
          and ${SKU_FILTER_SQL}
        group by 1
      ),
      inv as (
        select
          coalesce(nullif(trim(category), ''), '未分类') as category,
          coalesce(sum(inventory_total_qty), 0)::numeric as inventory_qty
        from ${INVENTORY_LATEST_TABLE}
        where ${SKU_FILTER_SQL}
        group by 1
      )
      select
        coalesce(sales.category, inv.category) as category,
        coalesce(sales.gmv, 0)::numeric as gmv,
        coalesce(inv.inventory_qty, 0)::numeric as inventory_qty
      from sales
      full outer join inv on inv.category = sales.category
      order by coalesce(sales.gmv, 0) desc, coalesce(inv.inventory_qty, 0) desc
    `,
    [dateFrom, dateTo],
    "queryDashboardCategoryStructure"
  );

  const rows = result.rows || [];
  const totalGmv = rows.reduce((sum, row) => sum + toNumber(row.gmv), 0);
  const totalInventory = rows.reduce((sum, row) => sum + toNumber(row.inventory_qty), 0);

  return rows.slice(0, 12).map((row) => {
    const gmv = toNumber(row.gmv);
    const inventoryQty = toNumber(row.inventory_qty);
    return {
      category: String(row.category || "未分类"),
      gmv: roundNumber(gmv, 2),
      gmv_share_pct: totalGmv > 0 ? roundNumber(gmv / totalGmv, 6) : 0,
      inventory_qty: roundNumber(inventoryQty, 2),
      inventory_share_pct: totalInventory > 0 ? roundNumber(inventoryQty / totalInventory, 6) : 0,
    };
  });
}

async function queryDashboardCategoryMovement(pool, dateFrom, dateTo, comparisonFrom, comparisonTo) {
  const result = await timedQuery(
    pool,
    `
      with current_period as (
        select
          coalesce(nullif(trim(category), ''), '未分类') as category,
          coalesce(sum(${DASHBOARD_SALES_AMOUNT_EXPR}), 0)::numeric as gmv
        from ${SALES_DAILY_TABLE}
        where sales_date between $1 and $2
          and ${SKU_FILTER_SQL}
        group by 1
      ),
      prev_period as (
        select
          coalesce(nullif(trim(category), ''), '未分类') as category,
          coalesce(sum(${DASHBOARD_SALES_AMOUNT_EXPR}), 0)::numeric as gmv
        from ${SALES_DAILY_TABLE}
        where sales_date between $3 and $4
          and ${SKU_FILTER_SQL}
        group by 1
      )
      select
        coalesce(c.category, p.category) as category,
        coalesce(c.gmv, 0)::numeric as current_gmv,
        coalesce(p.gmv, 0)::numeric as prev_gmv
      from current_period c
      full outer join prev_period p on p.category = c.category
    `,
    [dateFrom, dateTo, comparisonFrom, comparisonTo],
    "queryDashboardCategoryMovement"
  );

  const base = (result.rows || []).map((row) => {
    const currentGmv = toNumber(row.current_gmv);
    const prevGmv = toNumber(row.prev_gmv);
    return {
      category: String(row.category || "未分类"),
      gmv: roundNumber(currentGmv, 2),
      gmv_prev: roundNumber(prevGmv, 2),
      gmv_chg_pct: percentChange(currentGmv, prevGmv),
    };
  });

  const rising = base
    .filter((item) => item.gmv_chg_pct !== null && item.gmv_chg_pct > 0)
    .sort((a, b) => b.gmv_chg_pct - a.gmv_chg_pct)
    .slice(0, 8)
    .map((item) => ({
      ...item,
      gmv_chg_pct: roundNumber(item.gmv_chg_pct, 6),
    }));

  const falling = base
    .filter((item) => item.gmv_chg_pct !== null && item.gmv_chg_pct < 0)
    .sort((a, b) => a.gmv_chg_pct - b.gmv_chg_pct)
    .slice(0, 8)
    .map((item) => ({
      ...item,
      gmv_chg_pct: roundNumber(item.gmv_chg_pct, 6),
    }));

  return { rising, falling };
}

function makeDashboardOverviewCacheKey(dateFrom, dateTo) {
  return `${dateFrom}|${dateTo}`;
}

function getDashboardOverviewCache(dateFrom, dateTo) {
  const key = makeDashboardOverviewCacheKey(dateFrom, dateTo);
  if (!key) {
    return null;
  }
  return getMapCache(DASHBOARD_OVERVIEW_CACHE, key, DASHBOARD_CACHE_TTL_MS);
}

function setDashboardOverviewCache(dateFrom, dateTo, payload) {
  const key = makeDashboardOverviewCacheKey(dateFrom, dateTo);
  if (!key) {
    return;
  }
  setMapCache(DASHBOARD_OVERVIEW_CACHE, key, payload);
}

function buildDashboardKpiNode(currentValue, previousValue, digits = 2) {
  return {
    current: roundNumber(currentValue, digits),
    previous: roundNumber(previousValue, digits),
    change_pct: (() => {
      const value = percentChange(currentValue, previousValue);
      return value === null ? null : roundNumber(value, 6);
    })(),
  };
}

async function getDashboardOverview(anchorDateText, dateFromText, dateToText) {
  const range = await resolveDashboardRange({
    dateFromText,
    dateToText,
    anchorDateText,
    defaultSpanDays: 7,
  });
  const anchorDate = range.anchorDate;
  const dateFrom = range.dateFrom;
  const dateTo = range.dateTo;
  const comparisonFrom = range.comparisonFrom;
  const comparisonTo = range.comparisonTo;

  if (!dateFrom || !dateTo) {
    return {
      meta: {
        anchor_date: "",
        date_from: "",
        date_to: "",
        comparison_from: "",
        comparison_to: "",
        period_days: 0,
      },
      date_from: "",
      date_to: "",
      comparison_from: "",
      comparison_to: "",
      kpis: {
        gmv: buildDashboardKpiNode(0, 0, 2),
        qty: buildDashboardKpiNode(0, 0, 2),
        sell_through: buildDashboardKpiNode(0, 0, 6),
        discount_rate: buildDashboardKpiNode(0, 0, 6),
      },
      trends_daily: [],
      trends_weekly: [],
      category_structure: [],
      category_movement: { rising: [], falling: [] },
      updated_at: new Date().toISOString(),
    };
  }

  const cached = getDashboardOverviewCache(dateFrom, dateTo);
  if (cached) {
    return cached;
  }

  const cacheKey = makeDashboardOverviewCacheKey(dateFrom, dateTo);
  const inFlight = DASHBOARD_OVERVIEW_IN_FLIGHT.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    const pool = await getPool();
    const metrics = await queryDashboardOverviewMetrics(pool, dateFrom, dateTo, comparisonFrom, comparisonTo);
    const [trendsDaily, trendsWeekly, categoryStructure, categoryMovement] = await Promise.all([
      queryDashboardDailyTrend(pool, dateFrom, dateTo),
      queryDashboardWeeklyTrend(pool, dateFrom, dateTo),
      queryDashboardCategoryStructure(pool, dateFrom, dateTo),
      queryDashboardCategoryMovement(pool, dateFrom, dateTo, comparisonFrom, comparisonTo),
    ]);

    const payload = {
      meta: {
        anchor_date: anchorDate,
        date_from: dateFrom,
        date_to: dateTo,
        comparison_from: comparisonFrom,
        comparison_to: comparisonTo,
        period_days: range.periodDays,
      },
      date_from: dateFrom,
      date_to: dateTo,
      comparison_from: comparisonFrom,
      comparison_to: comparisonTo,
      kpis: {
        gmv: buildDashboardKpiNode(metrics.current.gmv, metrics.previous.gmv, 2),
        qty: buildDashboardKpiNode(metrics.current.qty, metrics.previous.qty, 2),
        sell_through: buildDashboardKpiNode(metrics.current.sell_through, metrics.previous.sell_through, 6),
        discount_rate: buildDashboardKpiNode(metrics.current.discount_rate, metrics.previous.discount_rate, 6),
      },
      trends_daily: trendsDaily,
      trends_weekly: trendsWeekly,
      category_structure: categoryStructure,
      category_movement: categoryMovement,
      updated_at: new Date().toISOString(),
    };

    setDashboardOverviewCache(dateFrom, dateTo, payload);
    return payload;
  })();

  DASHBOARD_OVERVIEW_IN_FLIGHT.set(cacheKey, request);
  try {
    return await request;
  } finally {
    DASHBOARD_OVERVIEW_IN_FLIGHT.delete(cacheKey);
  }
}

function filterObjectRowsByKeyword(rows, keyword, fuzzy) {
  const kw = String(keyword || "").trim();
  if (!kw) {
    return rows;
  }
  const kwUpper = kw.toUpperCase();
  const prefixRows = rows.filter((row) => {
    const sku = toText(row.sku).toUpperCase();
    const style = toText(row.style).toUpperCase();
    return sku === kwUpper || style === kwUpper || sku.startsWith(kwUpper) || style.startsWith(kwUpper);
  });

  if (prefixRows.length > 0 || !fuzzy || kwUpper.length < 3) {
    prefixRows.sort((a, b) => {
      const asku = toText(a.sku).toUpperCase();
      const bsku = toText(b.sku).toUpperCase();
      const astyle = toText(a.style).toUpperCase();
      const bstyle = toText(b.style).toUpperCase();
      const aRank = asku === kwUpper ? 0 : astyle === kwUpper ? 1 : 2;
      const bRank = bsku === kwUpper ? 0 : bstyle === kwUpper ? 1 : 2;
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      return asku.localeCompare(bsku, "zh-CN");
    });
    return prefixRows;
  }

  return rows
    .filter((row) => {
      const sku = toText(row.sku).toUpperCase();
      const style = toText(row.style).toUpperCase();
      return sku.includes(kwUpper) || style.includes(kwUpper);
    })
    .sort((a, b) => toText(a.sku).localeCompare(toText(b.sku), "zh-CN"));
}

function paginateRows(rows, page, pageSize) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(500, Math.max(1, Number(pageSize) || 100));
  const offset = (safePage - 1) * safePageSize;
  return {
    items: rows.slice(offset, offset + safePageSize),
    total: rows.length,
    page: safePage,
    pageSize: safePageSize,
  };
}

async function queryDailyUnionBaseRows(dateFrom, dateTo) {
  const cached = getDailyUnionCache(dateFrom, dateTo);
  if (cached) {
    return cached;
  }
  const cacheKey = makeDailyUnionCacheKey(dateFrom, dateTo);
  return withSingleFlight(DAILY_UNION_IN_FLIGHT, cacheKey, async () => {
    const nextCached = getDailyUnionCache(dateFrom, dateTo);
    if (nextCached) {
      return nextCached;
    }
    const pool = await getPool();
    const result = await timedQuery(pool, DAILY_UNION_SQL, [dateFrom, dateTo], "queryDailyUnionBaseRows");
    const rows = result.rows || [];
    setDailyUnionCache(dateFrom, dateTo, rows);
    return rows;
  });
}

function summarizeDailyRows(rows) {
  let inventoryDate = "";
  let generatedAt = "";
  for (const row of rows || []) {
    const d = toDateText(row.inventory_snapshot_date);
    if (d && (!inventoryDate || d > inventoryDate)) {
      inventoryDate = d;
    }
    const ts = dateTimeText(row.loaded_at);
    if (ts && (!generatedAt || ts > generatedAt)) {
      generatedAt = ts;
    }
  }
  return {
    inventory_date: inventoryDate,
    generated_at: generatedAt,
    row_count: Array.isArray(rows) ? rows.length : 0,
  };
}

async function getWeekChoices() {
  const payload = await getDateChoices();
  return {
    weeks: payload.salesDates,
    defaultWeek: payload.defaultSalesDate,
  };
}

async function resolveWeek(week) {
  const choices = await getWeekChoices();
  const normalized = normalizeDateInput(week);
  if (!normalized) {
    return { week: choices.defaultWeek, weeks: choices.weeks };
  }
  return {
    week: choices.weeks.includes(normalized) ? normalized : choices.defaultWeek,
    weeks: choices.weeks,
  };
}

async function getReportMeta(week) {
  const rows = await queryDailyUnionBaseRows(week, week);
  const summary = summarizeDailyRows(rows);
  return {
    report_week: week,
    group_headers: buildWeekGroupHeaders(),
    column_headers: WEEK_COLUMN_HEADERS,
    row_count: summary.row_count,
    generated_at: summary.generated_at,
    sales_date_from: week,
    sales_date_to: week,
    gap_summary: {
      missing_store_channel: 0,
      missing_pool_channel: 0,
      missing_pool_ratio: 0,
      unknown_inventory_channel: 0,
      unknown_sales_channel: 0,
    },
  };
}

async function getReportRows({ week, page, pageSize, keyword, fuzzy }) {
  const rows = await queryDailyUnionBaseRows(week, week);
  const filtered = filterObjectRowsByKeyword(rows, keyword, fuzzy);
  const paged = paginateRows(filtered, page, pageSize);
  return {
    items: paged.items.map((row) => toWeekRow(row, week)),
    total: paged.total,
    page: paged.page,
    pageSize: paged.pageSize,
  };
}

async function getReportExportRows(week) {
  const rows = await queryDailyUnionBaseRows(week, week);
  return rows.map((row) => toWeekRow(row, week));
}

async function getDailyDateChoices() {
  const payload = await getDateChoices();
  return {
    salesDates: payload.salesDates,
    defaultSalesDate: payload.defaultSalesDate,
  };
}

async function resolveDailyDate(salesDate) {
  const choices = await getDailyDateChoices();
  const normalized = normalizeDateInput(salesDate);
  if (!normalized) {
    return { salesDate: choices.defaultSalesDate, salesDates: choices.salesDates };
  }
  return {
    salesDate: choices.salesDates.includes(normalized) ? normalized : choices.defaultSalesDate,
    salesDates: choices.salesDates,
  };
}

async function resolveDailyRange(dateFromText, dateToText) {
  const choices = await getDailyDateChoices();
  const normalized = normalizeDailyRangeInput(dateFromText, dateToText);
  let dateFrom = normalized.dateFrom;
  let dateTo = normalized.dateTo;
  if (!dateFrom && !dateTo) {
    const fallback = choices.defaultSalesDate || "";
    return {
      dateFrom: fallback,
      dateTo: fallback,
      salesDates: choices.salesDates,
    };
  }
  if (!dateFrom) {
    dateFrom = dateTo;
  }
  if (!dateTo) {
    dateTo = dateFrom;
  }
  return {
    dateFrom,
    dateTo,
    salesDates: choices.salesDates,
  };
}

async function resolveDashboardCompareRange(dateFromText, dateToText) {
  return resolveDashboardRange({
    dateFromText,
    dateToText,
    anchorDateText: "",
    defaultSpanDays: 7,
  });
}

async function getDailyMeta(salesDate) {
  const rows = await queryDailyUnionBaseRows(salesDate, salesDate);
  const summary = summarizeDailyRows(rows);
  return {
    sales_date: salesDate,
    inventory_date: summary.inventory_date,
    group_headers: buildDailyGroupHeaders(),
    column_headers: DAILY_COLUMN_HEADERS,
    row_count: summary.row_count,
    generated_at: summary.generated_at,
    gap_summary: {
      missing_store_channel: 0,
      missing_pool_channel: 0,
      missing_pool_ratio: 0,
      unknown_inventory_channel: 0,
      unknown_sales_channel: 0,
    },
  };
}

async function getDailyRangeMeta({ dateFrom, dateTo }) {
  const rows = await queryDailyUnionBaseRows(dateFrom, dateTo);
  const summary = summarizeDailyRows(rows);
  return {
    date_from: dateFrom,
    date_to: dateTo,
    inventory_date: summary.inventory_date,
    group_headers: buildDailyGroupHeaders(),
    column_headers: DAILY_COLUMN_HEADERS,
    row_count: summary.row_count,
    generated_at: summary.generated_at,
    gap_summary: {
      missing_store_channel: 0,
      missing_pool_channel: 0,
      missing_pool_ratio: 0,
      unknown_inventory_channel: 0,
      unknown_sales_channel: 0,
    },
  };
}

async function getDailyRows({ salesDate, page, pageSize, keyword, fuzzy }) {
  const rows = await queryDailyUnionBaseRows(salesDate, salesDate);
  const filtered = filterObjectRowsByKeyword(rows, keyword, fuzzy);
  const paged = paginateRows(filtered, page, pageSize);
  return {
    items: paged.items.map((row) => toDailyRow(row)),
    total: paged.total,
    page: paged.page,
    pageSize: paged.pageSize,
  };
}

async function getDailyRowsRange({ dateFrom, dateTo, page, pageSize, keyword, fuzzy }) {
  const rows = await queryDailyUnionBaseRows(dateFrom, dateTo);
  const filtered = filterObjectRowsByKeyword(rows, keyword, fuzzy);
  const paged = paginateRows(filtered, page, pageSize);
  return {
    items: paged.items.map((row) => toDailyRow(row)),
    total: paged.total,
    page: paged.page,
    pageSize: paged.pageSize,
  };
}

async function getDailyExportRows(salesDate) {
  const rows = await queryDailyUnionBaseRows(salesDate, salesDate);
  return rows.map((row) => toDailyRow(row));
}

async function getDailyExportRowsRange({ dateFrom, dateTo }) {
  const rows = await queryDailyUnionBaseRows(dateFrom, dateTo);
  return rows.map((row) => toDailyRow(row));
}

async function ensureAnalysisReportsTable() {
  if (analysisTableReadyPromise) {
    return analysisTableReadyPromise;
  }

  analysisTableReadyPromise = (async () => {
    const pool = await getPool();
    await timedQuery(
      pool,
      `
        create table if not exists anta_daily.analysis_reports (
          id serial primary key,
          period_type text not null,
          period_start date not null,
          period_end date not null,
          skill_id text,
          skill_name text,
          prompt_text text,
          metrics_json jsonb,
          report_md text not null,
          status text not null,
          error_msg text,
          created_at timestamptz not null default now()
        )
      `,
      [],
      "ensureAnalysisReportsTable.create"
    );

    await timedQuery(
      pool,
      `
        alter table anta_daily.analysis_reports
        add column if not exists skill_id text,
        add column if not exists skill_name text,
        add column if not exists prompt_text text
      `,
      [],
      "ensureAnalysisReportsTable.alter"
    );

    await timedQuery(
      pool,
      `
        create index if not exists idx_analysis_reports_created_at
        on anta_daily.analysis_reports (created_at desc)
      `,
      [],
      "ensureAnalysisReportsTable.index"
    );
  })().catch((err) => {
    analysisTableReadyPromise = null;
    throw err;
  });

  return analysisTableReadyPromise;
}

async function createAnalysisReport({
  periodType,
  periodStart,
  periodEnd,
  skillId,
  skillName,
  promptText,
  metricsJson,
  reportMd,
  status,
  errorMsg,
}) {
  await ensureAnalysisReportsTable();
  const pool = await getPool();
  const result = await timedQuery(
    pool,
    `
      insert into anta_daily.analysis_reports (
        period_type,
        period_start,
        period_end,
        skill_id,
        skill_name,
        prompt_text,
        metrics_json,
        report_md,
        status,
        error_msg
      ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
      returning id, period_type, period_start, period_end, skill_id, skill_name, prompt_text, status, error_msg, created_at
    `,
    [
      String(periodType || ""),
      String(periodStart || ""),
      String(periodEnd || ""),
      skillId ? String(skillId) : null,
      skillName ? String(skillName) : null,
      promptText ? String(promptText) : null,
      JSON.stringify(metricsJson || {}),
      String(reportMd || ""),
      String(status || "success"),
      errorMsg ? String(errorMsg) : null,
    ],
    "createAnalysisReport"
  );
  return result.rows[0] || null;
}

async function listAnalysisReports({ page, pageSize }) {
  await ensureAnalysisReportsTable();
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 10));
  const offset = (safePage - 1) * safePageSize;
  const pool = await getPool();

  const [countResult, rowsResult] = await Promise.all([
    timedQuery(
      pool,
      `
        select count(1) as total
        from anta_daily.analysis_reports
      `,
      [],
      "listAnalysisReports.count"
    ),
    timedQuery(
      pool,
      `
        select
          id,
          period_type,
          period_start,
          period_end,
          skill_name,
          status,
          created_at
        from anta_daily.analysis_reports
        order by created_at desc
        offset $1 limit $2
      `,
      [offset, safePageSize],
      "listAnalysisReports.rows"
    ),
  ]);

  const total = Number(countResult.rows[0]?.total || 0);
  const items = (rowsResult.rows || []).map((row) => ({
    id: Number(row.id),
    period_type: String(row.period_type || ""),
    period_start: toDateText(row.period_start),
    period_end: toDateText(row.period_end),
    skill_name: String(row.skill_name || ""),
    status: String(row.status || ""),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : "",
  }));
  return {
    items,
    total,
    page: safePage,
    pageSize: safePageSize,
  };
}

async function getAnalysisReportById(id) {
  await ensureAnalysisReportsTable();
  const reportId = Number(id);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return null;
  }

  const pool = await getPool();
  const result = await timedQuery(
    pool,
    `
      select
        id,
        period_type,
        period_start,
        period_end,
        skill_id,
        skill_name,
        prompt_text,
        metrics_json,
        report_md,
        status,
        error_msg,
        created_at
      from anta_daily.analysis_reports
      where id = $1
      limit 1
    `,
    [reportId],
    "getAnalysisReportById"
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    period_type: String(row.period_type || ""),
    period_start: toDateText(row.period_start),
    period_end: toDateText(row.period_end),
    skill_id: String(row.skill_id || ""),
    skill_name: String(row.skill_name || ""),
    prompt_text: String(row.prompt_text || ""),
    metrics_json: row.metrics_json && typeof row.metrics_json === "object" ? row.metrics_json : {},
    report_md: String(row.report_md || ""),
    status: String(row.status || ""),
    error_msg: row.error_msg ? String(row.error_msg) : "",
    created_at: row.created_at ? new Date(row.created_at).toISOString() : "",
  };
}

/**
 * 清空所有报表缓存（F-PERF-40C §S3）。
 *
 * 数据刷新（rebuild-weekly）完成后自动调用 + 暴露给 admin endpoint 让运维手动清。
 *
 * 故意不清 IN_FLIGHT Map：
 *   - 清 IN_FLIGHT 会让正在等待的 promise 永远不被 settle（孤儿 Promise，导致 res 挂住直到 timeout）
 *   - 让飞行中的请求自然完成（用旧数据返回一次），新请求自然命中清空后的缓存走重查
 *   - 这是"温和"的清缓存语义，与 rebuild-weekly 业务对齐
 */
function clearAllCaches(reason = "manual") {
  return clearReportCaches(reason);
}

module.exports = {
  getPool,
  ensureAnalysisReportsTable,
  createAnalysisReport,
  listAnalysisReports,
  getAnalysisReportById,
  getDashboardDateChoices,
  resolveDashboardAnchorDate,
  getDashboardOverview,
  getDashboardChannelCompare,
  getDashboardDrilldown,
  getChannelDashboard,
  getChannelDashboardStyleDrilldown,
  getWeekChoices,
  resolveWeek,
  getReportMeta,
  getReportRows,
  getReportExportRows,
  getDailyDateChoices,
  resolveDailyDate,
  resolveDailyRange,
  getDailyMeta,
  getDailyRangeMeta,
  getDailyRows,
  getDailyRowsRange,
  getDailyExportRows,
  getDailyExportRowsRange,
  getCacheStats,
  clearReportCaches,
  clearAllCaches,
};
