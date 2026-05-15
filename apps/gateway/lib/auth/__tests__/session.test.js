import { describe, it, expect, beforeEach } from "vitest";

// eslint-disable-next-line import/first
const {
  SESSION_STORE,
  AUTH_COOKIE_SECURE,
  parseCookies,
  cleanupSessions,
  createSession,
  getSessionByRequest,
  buildAuthMePayload,
} = require("../session");
// eslint-disable-next-line import/first
const { getAuthAccountById } = require("../store");

function fakeReq(cookieHeader) {
  return { headers: { cookie: cookieHeader } };
}

describe("lib/auth/session", () => {
  beforeEach(() => {
    SESSION_STORE.clear();
  });

  it("AUTH_COOKIE_SECURE follows env defaults (false in test env)", () => {
    expect(AUTH_COOKIE_SECURE).toBe(false);
  });

  describe("parseCookies", () => {
    it("returns {} for empty header", () => {
      expect(parseCookies("")).toEqual({});
      expect(parseCookies(undefined)).toEqual({});
    });

    it("parses key=value pairs", () => {
      expect(parseCookies("smoke_sid=abc; other=def")).toEqual({ smoke_sid: "abc", other: "def" });
    });

    it("ignores malformed segments", () => {
      expect(parseCookies("invalid; key=value")).toEqual({ key: "value" });
    });

    it("decodes URI-encoded values", () => {
      expect(parseCookies("k=hello%20world")).toEqual({ k: "hello world" });
    });
  });

  describe("createSession + getSessionByRequest round-trip", () => {
    it("a session created for an account is retrievable via cookie", () => {
      const account = getAuthAccountById("acct_smoke_admin");
      const session = createSession(account);
      expect(session.sid).toBeTruthy();

      const req = fakeReq(`smoke_sid=${session.sid}`);
      const fetched = getSessionByRequest(req);
      expect(fetched?.account_id).toBe(account.id);
      expect(fetched?.username).toBe(account.username);
      expect(fetched?.is_admin).toBe(true);
    });

    it("returns null when cookie is missing", () => {
      expect(getSessionByRequest(fakeReq(""))).toBeNull();
    });

    it("returns null and clears expired sessions", () => {
      const account = getAuthAccountById("acct_smoke_admin");
      const session = createSession(account);
      // Force expiry
      const stored = SESSION_STORE.get(session.sid);
      stored.expires_at = Date.now() - 1000;
      SESSION_STORE.set(session.sid, stored);

      const fetched = getSessionByRequest(fakeReq(`smoke_sid=${session.sid}`));
      expect(fetched).toBeNull();
      expect(SESSION_STORE.has(session.sid)).toBe(false);
    });
  });

  describe("cleanupSessions", () => {
    it("removes expired entries", () => {
      SESSION_STORE.set("expired", { sid: "expired", expires_at: 1 });
      SESSION_STORE.set("alive", { sid: "alive", expires_at: Date.now() + 60000 });
      cleanupSessions();
      expect(SESSION_STORE.has("expired")).toBe(false);
      expect(SESSION_STORE.has("alive")).toBe(true);
    });
  });

  describe("buildAuthMePayload", () => {
    it("renders the canonical /api/auth/me shape", () => {
      const account = getAuthAccountById("acct_smoke_admin");
      const session = createSession(account);
      const payload = buildAuthMePayload(session);
      expect(payload).toMatchObject({
        ok: true,
        account_id: account.id,
        username: account.username,
        name: account.name,
        is_admin: true,
      });
      expect(typeof payload.expires_at).toBe("string");
      expect(payload.permissions.length).toBeGreaterThan(0);
    });
  });
});
