"use strict";

/**
 * SPA HTML fallback routes.
 *
 * Every named URL that should load the React app goes through here. Each
 * route is gated by its matching permission so denied users get the
 * `/no-access` fallback from the auth middleware instead of the React app.
 *
 * /report is the one exception — it redirects to /report-daily for legacy
 * bookmarks.
 *
 * Dispatch-related SPA routes are registered only when DISPATCH_AGENT_ENABLED
 * is true (see dispatch glue in server.js bootstrap).
 */

function register(app, ctx) {
  const { requirePermission, requireAdmin, sendReactApp } = ctx;

  app.get(["/no-access", "/no-access/"], (_req, res) => {
    sendReactApp(res);
  });

  app.get(["/admin/accounts", "/admin/accounts/"], requireAdmin, (_req, res) => {
    sendReactApp(res);
  });

  app.get("/", requirePermission("portal"), (_req, res) => {
    sendReactApp(res);
  });

  app.get(["/dashboard", "/dashboard/"], requirePermission("dashboard"), (_req, res) => {
    sendReactApp(res);
  });

  app.get(["/channel-dashboard", "/channel-dashboard/"], requirePermission("channel_dashboard"), (_req, res) => {
    sendReactApp(res);
  });

  app.get("/report", requirePermission("report_daily"), (_req, res) => {
    res.redirect("/report-daily");
  });

  app.get(["/report-daily", "/report-daily/"], requirePermission("report_daily"), (_req, res) => {
    sendReactApp(res);
  });

  app.get(["/analysis", "/analysis/"], requirePermission("analysis"), (_req, res) => {
    sendReactApp(res);
  });

  app.get(["/arrival", "/arrival/"], requirePermission("arrival"), (_req, res) => {
    sendReactApp(res);
  });
}

module.exports = { register };
