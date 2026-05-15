"use strict";

/**
 * Path/redirect helpers used by login and the public-path guard.
 *
 *   normalizeNext(raw)            — sanitize a `?next=` query parameter.
 *   isPublicPath(pathname)        — whitelist of routes accessible without
 *                                   a session (login page, login API,
 *                                   public dispatch confirm, etc.).
 *   resolvePostLoginRoute(account, rawNext) — pick where to send a user
 *                                   after a successful login.
 */

const {
  resolvePreferredRouteForAccount,
  isRouteAllowedForAccount,
} = require("./permissions");

function normalizeNext(raw) {
  const value = String(raw || "").trim();
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function isPublicPath(pathname) {
  return (
    pathname === "/login" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/agent/context" ||
    pathname === "/healthz" ||
    pathname === "/readyz" ||
    pathname === "/favicon.ico" ||
    pathname === "/login.css" ||
    pathname === "/login.js" ||
    pathname.startsWith("/dispatch/confirm/") ||
    pathname === "/api/dispatch/public/preview" ||
    pathname === "/api/dispatch/public/confirm"
  );
}

function resolvePostLoginRoute(account, rawNext) {
  const preferredRoute = resolvePreferredRouteForAccount(account);
  const nextUrl = normalizeNext(rawNext);
  if (nextUrl === "/login" || nextUrl === "/logout") {
    return preferredRoute;
  }
  return isRouteAllowedForAccount(account, nextUrl) ? nextUrl : preferredRoute;
}

module.exports = {
  normalizeNext,
  isPublicPath,
  resolvePostLoginRoute,
};
