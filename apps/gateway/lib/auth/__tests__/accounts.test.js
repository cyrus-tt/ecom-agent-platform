import { describe, it, expect } from "vitest";

// eslint-disable-next-line import/first
const {
  normalizeAuthAccount,
  sanitizeAccountForClient,
  cloneAccountForMutation,
  validateAccountName,
  validateAccountPassword,
} = require("../accounts");

const VALID_HASH = "bc640ff664a0d53c3f839da179fff0f35925939ff1f49068ef88a6855552d6da";

describe("lib/auth/accounts", () => {
  describe("normalizeAuthAccount", () => {
    it("returns null for non-object input", () => {
      expect(normalizeAuthAccount(null)).toBeNull();
      expect(normalizeAuthAccount("string")).toBeNull();
      expect(normalizeAuthAccount(undefined)).toBeNull();
    });

    it("returns null when password_hash is not 64-hex", () => {
      expect(normalizeAuthAccount({ username: "x", password_hash: "not-hex" })).toBeNull();
    });

    it("uses fallback username when raw is missing", () => {
      const acc = normalizeAuthAccount({ password_hash: VALID_HASH }, "fallback-user");
      expect(acc.username).toBe("fallback-user");
    });

    it("defaults is_admin to true when missing (legacy compat)", () => {
      const acc = normalizeAuthAccount({ username: "u", password_hash: VALID_HASH });
      expect(acc.is_admin).toBe(true);
    });

    it("respects is_admin: false", () => {
      const acc = normalizeAuthAccount({ username: "u", password_hash: VALID_HASH, is_admin: false });
      expect(acc.is_admin).toBe(false);
    });

    it("populates name from display_name when name absent", () => {
      const acc = normalizeAuthAccount({ username: "u", password_hash: VALID_HASH, display_name: "Display" });
      expect(acc.name).toBe("Display");
    });

    it("falls back name to username when neither name nor display_name set", () => {
      const acc = normalizeAuthAccount({ username: "u", password_hash: VALID_HASH });
      expect(acc.name).toBe("u");
    });

    it("normalizes permissions (filtering unknowns)", () => {
      const acc = normalizeAuthAccount({
        username: "u",
        password_hash: VALID_HASH,
        permissions: ["portal", "garbage"],
      });
      expect(acc.permissions).toEqual(["portal"]);
    });
  });

  describe("sanitizeAccountForClient", () => {
    it("returns null for null input", () => {
      expect(sanitizeAccountForClient(null)).toBeNull();
    });

    it("does not leak password_hash or password_bcrypt", () => {
      const safe = sanitizeAccountForClient({
        id: "acct_x",
        name: "X",
        username: "x",
        password_hash: VALID_HASH,
        password_bcrypt: "$2a$10$secretsecret",
        is_admin: false,
        permissions: ["portal"],
      });
      expect(safe).not.toHaveProperty("password_hash");
      expect(safe).not.toHaveProperty("password_bcrypt");
      expect(safe.permissions).toEqual(["portal"]);
    });

    it("admin gets all permissions in output", () => {
      const safe = sanitizeAccountForClient({
        id: "acct_a",
        name: "A",
        username: "a",
        password_hash: VALID_HASH,
        is_admin: true,
        permissions: [],
      });
      expect(safe.permissions.length).toBeGreaterThan(0);
    });
  });

  describe("cloneAccountForMutation", () => {
    it("preserves all mutable fields", () => {
      const clone = cloneAccountForMutation({
        id: "acct_x",
        name: "X",
        username: "x",
        password_hash: VALID_HASH,
        password_bcrypt: "$2a$10$xx",
        is_admin: false,
        permissions: ["portal"],
      });
      expect(clone).toMatchObject({
        id: "acct_x",
        name: "X",
        username: "x",
        password_hash: VALID_HASH,
        password_bcrypt: "$2a$10$xx",
        is_admin: false,
      });
      expect(clone.permissions).toEqual(["portal"]);
    });

    it("defaults password_bcrypt to empty string", () => {
      const clone = cloneAccountForMutation({
        id: "x", name: "X", username: "x", password_hash: VALID_HASH, is_admin: false, permissions: [],
      });
      expect(clone.password_bcrypt).toBe("");
    });
  });

  describe("validateAccountName", () => {
    it("throws on empty input", () => {
      expect(() => validateAccountName("")).toThrow("name is required");
      expect(() => validateAccountName("   ")).toThrow("name is required");
    });

    it("throws on duplicate name (case-insensitive)", () => {
      const existing = [{ id: "a", name: "Alice" }];
      expect(() => validateAccountName("alice", existing)).toThrow("already exists");
    });

    it("allows the same id to keep its name", () => {
      const existing = [{ id: "a", name: "Alice" }];
      expect(validateAccountName("Alice", existing, "a")).toBe("Alice");
    });

    it("trims input", () => {
      expect(validateAccountName("  Bob  ", [])).toBe("Bob");
    });
  });

  describe("validateAccountPassword", () => {
    it("throws on empty", () => {
      expect(() => validateAccountPassword("")).toThrow("password is required");
    });

    it("throws when too long", () => {
      expect(() => validateAccountPassword("x".repeat(129))).toThrow("password is too long");
    });

    it("returns the password unchanged on valid input", () => {
      expect(validateAccountPassword("hunter2")).toBe("hunter2");
    });
  });
});
