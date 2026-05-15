"use strict";

/**
 * Prometheus metrics — lightweight HTTP RED (Rate / Errors / Duration).
 *
 * Endpoints:
 *   GET /api/metrics  — registry scrape (admin-gated in routes/ops.js)
 *
 * Default metrics (process/heap/event-loop) are collected via
 * prom-client.collectDefaultMetrics() at import time, which is safe:
 *   - No DB connection needed
 *   - Cost is a few hundred microseconds per scrape
 *   - Can be disabled via ENABLE_METRICS=false
 *
 * Custom metrics:
 *   http_requests_total{method,route,status_class}  — counter
 *   http_request_duration_seconds{method,route,status_class}  — histogram
 */

const client = require("prom-client");

const registry = new client.Registry();
registry.setDefaultLabels({ service: "ecom-gateway" });

const enabled = (() => {
  const raw = String(process.env.ENABLE_METRICS || "").trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "false" || raw === "0" || raw === "no" || raw === "off");
})();

if (enabled) {
  client.collectDefaultMetrics({ register: registry });
}

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests received, labeled by method/route/status_class.",
  labelNames: ["method", "route", "status_class"],
  registers: [registry],
});

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds.",
  labelNames: ["method", "route", "status_class"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

function statusClass(statusCode) {
  if (statusCode >= 500) return "5xx";
  if (statusCode >= 400) return "4xx";
  if (statusCode >= 300) return "3xx";
  if (statusCode >= 200) return "2xx";
  return "1xx";
}

/**
 * Normalize a request path into a low-cardinality label.
 *
 * Goals:
 *   - /api/agent/reports/123 → /api/agent/reports/:id
 *   - /api/admin/jobs/abc-xyz → /api/admin/jobs/:jobId
 *   - /assets/abc.js → /assets/*
 *
 * Rule: prefer Express' matched `req.route.path` when available; fall back
 * to the raw path otherwise (callers already skip /healthz, /readyz etc
 * to keep label cardinality sane).
 */
function labelRoute(req) {
  if (req.route && typeof req.route.path === "string" && req.route.path) {
    if (req.baseUrl) return req.baseUrl + req.route.path;
    return req.route.path;
  }
  // Fallback for routes without a matched template (e.g. 404s).
  return req.path;
}

function isEnabled() {
  return enabled;
}

function contentType() {
  return registry.contentType;
}

async function scrape() {
  return registry.metrics();
}

module.exports = {
  registry,
  httpRequestsTotal,
  httpRequestDuration,
  statusClass,
  labelRoute,
  isEnabled,
  contentType,
  scrape,
};
