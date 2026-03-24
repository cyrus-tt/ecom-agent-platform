"use strict";

const reportRepo = require("./reportRepo");

const SALES_DAILY_TABLE = "anta_daily.rpt_sales_sku_daily";
const INVENTORY_LATEST_TABLE = "anta_daily.rpt_inventory_sku_latest";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateText(value) {
  const text = String(value || "").trim();
  if (!DATE_RE.test(text)) {
    return null;
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function formatDateText(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDays(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d;
}

function daysInclusive(startDate, endDate) {
  const ms = endDate.getTime() - startDate.getTime();
  return Math.floor(ms / (24 * 3600 * 1000)) + 1;
}

function round(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  const p = Math.pow(10, digits);
  return Math.round(n * p) / p;
}

function pctChange(current, previous) {
  const c = Number(current);
  const p = Number(previous);
  if (!Number.isFinite(c) || !Number.isFinite(p)) {
    return 0;
  }
  if (p === 0) {
    return c === 0 ? 0 : null;
  }
  return (c - p) / Math.abs(p);
}

function normalizePeriodType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "day" || text === "week" || text === "month") {
    return text;
  }
  return "week";
}

async function getLatestSalesDate(pool) {
  const result = await pool.query(
    `
      select max(sales_date) as latest_date
      from ${SALES_DAILY_TABLE}
    `
  );
  return result.rows[0]?.latest_date || null;
}

async function resolvePeriod({ periodType, startDate, endDate }) {
  const pool = await reportRepo.getPool();
  const latestRaw = await getLatestSalesDate(pool);
  const latestDate = latestRaw ? parseDateText(formatDateText(latestRaw)) : null;
  if (!latestDate) {
    throw new Error("销售数据为空，暂时无法生成分析。");
  }

  const type = normalizePeriodType(periodType);
  let start = parseDateText(startDate);
  let end = parseDateText(endDate);

  if (!start && !end) {
    end = latestDate;
    if (type === "day") {
      start = end;
    } else if (type === "week") {
      start = shiftDays(end, -6);
    } else {
      start = shiftDays(end, -29);
    }
  } else {
    if (!start) {
      start = end;
    }
    if (!end) {
      end = start;
    }
  }

  if (!start || !end) {
    throw new Error("日期参数不正确，请使用 YYYY-MM-DD 格式。");
  }
  if (start.getTime() > end.getTime()) {
    const t = start;
    start = end;
    end = t;
  }

  const days = daysInclusive(start, end);
  const comparisonEnd = shiftDays(start, -1);
  const comparisonStart = shiftDays(comparisonEnd, -(days - 1));

  return {
    type,
    start: formatDateText(start),
    end: formatDateText(end),
    comparison_start: formatDateText(comparisonStart),
    comparison_end: formatDateText(comparisonEnd),
    days,
  };
}

function finalizeCoreMetrics(row) {
  const qty = Number(row?.qty || 0);
  const gmv = Number(row?.gmv || 0);
  const discountRate = Number(row?.discount_rate || 0);
  const inventoryQty = Number(row?.inventory_qty || 0);
  const itemCount = Number(row?.item_count || 0);
  const sellThrough = inventoryQty > 0 ? qty / inventoryQty : 0;
  const avgOrderValue = qty > 0 ? gmv / qty : 0;
  return {
    gmv: round(gmv, 2),
    qty: round(qty, 2),
    sell_through: round(sellThrough, 6),
    discount_rate: round(discountRate, 6),
    avg_order_value: round(avgOrderValue, 4),
    item_count: Math.max(0, Math.round(itemCount)),
    inventory_qty: round(inventoryQty, 2),
  };
}

async function queryCoreMetrics(pool, periodStart, periodEnd) {
  const result = await pool.query(
    `
      with sales as (
        select
          coalesce(sum(sales_total_qty), 0) as qty,
          coalesce(
            sum(
              coalesce(tag_price, 0) * coalesce(sales_total_qty, 0) *
              coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
            ),
            0
          ) as gmv,
          coalesce(
            sum(
              coalesce(sales_total_qty, 0) *
              coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
            ),
            0
          ) as discount_numerator,
          coalesce(sum(coalesce(sales_total_qty, 0)), 0) as discount_denominator,
          count(distinct sku) as item_count
        from ${SALES_DAILY_TABLE}
        where sales_date between $1 and $2
      ),
      inv as (
        select coalesce(sum(inventory_total_qty), 0) as inventory_qty
        from ${INVENTORY_LATEST_TABLE}
      )
      select
        sales.qty,
        sales.gmv,
        sales.item_count,
        inv.inventory_qty,
        case
          when sales.discount_denominator = 0 then 0
          else sales.discount_numerator / sales.discount_denominator
        end as discount_rate
      from sales
      cross join inv
    `,
    [periodStart, periodEnd]
  );
  return finalizeCoreMetrics(result.rows[0] || {});
}

async function queryCategoryStructure(pool, periodStart, periodEnd) {
  const result = await pool.query(
    `
      with sales as (
        select
          coalesce(nullif(trim(category), ''), '未分类') as category,
          coalesce(
            sum(
              coalesce(tag_price, 0) * coalesce(sales_total_qty, 0) *
              coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
            ),
            0
          ) as gmv
        from ${SALES_DAILY_TABLE}
        where sales_date between $1 and $2
        group by 1
      ),
      inv as (
        select
          coalesce(nullif(trim(category), ''), '未分类') as category,
          coalesce(sum(inventory_total_qty), 0) as inventory_qty
        from ${INVENTORY_LATEST_TABLE}
        group by 1
      )
      select
        coalesce(sales.category, inv.category) as category,
        coalesce(sales.gmv, 0) as gmv,
        coalesce(inv.inventory_qty, 0) as inventory_qty
      from sales
      full outer join inv on inv.category = sales.category
      order by coalesce(sales.gmv, 0) desc, coalesce(inv.inventory_qty, 0) desc
    `,
    [periodStart, periodEnd]
  );

  const rows = result.rows || [];
  const totalGmv = rows.reduce((sum, row) => sum + Number(row.gmv || 0), 0);
  const totalInventory = rows.reduce((sum, row) => sum + Number(row.inventory_qty || 0), 0);
  return rows.slice(0, 12).map((row) => {
    const gmv = Number(row.gmv || 0);
    const inventoryQty = Number(row.inventory_qty || 0);
    return {
      category: String(row.category || "未分类"),
      gmv: round(gmv, 2),
      inventory_qty: round(inventoryQty, 2),
      gmv_share_pct: totalGmv > 0 ? round(gmv / totalGmv, 6) : 0,
      inventory_share_pct: totalInventory > 0 ? round(inventoryQty / totalInventory, 6) : 0,
    };
  });
}

async function queryCategoryMovement(pool, currentStart, currentEnd, compareStart, compareEnd) {
  const result = await pool.query(
    `
      with current_period as (
        select
          coalesce(nullif(trim(category), ''), '未分类') as category,
          coalesce(
            sum(
              coalesce(tag_price, 0) * coalesce(sales_total_qty, 0) *
              coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
            ),
            0
          ) as gmv
        from ${SALES_DAILY_TABLE}
        where sales_date between $1 and $2
        group by 1
      ),
      compare_period as (
        select
          coalesce(nullif(trim(category), ''), '未分类') as category,
          coalesce(
            sum(
              coalesce(tag_price, 0) * coalesce(sales_total_qty, 0) *
              coalesce(nullif(sku_discount_total, 0), nullif(style_discount_total, 0), 1)
            ),
            0
          ) as gmv
        from ${SALES_DAILY_TABLE}
        where sales_date between $3 and $4
        group by 1
      )
      select
        coalesce(c.category, p.category) as category,
        coalesce(c.gmv, 0) as current_gmv,
        coalesce(p.gmv, 0) as compare_gmv
      from current_period c
      full outer join compare_period p on p.category = c.category
    `,
    [currentStart, currentEnd, compareStart, compareEnd]
  );

  const rows = (result.rows || []).map((row) => {
    const currentGmv = Number(row.current_gmv || 0);
    const compareGmv = Number(row.compare_gmv || 0);
    return {
      category: String(row.category || "未分类"),
      gmv: round(currentGmv, 2),
      gmv_prev: round(compareGmv, 2),
      gmv_chg_pct: pctChange(currentGmv, compareGmv),
    };
  });

  const rising = rows
    .filter((row) => row.gmv_chg_pct !== null && row.gmv_chg_pct > 0)
    .sort((a, b) => b.gmv_chg_pct - a.gmv_chg_pct)
    .slice(0, 5)
    .map((row) => ({ ...row, gmv_chg_pct: round(row.gmv_chg_pct, 6) }));

  const falling = rows
    .filter((row) => row.gmv_chg_pct !== null && row.gmv_chg_pct < 0)
    .sort((a, b) => a.gmv_chg_pct - b.gmv_chg_pct)
    .slice(0, 5)
    .map((row) => ({ ...row, gmv_chg_pct: round(row.gmv_chg_pct, 6) }));

  return { rising, falling };
}

async function queryInventoryRiskSummary(pool, periodStart, periodEnd, periodDays) {
  const safeDays = Math.max(1, Number(periodDays || 1));
  const result = await pool.query(
    `
      with sales as (
        select
          sku,
          coalesce(sum(sales_total_qty), 0) / $3::numeric as daily_sales_avg
        from ${SALES_DAILY_TABLE}
        where sales_date between $1 and $2
        group by sku
      ),
      joined as (
        select
          coalesce(nullif(trim(inv.category), ''), '未分类') as category,
          coalesce(inv.inventory_total_qty, 0) as inventory_qty,
          coalesce(sales.daily_sales_avg, 0) as daily_sales_avg,
          case
            when coalesce(sales.daily_sales_avg, 0) > 0
              then coalesce(inv.inventory_total_qty, 0) / sales.daily_sales_avg
            else null
          end as days_of_supply
        from ${INVENTORY_LATEST_TABLE} inv
        left join sales on sales.sku = inv.sku
      )
      select
        category,
        count(*) filter (where days_of_supply is not null and days_of_supply < 7) as stockout_item_count,
        coalesce(sum(inventory_qty) filter (where days_of_supply is not null and days_of_supply < 7), 0) as stockout_inventory_qty,
        count(*) filter (where days_of_supply is not null and days_of_supply > 60) as slow_item_count,
        coalesce(sum(inventory_qty) filter (where days_of_supply is not null and days_of_supply > 60), 0) as slow_inventory_qty
      from joined
      group by category
    `,
    [periodStart, periodEnd, safeDays]
  );

  const byCategory = (result.rows || []).map((row) => ({
    category: String(row.category || "未分类"),
    stockout_item_count: Number(row.stockout_item_count || 0),
    stockout_inventory_qty: round(row.stockout_inventory_qty, 2),
    slow_item_count: Number(row.slow_item_count || 0),
    slow_inventory_qty: round(row.slow_inventory_qty, 2),
  }));

  const stockoutList = byCategory
    .filter((item) => item.stockout_item_count > 0)
    .sort((a, b) => b.stockout_item_count - a.stockout_item_count)
    .slice(0, 8);
  const slowList = byCategory
    .filter((item) => item.slow_item_count > 0)
    .sort((a, b) => b.slow_item_count - a.slow_item_count)
    .slice(0, 8);

  return {
    stockout_risk_summary: {
      total_item_count: stockoutList.reduce((sum, item) => sum + item.stockout_item_count, 0),
      total_inventory_qty: round(stockoutList.reduce((sum, item) => sum + item.stockout_inventory_qty, 0), 2),
      by_category: stockoutList,
    },
    slow_movers_summary: {
      total_item_count: slowList.reduce((sum, item) => sum + item.slow_item_count, 0),
      total_inventory_qty: round(slowList.reduce((sum, item) => sum + item.slow_inventory_qty, 0), 2),
      by_category: slowList,
    },
  };
}

async function calculateMetrics({ periodType, startDate, endDate }) {
  const period = await resolvePeriod({ periodType, startDate, endDate });
  const pool = await reportRepo.getPool();

  const [currentCore, comparisonCore, categoryStructure, movement, riskSummary] = await Promise.all([
    queryCoreMetrics(pool, period.start, period.end),
    queryCoreMetrics(pool, period.comparison_start, period.comparison_end),
    queryCategoryStructure(pool, period.start, period.end),
    queryCategoryMovement(pool, period.start, period.end, period.comparison_start, period.comparison_end),
    queryInventoryRiskSummary(pool, period.start, period.end, period.days),
  ]);

  const changes = {
    gmv_pct: pctChange(currentCore.gmv, comparisonCore.gmv),
    qty_pct: pctChange(currentCore.qty, comparisonCore.qty),
    sell_through_pct: pctChange(currentCore.sell_through, comparisonCore.sell_through),
    discount_rate_pct: pctChange(currentCore.discount_rate, comparisonCore.discount_rate),
    avg_order_value_pct: pctChange(currentCore.avg_order_value, comparisonCore.avg_order_value),
    item_count_pct: pctChange(currentCore.item_count, comparisonCore.item_count),
  };

  const hasData = currentCore.qty > 0 || currentCore.gmv > 0;

  return {
    period,
    current: currentCore,
    comparison: comparisonCore,
    changes: {
      gmv_pct: changes.gmv_pct === null ? null : round(changes.gmv_pct, 6),
      qty_pct: changes.qty_pct === null ? null : round(changes.qty_pct, 6),
      sell_through_pct: changes.sell_through_pct === null ? null : round(changes.sell_through_pct, 6),
      discount_rate_pct: changes.discount_rate_pct === null ? null : round(changes.discount_rate_pct, 6),
      avg_order_value_pct: changes.avg_order_value_pct === null ? null : round(changes.avg_order_value_pct, 6),
      item_count_pct: changes.item_count_pct === null ? null : round(changes.item_count_pct, 6),
    },
    category_structure: categoryStructure,
    rising_categories: movement.rising,
    falling_categories: movement.falling,
    stockout_risk_summary: riskSummary.stockout_risk_summary,
    slow_movers_summary: riskSummary.slow_movers_summary,
    has_data: hasData,
    summary: {
      period_type: period.type,
      period_start: period.start,
      period_end: period.end,
      comparison_start: period.comparison_start,
      comparison_end: period.comparison_end,
      current_gmv: currentCore.gmv,
      current_qty: currentCore.qty,
      current_sell_through: currentCore.sell_through,
      current_discount_rate: currentCore.discount_rate,
    },
  };
}

module.exports = {
  calculateMetrics,
};
