"use strict";

/**
 * Gate for `/api/agent/context`.
 *
 * Two acceptance paths:
 *   1. Logged-in user with the `analysis` permission.
 *   2. Anonymous request bearing the configured AGENT_REMOTE_READ_TOKEN
 *      (header `Authorization: Bearer <token>` or `X-Agent-Read-Token`).
 *
 * Path #2 supports headless analysis tooling that runs outside the
 * browser-session world.
 */

const appConfig = require("../services/appConfig");
const { accountHasPermission } = require("../lib/auth/permissions");

function hasAgentReadToken(req) {
  const configured = String(appConfig.agentRemoteReadToken || "").trim();
  if (!configured) {
    return false;
  }
  const authorization = String(req.headers.authorization || "").trim();
  const bearerToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const headerToken = String(req.headers["x-agent-read-token"] || "").trim();
  return bearerToken === configured || headerToken === configured;
}

function requireAgentContextAccess(req, res, next) {
  if (accountHasPermission(req.authSession, "analysis")) {
    return next();
  }
  if (hasAgentReadToken(req)) {
    return next();
  }
  return res.status(401).json({
    ok: false,
    message: "Unauthorized",
    login: "/login",
  });
}

module.exports = { requireAgentContextAccess };
