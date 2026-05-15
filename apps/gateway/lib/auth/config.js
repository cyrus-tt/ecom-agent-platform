"use strict";

/**
 * On-disk auth-config IO + store building.
 *
 * Layout on disk:
 *   apps/gateway/config/auth.json           — committed defaults
 *   apps/gateway/config/auth.local.json     — runtime overrides (managed)
 *   apps/gateway/runtime/auth_config_backup.json — first-run backup
 *
 * `loadManagedAuthStore` merges default + local, then `buildAuthStore`
 * normalizes accounts, enforces primary-admin invariants and returns the
 * canonical in-memory shape.
 *
 * `persistAuthStore(nextStore)` writes the local file atomically and then
 * replaces the singleton via `replaceAuthStore` (in `./store`). Order
 * matters: backup → local file → in-memory replace. If you swap any two
 * of those steps, a crash mid-sequence can wipe live config from disk.
 */

const fs = require("fs");
const path = require("path");

const passwordHasher = require("../passwordHasher");
const {
  AUTH_PERMISSION_KEYS,
  normalizePermissionKeys,
} = require("./permissions");
const { normalizeAuthAccount } = require("./accounts");

const BASE_DIR = path.resolve(__dirname, "..", "..");
const AUTH_CONFIG_DEFAULT_PATH = process.env.AUTH_CONFIG_PATH
  ? path.resolve(process.env.AUTH_CONFIG_PATH)
  : path.join(BASE_DIR, "config", "auth.json");
const AUTH_CONFIG_LOCAL_PATH = process.env.AUTH_CONFIG_LOCAL_PATH
  ? path.resolve(process.env.AUTH_CONFIG_LOCAL_PATH)
  : path.join(BASE_DIR, "config", "auth.local.json");
const AUTH_CONFIG_BACKUP_PATH = path.join(BASE_DIR, "runtime", "auth_config_backup.json");

function safeJsonRead(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function buildAuthStore(raw) {
  const defaults = {
    username: "anta",
    password_hash: passwordHasher.sha256Hex("123"),
    session_ttl_seconds: 24 * 3600,
    cookie_name: "anta_sid",
  };
  const legacyUsername = String(raw.username || defaults.username).trim() || defaults.username;
  const legacyPasswordHash = String(raw.password_hash || defaults.password_hash).trim().toLowerCase() || defaults.password_hash;
  const accounts = [];
  const rawAccounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  rawAccounts.forEach((item, index) => {
    const normalized = normalizeAuthAccount(item, legacyUsername, legacyPasswordHash, index, AUTH_PERMISSION_KEYS);
    if (normalized) {
      accounts.push(normalized);
    }
  });
  const legacyAccount = normalizeAuthAccount(
    {
      name: raw.name || raw.display_name || "Default Admin",
      username: legacyUsername,
      password_hash: legacyPasswordHash,
      is_admin: raw.is_admin !== false,
      permissions: AUTH_PERMISSION_KEYS,
    },
    defaults.username,
    defaults.password_hash,
    -1,
    AUTH_PERMISSION_KEYS
  );
  if (
    legacyAccount &&
    !accounts.some(
      (item) =>
        item.id === legacyAccount.id ||
        (item.username === legacyAccount.username && item.password_hash === legacyAccount.password_hash)
    )
  ) {
    accounts.unshift(legacyAccount);
  }

  let primaryAdminId = String(raw.primary_admin_id || "").trim();
  if (!primaryAdminId || !accounts.some((item) => item.id === primaryAdminId)) {
    primaryAdminId = accounts.find((item) => item.is_admin === true)?.id || accounts[0]?.id || "";
  }

  const normalizedAccounts = accounts.map((account) => {
    const isPrimaryAdmin = account.id === primaryAdminId;
    return {
      ...account,
      is_admin: isPrimaryAdmin,
      permissions: isPrimaryAdmin ? [...AUTH_PERMISSION_KEYS] : normalizePermissionKeys(account.permissions, AUTH_PERMISSION_KEYS),
    };
  });
  const primaryAdminAccount = normalizedAccounts.find((item) => item.id === primaryAdminId) || normalizedAccounts[0] || null;
  return {
    username: legacyUsername,
    password_hash: primaryAdminAccount?.password_hash || legacyPasswordHash,
    session_ttl_seconds: Math.max(300, Number(raw.session_ttl_seconds || defaults.session_ttl_seconds)),
    cookie_name: String(raw.cookie_name || defaults.cookie_name),
    primary_admin_id: primaryAdminId,
    accounts: normalizedAccounts,
  };
}

function loadManagedAuthStore() {
  const defaultConfig = safeJsonRead(AUTH_CONFIG_DEFAULT_PATH, {});
  const localConfig = safeJsonRead(AUTH_CONFIG_LOCAL_PATH, {});
  return buildAuthStore({
    ...defaultConfig,
    ...localConfig,
    accounts: Array.isArray(localConfig.accounts)
      ? localConfig.accounts
      : Array.isArray(defaultConfig.accounts)
        ? defaultConfig.accounts
        : [],
  });
}

function exportAuthConfig(authStore) {
  const { getAuthStore } = require("./store");
  const effectiveStore = authStore || getAuthStore();
  const primaryAdminAccount =
    effectiveStore.accounts.find((item) => item.id === effectiveStore.primary_admin_id) ||
    effectiveStore.accounts[0] ||
    null;
  return {
    name: primaryAdminAccount?.name || "Default Admin",
    username: effectiveStore.username,
    password_hash: primaryAdminAccount?.password_hash || effectiveStore.password_hash,
    session_ttl_seconds: effectiveStore.session_ttl_seconds,
    cookie_name: effectiveStore.cookie_name,
    primary_admin_id: effectiveStore.primary_admin_id,
    accounts: effectiveStore.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      username: account.username,
      password_hash: account.password_hash,
      password_bcrypt: account.password_bcrypt || "",
      is_admin: account.id === effectiveStore.primary_admin_id,
      permissions:
        account.id === effectiveStore.primary_admin_id
          ? [...AUTH_PERMISSION_KEYS]
          : normalizePermissionKeys(account.permissions, []),
    })),
  };
}

function ensureAuthConfigBackup() {
  if (fs.existsSync(AUTH_CONFIG_BACKUP_PATH)) {
    return;
  }
  const { getAuthStore } = require("./store");
  fs.mkdirSync(path.dirname(AUTH_CONFIG_BACKUP_PATH), { recursive: true });
  writeJsonAtomic(AUTH_CONFIG_BACKUP_PATH, exportAuthConfig(getAuthStore()));
}

function persistAuthStore(nextStore) {
  // Order is load-bearing: backup → local file write → in-memory replace.
  // Reversing any pair risks losing live config on a mid-sequence crash.
  const { replaceAuthStore } = require("./store");
  ensureAuthConfigBackup();
  fs.mkdirSync(path.dirname(AUTH_CONFIG_LOCAL_PATH), { recursive: true });
  writeJsonAtomic(AUTH_CONFIG_LOCAL_PATH, exportAuthConfig(nextStore));
  return replaceAuthStore(buildAuthStore(exportAuthConfig(nextStore)));
}

module.exports = {
  AUTH_CONFIG_DEFAULT_PATH,
  AUTH_CONFIG_LOCAL_PATH,
  AUTH_CONFIG_BACKUP_PATH,
  safeJsonRead,
  writeJsonAtomic,
  buildAuthStore,
  loadManagedAuthStore,
  exportAuthConfig,
  ensureAuthConfigBackup,
  persistAuthStore,
};
