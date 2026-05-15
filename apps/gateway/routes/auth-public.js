"use strict";

/**
 * Public auth routes — registered BEFORE the auth guard middleware.
 *
 *   POST /api/auth/login  — credential → session cookie
 *   GET  /login           — HTML login page (or redirect if already logged in)
 *   GET  /logout          — destroy session + redirect to /login
 *
 * The session-enrichment middleware (which populates req.authUser, etc.)
 * must already have run, but the auth guard (which rejects unauthenticated
 * requests) must NOT yet have run, otherwise /login becomes unreachable.
 */

const { validateBody } = require("../middleware/validateBody");
const { loginBodySchema } = require("../schemas/auth");
const {
  getAuthStore,
} = require("../lib/auth/store");
const {
  getMatchedAccount,
} = require("../lib/auth/credentials");
const {
  createSession,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  buildAuthMePayload,
  SESSION_STORE,
} = require("../lib/auth/session");
const {
  normalizeNext,
  resolvePostLoginRoute,
} = require("../lib/auth/redirects");

function register(app, ctx) {
  const { express, renderLoginPage } = ctx;

  app.post(
    "/api/auth/login",
    express.json({ limit: "256kb" }),
    validateBody(loginBodySchema),
    (req, res) => {
      const { username, password, next: rawNext } = req.body;
      const nextUrl = normalizeNext(rawNext);
      const matchedAccount = getMatchedAccount(username, password);

      if (!matchedAccount) {
        return res.status(401).json({ ok: false, message: "账号或密码错误" });
      }

      const session = createSession(matchedAccount);
      setSessionCookie(res, session.sid);
      return res.json({
        ...buildAuthMePayload(session),
        next: resolvePostLoginRoute(matchedAccount, nextUrl),
      });
    }
  );

  app.get("/login", (req, res) => {
    if (req.authUser) {
      const nextUrl = normalizeNext(req.query.next);
      return res.redirect(resolvePostLoginRoute(req.authSession, nextUrl));
    }
    return res.type("html").send(renderLoginPage(getAuthStore().username));
  });

  app.get("/logout", (req, res) => {
    const sid = parseCookies(req.headers.cookie)[getAuthStore().cookie_name];
    if (sid) {
      SESSION_STORE.delete(sid);
    }
    clearSessionCookie(res);
    res.redirect("/login");
  });
}

module.exports = { register };
