"use strict";

/**
 * Scheduled reports — auto-generate routine business reports without user intervention.
 *
 * Cyrus's pain point: spending 1-2 hours daily on reports (pull data → VLOOKUP → pivot → format → distribute).
 * This module eliminates that by auto-generating reports on a schedule.
 *
 * Report types:
 *   - daily_channel_summary: Each channel's GMV/qty/active SKU count
 *   - weekly_comparison: Week-over-week change by channel
 *   - anomaly_digest: Inspection results formatted as shareable report
 */

const { SALES_DAILY_TABLE, SKU_FILTER_SQL } = require("../report/constants");
const { CHANNEL_DASHBOARD_OPTIONS } = require("../report/channel/options");
const { buildBuffer } = require("../../lib/report/excelBuilder");

async function generateDailyChannelSummary(pool) {
  if (!pool) return null;

  const channels = [];
  for (const ch of CHANNEL_DASHBOARD_OPTIONS) {
    const sql = `
      SELECT
        coalesce(sum(${ch.salesQtyKey}), 0)::numeric AS qty,
        coalesce(sum(${ch.salesQtyKey} * tag_price), 0)::numeric AS gmv,
        count(DISTINCT CASE WHEN coalesce(${ch.salesQtyKey}, 0) > 0 THEN sku END)::int AS active_sku
      FROM ${SALES_DAILY_TABLE}
      WHERE sales_date = (current_date - interval '1 day')::date
        AND ${SKU_FILTER_SQL}`;

    try {
      const { rows } = await pool.query(sql);
      const row = rows[0] || {};
      if (Number(row.gmv) > 0 || Number(row.qty) > 0) {
        channels.push({
          channel: ch.label,
          gmv: Math.round(Number(row.gmv) * 100) / 100,
          qty: Math.round(Number(row.qty)),
          active_sku: Number(row.active_sku || 0),
        });
      }
    } catch (_) { /* skip channels that fail */ }
  }

  if (!channels.length) return null;

  const totalGmv = channels.reduce((s, c) => s + c.gmv, 0);
  const totalQty = channels.reduce((s, c) => s + c.qty, 0);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10);

  const schema = {
    title: `每日渠道汇总 ${dateStr}`,
    sheets: [
      {
        name: "渠道汇总",
        columns: [
          { header: "渠道", key: "channel", width: 18, type: "text" },
          { header: "GMV (元)", key: "gmv", width: 15, type: "currency" },
          { header: "销量", key: "qty", width: 12, type: "number" },
          { header: "动销SKU数", key: "active_sku", width: 12, type: "number" },
          { header: "GMV占比", key: "gmv_pct", width: 10, type: "percent" },
        ],
        data: channels.map((c) => ({
          ...c,
          gmv_pct: totalGmv > 0 ? c.gmv / totalGmv : 0,
        })),
        options: {
          freezeRow: 1,
          autoFilter: true,
          sortBy: { key: "gmv", order: "desc" },
        },
      },
      {
        name: "统计",
        columns: [
          { header: "指标", key: "metric", width: 20, type: "text" },
          { header: "数值", key: "value", width: 20, type: "text" },
        ],
        data: [
          { metric: "统计日期", value: dateStr },
          { metric: "渠道总数", value: String(channels.length) },
          { metric: "总 GMV", value: `¥${totalGmv.toLocaleString("zh-CN")}` },
          { metric: "总销量", value: totalQty.toLocaleString("zh-CN") },
        ],
        options: { freezeRow: 1, autoFilter: false },
      },
    ],
  };

  return { schema, buffer: await buildBuffer(schema), date: dateStr };
}

async function generateWeeklyComparison(pool) {
  if (!pool) return null;

  const channels = [];
  for (const ch of CHANNEL_DASHBOARD_OPTIONS) {
    const sql = `
      WITH this_week AS (
        SELECT coalesce(sum(${ch.salesQtyKey} * tag_price), 0)::numeric AS gmv
        FROM ${SALES_DAILY_TABLE}
        WHERE sales_date BETWEEN (current_date - interval '7 day')::date
                              AND (current_date - interval '1 day')::date
          AND ${SKU_FILTER_SQL}
      ),
      prev_week AS (
        SELECT coalesce(sum(${ch.salesQtyKey} * tag_price), 0)::numeric AS gmv
        FROM ${SALES_DAILY_TABLE}
        WHERE sales_date BETWEEN (current_date - interval '14 day')::date
                              AND (current_date - interval '8 day')::date
          AND ${SKU_FILTER_SQL}
      )
      SELECT t.gmv AS this_gmv, p.gmv AS prev_gmv,
             CASE WHEN p.gmv > 0 THEN round((t.gmv - p.gmv) / p.gmv * 100, 2) ELSE NULL END AS change_pct
      FROM this_week t, prev_week p`;

    try {
      const { rows } = await pool.query(sql);
      const row = rows[0] || {};
      if (Number(row.this_gmv) > 0 || Number(row.prev_gmv) > 0) {
        channels.push({
          channel: ch.label,
          this_week_gmv: Math.round(Number(row.this_gmv) * 100) / 100,
          prev_week_gmv: Math.round(Number(row.prev_gmv) * 100) / 100,
          change_pct: row.change_pct != null ? Number(row.change_pct) / 100 : null,
        });
      }
    } catch (_) { /* skip */ }
  }

  if (!channels.length) return null;

  const schema = {
    title: `周环比对比报告`,
    sheets: [{
      name: "周环比",
      columns: [
        { header: "渠道", key: "channel", width: 18, type: "text" },
        { header: "本周GMV", key: "this_week_gmv", width: 15, type: "currency" },
        { header: "上周GMV", key: "prev_week_gmv", width: 15, type: "currency" },
        { header: "变化率", key: "change_pct", width: 12, type: "percent", conditional: { negative: "red", positive: "green" } },
      ],
      data: channels,
      options: { freezeRow: 1, autoFilter: true, sortBy: { key: "change_pct", order: "asc" } },
    }],
  };

  return { schema, buffer: await buildBuffer(schema) };
}

module.exports = { generateDailyChannelSummary, generateWeeklyComparison };
