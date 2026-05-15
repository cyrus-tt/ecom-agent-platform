"use strict";

/**
 * Audit middleware.
 *
 * Captures per-request metadata (user, method, path, status, duration, ip,
 * user-agent) and forwards to the given audit logger on response finish.
 *
 * Must be registered AFTER session-enrichment middleware (so req.authUser
 * is available) but BEFORE route handlers (so it wraps every response).
 *
 * Skipped paths:
 *   - /healthz, /readyz, /api/ping — high-frequency probes, no audit value
 *   - /api/metrics (PR8) — prom-client scrape, not user traffic
 *   - /assets/* — static asset serving handled by express.static
 *
 * Skip logic is conservative: when in doubt, audit.
 */

const SKIP_EXACT = new Set(["/healthz", "/readyz", "/api/ping", "/api/metrics"]);

function shouldSkip(req) {
  if (SKIP_EXACT.has(req.path)) return true;
  if (req.path.startsWith("/assets/")) return true;
  if (req.path.startsWith("/favicon")) return true;
  return false;
}

function isEnabled() {
  const raw = String(process.env.ENABLE_AUDIT_LOG || "").trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "false" || raw === "0" || raw === "no" || raw === "off");
}

function auditRequestMiddleware(auditLogger) {
  if (!auditLogger || typeof auditLogger.record !== "function") {
    throw new Error("auditRequestMiddleware requires an audit logger with record()");
  }
  return function (req, res, next) {
    if (!isEnabled() || shouldSkip(req)) {
      return next();
    }
    const startedAt = Date.now();
    let recorded = false;

    function emit() {
      if (recorded) return;
      recorded = true;
      try {
        const durationMs = Date.now() - startedAt;
        auditLogger.record({
          account_id: req.authAccountId || null,
          username: req.authUser || null,
          is_admin: req.authIsAdmin === true ? true : req.authIsAdmin === false ? false : null,
          method: req.method,
          path: req.path,
          status_code: res.statusCode,
          duration_ms: durationMs,
          ip: req.ip,
          user_agent: req.headers["user-agent"] || "",
          metadata: null,
        });
      } catch (_err) {
        // Audit must never break a real request.
      }
    }

    res.on("finish", emit);
    res.on("close", emit);
    return next();
  };
}

module.exports = { auditRequestMiddleware, isEnabled };
