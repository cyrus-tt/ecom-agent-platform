"use strict";

const { getPool, timedQuery } = require("../../lib/db");
const {
  normalizeDateInput,
  normalizeDailyRangeInput,
  toDateText,
  dateTimeText,
} = require("./shared/dateUtils");
const { toDailyRow } = require("./shared/rowTransforms");
const { filterObjectRowsByKeyword, paginateRows } = require("./shared/pagination");
const {
  SALES_DAILY_TABLE,
  INVENTORY_LATEST_TABLE,
  SKU_FILTER_SQL,
  SALES_SUM_SQL,
  SKU_DISCOUNT_AVG_SQL,
  STYLE_DISCOUNT_AVG_SQL,
  INVENTORY_PICK_SQL,
  INVENTORY_MERGE_SQL,
  SALES_MERGE_SQL,
  SKU_DISCOUNT_MERGE_SQL,
  STYLE_DISCOUNT_MERGE_SQL,
} = require("./constants");
const { getDailyUnionCache, setDailyUnionCache } = require("./cache");
const { getDateChoices } = require("./dashboard/dateChoices");
const { WEEK_COLUMN_HEADERS } = require("./weekly");

const DAILY_COLUMN_HEADERS = ["库存快照日期", ...WEEK_COLUMN_HEADERS.slice(1)];

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

async function queryDailyUnionBaseRows(dateFrom, dateTo) {
  const cached = getDailyUnionCache(dateFrom, dateTo);
  if (cached) {
    return cached;
  }
  const pool = await getPool();
  const result = await timedQuery(pool, DAILY_UNION_SQL, [dateFrom, dateTo], "queryDailyUnionBaseRows");
  const rows = result.rows || [];
  setDailyUnionCache(dateFrom, dateTo, rows);
  return rows;
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

module.exports = {
  DAILY_COLUMN_HEADERS,
  DAILY_UNION_SQL,
  buildDailyGroupHeaders,
  queryDailyUnionBaseRows,
  summarizeDailyRows,
  getDailyDateChoices,
  resolveDailyDate,
  resolveDailyRange,
  getDailyMeta,
  getDailyRangeMeta,
  getDailyRows,
  getDailyRowsRange,
  getDailyExportRows,
  getDailyExportRowsRange,
};
