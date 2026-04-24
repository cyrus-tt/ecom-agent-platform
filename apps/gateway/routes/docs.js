"use strict";

/**
 * Serve OpenAPI spec + Swagger UI at /api/docs.
 *
 * Admin-gated: the spec documents every internal endpoint including
 * admin-only ones, so we do not want anonymous viewers. Admin cookie
 * required (same rule as /api/admin/accounts).
 *
 * The spec lives at apps/gateway/openapi.yaml and is parsed lazily on
 * first request. Changes to the file require a gateway restart.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const swaggerUi = require("swagger-ui-express");

let cached = null;

function loadSpec() {
  if (cached) return cached;
  const file = path.resolve(__dirname, "..", "openapi.yaml");
  const raw = fs.readFileSync(file, "utf8");
  cached = yaml.load(raw);
  return cached;
}

function register(app, ctx) {
  const { requireAdmin } = ctx;

  // Raw spec for admin download / external tools (Postman import etc.).
  app.get("/api/docs.yaml", requireAdmin, (_req, res) => {
    const file = path.resolve(__dirname, "..", "openapi.yaml");
    res.setHeader("Content-Type", "application/yaml; charset=utf-8");
    fs.createReadStream(file).pipe(res);
  });

  app.get("/api/docs.json", requireAdmin, (_req, res) => {
    res.json(loadSpec());
  });

  // Interactive Swagger UI (admin only).
  app.use(
    "/api/docs",
    requireAdmin,
    swaggerUi.serve,
    swaggerUi.setup(loadSpec(), {
      customSiteTitle: "ecom-agent-platform API",
      swaggerOptions: {
        displayRequestDuration: true,
        tryItOutEnabled: true,
      },
    })
  );
}

module.exports = { register };
