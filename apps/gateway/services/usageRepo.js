"use strict";

/**
 * usageRepo — aggregates from anta_daily.audit_log for the admin usage page.
 *
 * All queries are admin-only and parameterized (interval expressed as a
 * PostgreSQL interval literal; we whitelist the allowed values to avoid
 * any SQL injection via the interval string).
 */

const { childLogger } = require("../lib/logger");

const log = childLogger("usageRepo");

const INTERVAL_WHITELIST = new Set([
  "1 hour",
  "6 hours",
  "24 hours",
  "7 days",
  "30 days",
]);

function resolveInterval(raw) {
  const value = String(raw || "24 hours").trim();
  return INTERVAL_WHITELIST.has(value) ? value : "24 hours";
}

async function listByPath(getPool, intervalRaw) {
  const interval = resolveInterval(intervalRaw);
  const pool = await getPool();
  const { rows } = await pool.query(
    `
    SELECT
      path,
      method,
      COUNT(*)::bigint AS total_requests,
      COUNT(DISTINCT account_id)::bigint AS unique_users,
      ROUND(AVG(duration_ms))::int AS avg_duration_ms,
      COALESCE(
        (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms))::int,
        0
      ) AS p95_duration_ms,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END)::bigint AS error_count,
      MAX(created_at) AS last_request_at
    FROM anta_daily.audit_log
    WHERE created_at > now() - $1::interval
    GROUP BY path, method
    ORDER BY total_requests DESC
    LIMIT 200
    `,
    [interval]
  );
  return { interval, rows };
}

async function listByUser(getPool, intervalRaw) {
  const interval = resolveInterval(intervalRaw);
  const pool = await getPool();
  const { rows } = await pool.query(
    `
    SELECT
      account_id,
      username,
      is_admin,
      COUNT(*)::bigint AS total_requests,
      COUNT(DISTINCT path)::bigint AS unique_paths,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END)::bigint AS error_count,
      MAX(created_at) AS last_request_at
    FROM anta_daily.audit_log
    WHERE created_at > now() - $1::interval
      AND account_id IS NOT NULL
    GROUP BY account_id, username, is_admin
    ORDER BY total_requests DESC
    LIMIT 200
    `,
    [interval]
  );
  return { interval, rows };
}

async function summary(getPool, intervalRaw) {
  const interval = resolveInterval(intervalRaw);
  const pool = await getPool();
  const { rows } = await pool.query(
    `
    SELECT
      COUNT(*)::bigint AS total_requests,
      COUNT(DISTINCT account_id)::bigint AS unique_users,
      SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END)::bigint AS server_errors,
      SUM(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 ELSE 0 END)::bigint AS client_errors,
      ROUND(AVG(duration_ms))::int AS avg_duration_ms
    FROM anta_daily.audit_log
    WHERE created_at > now() - $1::interval
    `,
    [interval]
  );
  return { interval, row: rows[0] || {} };
}

async function getUsage(getPool, intervalRaw) {
  try {
    const [byPathResult, byUserResult, summaryResult] = await Promise.all([
      listByPath(getPool, intervalRaw),
      listByUser(getPool, intervalRaw),
      summary(getPool, intervalRaw),
    ]);
    return {
      ok: true,
      interval: byPathResult.interval,
      summary: summaryResult.row,
      by_path: byPathResult.rows,
      by_user: byUserResult.rows,
    };
  } catch (err) {
    log.warn({ err: err && err.message }, `usage query failed: ${err && err.message}`);
    // Common failure: audit_log table not yet created (PR7 migration pending).
    const message = String(err && err.message ? err.message : err);
    const missingTable = /relation\s+"?anta_daily.audit_log"?\s+does not exist/i.test(message);
    return {
      ok: false,
      message: missingTable
        ? "audit_log 表尚未创建，请先在数据库执行 pipelines/pg-daily-wide/sql/90_audit_log.sql"
        : message,
      by_path: [],
      by_user: [],
      summary: {},
    };
  }
}

module.exports = { getUsage, INTERVAL_WHITELIST };
