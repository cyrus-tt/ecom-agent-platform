"use strict";

const { getPool, timedQuery } = require("../../../lib/db");
const { toNumber, roundNumber, percentChange } = require("../shared/numberUtils");
const {
  SALES_DAILY_TABLE,
  INVENTORY_LATEST_TABLE,
  SKU_FILTER_SQL,
  DASHBOARD_NET_QTY_EXPR,
} = require("../constants");
const {
  DASHBOARD_OVERVIEW_IN_FLIGHT,
  makeDashboardOverviewCacheKey,
  getDashboardOverviewCache,
  setDashboardOverviewCache,
} = require("../cache");
const { resolveDashboardRange } = require("./dateChoices");

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
          coalesce(sum(
            coalesce(tag_price, 0) * ${DASHBOARD_NET_QTY_EXPR} *
            coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
          ) filter (where sales_date between $1 and $2), 0)::numeric as current_gmv,
          coalesce(sum(${DASHBOARD_NET_QTY_EXPR}) filter (where sales_date between $1 and $2), 0)::numeric as current_qty,
          coalesce(sum(
            ${DASHBOARD_NET_QTY_EXPR} *
            coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
          ) filter (where sales_date between $1 and $2), 0)::numeric as current_discount_num,
          coalesce(sum(
            coalesce(tag_price, 0) * ${DASHBOARD_NET_QTY_EXPR} *
            coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
          ) filter (where sales_date between $3 and $4), 0)::numeric as previous_gmv,
          coalesce(sum(${DASHBOARD_NET_QTY_EXPR}) filter (where sales_date between $3 and $4), 0)::numeric as previous_qty,
          coalesce(sum(
            ${DASHBOARD_NET_QTY_EXPR} *
            coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
          ) filter (where sales_date between $3 and $4), 0)::numeric as previous_discount_num
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

  return {
    current: {
      gmv: toNumber(row.current_gmv),
      qty: currentQty,
      discount_rate: currentQty !== 0 ? toNumber(row.current_discount_num) / currentQty : 0,
      sell_through: inventoryQty > 0 ? currentQty / inventoryQty : 0,
    },
    previous: {
      gmv: toNumber(row.previous_gmv),
      qty: previousQty,
      discount_rate: previousQty !== 0 ? toNumber(row.previous_discount_num) / previousQty : 0,
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
          coalesce(sum(
            coalesce(tag_price, 0) * ${DASHBOARD_NET_QTY_EXPR} *
            coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
          ), 0)::numeric as gmv,
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
          coalesce(sum(
            coalesce(tag_price, 0) * ${DASHBOARD_NET_QTY_EXPR} *
            coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
          ), 0)::numeric as gmv,
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
          coalesce(sum(
            coalesce(tag_price, 0) * coalesce(sales_total_qty, 0) *
            coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
          ), 0)::numeric as gmv
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
          coalesce(sum(
            coalesce(tag_price, 0) * coalesce(sales_total_qty, 0) *
            coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
          ), 0)::numeric as gmv
        from ${SALES_DAILY_TABLE}
        where sales_date between $1 and $2
          and ${SKU_FILTER_SQL}
        group by 1
      ),
      prev_period as (
        select
          coalesce(nullif(trim(category), ''), '未分类') as category,
          coalesce(sum(
            coalesce(tag_price, 0) * coalesce(sales_total_qty, 0) *
            coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
          ), 0)::numeric as gmv
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

module.exports = {
  queryDashboardOverviewMetrics,
  queryDashboardDailyTrend,
  queryDashboardWeeklyTrend,
  queryDashboardCategoryStructure,
  queryDashboardCategoryMovement,
  buildDashboardKpiNode,
  getDashboardOverview,
};
