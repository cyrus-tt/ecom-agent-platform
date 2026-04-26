import { describe, it, expect } from "vitest";

// eslint-disable-next-line import/first
const {
  getAuthStore,
  reloadAuthStore,
  getAuthAccountById,
  isPrimaryAdminAccount,
} = require("../store");

describe("lib/auth/store", () => {
  it("getAuthStore returns the same singleton instance across calls", () => {
    const a = getAuthStore();
    const b = getAuthStore();
    expect(a).toBe(b);
  });

  it("getAuthStore loads accounts from the fixture", () => {
    const store = getAuthStore();
    expect(store.accounts.length).toBeGreaterThanOrEqual(2);
    expect(store.accounts.find((acc) => acc.id === "acct_smoke_admin")).toBeTruthy();
    expect(store.accounts.find((acc) => acc.id === "acct_smoke_user")).toBeTruthy();
  });

  it("reloadAuthStore replaces the singleton with a fresh build", () => {
    const before = getAuthStore();
    const after = reloadAuthStore();
    // After reload, `getAuthStore()` returns the freshly built object,
    // and the in-memory reference is the new one.
    expect(after).not.toBe(before);
    expect(getAuthStore()).toBe(after);
  });

  describe("getAuthAccountById", () => {
    it("returns the matching account", () => {
      const acc = getAuthAccountById("acct_smoke_admin");
      expect(acc?.username).toBe("smoke-admin");
    });

    it("returns null for unknown id", () => {
      expect(getAuthAccountById("does_not_exist")).toBeNull();
    });

    it("returns null for empty/whitespace input", () => {
      expect(getAuthAccountById("")).toBeNull();
      expect(getAuthAccountById("   ")).toBeNull();
    });
  });

  describe("isPrimaryAdminAccount", () => {
    it("true for the configured primary admin", () => {
      const store = getAuthStore();
      expect(isPrimaryAdminAccount(store.primary_admin_id)).toBe(true);
    });

    it("false for the non-admin smoke user", () => {
      expect(isPrimaryAdminAccount("acct_smoke_user")).toBe(false);
    });

    it("false for empty input", () => {
      expect(isPrimaryAdminAccount("")).toBe(false);
      expect(isPrimaryAdminAccount(null)).toBe(false);
    });
  });
});
