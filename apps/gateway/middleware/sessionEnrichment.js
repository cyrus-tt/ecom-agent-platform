"use strict";

/**
 * Populates `req.authSession` (and a few flat aliases) so every downstream
 * route/middleware can inspect the current user without re-parsing the
 * cookie. Must run BEFORE the auth guard, audit logger, and any
 * permission-gate middleware.
 *
 * Flat aliases kept for backwards compatibility with `auditRequest`,
 * existing route handlers and the public-path guard:
 *   req.authAccountId  — account id or ""
 *   req.authUser       — username or ""
 *   req.authName       — display name or ""
 *   req.authIsAdmin    — boolean
 *   req.authPermissions — array
 */

const { getSessionByRequest } = require("../lib/auth/session");

function sessionEnrichment() {
  return (req, _res, next) => {
    req.authSession = getSessionByRequest(req);
    req.authAccountId = req.authSession ? req.authSession.account_id : "";
    req.authUser = req.authSession ? req.authSession.username : "";
    req.authName = req.authSession ? req.authSession.name : "";
    req.authIsAdmin = !!(req.authSession && req.authSession.is_admin);
    req.authPermissions = req.authSession ? req.authSession.permissions : [];
    next();
  };
}

module.exports = { sessionEnrichment };
