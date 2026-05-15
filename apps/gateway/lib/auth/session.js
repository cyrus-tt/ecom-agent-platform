"use strict";

/**
 * In-memory session store + cookie helpers + /api/auth/me payload.
 *
 * SESSION_STORE is a process-local Map (sid → session object). Restarting
 * the gateway therefore logs every active user out — accepted tradeoff for
 * V3 (no Redis, no JWT). Persistence belongs to a future PR.
 *
 * Singleton guarantee depends on Node's per-absolute-path module cache.
 * Do not introduce a second require path for this file (see notes in
 * `./store`).
 */

const crypto = require("crypto");

const {
  AUTH_PERMISSION_KEYS,
  normalizePermissionKeys,
  resolvePreferredRouteForAccount,
  resolvePreferredRouteForPermissions,
} = require("./permissions");
const { getAuthStore, getAuthAccountById } = require("./store");

const AUTH_COOKIE_SECURE = String(
  process.env.AUTH_COOKIE_SECURE || (process.env.NODE_ENV === "production" ? "true" : "false")
)
  .trim()
  .toLowerCase() === "true";

const SESSION_STORE = new Map();

function parseCookies(cookieHeader) {
  const cookies = {};
  String(cookieHeader || "")
    .split(";")
    .forEach((part) => {
      const idx = part.indexOf("=");
      if (idx <= 0) {
        return;
      }
      try {
        const key = decodeURIComponent(part.slice(0, idx).trim());
        const value = decodeURIComponent(part.slice(idx + 1).trim());
        if (key) {
          cookies[key] = value;
        }
      } catch (_err) {
        return;
      }
    });
  return cookies;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [sid, session] of SESSION_STORE.entries()) {
    if (!session || now >= Number(session.expires_at || 0)) {
      SESSION_STORE.delete(sid);
    }
  }
}

function createSession(account) {
  cleanupSessions();
  const sid = crypto.randomBytes(24).toString("hex");
  const authStore = getAuthStore();
  const expiresAt = Date.now() + authStore.session_ttl_seconds * 1000;
  const session = {
    sid,
    account_id: String(account?.id || ""),
    created_at: Date.now(),
    expires_at: expiresAt,
  };
  SESSION_STORE.set(sid, session);
  return getAuthAccountById(session.account_id)
    ? {
        ...session,
        username: String(account?.username || ""),
        name: String(account?.name || account?.username || ""),
        is_admin: account?.is_admin === true,
        permissions: account?.is_admin === true ? [...AUTH_PERMISSION_KEYS] : normalizePermissionKeys(account?.permissions, []),
        shared_username: authStore.username,
        preferred_route: resolvePreferredRouteForAccount(account),
      }
    : null;
}

function getSessionByRequest(req) {
  cleanupSessions();
  const cookies = parseCookies(req.headers.cookie);
  const authStore = getAuthStore();
  const sid = cookies[authStore.cookie_name];
  if (!sid) {
    return null;
  }
  const session = SESSION_STORE.get(sid);
  if (!session || Date.now() >= Number(session.expires_at || 0)) {
    SESSION_STORE.delete(sid);
    return null;
  }
  const account = getAuthAccountById(session.account_id);
  if (!account) {
    SESSION_STORE.delete(sid);
    return null;
  }
  return {
    sid,
    account_id: session.account_id,
    username: String(account.username || ""),
    name: String(account.name || account.username || ""),
    is_admin: account.is_admin === true,
    permissions: account.is_admin === true ? [...AUTH_PERMISSION_KEYS] : normalizePermissionKeys(account.permissions, []),
    shared_username: authStore.username,
    preferred_route: resolvePreferredRouteForAccount(account),
    created_at: Number(session.created_at || Date.now()),
    expires_at: Number(session.expires_at || 0),
  };
}

function setSessionCookie(res, sid) {
  const authStore = getAuthStore();
  res.cookie(authStore.cookie_name, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: AUTH_COOKIE_SECURE,
    path: "/",
    maxAge: authStore.session_ttl_seconds * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(getAuthStore().cookie_name, {
    httpOnly: true,
    sameSite: "lax",
    secure: AUTH_COOKIE_SECURE,
    path: "/",
  });
}

function buildAuthMePayload(session) {
  return {
    ok: true,
    account_id: session.account_id,
    username: session.username,
    name: session.name,
    is_admin: session.is_admin === true,
    permissions: session.is_admin === true ? [...AUTH_PERMISSION_KEYS] : normalizePermissionKeys(session.permissions, []),
    shared_username: session.shared_username || getAuthStore().username,
    preferred_route: session.preferred_route || resolvePreferredRouteForPermissions(session.permissions),
    expires_at: new Date(session.expires_at).toISOString(),
  };
}

module.exports = {
  AUTH_COOKIE_SECURE,
  SESSION_STORE,
  parseCookies,
  cleanupSessions,
  createSession,
  getSessionByRequest,
  setSessionCookie,
  clearSessionCookie,
  buildAuthMePayload,
};
