import { describe, it, expect } from "vitest";
import crypto from "crypto";

// Flip ENABLE_BCRYPT on for these tests (vitest.config sets it to "false"
// globally to keep smoke tests fast and to prevent fixture mutation).
process.env.ENABLE_BCRYPT = "true";

// eslint-disable-next-line import/first
const hasher = require("../../lib/passwordHasher");

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

describe("passwordHasher", () => {
  it("verifies legacy SHA256 password_hash", () => {
    const account = { password_hash: sha256("hunter2") };
    const result = hasher.verify("hunter2", account);
    expect(result.valid).toBe(true);
    expect(result.method).toBe("sha256");
    expect(result.needsUpgrade).toBe(true);
  });

  it("rejects wrong password against SHA256 hash", () => {
    const account = { password_hash: sha256("hunter2") };
    const result = hasher.verify("wrong", account);
    expect(result.valid).toBe(false);
  });

  it("hashForStorage produces a bcrypt string that verify() accepts", () => {
    const plaintext = "correct-horse-battery-staple";
    const bcryptHash = hasher.hashForStorage(plaintext);
    expect(bcryptHash.startsWith("$2")).toBe(true);
    const account = { password_hash: "", password_bcrypt: bcryptHash };
    const result = hasher.verify(plaintext, account);
    expect(result.valid).toBe(true);
    expect(result.method).toBe("bcrypt");
    expect(result.needsUpgrade).toBe(false);
  });

  it("prefers bcrypt over SHA256 when both are present and bcrypt matches", () => {
    const plaintext = "dual-hash-pw";
    const account = {
      password_hash: sha256("different-plaintext"),
      password_bcrypt: hasher.hashForStorage(plaintext),
    };
    const result = hasher.verify(plaintext, account);
    expect(result.valid).toBe(true);
    expect(result.method).toBe("bcrypt");
    expect(result.needsUpgrade).toBe(false);
  });

  it("falls back to SHA256 when bcrypt hash does not match", () => {
    const plaintext = "legacy-pw";
    const account = {
      password_hash: sha256(plaintext),
      password_bcrypt: hasher.hashForStorage("unrelated"),
    };
    const result = hasher.verify(plaintext, account);
    // When bcrypt is present the fallback to SHA256 is acceptable on mismatch
    // but we should not auto-upgrade since bcrypt already exists.
    expect(result.valid).toBe(true);
    expect(result.method).toBe("sha256");
    expect(result.needsUpgrade).toBe(false);
  });

  it("rejects entirely wrong password against both hashes", () => {
    const account = {
      password_hash: sha256("one"),
      password_bcrypt: hasher.hashForStorage("two"),
    };
    const result = hasher.verify("three", account);
    expect(result.valid).toBe(false);
    expect(result.method).toBe(null);
  });

  it("handles empty/missing account gracefully", () => {
    expect(hasher.verify("x", null).valid).toBe(false);
    expect(hasher.verify("x", {}).valid).toBe(false);
    expect(hasher.verify("", { password_hash: sha256("") }).valid).toBe(true);
  });
});
