"use strict";

const { getPool, timedQuery } = require("../../../lib/db");
const { toText, toNumber, roundNumber, percentChange } = require("../shared/numberUtils");
const {
  SALES_DAILY_TABLE,
  SKU_FILTER_SQL,
  DASHBOARD_CATEGORY_SQL,
  DASHBOARD_SEASON_SQL,
  DASHBOARD_MAJOR_CATEGORY_SQL,
  DASHBOARD_UNCATEGORIZED_LABEL,
  DASHBOARD_UNMARKED_SEASON_LABEL,
  DASHBOARD_UNMARKED_MAJOR_CATEGORY_LABEL,
} = require("../constants");
const {
  CHANNEL_DASHBOARD_OPTION_MAP,
  getChannelDashboardAvailableChannels,
  normalizeDashboardCompareCodes,
} = require("../channel/options");
const { resolveDashboardRange } = require("./dateChoices");

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

async function resolveDashboardCompareRange(dateFromText, dateToText) {
  return resolveDashboardRange({
    dateFromText,
    dateToText,
    anchorDateText: "",
    defaultSpanDays: 7,
  });
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

  const pool = await getPool();
  const selectedOptions = selectedChannelCodes
    .map((code) => CHANNEL_DASHBOARD_OPTION_MAP.get(code))
    .filter(Boolean);
  const channels = await Promise.all(selectedOptions.map((option) => buildDashboardCompareChannel(pool, range, option)));

  return {
    sales_dates: Array.isArray(range.salesDates) ? range.salesDates : [],
    date_from: range.dateFrom,
    date_to: range.dateTo,
    comparison_from: range.comparisonFrom,
    comparison_to: range.comparisonTo,
    available_channels: availableChannels,
    selected_channels: selectedChannelCodes,
    channels,
  };
}

module.exports = {
  normalizeDashboardCompareChange,
  computePiecePrice,
  getDashboardCompareLabelFallback,
  buildDashboardCompareDimensionSql,
  toDashboardCompareSummary,
  toDashboardCompareRows,
  queryDashboardCompareSection,
  buildDashboardCompareChannel,
  resolveDashboardCompareRange,
  getDashboardChannelCompare,
};
