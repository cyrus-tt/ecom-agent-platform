"use strict";

/**
 * Metrics middleware.
 *
 * On every HTTP request, captures:
 *   - duration via process.hrtime
 *   - final status class via res.on('finish'|'close')
 *
 * Updates prom-client registry counters + histograms labeled by route
 * template (matched by express) to keep cardinality bounded.
 *
 * Skip paths:
 *   - /api/metrics itself (would be circular)
 *   - /healthz, /readyz (probe noise)
 */

const metrics = require("../lib/metrics");

const SKIP_EXACT = new Set(["/api/metrics", "/healthz", "/readyz"]);

function metricsMiddleware() {
  return function (req, res, next) {
    if (!metrics.isEnabled() || SKIP_EXACT.has(req.path)) return next();

    const startedNs = process.hrtime.bigint();
    let recorded = false;

    function finish() {
      if (recorded) return;
      recorded = true;
      try {
        const elapsedNs = Number(process.hrtime.bigint() - startedNs);
        const seconds = elapsedNs / 1e9;
        const labels = {
          method: req.method,
          route: metrics.labelRoute(req),
          status_class: metrics.statusClass(res.statusCode),
        };
        metrics.httpRequestsTotal.inc(labels);
        metrics.httpRequestDuration.observe(labels, seconds);
      } catch (_err) {
        // Metrics must never break a real request.
      }
    }

    res.on("finish", finish);
    res.on("close", finish);
    next();
  };
}

module.exports = { metricsMiddleware };
