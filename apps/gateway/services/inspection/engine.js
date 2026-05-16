"use strict";

const { SALES_DAILY_TABLE, SKU_FILTER_SQL } = require("../report/constants");
const { CHANNEL_DASHBOARD_OPTIONS } = require("../report/channel/options");

// GMV = sales_qty * tag_price per channel row
function gmvExpr(salesQtyKey) {
  return `coalesce(sum(${salesQtyKey} * tag_price), 0)`;
}

function classifySeverity(changePct, warnThreshold, critThreshold) {
  const drop = -changePct;
  if (drop >= critThreshold) return "critical";
  if (drop >= warnThreshold) return "warning";
  return null;
}

// ── Type 1: Day-over-Day sales drop per channel ─────────────────────────────

async function detectSalesDropDoD(pool, anomalies) {
  for (const ch of CHANNEL_DASHBOARD_OPTIONS) {
    const sql = `
      WITH yesterday AS (
        SELECT ${gmvExpr(ch.salesQtyKey)} AS gmv
        FROM ${SALES_DAILY_TABLE}
        WHERE sales_date = (current_date - interval '1 day')::date
          AND ${SKU_FILTER_SQL}
      ),
      day_before AS (
        SELECT ${gmvExpr(ch.salesQtyKey)} AS gmv
        FROM ${SALES_DAILY_TABLE}
        WHERE sales_date = (current_date - interval '2 day')::date
          AND ${SKU_FILTER_SQL}
      )
      SELECT
        y.gmv   AS current_gmv,
        d.gmv   AS previous_gmv,
        CASE WHEN d.gmv > 0
             THEN round((y.gmv - d.gmv) / d.gmv * 100, 2)
             ELSE NULL END AS change_pct
      FROM yesterday y, day_before d`;

    const { rows } = await pool.query(sql);
    if (!rows.length) continue;
    const row = rows[0];
    if (row.change_pct === null) continue;

    const severity = classifySeverity(Number(row.change_pct), 10, 25);
    if (!severity) continue;

    anomalies.push({
      type: "sales_drop_dod",
      severity,
      title: `${ch.label}渠道日环比GMV下降 ${Math.abs(row.change_pct)}%`,
      description: `${ch.label}(${ch.code}) 昨日GMV ${row.current_gmv}，前日GMV ${row.previous_gmv}，变化 ${row.change_pct}%`,
      metric_current: Number(row.current_gmv),
      metric_previous: Number(row.previous_gmv),
      change_pct: Number(row.change_pct),
      suggested_action: `检查${ch.label}渠道昨日是否有促销结束、库存断货或流量异常`,
    });
  }
}

// ── Type 2: Week-over-Week sales drop per channel ───────────────────────────

async function detectSalesDropWoW(pool, anomalies) {
  for (const ch of CHANNEL_DASHBOARD_OPTIONS) {
    const sql = `
      WITH this_week AS (
        SELECT ${gmvExpr(ch.salesQtyKey)} AS gmv
        FROM ${SALES_DAILY_TABLE}
        WHERE sales_date BETWEEN (current_date - interval '7 day')::date
                              AND (current_date - interval '1 day')::date
          AND ${SKU_FILTER_SQL}
      ),
      prev_week AS (
        SELECT ${gmvExpr(ch.salesQtyKey)} AS gmv
        FROM ${SALES_DAILY_TABLE}
        WHERE sales_date BETWEEN (current_date - interval '14 day')::date
                              AND (current_date - interval '8 day')::date
          AND ${SKU_FILTER_SQL}
      )
      SELECT
        t.gmv   AS current_gmv,
        p.gmv   AS previous_gmv,
        CASE WHEN p.gmv > 0
             THEN round((t.gmv - p.gmv) / p.gmv * 100, 2)
             ELSE NULL END AS change_pct
      FROM this_week t, prev_week p`;

    const { rows } = await pool.query(sql);
    if (!rows.length) continue;
    const row = rows[0];
    if (row.change_pct === null) continue;

    const severity = classifySeverity(Number(row.change_pct), 15, 30);
    if (!severity) continue;

    anomalies.push({
      type: "sales_drop_wow",
      severity,
      title: `${ch.label}渠道周环比GMV下降 ${Math.abs(row.change_pct)}%`,
      description: `${ch.label}(${ch.code}) 近7日GMV ${row.current_gmv}，前7日GMV ${row.previous_gmv}，变化 ${row.change_pct}%`,
      metric_current: Number(row.current_gmv),
      metric_previous: Number(row.previous_gmv),
      change_pct: Number(row.change_pct),
      suggested_action: `对比${ch.label}渠道近两周促销活动、流量来源变化`,
    });
  }
}

// ── Type 3: Zero-sales SKUs in last 7 days, grouped by category ─────────────

async function detectZeroSalesSku(pool, anomalies) {
  const salesSumExpr = CHANNEL_DASHBOARD_OPTIONS
    .map((ch) => `coalesce(${ch.salesQtyKey}, 0)`)
    .join(" + ");

  const sql = `
    WITH recent_skus AS (
      SELECT DISTINCT sku, coalesce(nullif(trim(category), ''), '未分类') AS cat
      FROM ${SALES_DAILY_TABLE}
      WHERE sales_date >= (current_date - interval '14 day')::date
        AND ${SKU_FILTER_SQL}
    ),
    last_7d_sales AS (
      SELECT sku, sum(${salesSumExpr}) AS total_qty
      FROM ${SALES_DAILY_TABLE}
      WHERE sales_date >= (current_date - interval '7 day')::date
        AND ${SKU_FILTER_SQL}
      GROUP BY sku
    )
    SELECT rs.cat AS category, count(*) AS zero_count
    FROM recent_skus rs
    LEFT JOIN last_7d_sales s ON s.sku = rs.sku
    WHERE coalesce(s.total_qty, 0) = 0
    GROUP BY rs.cat
    HAVING count(*) > 20
    ORDER BY count(*) DESC`;

  const { rows } = await pool.query(sql);
  for (const row of rows) {
    anomalies.push({
      type: "zero_sales_sku",
      severity: "warning",
      title: `${row.category} 有 ${row.zero_count} 个SKU近7日零销售`,
      description: `品类 ${row.category} 中有 ${row.zero_count} 个SKU在近14天有数据但近7天销量为0`,
      metric_current: Number(row.zero_count),
      metric_previous: null,
      change_pct: null,
      suggested_action: `排查${row.category}品类滞销SKU，考虑促销或下架`,
    });
  }
}

// ── Type 4: New products with zero sales ────────────────────────────────────

async function detectNewProductUnderperform(pool, anomalies) {
  const salesSumExpr = CHANNEL_DASHBOARD_OPTIONS
    .map((ch) => `coalesce(${ch.salesQtyKey}, 0)`)
    .join(" + ");

  const sql = `
    WITH sku_first_seen AS (
      SELECT sku, min(sales_date) AS first_date
      FROM ${SALES_DAILY_TABLE}
      WHERE ${SKU_FILTER_SQL}
      GROUP BY sku
      HAVING min(sales_date) >= (current_date - interval '14 day')::date
    ),
    sku_total AS (
      SELECT d.sku,
             f.first_date,
             (current_date - f.first_date) AS days_since,
             sum(${salesSumExpr}) AS total_qty
      FROM ${SALES_DAILY_TABLE} d
      JOIN sku_first_seen f ON f.sku = d.sku
      WHERE d.sales_date >= f.first_date
        AND ${SKU_FILTER_SQL}
      GROUP BY d.sku, f.first_date
    )
    SELECT
      CASE WHEN days_since > 7 THEN 'warning' ELSE 'info' END AS severity,
      count(*) AS sku_count,
      CASE WHEN days_since > 7 THEN '7-14天' ELSE '0-7天' END AS age_bucket
    FROM sku_total
    WHERE total_qty = 0
    GROUP BY
      CASE WHEN days_since > 7 THEN 'warning' ELSE 'info' END,
      CASE WHEN days_since > 7 THEN '7-14天' ELSE '0-7天' END
    ORDER BY severity DESC`;

  const { rows } = await pool.query(sql);
  for (const row of rows) {
    anomalies.push({
      type: "new_product_underperform",
      severity: row.severity,
      title: `${row.sku_count} 个新品上架${row.age_bucket}仍零销售`,
      description: `在过去14天内首次出现的SKU中，有 ${row.sku_count} 个在上架${row.age_bucket}后仍无任何销量`,
      metric_current: Number(row.sku_count),
      metric_previous: null,
      change_pct: null,
      suggested_action: `检查新品${row.age_bucket}零销售原因：定价、曝光、标题、主图`,
    });
  }
}

// ── Summary builder ─────────────────────────────────────────────────────────

function buildSummary(anomalies) {
  const critical = anomalies.filter((a) => a.severity === "critical").length;
  const warning = anomalies.filter((a) => a.severity === "warning").length;
  const info = anomalies.filter((a) => a.severity === "info").length;
  const parts = [];
  if (critical) parts.push(`${critical} 个严重`);
  if (warning) parts.push(`${warning} 个警告`);
  if (info) parts.push(`${info} 个提示`);
  return `发现 ${anomalies.length} 个异常` + (parts.length ? `（${parts.join("，")}）` : "");
}

// ── Main entry ──────────────────────────────────────────────────────────────

async function runInspection(pool) {
  if (!pool) {
    return { status: "skipped", reason: "database_unavailable", anomalies: [] };
  }

  try {
    const anomalies = [];
    await detectSalesDropDoD(pool, anomalies);
    await detectSalesDropWoW(pool, anomalies);
    await detectZeroSalesSku(pool, anomalies);
    await detectNewProductUnderperform(pool, anomalies);

    return {
      run_date: new Date().toISOString().slice(0, 10),
      anomaly_count: anomalies.length,
      summary: buildSummary(anomalies),
      anomalies,
    };
  } catch (err) {
    const isConnectionError =
      err.code === "ECONNREFUSED" ||
      err.code === "ENOTFOUND" ||
      err.code === "57P01" ||
      err.message?.includes("Connection terminated");
    if (isConnectionError) {
      return { status: "skipped", reason: "database_unavailable", anomalies: [] };
    }
    throw err;
  }
}

module.exports = { runInspection };
