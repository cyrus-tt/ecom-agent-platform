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
          `SELECT id, inspection_id, type, severity, title, description, metric_current, metric_previous, change_pct, suggested_action, status, created_at
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
          `SELECT id, inspection_id, type, severity, title, description, metric_current, metric_previous, change_pct, suggested_action, status, created_at
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

  // ── GET /api/agent/inspections/:id/report ── download Excel report ──
  app.get(
    "/api/agent/inspections/:id/report",
    requirePermission("analysis"),
    async (req, res, next) => {
      try {
        const id = parsePositiveInt(req.params.id, 0);
        if (!id) return res.status(400).json({ ok: false, message: "invalid id" });

        const pool = ctx.getPool();
        const inspResult = await bestEffort(pool,
          `SELECT id, run_date, anomaly_count, summary, status, created_at
             FROM anta_daily.agent_inspections WHERE id = $1`, [id]);
        const inspection = inspResult.rows[0];
        if (!inspection) {
          return res.status(404).json({ ok: false, message: "inspection not found" });
        }

        const anomResult = await bestEffort(pool,
          `SELECT type, severity, title, description, metric_current, metric_previous, change_pct, suggested_action, status
             FROM anta_daily.agent_anomalies WHERE inspection_id = $1 ORDER BY severity DESC`, [id]);

        const propResult = await bestEffort(pool,
          `SELECT risk_level, action_type, title, description, status
             FROM anta_daily.agent_proposals WHERE inspection_id = $1 ORDER BY created_at`, [id]);

        const autoReport = require("../services/inspection/autoReport");
        const buffer = await autoReport.generateReportBuffer(inspection, anomResult.rows, propResult.rows);
        const filename = encodeURIComponent(`巡检报告_${inspection.run_date}.xlsx`);

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
        return res.send(buffer);
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── GET /api/agent/inspections/latest/report ── latest report download
  app.get(
    "/api/agent/inspections/latest/report",
    requirePermission("analysis"),
    async (_req, res, next) => {
      try {
        const pool = ctx.getPool();
        const inspResult = await bestEffort(pool,
          `SELECT id, run_date, anomaly_count, summary, status, created_at
             FROM anta_daily.agent_inspections ORDER BY run_date DESC LIMIT 1`, []);
        const inspection = inspResult.rows[0];
        if (!inspection) {
          return res.status(404).json({ ok: false, message: "no inspections found" });
        }

        const anomResult = await bestEffort(pool,
          `SELECT type, severity, title, description, metric_current, metric_previous, change_pct, suggested_action, status
             FROM anta_daily.agent_anomalies WHERE inspection_id = $1 ORDER BY severity DESC`,
          [inspection.id]);

        const propResult = await bestEffort(pool,
          `SELECT risk_level, action_type, title, description, status
             FROM anta_daily.agent_proposals WHERE inspection_id = $1 ORDER BY created_at`,
          [inspection.id]);

        const autoReport = require("../services/inspection/autoReport");
        const buffer = await autoReport.generateReportBuffer(inspection, anomResult.rows, propResult.rows);
        const filename = encodeURIComponent(`巡检报告_${inspection.run_date}.xlsx`);

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
        return res.send(buffer);
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── POST /api/agent/anomalies/:id/acknowledge ── mark as expected ──
  app.post(
    "/api/agent/anomalies/:id/acknowledge",
    requirePermission("analysis"),
    express.json({ limit: "64kb" }),
    async (req, res, next) => {
      try {
        const id = parsePositiveInt(req.params.id, 0);
        if (!id) return res.status(400).json({ ok: false, message: "invalid id" });

        const reason = req.body?.reason || "acknowledged";
        const pool = ctx.getPool();
        const { rows } = await pool.query(
          `UPDATE anta_daily.agent_anomalies
              SET status = 'acknowledged'
            WHERE id = $1 AND status = 'open'
            RETURNING id`,
          [id],
        );
        if (!rows.length) {
          return res.status(404).json({ ok: false, message: "anomaly not found or already handled" });
        }

        // Learn suppression pattern from this acknowledgment
        const suppressions = require("../services/inspection/suppressions");
        const anomalyResult = await bestEffort(pool,
          `SELECT type, severity, title, change_pct FROM anta_daily.agent_anomalies WHERE id = $1`, [id]);
        if (anomalyResult.rows[0]) {
          await suppressions.learnFromAcknowledgment(pool, anomalyResult.rows[0], reason);
        }

        return res.json({ ok: true, anomaly_id: id, status: "acknowledged" });
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
          const engine = require("../services/inspection");
          const pool = ctx.getPool();
          const inspection = await engine.runNow(pool, console);
          return res.json({ ok: true, inspection });
        } finally {
          _inspectionRunning = false;
        }
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── GET /api/agent/inspections/latest/insight ── AI analysis ────────
  app.get(
    "/api/agent/inspections/latest/insight",
    requirePermission("analysis"),
    async (_req, res, next) => {
      try {
        const pool = ctx.getPool();
        const { rows } = await bestEffort(
          pool,
          `SELECT findings->'ai_insight' AS insight
             FROM anta_daily.agent_inspections
            WHERE findings->'ai_insight' IS NOT NULL
            ORDER BY run_date DESC LIMIT 1`,
          [],
        );
        const insight = rows[0]?.insight || null;
        return res.json({ ok: true, insight });
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── GET /api/agent/digest ── morning briefing message ─────────────
  app.get(
    "/api/agent/digest",
    requirePermission("analysis"),
    async (_req, res, next) => {
      try {
        const digest = require("../services/inspection/digest");
        const pool = ctx.getPool();
        const message = await digest.buildDigest(pool);
        if (!message) {
          return res.json({ ok: true, message: null, reason: "no_inspection_today" });
        }
        return res.json({ ok: true, message });
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── GET /api/agent/proposals ── approval queue ────────────────────
  app.get(
    "/api/agent/proposals",
    requirePermission("analysis"),
    async (req, res, next) => {
      try {
        const status = req.query.status || "all";
        const limit = Math.min(100, parsePositiveInt(req.query.limit, 50));
        const pool = ctx.getPool();
        const whereClause = status === "all" ? "" : "WHERE p.status = $3";
        const params = status === "all" ? [limit, 0] : [limit, 0, status];
        const { rows } = await bestEffort(
          pool,
          `SELECT p.id, p.anomaly_id, p.inspection_id, p.risk_level,
                  p.action_type, p.title, p.description, p.proposed_action,
                  p.status, p.decided_at, p.decided_by, p.reject_reason,
                  p.execution_result, p.created_at
             FROM anta_daily.agent_proposals p
             ${whereClause}
            ORDER BY
              CASE p.status WHEN 'pending' THEN 0 ELSE 1 END,
              p.created_at DESC
            LIMIT $1 OFFSET $2`,
          params,
        );
        return res.json({ ok: true, items: rows });
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── GET /api/agent/proposals/pending ── count + list of pending ───
  app.get(
    "/api/agent/proposals/pending",
    requirePermission("analysis"),
    async (_req, res, next) => {
      try {
        const pool = ctx.getPool();
        const { rows } = await bestEffort(
          pool,
          `SELECT id, anomaly_id, inspection_id, risk_level,
                  action_type, title, description, proposed_action,
                  status, created_at
             FROM anta_daily.agent_proposals
            WHERE status = 'pending'
            ORDER BY created_at DESC`,
          [],
        );
        return res.json({ ok: true, count: rows.length, items: rows });
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── POST /api/agent/proposals/:id/approve ── approve a proposal ──
  app.post(
    "/api/agent/proposals/:id/approve",
    requireAdmin,
    express.json({ limit: "64kb" }),
    async (req, res, next) => {
      try {
        const id = parsePositiveInt(req.params.id, 0);
        if (!id) return res.status(400).json({ ok: false, message: "invalid id" });

        const pool = ctx.getPool();
        const { rows } = await pool.query(
          `UPDATE anta_daily.agent_proposals
              SET status = 'approved', decided_at = now(), decided_by = $2
            WHERE id = $1 AND status = 'pending'
            RETURNING id`,
          [id, req.user?.username || "admin"],
        );
        if (!rows.length) {
          return res.status(404).json({ ok: false, message: "proposal not found or not pending" });
        }

        const proposalService = require("../services/inspection/proposals");
        const result = await proposalService.executeProposal(pool, id);
        return res.json({ ok: true, proposal_id: id, execution: result });
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── POST /api/agent/proposals/:id/reject ── reject a proposal ────
  app.post(
    "/api/agent/proposals/:id/reject",
    requireAdmin,
    express.json({ limit: "64kb" }),
    async (req, res, next) => {
      try {
        const id = parsePositiveInt(req.params.id, 0);
        if (!id) return res.status(400).json({ ok: false, message: "invalid id" });

        const reason = req.body?.reason || "";
        const pool = ctx.getPool();
        const { rows } = await pool.query(
          `UPDATE anta_daily.agent_proposals
              SET status = 'rejected', decided_at = now(), decided_by = $2, reject_reason = $3
            WHERE id = $1 AND status = 'pending'
            RETURNING id`,
          [id, req.user?.username || "admin", reason],
        );
        if (!rows.length) {
          return res.status(404).json({ ok: false, message: "proposal not found or not pending" });
        }
        return res.json({ ok: true, proposal_id: id });
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── POST /api/agent/proposals/batch-approve ── approve all pending ─
  app.post(
    "/api/agent/proposals/batch-approve",
    requireAdmin,
    express.json({ limit: "64kb" }),
    async (req, res, next) => {
      try {
        const pool = ctx.getPool();
        const { rows } = await pool.query(
          `UPDATE anta_daily.agent_proposals
              SET status = 'approved', decided_at = now(), decided_by = $1
            WHERE status = 'pending'
            RETURNING id`,
          [req.user?.username || "admin"],
        );
        if (!rows.length) {
          return res.json({ ok: true, approved: 0, results: [] });
        }

        const proposalService = require("../services/inspection/proposals");
        const results = [];
        for (const row of rows) {
          const result = await proposalService.executeProposal(pool, row.id);
          results.push({ id: row.id, result });
        }
        return res.json({ ok: true, approved: rows.length, results });
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── GET /api/agent/effects/summary ── aggregate effectiveness ──────
  app.get(
    "/api/agent/effects/summary",
    requirePermission("analysis"),
    async (_req, res, next) => {
      try {
        const effectsService = require("../services/inspection/effects");
        const pool = ctx.getPool();
        const summary = await effectsService.getEffectsSummary(pool);
        return res.json({ ok: true, ...summary });
      } catch (err) {
        return next(err);
      }
    },
  );

  // ── GET /api/agent/effects ── recent evaluated effects ───────────
  app.get(
    "/api/agent/effects",
    requirePermission("analysis"),
    async (req, res, next) => {
      try {
        const limit = Math.min(50, parsePositiveInt(req.query.limit, 20));
        const effectsService = require("../services/inspection/effects");
        const pool = ctx.getPool();
        const items = await effectsService.getRecentEffects(pool, limit);
        return res.json({ ok: true, items });
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

        // Three queries in parallel, all tolerate missing tables
        const [runsResult, inspResult, proposalResult] = await Promise.all([
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
          bestEffort(
            pool,
            `SELECT id, created_at, title AS summary, status, risk_level, action_type
               FROM anta_daily.agent_proposals
              WHERE created_at >= NOW() - MAKE_INTERVAL(days => $1)
                AND status IN ('approved', 'executed', 'rejected')
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
        for (const row of proposalResult.rows) {
          items.push({
            type: "proposal",
            id: row.id,
            created_at: row.created_at,
            summary: row.summary || "",
            status: row.status,
            risk_level: row.risk_level,
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
