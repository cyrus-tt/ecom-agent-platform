import { describe, it, expect } from "vitest";

// eslint-disable-next-line import/first
const {
  buildAuthStore,
  loadManagedAuthStore,
  exportAuthConfig,
  AUTH_CONFIG_DEFAULT_PATH,
} = require("../config");

const VALID_HASH = "bc640ff664a0d53c3f839da179fff0f35925939ff1f49068ef88a6855552d6da";

describe("lib/auth/config", () => {
  describe("buildAuthStore", () => {
    it("forces non-primary admins to is_admin=false", () => {
      const store = buildAuthStore({
        username: "shared",
        password_hash: VALID_HASH,
        primary_admin_id: "acct_p",
        accounts: [
          { id: "acct_p", username: "shared", password_hash: VALID_HASH, is_admin: true },
          { id: "acct_other", username: "shared", password_hash: VALID_HASH, is_admin: true, permissions: ["portal"] },
        ],
      });
      const primary = store.accounts.find((a) => a.id === "acct_p");
      const other = store.accounts.find((a) => a.id === "acct_other");
      expect(primary.is_admin).toBe(true);
      expect(other.is_admin).toBe(false);
    });

    it("primary admin gets all permissions, even if config tried to restrict them", () => {
      const store = buildAuthStore({
        username: "shared",
        password_hash: VALID_HASH,
        primary_admin_id: "acct_p",
        accounts: [
          { id: "acct_p", username: "shared", password_hash: VALID_HASH, is_admin: true, permissions: ["portal"] },
        ],
      });
      const primary = store.accounts.find((a) => a.id === "acct_p");
      expect(primary.permissions.length).toBeGreaterThan(1);
    });

    it("clamps session_ttl_seconds to a 300s floor", () => {
      const store = buildAuthStore({ username: "u", password_hash: VALID_HASH, session_ttl_seconds: 10 });
      expect(store.session_ttl_seconds).toBe(300);
    });

    it("uses defaults when raw is empty", () => {
      const store = buildAuthStore({});
      expect(store.username).toBe("anta");
      expect(store.cookie_name).toBe("anta_sid");
      expect(store.accounts.length).toBeGreaterThan(0);
    });

    it("falls back to first admin when primary_admin_id missing", () => {
      const store = buildAuthStore({
        username: "u",
        password_hash: VALID_HASH,
        accounts: [
          { id: "acct_a", username: "u", password_hash: VALID_HASH, is_admin: false },
          { id: "acct_b", username: "u", password_hash: VALID_HASH, is_admin: true },
        ],
      });
      expect(store.primary_admin_id).toBeTruthy();
    });
  });

  describe("loadManagedAuthStore", () => {
    it("loads the fixture file the test runner pointed AUTH_CONFIG_PATH at", () => {
      const store = loadManagedAuthStore();
      expect(store.username).toBe("smoke-admin");
      expect(store.accounts.find((a) => a.id === "acct_smoke_admin")).toBeTruthy();
    });

    it("AUTH_CONFIG_DEFAULT_PATH reflects the env var override", () => {
      expect(AUTH_CONFIG_DEFAULT_PATH).toContain("auth.fixture.json");
    });
  });

  describe("exportAuthConfig", () => {
    it("uses the provided store argument and returns the same shape we wrote", () => {
      const built = buildAuthStore({
        username: "u",
        password_hash: VALID_HASH,
        primary_admin_id: "acct_p",
        accounts: [
          { id: "acct_p", username: "u", password_hash: VALID_HASH, is_admin: true },
        ],
      });
      const exported = exportAuthConfig(built);
      expect(exported.username).toBe("u");
      expect(exported.primary_admin_id).toBe("acct_p");
      expect(Array.isArray(exported.accounts)).toBe(true);
      expect(exported.accounts[0]).toHaveProperty("password_hash");
      expect(exported.accounts[0]).toHaveProperty("password_bcrypt");
    });
  });
});
