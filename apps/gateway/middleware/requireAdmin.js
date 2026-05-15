"use strict";

/**
 * Admin-only gate. Reuses `denyPermission` semantics from
 * `./requirePermission` (kept private there) by reimplementing the small
 * deny path here to avoid coupling middleware files to each other's
 * private helpers.
 */

const { normalizeNext } = require("../lib/auth/redirects");

function isApiLikeRequest(req) {
  return req.path.startsWith("/api/") || req.path.startsWith("/notes-api/");
}

function denyAdmin(req, res) {
  const preferredRoute = normalizeNext(req.authSession?.preferred_route || "/no-access");
  if (isApiLikeRequest(req)) {
    return res.status(403).json({
      ok: false,
      message: "Forbidden",
      required_permission: "admin",
      preferred_route: preferredRoute,
    });
  }
  const currentPath = normalizeNext(req.originalUrl || req.path || "/");
  if (preferredRoute === currentPath) {
    return res.redirect("/no-access");
  }
  return res.redirect(preferredRoute);
}

function requireAdmin(req, res, next) {
  if (req.authSession?.is_admin === true) {
    return next();
  }
  return denyAdmin(req, res);
}

module.exports = { requireAdmin };
