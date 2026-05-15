"use strict";

/**
 * Serve OpenAPI spec + Swagger UI at /api/docs.
 *
 * Admin-gated: the spec documents every internal endpoint including
 * admin-only ones, so we do not want anonymous viewers. Admin cookie
 * required (same rule as /api/admin/accounts).
 *
 * Two specs are available:
 *   - openapi.yaml             (default; hand-maintained, full coverage)
 *   - openapi.generated.yaml   (zod-generated; partial coverage, see PR13/ADR-0018)
 *
 * Choose at request time via `?source=generated`. Default remains the
 * hand-written file so existing bookmarks and CI scrapers don't break.
 *
 * Both are parsed lazily and cached per-source. Changes require a gateway
 * restart (or hitting the file directly).
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const swaggerUi = require("swagger-ui-express");

const SOURCES = {
  manual: "openapi.yaml",
  generated: "openapi.generated.yaml",
};

const cache = {};

function resolveSource(req) {
  const q = (req && req.query && String(req.query.source || "").trim()) || "";
  return q === "generated" ? "generated" : "manual";
}

function specFilename(source) {
  return SOURCES[source] || SOURCES.manual;
}

function loadSpec(source) {
  if (cache[source]) return cache[source];
  const filename = specFilename(source);
  const file = path.resolve(__dirname, "..", filename);
  if (!fs.existsSync(file)) {
    // Generated file may not be built yet — fall back to manual to avoid 500.
    if (source !== "manual") return loadSpec("manual");
    throw new Error(`OpenAPI spec missing: ${file}`);
  }
  const raw = fs.readFileSync(file, "utf8");
  cache[source] = yaml.load(raw);
  return cache[source];
}

const { requireAdmin } = require("../middleware/requireAdmin");

function register(app) {

  // Raw spec for admin download / external tools (Postman import etc.).
  app.get("/api/docs.yaml", requireAdmin, (req, res) => {
    const source = resolveSource(req);
    const file = path.resolve(__dirname, "..", specFilename(source));
    if (!fs.existsSync(file)) {
      res
        .status(404)
        .json({ ok: false, message: `spec not found: ${specFilename(source)}` });
      return;
    }
    res.setHeader("Content-Type", "application/yaml; charset=utf-8");
    fs.createReadStream(file).pipe(res);
  });

  app.get("/api/docs.json", requireAdmin, (req, res) => {
    const source = resolveSource(req);
    res.json(loadSpec(source));
  });

  // Interactive Swagger UI (admin only).
  // swagger-ui-express binds spec at setup time; to honour ?source=generated
  // dynamically we re-create setup per request. Volume is tiny (admin browser
  // sessions only), so the per-request cost is acceptable.
  app.use("/api/docs", requireAdmin, (req, res, next) => {
    const source = resolveSource(req);
    const setup = swaggerUi.setup(loadSpec(source), {
      customSiteTitle: `ecom-agent-platform API (${source})`,
      swaggerOptions: {
        displayRequestDuration: true,
        tryItOutEnabled: true,
      },
    });
    // swaggerUi.serve is an array of middlewares; chain them then run setup.
    const chain = swaggerUi.serve.slice();
    const runNext = (err) => {
      if (err) return next(err);
      const mw = chain.shift();
      if (mw) return mw(req, res, runNext);
      return setup(req, res, next);
    };
    runNext();
  });
}

module.exports = {
  register,
  _internal: { resolveSource, loadSpec, specFilename, SOURCES },
};
