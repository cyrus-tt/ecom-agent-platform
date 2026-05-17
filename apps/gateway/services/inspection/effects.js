"use strict";

/**
 * Effect tracking — measures whether executed proposals actually improved metrics.
 *
 * Flow:
 *   1. When a proposal is executed, record baseline metric + schedule followup
 *   2. After FOLLOWUP_DAYS, re-measure the metric
 *   3. Compare and classify: improved / unchanged / worsened
 *
 * Evaluation runs daily (piggybacks on the inspection cron).
 */

const { SALES_DAILY_TABLE, SKU_FILTER_SQL } = require("../report/constants");
const { CHANNEL_DASHBOARD_OPTIONS } = require("../report/channel/options");

const FOLLOWUP_DAYS = 3;

function metricTypeFromAnomaly(anomalyType) {
  const map = {
    sales_drop_dod: "channel_gmv_dod",
    sales_drop_wow: "channel_gmv_wow",
    zero_sales_sku: "zero_sales_count",
    new_product_underperform: "new_product_sales",
  };
  return map[anomalyType] || "unknown";
}

async function recordBaseline(pool, proposal, anomaly) {
  if (!pool || !proposal || !anomaly) return null;

  const metricType = metricTypeFromAnomaly(anomaly.type);
  const baselineValue = anomaly.metric_current;
  const baselineDate = new Date().toISOString().slice(0, 10);

  try {
    const { rows } = await pool.query(
      `INSERT INTO anta_daily.agent_effects
       (proposal_id, anomaly_id, metric_type, baseline_value, baseline_date, outcome)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id`,
      [proposal.id, anomaly.id, metricType, baselineValue, baselineDate]
    );
    return rows[0]?.id || null;
  } catch (err) {
    if (err.code === "42P01") return null;
    throw err;
  }
}

async function evaluatePendingEffects(pool, logger) {
  if (!pool) return [];

  let pendingEffects;
  try {
    const result = await pool.query(
      `SELECT e.id, e.proposal_id, e.anomaly_id, e.metric_type,
              e.baseline_value, e.baseline_date,
              a.type AS anomaly_type, a.title AS anomaly_title
         FROM anta_daily.agent_effects e
         JOIN anta_daily.agent_anomalies a ON a.id = e.anomaly_id
        WHERE e.outcome = 'pending'
          AND e.baseline_date <= (current_date - $1::int)
        ORDER BY e.baseline_date`,
      [FOLLOWUP_DAYS]
    );
    pendingEffects = result.rows;
  } catch (err) {
    if (err.code === "42P01") return [];
    throw err;
  }

  if (!pendingEffects.length) return [];

  const evaluated = [];
  for (const effect of pendingEffects) {
    try {
      const followupValue = await measureCurrentMetric(pool, effect);
      if (followupValue === null) continue;

      const changePct = (effect.baseline_value != null && effect.baseline_value !== 0)
        ? ((followupValue - effect.baseline_value) / Math.abs(effect.baseline_value)) * 100
        : null;

      const outcome = classifyOutcome(effect.metric_type, changePct);

      await pool.query(
        `UPDATE anta_daily.agent_effects
            SET followup_value = $2,
                followup_date = current_date,
                change_pct = $3,
                outcome = $4,
                evaluated_at = now()
          WHERE id = $1`,
        [effect.id, followupValue, changePct ? Math.round(changePct * 100) / 100 : null, outcome]
      );

      evaluated.push({ id: effect.id, outcome, changePct });
    } catch (err) {
      logger.warn({ err, effectId: effect.id }, "Failed to evaluate effect");
    }
  }

  return evaluated;
}

async function measureCurrentMetric(pool, effect) {
  switch (effect.metric_type) {
    case "channel_gmv_dod":
    case "channel_gmv_wow":
      return measureChannelGmv(pool, effect);
    case "zero_sales_count":
      return measureZeroSalesCount(pool, effect);
    case "new_product_sales":
      return measureNewProductSales(pool, effect);
    default:
      return null;
  }
}

async function measureChannelGmv(pool, effect) {
  const channelMatch = effect.anomaly_title?.match(/^(.+?)渠道/);
  if (!channelMatch) return null;

  const channelLabel = channelMatch[1];
  const ch = CHANNEL_DASHBOARD_OPTIONS.find((c) => c.label === channelLabel);
  if (!ch) return null;

  const sql = `
    SELECT coalesce(sum(${ch.salesQtyKey} * tag_price), 0) AS gmv
      FROM ${SALES_DAILY_TABLE}
     WHERE sales_date = (current_date - interval '1 day')::date
       AND ${SKU_FILTER_SQL}`;

  const { rows } = await pool.query(sql);
  return rows[0] ? Number(rows[0].gmv) : null;
}

async function measureZeroSalesCount(pool, effect) {
  const salesSumExpr = CHANNEL_DASHBOARD_OPTIONS
    .map((ch) => `coalesce(${ch.salesQtyKey}, 0)`)
    .join(" + ");

  const sql = `
    WITH recent_skus AS (
      SELECT DISTINCT sku
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
    SELECT count(*) AS zero_count
      FROM recent_skus rs
      LEFT JOIN last_7d_sales s ON s.sku = rs.sku
     WHERE coalesce(s.total_qty, 0) = 0`;

  const { rows } = await pool.query(sql);
  return rows[0] ? Number(rows[0].zero_count) : null;
}

async function measureNewProductSales(pool, effect) {
  const salesSumExpr = CHANNEL_DASHBOARD_OPTIONS
    .map((ch) => `coalesce(${ch.salesQtyKey}, 0)`)
    .join(" + ");

  const sql = `
    SELECT count(*)::int AS zero_count FROM (
      SELECT f.sku
        FROM (
          SELECT sku, min(sales_date) AS first_date
            FROM ${SALES_DAILY_TABLE}
           WHERE ${SKU_FILTER_SQL}
           GROUP BY sku
           HAVING min(sales_date) >= (current_date - interval '14 day')::date
        ) f
        JOIN ${SALES_DAILY_TABLE} d ON d.sku = f.sku
       WHERE d.sales_date >= f.first_date
         AND ${SKU_FILTER_SQL}
       GROUP BY f.sku
      HAVING sum(${salesSumExpr}) = 0
    ) sub`;

  const { rows } = await pool.query(sql);
  return rows[0] ? Number(rows[0].zero_count) : 0;
}

function classifyOutcome(metricType, changePct) {
  if (changePct === null) return "unchanged";

  if (metricType === "zero_sales_count" || metricType === "new_product_sales") {
    if (changePct <= -10) return "improved";
    if (changePct >= 10) return "worsened";
    return "unchanged";
  }

  // For GMV metrics, positive change = improvement
  if (changePct >= 5) return "improved";
  if (changePct <= -5) return "worsened";
  return "unchanged";
}

async function getEffectsSummary(pool) {
  if (!pool) return { total: 0, improved: 0, unchanged: 0, worsened: 0, pending: 0 };

  try {
    const { rows } = await pool.query(
      `SELECT outcome, count(*)::int AS cnt
         FROM anta_daily.agent_effects
        GROUP BY outcome`
    );
    const summary = { total: 0, improved: 0, unchanged: 0, worsened: 0, pending: 0 };
    for (const row of rows) {
      summary[row.outcome] = row.cnt;
      summary.total += row.cnt;
    }
    return summary;
  } catch (err) {
    if (err.code === "42P01") return { total: 0, improved: 0, unchanged: 0, worsened: 0, pending: 0 };
    throw err;
  }
}

async function getRecentEffects(pool, limit = 20) {
  if (!pool) return [];

  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.proposal_id, e.metric_type, e.baseline_value,
              e.baseline_date, e.followup_value, e.followup_date,
              e.change_pct, e.outcome, e.evaluated_at,
              p.title AS proposal_title, p.action_type
         FROM anta_daily.agent_effects e
         JOIN anta_daily.agent_proposals p ON p.id = e.proposal_id
        WHERE e.outcome != 'pending'
        ORDER BY e.evaluated_at DESC
        LIMIT $1`,
      [limit]
    );
    return rows;
  } catch (err) {
    if (err.code === "42P01") return [];
    throw err;
  }
}

module.exports = {
  recordBaseline,
  evaluatePendingEffects,
  getEffectsSummary,
  getRecentEffects,
  FOLLOWUP_DAYS,
};
