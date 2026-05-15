"use strict";

/**
 * Health-check and observability routes.
 *
 * Endpoints:
 *   GET /healthz     — lightweight liveness probe (always 200 if process up)
 *   GET /readyz      — readiness probe (200/503 depending on deps)
 *   GET /api/health  — full health detail for admin UI
 *   GET /api/ping    — authenticated echo for session verification
 *
 * All dependencies are injected via ctx to keep this module free of
 * top-level side effects and amenable to unit testing.
 */

function register(app, ctx) {
  const {
    host,
    port,
    appConfig,
    getReportDbStatus,
    getArrivalServiceStatus,
    getNotesServiceStatus,
    getAuthStore,
    getLanIps,
  } = ctx;

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: "ecom-dashboard-gateway",
      host,
      port,
      server_time: new Date().toISOString(),
    });
  });

  app.get("/readyz", async (_req, res) => {
    const [reportDb, arrival, notes] = await Promise.all([
      getReportDbStatus(),
      getArrivalServiceStatus({ allowAutoStart: false }),
      getNotesServiceStatus(),
    ]);
    const ok = reportDb.ok && arrival.ok && notes.ok;

    res.status(ok ? 200 : 503).json({
      ok,
      service: "ecom-dashboard-gateway",
      host,
      port,
      server_time: new Date().toISOString(),
      dependencies: {
        report_db: reportDb,
        arrival: arrival,
        notes: notes,
      },
      config: {
        arrival_service_url_source: appConfig.arrivalServiceUrlSource,
        notes_service_url_source: appConfig.notesServiceUrlSource,
        arrival_project_dir_configured: appConfig.arrivalProjectDirConfigured,
        arrival_project_dir_source: appConfig.arrivalProjectDirSource,
        notes_project_dir_configured: appConfig.notesProjectDirConfigured,
        notes_project_dir_source: appConfig.notesProjectDirSource,
      },
    });
  });

  app.get("/api/health", async (_req, res) => {
    const [reportDb, arrival, notes] = await Promise.all([
      getReportDbStatus(),
      getArrivalServiceStatus({ allowAutoStart: false }),
      getNotesServiceStatus(),
    ]);
    const authStore = getAuthStore();

    res.json({
      ok: reportDb.ok && arrival.ok && notes.ok,
      service: "ecom-dashboard-gateway",
      host,
      port,
      lan_ips: getLanIps(),
      server_time: new Date().toISOString(),
      auth: {
        cookie_name: authStore.cookie_name,
        session_ttl_seconds: authStore.session_ttl_seconds,
      },
      report_db: {
        ok: reportDb.ok,
        message: reportDb.message,
      },
      upstream: {
        arrival: {
          ok: arrival.ok,
          status: arrival.status,
          message: arrival.message,
          auto_start: arrival.auto_start,
        },
        notes: {
          ok: notes.ok,
          status: notes.status,
          message: notes.message,
        },
      },
      config: {
        arrival_service_url_source: appConfig.arrivalServiceUrlSource,
        notes_service_url_source: appConfig.notesServiceUrlSource,
        arrival_project_dir_configured: appConfig.arrivalProjectDirConfigured,
        notes_project_dir_configured: appConfig.notesProjectDirConfigured,
      },
    });
  });

  app.get("/api/ping", (req, res) => {
    res.json({
      ok: true,
      message: "pong",
      user: req.authUser || "",
      client_ip: req.ip,
      x_forwarded_for: req.headers["x-forwarded-for"] || "",
      server_time: new Date().toISOString(),
    });
  });
}

module.exports = { register };
