"use strict";

/**
 * Module-scoped singleton for the canonical AUTH_STORE.
 *
 * Lazy-initialized on first `getAuthStore()` call to honour the historical
 * "do not read auth config until first request" semantics. Tests that flip
 * `AUTH_CONFIG_PATH` therefore must not invoke `getAuthStore()` before the
 * env var is set.
 *
 * Node `require` cache guarantees a single module instance per absolute
 * path, which gives us a process-wide singleton for free. Do NOT introduce
 * a second alias path (e.g. `lib/auth/store/index.js`) — that would mint a
 * second copy of `AUTH_STORE` and silently desync state.
 */

let AUTH_STORE = null;

function getAuthStore() {
  if (!AUTH_STORE) {
    const { loadManagedAuthStore } = require("./config");
    AUTH_STORE = loadManagedAuthStore();
  }
  return AUTH_STORE;
}

function replaceAuthStore(nextStore) {
  AUTH_STORE = nextStore;
  return AUTH_STORE;
}

function reloadAuthStore() {
  const { loadManagedAuthStore } = require("./config");
  return replaceAuthStore(loadManagedAuthStore());
}

function getAuthAccountById(accountId) {
  const lookupId = String(accountId || "").trim();
  if (!lookupId) {
    return null;
  }
  return getAuthStore().accounts.find((item) => item.id === lookupId) || null;
}

function isPrimaryAdminAccount(accountId) {
  return String(accountId || "").trim() !== "" && getAuthStore().primary_admin_id === String(accountId);
}

module.exports = {
  getAuthStore,
  replaceAuthStore,
  reloadAuthStore,
  getAuthAccountById,
  isPrimaryAdminAccount,
};
