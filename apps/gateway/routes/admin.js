"use strict";

/**
 * Admin endpoints — all require the `requireAdmin` middleware.
 *
 * Scope:
 *   /api/admin/accounts                       — managed account CRUD
 *   /api/admin/accounts/:id/permissions       — module permission update
 *   /api/admin/accounts/:id/password          — password reset
 *   /api/settings/ai                          — AI key status
 *   /api/settings/ai/deepseek-key             — AI key set/clear
 *   /api/admin/refresh-arrival                — trigger arrival refresh job
 *   /api/admin/rebuild-weekly                 — trigger PG pipeline rebuild
 *   /api/admin/jobs/:jobId                    — managed job status
 *   /api/admin/usage                          — aggregate from audit_log (PR9)
 */

const fs = require("fs");
const usageRepo = require("../services/usageRepo");

function register(app, ctx) {
  const {
    express,
    requireAdmin,
    runtimeSecrets,
    // account helpers
    getAuthStore,
    sanitizeAccountForClient,
    createManagedAccount,
    updateManagedAccountPermissions,
    updateManagedAccountPassword,
    AUTH_PERMISSION_MODULES,
    // ops helpers
    getArrivalAutoStartState,
    getArrivalServiceStatus,
    refreshArrivalViaUpstream,
    startManagedJob,
    JOB_STORE,
    ARRIVAL_BASE,
    ARRIVAL_PROJECT_DIR,
    PG_PIPELINE_SCRIPT,
    PROJECT_ROOT,
    // PR9: audit_log aggregate
    getPool,
  } = ctx;

  // ── managed accounts ───────────────────────────────────────────────

  app.get("/api/admin/accounts", requireAdmin, (_req, res) => {
    const authStore = getAuthStore();
    return res.json({
      ok: true,
      shared_username: authStore.username,
      primary_admin_id: authStore.primary_admin_id,
      modules: AUTH_PERMISSION_MODULES,
      accounts: authStore.accounts.map((account) => sanitizeAccountForClient(account)),
    });
  });

  app.post("/api/admin/accounts", requireAdmin, express.json({ limit: "256kb" }), (req, res) => {
    try {
      const account = createManagedAccount({
        name: req.body?.name,
        password: req.body?.password,
        permissions: req.body?.permissions,
      });
      return res.status(201).json({
        ok: true,
        account: sanitizeAccountForClient(account),
      });
    } catch (err) {
      return res.status(400).json({ ok: false, message: String(err?.message || err) });
    }
  });

  app.patch(
    "/api/admin/accounts/:accountId/permissions",
    requireAdmin,
    express.json({ limit: "256kb" }),
    (req, res) => {
      try {
        const account = updateManagedAccountPermissions(req.params.accountId, req.body?.permissions);
        if (!account) {
          return res.status(404).json({ ok: false, message: "account not found" });
        }
        return res.json({
          ok: true,
          account: sanitizeAccountForClient(account),
        });
      } catch (err) {
        const message = String(err?.message || err);
        const status = message === "account not found" ? 404 : 400;
        return res.status(status).json({ ok: false, message });
      }
    }
  );

  app.patch(
    "/api/admin/accounts/:accountId/password",
    requireAdmin,
    express.json({ limit: "256kb" }),
    (req, res) => {
      try {
        const account = updateManagedAccountPassword(req.params.accountId, req.body?.password);
        if (!account) {
          return res.status(404).json({ ok: false, message: "account not found" });
        }
        return res.json({
          ok: true,
          account: sanitizeAccountForClient(account),
        });
      } catch (err) {
        const message = String(err?.message || err);
        const status = message === "account not found" ? 404 : 400;
        return res.status(status).json({ ok: false, message });
      }
    }
  );

  // ── AI secrets ─────────────────────────────────────────────────────

  app.get("/api/settings/ai", requireAdmin, (_req, res) => {
    return res.json({
      ok: true,
      settings: runtimeSecrets.getDeepseekStatus(),
    });
  });

  app.post("/api/settings/ai/deepseek-key", requireAdmin, express.json({ limit: "128kb" }), (req, res) => {
    try {
      const apiKey = String(req.body?.api_key || "").trim();
      if (!apiKey) {
        return res.status(400).json({ ok: false, message: "api_key is required" });
      }
      const settings = runtimeSecrets.setDeepseekApiKey(apiKey);
      return res.json({
        ok: true,
        settings,
      });
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      return res.status(500).json({ ok: false, message });
    }
  });

  app.delete("/api/settings/ai/deepseek-key", requireAdmin, (_req, res) => {
    const settings = runtimeSecrets.clearDeepseekApiKey();
    return res.json({
      ok: true,
      settings,
    });
  });

  // ── data refresh / rebuild jobs ────────────────────────────────────

  app.post("/api/admin/refresh-arrival", requireAdmin, async (req, res) => {
    try {
      const autoStartState = getArrivalAutoStartState();
      if (!autoStartState.ready) {
        const arrivalStatus = await getArrivalServiceStatus({ allowAutoStart: false });
        if (!arrivalStatus.ok) {
          return res.status(503).json({
            ok: false,
            message: autoStartState.message,
            target: ARRIVAL_BASE,
            auto_start: autoStartState,
          });
        }
        const upstreamRefresh = await refreshArrivalViaUpstream(600000);
        if (!upstreamRefresh.ok) {
          return res.status(upstreamRefresh.status || 502).json({
            ok: false,
            message: `arrival refresh failed: ${upstreamRefresh.message}`,
            target: upstreamRefresh.target,
            upstream: upstreamRefresh.data,
          });
        }
        return res.json({
          ok: true,
          mode: "upstream",
          message: "arrival refresh completed",
          target: upstreamRefresh.target,
          upstream: upstreamRefresh.data,
        });
      }
      const result = startManagedJob({
        type: "refresh-arrival",
        command: "python",
        args: ["dashboard_service.py", "--refresh-once"],
        cwd: ARRIVAL_PROJECT_DIR,
      });
      res.json({
        ok: true,
        reused: result.reused,
        job: result.job,
      });
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      res.status(500).json({ ok: false, message });
    }
  });

  app.post("/api/admin/rebuild-weekly", requireAdmin, (req, res) => {
    try {
      if (!fs.existsSync(PG_PIPELINE_SCRIPT)) {
        return res.status(500).json({ ok: false, message: "pipeline script not found" });
      }
      const result = startManagedJob({
        type: "rebuild-weekly",
        command: "powershell",
        args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PG_PIPELINE_SCRIPT],
        cwd: PROJECT_ROOT,
      });
      res.json({
        ok: true,
        reused: result.reused,
        job: result.job,
      });
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      res.status(500).json({ ok: false, message });
    }
  });

  app.get("/api/admin/jobs/:jobId", requireAdmin, (req, res) => {
    const jobId = String(req.params.jobId || "");
    const job = JOB_STORE.get(jobId);
    if (!job) {
      return res.status(404).json({ ok: false, message: "job not found" });
    }
    return res.json({ ok: true, job });
  });

  // ── usage statistics (from audit_log) ──────────────────────────────
  app.get("/api/admin/usage", requireAdmin, async (req, res) => {
    const interval = String(req.query.interval || "24 hours").trim();
    const payload = await usageRepo.getUsage(getPool, interval);
    const statusCode = payload.ok ? 200 : 503;
    return res.status(statusCode).json(payload);
  });
}

module.exports = { register };
