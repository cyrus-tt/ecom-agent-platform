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
const {
  getChannelDashboardCache,
  setChannelDashboardCache,
} = require("../cache");
const {
  CHANNEL_DASHBOARD_OPTION_MAP,
  getChannelDashboardAvailableChannels,
  normalizeChannelDashboardCodes,
} = require("./options");
const {
  resolveDashboardRange,
  resolveOptionalDashboardRange,
} = require("../dashboard/dateChoices");

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

module.exports = {
  buildChannelDashboardInventoryExpr,
  buildChannelDashboardSql,
  toMainColorText,
  toChannelDashboardItem,
  summarizeChannelDashboardRows,
  buildChannelDashboardPanel,
  buildChannelDashboardPanels,
  buildChannelDashboardCombinedSql,
  queryChannelDashboardPanel,
  getChannelDashboard,
};
