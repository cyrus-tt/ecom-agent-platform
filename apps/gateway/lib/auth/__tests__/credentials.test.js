import { describe, it, expect } from "vitest";

// eslint-disable-next-line import/first
const {
  verifyPasswordHash,
  findAccountByCredentials,
  getMatchedAccount,
} = require("../credentials");

// Plaintext counterparts for hashes in tests/fixtures/auth.fixture.json:
//   sha256("smoke-pass")      = bc640ff6…
//   sha256("smoke-user-pass") = 2e5b98fa…
// (Same passwords used by tests/smoke/auth.test.js so any drift is caught
//  in two places.)
const SMOKE_ADMIN_PASSWORD = "smoke-pass";
const SMOKE_USER_PASSWORD = "smoke-user-pass";

describe("lib/auth/credentials", () => {
  describe("verifyPasswordHash (legacy helper)", () => {
    it("verifies the hex matches the password", () => {
      // sha256("smoke-admin-password") matches the fixture hash.
      const hash = "bc640ff664a0d53c3f839da179fff0f35925939ff1f49068ef88a6855552d6da";
      expect(verifyPasswordHash(SMOKE_ADMIN_PASSWORD, hash)).toBe(true);
    });

    it("rejects a wrong password", () => {
      const hash = "bc640ff664a0d53c3f839da179fff0f35925939ff1f49068ef88a6855552d6da";
      expect(verifyPasswordHash("wrong", hash)).toBe(false);
    });
  });

  describe("findAccountByCredentials", () => {
    it("matches the smoke-admin account", () => {
      const result = findAccountByCredentials("smoke-admin", SMOKE_ADMIN_PASSWORD);
      expect(result.account?.id).toBe("acct_smoke_admin");
      expect(result.method).toBe("sha256");
    });

    it("matches the smoke-user account", () => {
      const result = findAccountByCredentials("smoke-user", SMOKE_USER_PASSWORD);
      expect(result.account?.id).toBe("acct_smoke_user");
    });

    it("returns null on wrong password", () => {
      const result = findAccountByCredentials("smoke-admin", "wrong");
      expect(result.account).toBeNull();
    });

    it("returns null on unknown user", () => {
      const result = findAccountByCredentials("nobody", "anything");
      expect(result.account).toBeNull();
    });

    it("returns null when username is empty", () => {
      const result = findAccountByCredentials("", "x");
      expect(result.account).toBeNull();
    });

    it("needsUpgrade is false when bcrypt is disabled (test env)", () => {
      // vitest.config.js sets ENABLE_BCRYPT=false → no upgrade is recommended.
      const result = findAccountByCredentials("smoke-admin", SMOKE_ADMIN_PASSWORD);
      expect(result.needsUpgrade).toBe(false);
    });
  });

  describe("getMatchedAccount", () => {
    it("returns the matched account on success", () => {
      const acc = getMatchedAccount("smoke-admin", SMOKE_ADMIN_PASSWORD);
      expect(acc?.id).toBe("acct_smoke_admin");
    });

    it("returns null on failure", () => {
      expect(getMatchedAccount("smoke-admin", "nope")).toBeNull();
    });
  });
});
