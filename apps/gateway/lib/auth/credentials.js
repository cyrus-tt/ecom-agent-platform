"use strict";

/**
 * Credential matching + bcrypt auto-upgrade.
 *
 * `getMatchedAccount(username, password)` is the entry point used by
 * `routes/auth-public.js`. It:
 *   1. Looks up the account by username.
 *   2. Tries bcrypt → SHA256 (delegated to `passwordHasher.verify`).
 *   3. If only SHA256 matched and bcrypt is enabled, persists a bcrypt
 *      hash for the account so the next login uses bcrypt.
 *
 * The auto-upgrade `persistAuthStore` call is wrapped in try/catch — a
 * disk failure must not deny a successful login.
 */

const passwordHasher = require("../passwordHasher");
const { childLogger } = require("../logger");

const log = childLogger("auth-credentials");

function verifyPasswordHash(password, expectedHex) {
  // Legacy SHA256-only helper kept for any callers that still depend on it.
  // Prefer passwordHasher.verify(password, account) for new code.
  return passwordHasher.verify(password, { password_hash: expectedHex }).valid;
}

function findAccountByCredentials(username, password) {
  const { getAuthStore } = require("./store");
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername) {
    return { account: null, needsUpgrade: false, method: null };
  }
  for (const account of getAuthStore().accounts || []) {
    if (!account || account.username !== normalizedUsername) {
      continue;
    }
    const result = passwordHasher.verify(password, account);
    if (result.valid) {
      return { account, needsUpgrade: result.needsUpgrade, method: result.method };
    }
  }
  return { account: null, needsUpgrade: false, method: null };
}

function upgradeAccountToBcrypt(accountId, plaintextPassword) {
  const { getAuthStore } = require("./store");
  const { persistAuthStore } = require("./config");
  const store = getAuthStore();
  const next = {
    ...store,
    accounts: store.accounts.map((entry) => {
      if (entry.id !== accountId) return entry;
      return {
        ...entry,
        password_bcrypt: passwordHasher.hashForStorage(plaintextPassword),
      };
    }),
  };
  try {
    persistAuthStore(next);
    log.info({ accountId }, "password auto-upgraded to bcrypt");
  } catch (err) {
    log.warn(
      { accountId, err: err && err.message },
      `bcrypt auto-upgrade persist failed: ${err && err.message}`
    );
  }
}

function getMatchedAccount(username, password) {
  const { account, needsUpgrade } = findAccountByCredentials(username, password);
  if (account && needsUpgrade) {
    upgradeAccountToBcrypt(account.id, password);
  }
  return account;
}

module.exports = {
  verifyPasswordHash,
  findAccountByCredentials,
  upgradeAccountToBcrypt,
  getMatchedAccount,
};
