"use strict";

/**
 * Audit logger — dual-sink.
 *
 * Sinks:
 *   1. pino child logger `module:"audit"` — always on, picks up file rolling
 *      from lib/logger (PR3).
 *   2. PostgreSQL anta_daily.audit_log — opt-in via ENABLE_AUDIT_DB, default on.
 *      Disabled automatically when the DB pool is unavailable to avoid
 *      cascading failures during outages.
 *
 * Design:
 *   - record() is fire-and-forget. It never throws and never blocks the
 *     request path. A dropped audit row is preferable to a dropped user
 *     response.
 *   - A best-effort queue batches DB inserts every 500ms or 32 rows.
 *   - If the DB insert errors three times in a row, the DB sink suspends
 *     itself for 60 seconds (circuit-breaker) to avoid log-flooding.
 *
 * Schema: pipelines/pg-daily-wide/sql/90_audit_log.sql
 */

const { childLogger } = require("../lib/logger");

const log = childLogger("audit");

// Env vars read lazily per-operation so tests can override at runtime.
function flushIntervalMs() {
  return Number(process.env.AUDIT_FLUSH_INTERVAL_MS || 500);
}
function flushBatchSize() {
  return Number(process.env.AUDIT_FLUSH_BATCH_SIZE || 32);
}
function circuitBreakMs() {
  return Number(process.env.AUDIT_BREAKER_MS || 60_000);
}

function isEnabledDb() {
  const raw = String(process.env.ENABLE_AUDIT_DB || "").trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "false" || raw === "0" || raw === "no" || raw === "off");
}

function createAuditLogger({ getPool } = {}) {
  const queue = [];
  let flushTimer = null;
  let consecutiveFailures = 0;
  let suspendedUntil = 0;

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush().catch(() => {});
    }, flushIntervalMs());
    // Allow Node.js to exit even when only the timer is pending.
    if (flushTimer && typeof flushTimer.unref === "function") flushTimer.unref();
  }

  async function flush() {
    if (!queue.length) return;
    if (!isEnabledDb()) {
      queue.length = 0;
      return;
    }
    if (Date.now() < suspendedUntil) {
      queue.length = 0;
      return;
    }
    if (typeof getPool !== "function") {
      queue.length = 0;
      return;
    }
    const batch = queue.splice(0, flushBatchSize());
    if (!batch.length) return;

    try {
      const pool = await getPool();
      const placeholders = batch
        .map((_, i) => {
          const base = i * 10;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
        })
        .join(",");
      const values = [];
      for (const entry of batch) {
        values.push(
          entry.account_id || null,
          entry.username || null,
          entry.is_admin === true ? true : entry.is_admin === false ? false : null,
          entry.method,
          entry.path,
          entry.status_code ?? null,
          entry.duration_ms ?? null,
          entry.ip || null,
          entry.user_agent || null,
          entry.metadata ? JSON.stringify(entry.metadata) : null
        );
      }
      const sql = `
        INSERT INTO anta_daily.audit_log
          (account_id, username, is_admin, method, path, status_code, duration_ms, ip, user_agent, metadata)
        VALUES ${placeholders}
      `;
      await pool.query(sql, values);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      log.warn(
        { err: err && err.message, queued: queue.length, consecutiveFailures },
        `audit DB flush failed: ${err && err.message}`
      );
      if (consecutiveFailures >= 3) {
        suspendedUntil = Date.now() + circuitBreakMs();
        log.error(
          { until: new Date(suspendedUntil).toISOString() },
          "audit DB sink suspended; pino file sink continues"
        );
      }
    } finally {
      if (queue.length) scheduleFlush();
    }
  }

  function record(entry) {
    // Always log to pino (file sink always on).
    log.info(entry, `${entry.method} ${entry.path} → ${entry.status_code} ${entry.duration_ms}ms`);

    // Queue for DB insert if enabled.
    if (!isEnabledDb()) return;
    queue.push(entry);
    if (queue.length >= flushBatchSize()) {
      flush().catch(() => {});
    } else {
      scheduleFlush();
    }
  }

  return { record, flush };
}

module.exports = { createAuditLogger, isEnabledDb };
