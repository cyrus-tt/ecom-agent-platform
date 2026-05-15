"use strict";

/**
 * Session-owner auth routes — registered AFTER the auth guard middleware.
 *
 *   POST /api/auth/logout  — destroy session (200 for both authed + anon)
 *   POST /api/auth/me/password — current user changes own password
 *   GET  /api/auth/me      — current session payload
 *
 * Both endpoints rely on req.authSession populated by the session
 * enrichment middleware (still upstream of the guard).
 */

const express = require("express");
const passwordHasher = require("../lib/passwordHasher");
const passwordPolicy = require("../lib/passwordPolicy");
const { updateManagedAccountPassword } = require("../lib/auth/accounts");
const { getAuthStore, getAuthAccountById } = require("../lib/auth/store");
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

  app.post("/api/auth/me/password", express.json({ limit: "256kb" }), (req, res) => {
    if (!req.authSession) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    const body = req.body || {};
    const oldPassword = String(body.oldPassword || "");
    const newPassword = String(body.newPassword || "");
    const accountId = req.authSession.account_id;
    const account = getAuthAccountById(accountId);
    if (!account) {
      return res.status(404).json({ ok: false, message: "账号不存在" });
    }
    if (!passwordHasher.verify(oldPassword, account).valid) {
      return res.status(400).json({ ok: false, message: "旧密码不正确" });
    }
    const policyResult = passwordPolicy.validate(newPassword);
    if (!policyResult.ok) {
      return res.status(422).json({
        ok: false,
        message: policyResult.reasons.join("；"),
        reasons: policyResult.reasons,
      });
    }
    try {
      updateManagedAccountPassword(accountId, newPassword);
    } catch (err) {
      const message = String(err?.message || err);
      return res.status(400).json({ ok: false, message });
    }
    const sid = parseCookies(req.headers.cookie)[getAuthStore().cookie_name];
    if (sid) {
      SESSION_STORE.delete(sid);
    }
    clearSessionCookie(res);
    return res.json({ ok: true, message: "密码已更新，请重新登录" });
  });

  app.get("/api/auth/me", (req, res) => {
    if (!req.authSession) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    return res.json(buildAuthMePayload(req.authSession));
  });
}

module.exports = { register };
