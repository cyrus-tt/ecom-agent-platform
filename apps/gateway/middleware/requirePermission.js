"use strict";

/**
 * Permission-gate middleware factories.
 *
 *   requirePermission("arrival")               — single key
 *   requireAnyPermission(["report_daily", …])  — disjunction
 *
 * On deny:
 *   - API-shaped paths (/api/*, /notes-api/*) → 403 JSON
 *   - HTML paths → 302 to the user's preferred route, or /no-access if
 *     they were already there.
 *
 * Depends on `req.authSession` populated by `sessionEnrichment`.
 */

const {
  accountHasPermission,
  accountHasAnyPermission,
} = require("../lib/auth/permissions");
const { normalizeNext } = require("../lib/auth/redirects");

function isApiLikeRequest(req) {
  return req.path.startsWith("/api/") || req.path.startsWith("/notes-api/");
}

function denyPermission(req, res, requiredPermission) {
  const preferredRoute = normalizeNext(req.authSession?.preferred_route || "/no-access");
  if (isApiLikeRequest(req)) {
    return res.status(403).json({
      ok: false,
      message: "Forbidden",
      required_permission: requiredPermission || "",
      preferred_route: preferredRoute,
    });
  }
  const currentPath = normalizeNext(req.originalUrl || req.path || "/");
  if (preferredRoute === currentPath) {
    return res.redirect("/no-access");
  }
  return res.redirect(preferredRoute);
}

function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (accountHasPermission(req.authSession, permissionKey)) {
      return next();
    }
    return denyPermission(req, res, permissionKey);
  };
}

function requireAnyPermission(permissionKeys) {
  return (req, res, next) => {
    if (accountHasAnyPermission(req.authSession, permissionKeys)) {
      return next();
    }
    return denyPermission(req, res, Array.isArray(permissionKeys) ? permissionKeys.join(",") : "");
  };
}

module.exports = {
  requirePermission,
  requireAnyPermission,
};
