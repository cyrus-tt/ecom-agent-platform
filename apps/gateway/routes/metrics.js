"use strict";

/**
 * Prometheus scrape endpoint.
 *
 *   GET /api/metrics
 *     允许两种任一认证（V2，见 ADR 0012）：
 *       1. Authorization: Bearer <METRICS_TOKEN>   — 给 Prometheus 用
 *       2. admin session cookie                    — 给运维手动 curl 用
 *     返回 text/plain; version=0.0.4（prom-client exposition format）
 *
 * 老设计（ADR 0008）只允许 admin session；但 Prometheus 不支持 cookie 登录，
 * 所以 V2 补上 Bearer token 通道（见 middleware/metricsAuth.js）。
 * METRICS_TOKEN 未设置时，Bearer 通道关闭、只剩 admin session —— **不会**退化为公开端点。
 */

const metrics = require("../lib/metrics");
const { buildMetricsAuth } = require("../middleware/metricsAuth");

function register(app, ctx) {
  const { requireAdmin } = ctx;
  const metricsAuth = buildMetricsAuth(requireAdmin);

  app.get("/api/metrics", metricsAuth, async (_req, res, next) => {
    try {
      res.setHeader("Content-Type", metrics.contentType());
      res.end(await metrics.scrape());
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { register };
