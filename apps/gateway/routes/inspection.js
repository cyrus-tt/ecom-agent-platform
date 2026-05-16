"use strict";

/**
 * Inspection endpoints — daily data-quality patrol results.
 *
 * Scope:
 *   /api/agent/inspections           — paginated list of inspection runs
 *   /api/agent/inspections/latest    — most recent inspection + anomalies
 *   /api/agent/inspections/:id       — single inspection + anomalies
 *   /api/agent/activity              — merged timeline (runs + inspections)
 *   /api/admin/inspection/run        — manually trigger an inspection
 */

const { requirePermission } = require("../middleware/requirePermission");
const { requireAdmin } = require("../middleware/requireAdmin");

// ── bestEffort: tolerate missing tables (first run before DDL) ──────
async function bestEffort(pool, sql, params) {
  try {
    if (!pool) return { rows: [] };
    return await pool.query(sql, params);
  } catch (err) {
    if (err.message?.includes("does not exist")) return { rows: [] };
    throw err;
  }
}

function register(app, ctx) {
  const { express, parsePositiveInt } = ctx;

  // ── GET /api/agent/inspections ── paginated list ──────────────────
  app.get(
    "/api/agent/inspections",
    requirePermission("analysis"),
    async (req, res, next) => {
      try {
        const limit = Math.min(100, parsePositiveInt(req.query.limit, 30));
        const offset = Math.max(0, parsePositiveInt(req.query.offset, 0) - 0);
        const pool = ctx.getPool();
        const { rows } = await bestEffort(
          pool,
          `SELECT id, run_date, anomaly_count, summary, status, created_at
             FROM anta_daily.agent_inspections
            ORDER BY run_date DESC
            LIMIT $1 OFFSET $2`,
          [limit, offset],
        );
        return res.json({ ok: true, items: rows });
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── GET /api/agent/inspections/latest ── most recent + anomalies ──
  app.get(
    "/api/agent/inspections/latest",
    requirePermission("analysis"),
    async (_req, res, next) => {
      try {
        const pool = ctx.getPool();
        const inspResult = await bestEffort(
          pool,
          `SELECT id, run_date, anomaly_count, summary, status, created_at
             FROM anta_daily.agent_inspections
            ORDER BY run_date DESC
            LIMIT 1`,
          [],
        );
        const inspection = inspResult.rows[0] || null;
        if (!inspection) {
          return res.json({ ok: true, inspection: null, anomalies: [] });
        }
        const anomResult = await bestEffort(
          pool,
          `SELECT id, inspection_id, metric_key, severity, detail, created_at
             FROM anta_daily.agent_anomalies
            WHERE inspection_id = $1
            ORDER BY severity DESC, id`,
          [inspection.id],
        );
        return res.json({
          ok: true,
          inspection,
          anomalies: anomResult.rows,
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── GET /api/agent/inspections/:id ── single inspection + anomalies
  app.get(
    "/api/agent/inspections/:id",
    requirePermission("analysis"),
    async (req, res, next) => {
      try {
        const id = parsePositiveInt(req.params.id, 0);
        if (!id) {
          return res.status(400).json({ ok: false, message: "invalid id" });
        }
        const pool = ctx.getPool();
        const inspResult = await bestEffort(
          pool,
          `SELECT id, run_date, anomaly_count, summary, status, created_at
             FROM anta_daily.agent_inspections
            WHERE id = $1`,
          [id],
        );
        const inspection = inspResult.rows[0] || null;
        if (!inspection) {
          return res.status(404).json({ ok: false, message: "inspection not found" });
        }
        const anomResult = await bestEffort(
          pool,
          `SELECT id, inspection_id, metric_key, severity, detail, created_at
             FROM anta_daily.agent_anomalies
            WHERE inspection_id = $1
            ORDER BY severity DESC, id`,
          [inspection.id],
        );
        return res.json({
          ok: true,
          inspection,
          anomalies: anomResult.rows,
        });
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── POST /api/admin/inspection/run ── manual trigger ──────────────
  let _inspectionRunning = false;

  app.post(
    "/api/admin/inspection/run",
    requireAdmin,
    express.json({ limit: "64kb" }),
    async (_req, res, next) => {
      try {
        if (_inspectionRunning) {
          return res.status(429).json({
            ok: false,
            message: "inspection already running",
          });
        }
        _inspectionRunning = true;
        try {
          // The inspection engine is loaded lazily — it may not exist yet
          // (another agent is building it). Fail gracefully.
          let inspection;
          try {
            const engine = require("../services/inspection");
            inspection = await engine.runNow();
          } catch (err) {
            if (err.code === "MODULE_NOT_FOUND") {
              return res.status(501).json({
                ok: false,
                message: "inspection engine not available yet",
              });
            }
            throw err;
          }
          return res.json({ ok: true, inspection });
        } finally {
          _inspectionRunning = false;
        }
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── GET /api/agent/activity ── merged timeline ────────────────────
  app.get(
    "/api/agent/activity",
    requirePermission("analysis"),
    async (req, res, next) => {
      try {
        const days = Math.min(30, parsePositiveInt(req.query.days, 7));
        const pool = ctx.getPool();

        // Two queries in parallel, both tolerate missing tables
        const [runsResult, inspResult] = await Promise.all([
          bestEffort(
            pool,
            `SELECT id, created_at, question AS summary
               FROM anta_daily.agent_runs
              WHERE created_at >= NOW() - MAKE_INTERVAL(days => $1)
              ORDER BY created_at DESC`,
            [days],
          ),
          bestEffort(
            pool,
            `SELECT id, created_at, summary, anomaly_count
               FROM anta_daily.agent_inspections
              WHERE created_at >= NOW() - MAKE_INTERVAL(days => $1)
              ORDER BY created_at DESC`,
            [days],
          ),
        ]);

        const items = [];
        for (const row of runsResult.rows) {
          items.push({
            type: "analysis",
            id: row.id,
            created_at: row.created_at,
            summary: row.summary || "",
          });
        }
        for (const row of inspResult.rows) {
          items.push({
            type: "inspection",
            id: row.id,
            created_at: row.created_at,
            summary: row.summary || "",
            anomaly_count: row.anomaly_count ?? 0,
          });
        }
        // Sort merged timeline descending by created_at
        items.sort((a, b) => {
          const ta = new Date(a.created_at).getTime() || 0;
          const tb = new Date(b.created_at).getTime() || 0;
          return tb - ta;
        });

        return res.json({ ok: true, items });
      } catch (err) {
        return next(err);
      }
    },
  );
}

module.exports = { register };
