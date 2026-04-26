"use strict";

/**
 * Prometheus scrape endpoint.
 *
 *   GET /api/metrics  — admin-gated, returns text/plain exposition format
 *
 * Admin gating is a tradeoff: Prometheus best practice is unauthenticated
 * scrape on a separate listener. For a LAN/VPN deploy serving 40 users,
 * keeping everything on one port + admin auth is simpler and the scrape
 * volume is tiny.
 */

const metrics = require("../lib/metrics");
const { requireAdmin } = require("../middleware/requireAdmin");

function register(app) {

  app.get("/api/metrics", requireAdmin, async (_req, res, next) => {
    try {
      res.setHeader("Content-Type", metrics.contentType());
      res.end(await metrics.scrape());
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { register };
