"use strict";

const { SALES_DAILY_TABLE, SKU_FILTER_SQL } = require("../report/constants");
const { CHANNEL_DASHBOARD_OPTIONS } = require("../report/channel/options");

const CHANNEL_MAP = new Map(CHANNEL_DASHBOARD_OPTIONS.map((ch) => [ch.code, ch]));

async function queryChannelTrend(pool, channelCode, anchorDate) {
  const ch = CHANNEL_MAP.get(channelCode);
  if (!ch) return { error: "unknown_channel" };
  if (!pool) return { data: [] };

  const anchor = anchorDate || new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const sql = `
    WITH days AS (
      SELECT generate_series(
        ($1::date - interval '6 day')::date,
        $1::date,
        interval '1 day'
      )::date AS sales_date
    ),
    sales AS (
      SELECT sales_date,
             coalesce(sum(${ch.salesQtyKey} * tag_price), 0)::numeric AS gmv
        FROM ${SALES_DAILY_TABLE}
       WHERE sales_date BETWEEN ($1::date - interval '6 day')::date AND $1::date
         AND ${SKU_FILTER_SQL}
       GROUP BY sales_date
    )
    SELECT to_char(d.sales_date, 'YYYY-MM-DD') AS date,
           coalesce(s.gmv, 0) AS gmv
      FROM days d
      LEFT JOIN sales s ON s.sales_date = d.sales_date
     ORDER BY d.sales_date`;

  try {
    const { rows } = await pool.query(sql, [anchor]);
    return {
      data: rows.map((r) => ({ date: r.date, gmv: Math.round(Number(r.gmv) * 100) / 100 })),
    };
  } catch (err) {
    if (err.code === "42P01") return { data: [] };
    throw err;
  }
}

module.exports = { queryChannelTrend, CHANNEL_MAP };
