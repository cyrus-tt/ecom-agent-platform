"use strict";

/**
 * Password hashing utility — bcrypt primary, SHA256 fallback.
 *
 * History:
 *   - v0: SHA256(password) stored in account.password_hash. Salt-less, fast,
 *         vulnerable to rainbow-table attacks. Used since project inception.
 *   - v1 (this module): bcryptjs cost=10 stored in account.password_bcrypt.
 *         SHA256 kept as fallback to avoid forcing everyone to reset.
 *
 * Verification order:
 *   1. If account.password_bcrypt is present → try bcrypt.compareSync
 *   2. Otherwise → try SHA256 timing-safe comparison against password_hash
 *
 * Auto-upgrade:
 *   When a login succeeds via SHA256 fallback AND ENABLE_BCRYPT=true
 *   (default), the caller should call hashForStorage(password) and persist
 *   the result to account.password_bcrypt.
 */

const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const BCRYPT_COST = Number(process.env.BCRYPT_COST || 10);

function isBcryptEnabled() {
  const raw = String(process.env.ENABLE_BCRYPT || "").trim().toLowerCase();
  if (!raw) return true;
  return !(raw === "false" || raw === "0" || raw === "no" || raw === "off");
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function timingSafeHexEqual(providedHex, expectedHex) {
  try {
    const expected = Buffer.from(String(expectedHex || "").toLowerCase(), "hex");
    const provided = Buffer.from(String(providedHex || "").toLowerCase(), "hex");
    if (!expected.length || expected.length !== provided.length) {
      return false;
    }
    return crypto.timingSafeEqual(expected, provided);
  } catch (_err) {
    return false;
  }
}

/**
 * Verify a plaintext password against an account record.
 *
 * @returns {{ valid: boolean, method: "bcrypt" | "sha256" | null, needsUpgrade: boolean }}
 */
function verify(password, account) {
  if (!account) {
    return { valid: false, method: null, needsUpgrade: false };
  }

  const bcryptHash = String(account.password_bcrypt || "").trim();
  if (bcryptHash) {
    try {
      if (bcrypt.compareSync(String(password || ""), bcryptHash)) {
        return { valid: true, method: "bcrypt", needsUpgrade: false };
      }
    } catch (_err) {
      // fallthrough to sha256 attempt
    }
  }

  const sha256Hash = String(account.password_hash || "").trim();
  if (sha256Hash) {
    const candidate = sha256Hex(password);
    if (timingSafeHexEqual(candidate, sha256Hash)) {
      // Auto-upgrade recommended only when bcrypt is not yet stored
      return {
        valid: true,
        method: "sha256",
        needsUpgrade: isBcryptEnabled() && !bcryptHash,
      };
    }
  }

  return { valid: false, method: null, needsUpgrade: false };
}

/**
 * Hash a plaintext password for storage in account.password_bcrypt.
 * Returns bcrypt string (e.g. "$2a$10$...").
 */
function hashForStorage(password) {
  return bcrypt.hashSync(String(password || ""), BCRYPT_COST);
}

module.exports = { verify, hashForStorage, sha256Hex, isBcryptEnabled, BCRYPT_COST };
