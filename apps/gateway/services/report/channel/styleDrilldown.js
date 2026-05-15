"use strict";

const { getPool, timedQuery } = require("../../../lib/db");
const { daysBetweenInclusive } = require("../shared/dateUtils");
const { toText, toNumber, roundNumber } = require("../shared/numberUtils");
const {
  SALES_DAILY_TABLE,
  INVENTORY_LATEST_TABLE,
  SKU_FILTER_SQL,
  DASHBOARD_CATEGORY_SQL,
  DASHBOARD_STYLE_SQL,
  DASHBOARD_SKU_SQL,
  DASHBOARD_UNCATEGORIZED_LABEL,
  DASHBOARD_UNMARKED_STYLE_LABEL,
  DASHBOARD_UNMARKED_SKU_LABEL,
} = require("../constants");
const { CHANNEL_DASHBOARD_OPTION_MAP } = require("./options");
const { buildChannelDashboardInventoryExpr } = require("./panel");
const { resolveDashboardRange } = require("../dashboard/dateChoices");

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

module.exports = {
  buildChannelDashboardStyleDrilldownBaseSql,
  buildChannelDashboardStyleDrilldownEmptyPayload,
  toChannelDashboardStyleSummary,
  toChannelDashboardStyleDrilldownItem,
  getChannelDashboardStyleDrilldown,
};
