"use strict";

/**
 * Account-shape helpers: normalization, sanitization, validation and CRUD.
 *
 * The CRUD helpers (`createManagedAccount` / `updateManagedAccount*`) write
 * back to the on-disk auth config via `persistAuthStore` from `./config`,
 * which in turn calls `replaceAuthStore` from `./store`. To avoid a circular
 * load with `./config` (which itself uses `normalizeAuthAccount`), the CRUD
 * helpers `require()` `./config` and `./store` lazily inside the function body.
 *
 * NOTE on `is_admin` default: `normalizeAuthAccount` keeps the legacy
 * "missing is_admin defaults to true" behaviour. `buildAuthStore` (in
 * `./config`) immediately downgrades any non-primary account to
 * `is_admin: false`, so the surface effect is bounded. Do NOT "fix" this
 * default in this PR — it is load-bearing for backward-compatible config
 * files.
 */

const crypto = require("crypto");

const passwordHasher = require("../passwordHasher");
const {
  AUTH_PERMISSION_KEYS,
  normalizePermissionKeys,
  resolvePreferredRouteForAccount,
} = require("./permissions");

function buildAccountId(raw, fallbackUsername, index) {
  const explicitId = String(raw?.id || raw?.account_id || "").trim();
  if (explicitId) {
    return explicitId;
  }
  const seed = [
    String(index),
    String(raw?.name || raw?.display_name || ""),
    String(raw?.username || fallbackUsername || ""),
    String(raw?.password_hash || ""),
  ].join("|");
  return `acct_${passwordHasher.sha256Hex(seed).slice(0, 16)}`;
}

function normalizeAuthAccount(raw, fallbackUsername, fallbackPasswordHash, index, fallbackPermissions = AUTH_PERMISSION_KEYS) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const id = buildAccountId(raw, fallbackUsername, index);
  const username = String(raw.username || fallbackUsername || "").trim();
  const passwordHash = String(raw.password_hash || fallbackPasswordHash || "").trim().toLowerCase();
  if (!username || !/^[0-9a-f]{64}$/i.test(passwordHash)) {
    return null;
  }
  const passwordBcrypt = String(raw.password_bcrypt || "").trim();
  return {
    id,
    name: String(raw.name || raw.display_name || username).trim() || username,
    username,
    password_hash: passwordHash,
    password_bcrypt: passwordBcrypt,
    is_admin: raw.is_admin !== false,
    permissions: normalizePermissionKeys(raw.permissions, fallbackPermissions),
  };
}

function sanitizeAccountForClient(account) {
  if (!account) {
    return null;
  }
  const { isPrimaryAdminAccount } = require("./store");
  return {
    id: account.id,
    name: account.name,
    username: account.username,
    is_admin: account.is_admin === true,
    is_primary_admin: isPrimaryAdminAccount(account.id),
    permissions: account.is_admin === true ? [...AUTH_PERMISSION_KEYS] : normalizePermissionKeys(account.permissions, []),
    preferred_route: resolvePreferredRouteForAccount(account),
  };
}

function cloneAccountForMutation(account) {
  return {
    id: account.id,
    name: account.name,
    username: account.username,
    password_hash: account.password_hash,
    password_bcrypt: account.password_bcrypt || "",
    is_admin: account.is_admin === true,
    permissions: normalizePermissionKeys(account.permissions, []),
  };
}

function validateAccountName(name, existingAccounts = [], currentId = "") {
  const nextName = String(name || "").trim();
  if (!nextName) {
    throw new Error("name is required");
  }
  const normalized = nextName.toLowerCase();
  const duplicated = existingAccounts.some(
    (item) => item.id !== currentId && String(item.name || "").trim().toLowerCase() === normalized
  );
  if (duplicated) {
    throw new Error("account name already exists");
  }
  return nextName;
}

function validateAccountPassword(password) {
  const nextPassword = String(password || "");
  if (!nextPassword) {
    throw new Error("password is required");
  }
  if (nextPassword.length > 128) {
    throw new Error("password is too long");
  }
  return nextPassword;
}

function updateAuthStore(mutator) {
  const { getAuthStore } = require("./store");
  const { exportAuthConfig, persistAuthStore, buildAuthStore } = require("./config");
  const draft = exportAuthConfig(getAuthStore());
  draft.accounts = draft.accounts.map((account) => cloneAccountForMutation(account));
  mutator(draft);
  return persistAuthStore(buildAuthStore(draft));
}

function createManagedAccount({ name, password, permissions }) {
  const nextPassword = validateAccountPassword(password);
  const bcryptHash = passwordHasher.isBcryptEnabled()
    ? passwordHasher.hashForStorage(nextPassword)
    : "";
  const nextStore = updateAuthStore((draft) => {
    const nextName = validateAccountName(name, draft.accounts);
    draft.accounts.push({
      id: `acct_${crypto.randomBytes(8).toString("hex")}`,
      name: nextName,
      username: draft.username,
      password_hash: passwordHasher.sha256Hex(nextPassword),
      password_bcrypt: bcryptHash,
      is_admin: false,
      permissions: normalizePermissionKeys(permissions, []),
    });
  });
  return nextStore.accounts[nextStore.accounts.length - 1] || null;
}

function updateManagedAccountPermissions(accountId, permissions) {
  const { getAuthAccountById } = require("./store");
  updateAuthStore((draft) => {
    const target = draft.accounts.find((item) => item.id === accountId);
    if (!target) {
      throw new Error("account not found");
    }
    if (draft.primary_admin_id === target.id) {
      throw new Error("primary admin permissions are locked");
    }
    target.permissions = normalizePermissionKeys(permissions, []);
  });
  return getAuthAccountById(accountId);
}

function updateManagedAccountPassword(accountId, password) {
  const { getAuthAccountById } = require("./store");
  const nextPassword = validateAccountPassword(password);
  updateAuthStore((draft) => {
    const target = draft.accounts.find((item) => item.id === accountId);
    if (!target) {
      throw new Error("account not found");
    }
    target.password_hash = passwordHasher.sha256Hex(nextPassword);
    target.password_bcrypt = passwordHasher.isBcryptEnabled()
      ? passwordHasher.hashForStorage(nextPassword)
      : "";
  });
  return getAuthAccountById(accountId);
}

module.exports = {
  buildAccountId,
  normalizeAuthAccount,
  sanitizeAccountForClient,
  cloneAccountForMutation,
  validateAccountName,
  validateAccountPassword,
  updateAuthStore,
  createManagedAccount,
  updateManagedAccountPermissions,
  updateManagedAccountPassword,
};
