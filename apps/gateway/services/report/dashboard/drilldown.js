"use strict";

const { getPool, timedQuery } = require("../../../lib/db");
const { toText, toNumber, roundNumber } = require("../shared/numberUtils");
const {
  SALES_DAILY_TABLE,
  INVENTORY_LATEST_TABLE,
  SKU_FILTER_SQL,
  DASHBOARD_STYLE_SQL,
  DASHBOARD_SKU_SQL,
  DASHBOARD_CATEGORY_SQL,
  DASHBOARD_NET_QTY_EXPR,
  DASHBOARD_UNMARKED_STYLE_LABEL,
  DASHBOARD_UNMARKED_SKU_LABEL,
} = require("../constants");
const { resolveDashboardRange } = require("./dateChoices");

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
        coalesce(sum(
          coalesce(tag_price, 0) * ${DASHBOARD_NET_QTY_EXPR} *
          coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
        ), 0)::numeric as gmv,
        coalesce(sum(${DASHBOARD_NET_QTY_EXPR}), 0)::numeric as qty,
        coalesce(sum(
          ${DASHBOARD_NET_QTY_EXPR} *
          coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
        ), 0)::numeric as discount_num
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
          coalesce(sum(inventory_qty), 0)::numeric as inventory_qty
        from joined
        group by 1
      )
      select
        style,
        gmv,
        qty,
        inventory_qty,
        case when qty = 0 then 0 else discount_num / qty end as discount_rate
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
        case when qty = 0 then 0 else discount_num / qty end as discount_rate
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

  const pool = await getPool();
  const payload =
    safeLevel === "sku"
      ? await queryDashboardSkuDrilldown(pool, dateFrom, dateTo, safeCategory, safeStyle, safePage, safePageSize)
      : await queryDashboardStyleDrilldown(pool, dateFrom, dateTo, safeCategory, safePage, safePageSize);

  return {
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
}

module.exports = {
  normalizeDashboardDrilldownLevel,
  buildDashboardDrilldownBaseSql,
  buildDashboardDrilldownEmptyPayload,
  toDashboardSummary,
  toDashboardStyleDrilldownRow,
  toDashboardSkuDrilldownRow,
  queryDashboardStyleDrilldown,
  queryDashboardSkuDrilldown,
  getDashboardDrilldown,
};
