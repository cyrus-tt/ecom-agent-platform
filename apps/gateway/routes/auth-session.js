"use strict";

/**
 * Session-owner auth routes — registered AFTER the auth guard middleware.
 *
 *   POST /api/auth/logout  — destroy session (200 for both authed + anon)
 *   GET  /api/auth/me      — current session payload
 *
 * Both endpoints rely on req.authSession populated by the session
 * enrichment middleware (still upstream of the guard).
 */

const { getAuthStore } = require("../lib/auth/store");
const {
  parseCookies,
  clearSessionCookie,
  buildAuthMePayload,
  SESSION_STORE,
} = require("../lib/auth/session");

function register(app) {
  app.post("/api/auth/logout", (req, res) => {
    const sid = parseCookies(req.headers.cookie)[getAuthStore().cookie_name];
    if (sid) {
      SESSION_STORE.delete(sid);
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.authSession) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    return res.json(buildAuthMePayload(req.authSession));
  });
}

module.exports = { register };
