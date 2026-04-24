const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const XLSX = require("xlsx");
const reportRepo = require("./services/reportRepo");
const metricsService = require("./services/metricsService");
const agentService = require("./services/agentService");
const agentSkills = require("./services/agentSkills");
const analysisContextProvider = require("./services/analysisContextProvider");
const appConfig = require("./services/appConfig");
const runtimeSecrets = require("./services/runtimeSecrets");
const dispatchModule = require("./services/dispatch");
const { childLogger } = require("./lib/logger");
const passwordHasher = require("./lib/passwordHasher");
const log = childLogger("server");

const app = express();
app.set("trust proxy", 1);
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, "public");
const PROJECT_ROOT = path.resolve(BASE_DIR, "..", "..");
const WEB_DIST_DIR = process.env.WEB_DIST_DIR || path.join(PROJECT_ROOT, "apps", "web", "dist");
const WEB_INDEX_PATH = path.join(WEB_DIST_DIR, "index.html");
const AUTH_CONFIG_DEFAULT_PATH = process.env.AUTH_CONFIG_PATH
  ? path.resolve(process.env.AUTH_CONFIG_PATH)
  : path.join(BASE_DIR, "config", "auth.json");
const AUTH_CONFIG_LOCAL_PATH = process.env.AUTH_CONFIG_LOCAL_PATH
  ? path.resolve(process.env.AUTH_CONFIG_LOCAL_PATH)
  : path.join(BASE_DIR, "config", "auth.local.json");
const AUTH_CONFIG_BACKUP_PATH = path.join(BASE_DIR, "runtime", "auth_config_backup.json");
const ARRIVAL_BASE = appConfig.arrivalServiceUrl;
const NOTES_BASE = appConfig.notesServiceUrl;
const ARRIVAL_PROJECT_DIR = appConfig.arrivalProjectDir;
const PG_PIPELINE_SCRIPT = path.join(PROJECT_ROOT, "ops", "windows", "run_pg_pipeline.ps1");
const ARRIVAL_URL = new URL(ARRIVAL_BASE);
const ARRIVAL_START_TIMEOUT_MS = Math.max(3000, Number(process.env.ARRIVAL_START_TIMEOUT_MS || 20000));
const ARRIVAL_PROBE_TIMEOUT_MS = Math.max(1000, Number(process.env.ARRIVAL_PROBE_TIMEOUT_MS || 2500));
const AUTH_COOKIE_SECURE = String(process.env.AUTH_COOKIE_SECURE || (process.env.NODE_ENV === "production" ? "true" : "false"))
  .trim()
  .toLowerCase() === "true";

const SESSION_STORE = new Map();
const JOB_STORE = new Map();
const RUNNING_JOB_BY_TYPE = new Map();
const JOB_LOG_LIMIT = 300;
let ARRIVAL_SERVICE_PROCESS = null;
let ARRIVAL_SERVICE_START_PROMISE = null;
let ARRIVAL_SERVICE_LAST_ERROR = "";
let AUTH_STORE = null;

const AUTH_PERMISSION_MODULES = [
  { key: "portal", label: "门户", route: "/", description: "登录后的首页与系统健康概览" },
  { key: "report_daily", label: "日报", route: "/report-daily", description: "日报主表与导出" },
  { key: "arrival", label: "新品", route: "/arrival", description: "到货、新品看板与跟进备注" },
  { key: "dashboard", label: "可视化", route: "/dashboard", description: "综合数据可视化看板" },
  { key: "channel_dashboard", label: "渠道", route: "/channel-dashboard", description: "渠道店铺看板" },
  { key: "analysis", label: "分析", route: "/analysis", description: "AI 经营分析与历史报告" },
  ...(dispatchModule.isEnabled() ? [dispatchModule.PERMISSION_MODULE] : []),
];

const AUTH_PERMISSION_KEYS = AUTH_PERMISSION_MODULES.map((item) => item.key);
const AUTH_PERMISSION_SET = new Set(AUTH_PERMISSION_KEYS);

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

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

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizePermissionKeys(rawPermissions, fallbackPermissions = AUTH_PERMISSION_KEYS) {
  if (!Array.isArray(rawPermissions)) {
    return [...fallbackPermissions];
  }
  const next = [];
  rawPermissions.forEach((item) => {
    const key = String(item || "").trim();
    if (!AUTH_PERMISSION_SET.has(key) || next.includes(key)) {
      return;
    }
    next.push(key);
  });
  return next;
}

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
  return `acct_${sha256(seed).slice(0, 16)}`;
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

function loadAuthConfig() {
  const defaults = {
    username: "anta",
    password_hash: sha256("123"),
    session_ttl_seconds: 24 * 3600,
    cookie_name: "anta_sid",
  };
  const defaultConfig = safeJsonRead(AUTH_CONFIG_DEFAULT_PATH, {});
  const localConfig = safeJsonRead(AUTH_CONFIG_LOCAL_PATH, {});
  const raw = {
    ...defaultConfig,
    ...localConfig,
    accounts: Array.isArray(localConfig.accounts)
      ? localConfig.accounts
      : Array.isArray(defaultConfig.accounts)
        ? defaultConfig.accounts
        : [],
  };
  const legacyUsername = String(raw.username || defaults.username).trim() || defaults.username;
  const legacyPasswordHash = String(raw.password_hash || defaults.password_hash).trim().toLowerCase() || defaults.password_hash;
  const accounts = [];
  const rawAccounts = Array.isArray(raw.accounts) ? raw.accounts : [];
  rawAccounts.forEach((item) => {
    const normalized = normalizeAuthAccount(item, legacyUsername, legacyPasswordHash);
    if (normalized) {
      accounts.push(normalized);
    }
  });
  const legacyAccount = normalizeAuthAccount(
    {
      name: raw.name || raw.display_name || "默认账号",
      username: legacyUsername,
      password_hash: legacyPasswordHash,
      is_admin: raw.is_admin !== false,
    },
    defaults.username,
    defaults.password_hash
  );
  if (legacyAccount && !accounts.some((item) => item.username === legacyAccount.username && item.password_hash === legacyAccount.password_hash)) {
    accounts.unshift(legacyAccount);
  }
  return {
    username: legacyUsername,
    password_hash: legacyPasswordHash,
    session_ttl_seconds: Math.max(300, Number(raw.session_ttl_seconds || defaults.session_ttl_seconds)),
    cookie_name: String(raw.cookie_name || defaults.cookie_name),
    accounts,
  };
}

const AUTH_CONFIG = loadAuthConfig();

function buildAuthStore(raw) {
  const defaults = {
    username: "anta",
    password_hash: sha256("123"),
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

function getAuthStore() {
  if (!AUTH_STORE) {
    AUTH_STORE = loadManagedAuthStore();
  }
  return AUTH_STORE;
}

function replaceAuthStore(nextStore) {
  AUTH_STORE = nextStore;
  return AUTH_STORE;
}

function reloadAuthStore() {
  return replaceAuthStore(loadManagedAuthStore());
}

function resolvePreferredRouteForPermissions(permissions) {
  const permissionList = Array.isArray(permissions) ? permissions : [];
  for (const item of AUTH_PERMISSION_MODULES) {
    if (permissionList.includes(item.key)) {
      return item.route;
    }
  }
  return "/no-access";
}

function resolvePreferredRouteForAccount(account) {
  if (!account) {
    return "/no-access";
  }
  if (account.is_admin === true) {
    return "/";
  }
  return resolvePreferredRouteForPermissions(account.permissions);
}

function accountHasPermission(account, permissionKey) {
  if (!account) {
    return false;
  }
  if (account.is_admin === true) {
    return true;
  }
  return Array.isArray(account.permissions) && account.permissions.includes(permissionKey);
}

function accountHasAnyPermission(account, permissionKeys) {
  return (Array.isArray(permissionKeys) ? permissionKeys : []).some((item) => accountHasPermission(account, item));
}

function isRouteAllowedForAccount(account, pathname) {
  const routePath = String(pathname || "").trim() || "/";
  if (routePath === "/no-access") {
    return true;
  }
  if (routePath === "/") {
    return accountHasPermission(account, "portal");
  }
  if (routePath === "/report" || routePath.startsWith("/report-daily")) {
    return accountHasPermission(account, "report_daily");
  }
  if (routePath.startsWith("/arrival")) {
    return accountHasPermission(account, "arrival");
  }
  if (routePath.startsWith("/dashboard")) {
    return accountHasPermission(account, "dashboard");
  }
  if (routePath.startsWith("/channel-dashboard")) {
    return accountHasPermission(account, "channel_dashboard");
  }
  if (routePath.startsWith("/analysis")) {
    return accountHasPermission(account, "analysis");
  }
  if (routePath.startsWith("/admin/accounts")) {
    return account?.is_admin === true;
  }
  return true;
}

function exportAuthConfig(authStore = getAuthStore()) {
  const primaryAdminAccount = authStore.accounts.find((item) => item.id === authStore.primary_admin_id) || authStore.accounts[0] || null;
  return {
    name: primaryAdminAccount?.name || "Default Admin",
    username: authStore.username,
    password_hash: primaryAdminAccount?.password_hash || authStore.password_hash,
    session_ttl_seconds: authStore.session_ttl_seconds,
    cookie_name: authStore.cookie_name,
    primary_admin_id: authStore.primary_admin_id,
    accounts: authStore.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      username: account.username,
      password_hash: account.password_hash,
      password_bcrypt: account.password_bcrypt || "",
      is_admin: account.id === authStore.primary_admin_id,
      permissions: account.id === authStore.primary_admin_id ? [...AUTH_PERMISSION_KEYS] : normalizePermissionKeys(account.permissions, []),
    })),
  };
}

function ensureAuthConfigBackup() {
  if (fs.existsSync(AUTH_CONFIG_BACKUP_PATH)) {
    return;
  }
  fs.mkdirSync(path.dirname(AUTH_CONFIG_BACKUP_PATH), { recursive: true });
  writeJsonAtomic(AUTH_CONFIG_BACKUP_PATH, exportAuthConfig(getAuthStore()));
}

function persistAuthStore(nextStore) {
  ensureAuthConfigBackup();
  fs.mkdirSync(path.dirname(AUTH_CONFIG_LOCAL_PATH), { recursive: true });
  writeJsonAtomic(AUTH_CONFIG_LOCAL_PATH, exportAuthConfig(nextStore));
  return replaceAuthStore(buildAuthStore(exportAuthConfig(nextStore)));
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

function sanitizeAccountForClient(account) {
  if (!account) {
    return null;
  }
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
      password_hash: sha256(nextPassword),
      password_bcrypt: bcryptHash,
      is_admin: false,
      permissions: normalizePermissionKeys(permissions, []),
    });
  });
  return nextStore.accounts[nextStore.accounts.length - 1] || null;
}

function updateManagedAccountPermissions(accountId, permissions) {
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
  const nextPassword = validateAccountPassword(password);
  updateAuthStore((draft) => {
    const target = draft.accounts.find((item) => item.id === accountId);
    if (!target) {
      throw new Error("account not found");
    }
    target.password_hash = sha256(nextPassword);
    target.password_bcrypt = passwordHasher.isBcryptEnabled()
      ? passwordHasher.hashForStorage(nextPassword)
      : "";
  });
  return getAuthAccountById(accountId);
}

function getLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  Object.values(nets).forEach((list) => {
    (list || []).forEach((addr) => {
      if (addr.family === "IPv4" && !addr.internal && !addr.address.startsWith("169.254.")) {
        ips.push(addr.address);
      }
    });
  });
  return [...new Set(ips)];
}

function stampNow() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}${m}${day}_${hh}${mm}`;
}

function nowText() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function findLatestGapWorkbookPath() {
  const runtimeDir = path.join(BASE_DIR, "runtime");
  if (!fs.existsSync(runtimeDir)) {
    return "";
  }
  const names = fs
    .readdirSync(runtimeDir)
    .filter((name) => /^mapping_gaps_\d{8}\.xlsx$/i.test(name))
    .map((name) => {
      const full = path.join(runtimeDir, name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(full).mtimeMs || 0;
      } catch (_err) {
        mtimeMs = 0;
      }
      return { name, full, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return names[0]?.full || "";
}

function ensureSheet(wb, name, headerRow) {
  if (wb.Sheets[name]) {
    return;
  }
  const ws = XLSX.utils.aoa_to_sheet([headerRow]);
  wb.Sheets[name] = ws;
  wb.SheetNames.push(name);
}

function buildGapTemplateWorkbook(week, gapSummary) {
  const sourcePath = findLatestGapWorkbookPath();
  const wb = sourcePath ? XLSX.readFile(sourcePath) : XLSX.utils.book_new();
  const gap = gapSummary || {};
  const summaryRows = [
    ["报告周次", week || ""],
    ["导出时间", nowText()],
    [""],
    ["缺口类型", "数量", "处理状态(待填)", "责任人(待填)", "备注(待填)"],
    ["门店渠道缺失", Number(gap.missing_store_channel || 0), "", "", ""],
    ["分配池渠道缺失", Number(gap.missing_pool_channel || 0), "", "", ""],
    ["分配池比例缺失", Number(gap.missing_pool_ratio || 0), "", "", ""],
    ["库存未知渠道", Number(gap.unknown_inventory_channel || 0), "", "", ""],
    ["销售未知渠道", Number(gap.unknown_sales_channel || 0), "", "", ""],
  ];
  const summarySheetName = "缺口摘要";
  if (wb.Sheets[summarySheetName]) {
    delete wb.Sheets[summarySheetName];
    wb.SheetNames = wb.SheetNames.filter((name) => name !== summarySheetName);
  }
  wb.Sheets[summarySheetName] = XLSX.utils.aoa_to_sheet(summaryRows);
  wb.SheetNames.unshift(summarySheetName);

  ensureSheet(wb, "unknown_inventory_channel", ["库存渠道(待填)", "备注(待填)"]);
  ensureSheet(wb, "unknown_sales_channel", ["销售渠道(待填)", "备注(待填)"]);
  return { wb, sourcePath };
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function normalizeAgentPeriodType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "day" || text === "week" || text === "month") {
    return text;
  }
  return "week";
}

function hasClientBuild() {
  return fs.existsSync(WEB_INDEX_PATH);
}

function sendReactApp(res) {
  if (!hasClientBuild()) {
    return res.status(503).type("html").send(`<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>前端构建缺失</title></head>
<body style="font-family:Segoe UI,Microsoft YaHei,sans-serif;padding:32px;">
<h2>React 前端构建缺失</h2>
<p>请先执行 <code>npm run build:web</code> 或 <code>ops\\windows\\start_all.ps1 -RebuildWeb</code>。</p>
</body>
</html>`);
  }
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  return res.sendFile(WEB_INDEX_PATH);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  String(cookieHeader || "")
    .split(";")
    .forEach((part) => {
      const idx = part.indexOf("=");
      if (idx <= 0) {
        return;
      }
      try {
        const key = decodeURIComponent(part.slice(0, idx).trim());
        const value = decodeURIComponent(part.slice(idx + 1).trim());
        if (key) {
          cookies[key] = value;
        }
      } catch (_err) {
        return;
      }
    });
  return cookies;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [sid, session] of SESSION_STORE.entries()) {
    if (!session || now >= Number(session.expires_at || 0)) {
      SESSION_STORE.delete(sid);
    }
  }
}

function createSession(account) {
  cleanupSessions();
  const sid = crypto.randomBytes(24).toString("hex");
  const authStore = getAuthStore();
  const expiresAt = Date.now() + authStore.session_ttl_seconds * 1000;
  const session = {
    sid,
    account_id: String(account?.id || ""),
    created_at: Date.now(),
    expires_at: expiresAt,
  };
  SESSION_STORE.set(sid, session);
  return getAuthAccountById(session.account_id)
    ? {
        ...session,
        username: String(account?.username || ""),
        name: String(account?.name || account?.username || ""),
        is_admin: account?.is_admin === true,
        permissions: account?.is_admin === true ? [...AUTH_PERMISSION_KEYS] : normalizePermissionKeys(account?.permissions, []),
        shared_username: authStore.username,
        preferred_route: resolvePreferredRouteForAccount(account),
      }
    : null;
}

function verifyPasswordHash(password, expectedHex) {
  // Legacy SHA256-only helper kept for any callers that still depend on it.
  // Prefer passwordHasher.verify(password, account) for new code.
  return passwordHasher.verify(password, { password_hash: expectedHex }).valid;
}

function findAccountByCredentials(username, password) {
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

function getSessionByRequest(req) {
  cleanupSessions();
  const cookies = parseCookies(req.headers.cookie);
  const authStore = getAuthStore();
  const sid = cookies[authStore.cookie_name];
  if (!sid) {
    return null;
  }
  const session = SESSION_STORE.get(sid);
  if (!session || Date.now() >= Number(session.expires_at || 0)) {
    SESSION_STORE.delete(sid);
    return null;
  }
  const account = getAuthAccountById(session.account_id);
  if (!account) {
    SESSION_STORE.delete(sid);
    return null;
  }
  return {
    sid,
    account_id: session.account_id,
    username: String(account.username || ""),
    name: String(account.name || account.username || ""),
    is_admin: account.is_admin === true,
    permissions: account.is_admin === true ? [...AUTH_PERMISSION_KEYS] : normalizePermissionKeys(account.permissions, []),
    shared_username: authStore.username,
    preferred_route: resolvePreferredRouteForAccount(account),
    created_at: Number(session.created_at || Date.now()),
    expires_at: Number(session.expires_at || 0),
  };
}

function setSessionCookie(res, sid) {
  const authStore = getAuthStore();
  res.cookie(authStore.cookie_name, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: AUTH_COOKIE_SECURE,
    path: "/",
    maxAge: authStore.session_ttl_seconds * 1000,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(getAuthStore().cookie_name, {
    httpOnly: true,
    sameSite: "lax",
    secure: AUTH_COOKIE_SECURE,
    path: "/",
  });
}

function normalizeNext(raw) {
  const value = String(raw || "").trim();
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

function isPublicPath(pathname) {
  return (
    pathname === "/login" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/agent/context" ||
    pathname === "/healthz" ||
    pathname === "/readyz" ||
    pathname === "/favicon.ico" ||
    pathname === "/login.css" ||
    pathname === "/login.js" ||
    pathname.startsWith("/dispatch/confirm/") ||
    pathname === "/api/dispatch/public/preview" ||
    pathname === "/api/dispatch/public/confirm"
  );
}

function buildAuthMePayload(session) {
  return {
    ok: true,
    account_id: session.account_id,
    username: session.username,
    name: session.name,
    is_admin: session.is_admin === true,
    permissions: session.is_admin === true ? [...AUTH_PERMISSION_KEYS] : normalizePermissionKeys(session.permissions, []),
    shared_username: session.shared_username || getAuthStore().username,
    preferred_route: session.preferred_route || resolvePreferredRouteForPermissions(session.permissions),
    expires_at: new Date(session.expires_at).toISOString(),
  };
}

function isApiLikeRequest(req) {
  return req.path.startsWith("/api/") || req.path.startsWith("/notes-api/");
}

function denyPermission(req, res, requiredPermission) {
  const preferredRoute = normalizeNext(req.authSession?.preferred_route || "/no-access");
  if (isApiLikeRequest(req)) {
    return res.status(403).json({
      ok: false,
      message: "Forbidden",
      required_permission: requiredPermission || "",
      preferred_route: preferredRoute,
    });
  }
  const currentPath = normalizeNext(req.originalUrl || req.path || "/");
  if (preferredRoute === currentPath) {
    return res.redirect("/no-access");
  }
  return res.redirect(preferredRoute);
}

function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (accountHasPermission(req.authSession, permissionKey)) {
      return next();
    }
    return denyPermission(req, res, permissionKey);
  };
}

function requireAnyPermission(permissionKeys) {
  return (req, res, next) => {
    if (accountHasAnyPermission(req.authSession, permissionKeys)) {
      return next();
    }
    return denyPermission(req, res, Array.isArray(permissionKeys) ? permissionKeys.join(",") : "");
  };
}

function requireAdmin(req, res, next) {
  if (req.authSession?.is_admin === true) {
    return next();
  }
  return denyPermission(req, res, "admin");
}

function hasAgentReadToken(req) {
  const configured = String(appConfig.agentRemoteReadToken || "").trim();
  if (!configured) {
    return false;
  }
  const authorization = String(req.headers.authorization || "").trim();
  const bearerToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const headerToken = String(req.headers["x-agent-read-token"] || "").trim();
  return bearerToken === configured || headerToken === configured;
}

function requireAgentContextAccess(req, res, next) {
  if (accountHasPermission(req.authSession, "analysis")) {
    return next();
  }
  if (hasAgentReadToken(req)) {
    return next();
  }
  return res.status(401).json({
    ok: false,
    message: "Unauthorized",
    login: "/login",
  });
}

function resolvePostLoginRoute(account, rawNext) {
  const preferredRoute = resolvePreferredRouteForAccount(account);
  const nextUrl = normalizeNext(rawNext);
  if (nextUrl === "/login" || nextUrl === "/logout") {
    return preferredRoute;
  }
  return isRouteAllowedForAccount(account, nextUrl) ? nextUrl : preferredRoute;
}

function renderLoginPage(sharedUsername) {
  const template = fs.readFileSync(path.join(PUBLIC_DIR, "login.html"), "utf8");
  return template.replace(/__SHARED_USERNAME__/g, escapeHtml(sharedUsername));
}

function appendJobLog(job, streamName, chunk) {
  const lines = String(chunk || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  lines.forEach((line) => {
    job.logs.push(`[${new Date().toISOString()}] [${streamName}] ${line}`);
  });
  if (job.logs.length > JOB_LOG_LIMIT) {
    job.logs.splice(0, job.logs.length - JOB_LOG_LIMIT);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isChildRunning(child) {
  return !!child && child.exitCode === null && child.killed !== true;
}

function appendArrivalServiceLog(streamName, chunk) {
  const lines = String(chunk || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  lines.forEach((line) => {
    ARRIVAL_SERVICE_LAST_ERROR = line;
    log.info({ arrivalStream: streamName }, line);
  });
}

function getArrivalStatusUrl() {
  return new URL("/api/status", ARRIVAL_BASE).toString();
}

function getNotesHealthUrl() {
  return new URL("/health", NOTES_BASE).toString();
}

function getArrivalStartScriptPath() {
  return ARRIVAL_PROJECT_DIR ? path.join(ARRIVAL_PROJECT_DIR, "start_dashboard.bat") : "";
}

function getArrivalAutoStartState() {
  if (!ARRIVAL_PROJECT_DIR) {
    return {
      enabled: false,
      ready: false,
      message: "ARRIVAL_PROJECT_DIR 未配置，当前环境不启用新品服务自动拉起。",
      hint: "请显式配置 ARRIVAL_PROJECT_DIR，或先独立启动 Arrival 服务。",
      hint_path: "",
    };
  }
  if (!fs.existsSync(ARRIVAL_PROJECT_DIR)) {
    return {
      enabled: true,
      ready: false,
      message: `ARRIVAL_PROJECT_DIR 不存在：${ARRIVAL_PROJECT_DIR}`,
      hint: "请修正 ARRIVAL_PROJECT_DIR，或移除该配置以关闭自动拉起。",
      hint_path: getArrivalStartScriptPath(),
    };
  }
  const dashboardScriptPath = path.join(ARRIVAL_PROJECT_DIR, "dashboard_service.py");
  if (!fs.existsSync(dashboardScriptPath)) {
    return {
      enabled: true,
      ready: false,
      message: `dashboard_service.py 不存在：${dashboardScriptPath}`,
      hint: "请确认 Arrival 项目目录配置正确。",
      hint_path: getArrivalStartScriptPath(),
    };
  }
  return {
    enabled: true,
    ready: true,
    message: "ok",
    hint: "",
    hint_path: getArrivalStartScriptPath(),
  };
}

async function getReportDbStatus() {
  try {
    await reportRepo.getPool();
    return {
      ok: true,
      message: "ok",
    };
  } catch (err) {
    return {
      ok: false,
      message: String(err && err.message ? err.message : err),
    };
  }
}

function spawnArrivalService() {
  if (isChildRunning(ARRIVAL_SERVICE_PROCESS)) {
    return ARRIVAL_SERVICE_PROCESS;
  }
  const autoStartState = getArrivalAutoStartState();
  if (!autoStartState.ready) {
    throw new Error(autoStartState.message);
  }

  ARRIVAL_SERVICE_LAST_ERROR = "";
  const args = [
    "dashboard_service.py",
    "--host",
    ARRIVAL_URL.hostname || "127.0.0.1",
    "--port",
    String(ARRIVAL_URL.port || 5188),
  ];
  const child = spawn("python", args, {
    cwd: ARRIVAL_PROJECT_DIR,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  ARRIVAL_SERVICE_PROCESS = child;
  child.stdout.on("data", (chunk) => appendArrivalServiceLog("stdout", chunk));
  child.stderr.on("data", (chunk) => appendArrivalServiceLog("stderr", chunk));
  child.on("error", (err) => {
    ARRIVAL_SERVICE_LAST_ERROR = String(err && err.message ? err.message : err);
    if (ARRIVAL_SERVICE_PROCESS === child) {
      ARRIVAL_SERVICE_PROCESS = null;
    }
  });
  child.on("close", (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${Number.isFinite(code) ? code : -1}`;
    ARRIVAL_SERVICE_LAST_ERROR = ARRIVAL_SERVICE_LAST_ERROR || `arrival service exited with ${reason}`;
    if (ARRIVAL_SERVICE_PROCESS === child) {
      ARRIVAL_SERVICE_PROCESS = null;
    }
  });
  return child;
}

async function ensureArrivalServiceReady() {
  const probe = await probeJson(getArrivalStatusUrl(), ARRIVAL_PROBE_TIMEOUT_MS);
  if (probe.ok) {
    return { ok: true, started: false };
  }
  const autoStartState = getArrivalAutoStartState();
  if (!autoStartState.ready) {
    throw new Error(autoStartState.message);
  }
  if (ARRIVAL_SERVICE_START_PROMISE) {
    return ARRIVAL_SERVICE_START_PROMISE;
  }

  ARRIVAL_SERVICE_START_PROMISE = (async () => {
    const child = spawnArrivalService();
    const startedAt = Date.now();
    while (Date.now() - startedAt < ARRIVAL_START_TIMEOUT_MS) {
      const status = await probeJson(getArrivalStatusUrl(), ARRIVAL_PROBE_TIMEOUT_MS);
      if (status.ok) {
        return { ok: true, started: true, pid: child && child.pid ? child.pid : 0 };
      }
      if (child && child.exitCode !== null) {
        throw new Error(ARRIVAL_SERVICE_LAST_ERROR || `arrival service exited with code ${child.exitCode}`);
      }
      await sleep(500);
    }
    throw new Error(
      ARRIVAL_SERVICE_LAST_ERROR || `arrival service did not become ready within ${ARRIVAL_START_TIMEOUT_MS}ms`
    );
  })();

  try {
    return await ARRIVAL_SERVICE_START_PROMISE;
  } finally {
    ARRIVAL_SERVICE_START_PROMISE = null;
  }
}

async function getArrivalServiceStatus({ allowAutoStart = false } = {}) {
  const initialProbe = await probeJson(getArrivalStatusUrl(), ARRIVAL_PROBE_TIMEOUT_MS);
  const autoStartState = getArrivalAutoStartState();
  if (initialProbe.ok) {
    return {
      ...initialProbe,
      target: ARRIVAL_BASE,
      auto_start: autoStartState,
    };
  }

  if (allowAutoStart && autoStartState.ready) {
    try {
      await ensureArrivalServiceReady();
      const readyProbe = await probeJson(getArrivalStatusUrl(), ARRIVAL_PROBE_TIMEOUT_MS);
      return {
        ...readyProbe,
        target: ARRIVAL_BASE,
        auto_start: autoStartState,
      };
    } catch (err) {
      return {
        ok: false,
        status: initialProbe.status || 0,
        data: initialProbe.data || null,
        message: String(err && err.message ? err.message : err),
        target: ARRIVAL_BASE,
        auto_start: autoStartState,
      };
    }
  }

  return {
    ok: false,
    status: initialProbe.status || 0,
    data: initialProbe.data || null,
    message: autoStartState.ready
      ? initialProbe.message || "arrival service unavailable"
      : `${initialProbe.message || "arrival service unavailable"}；${autoStartState.message}`,
    target: ARRIVAL_BASE,
    auto_start: autoStartState,
  };
}

async function getNotesServiceStatus() {
  const probe = await probeJson(getNotesHealthUrl(), ARRIVAL_PROBE_TIMEOUT_MS);
  return {
    ...probe,
    message:
      probe.ok || appConfig.notesProjectDirConfigured
        ? probe.message
        : `${probe.message || "notes service unavailable"}；NOTES_PROJECT_DIR 未配置，当前环境不启用本地备注服务启动。`,
    target: NOTES_BASE,
    project_dir_configured: appConfig.notesProjectDirConfigured,
    project_dir_source: appConfig.notesProjectDirSource,
  };
}

async function refreshArrivalViaUpstream(timeoutMs = 600000) {
  const targetUrl = new URL("/api/refresh", ARRIVAL_BASE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 600000));
  try {
    const upstream = await fetch(targetUrl, {
      method: "POST",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const bodyText = await upstream.text();
    let bodyData = null;
    try {
      bodyData = bodyText ? JSON.parse(bodyText) : null;
    } catch (_err) {
      bodyData = bodyText || null;
    }
    return {
      ok: upstream.ok,
      status: upstream.status,
      data: bodyData,
      message:
        (bodyData && typeof bodyData === "object" && bodyData.message) ||
        (typeof bodyData === "string" ? bodyData : "") ||
        `${upstream.status} ${upstream.statusText}`.trim(),
      target: targetUrl.toString(),
    };
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    return {
      ok: false,
      status: 502,
      data: null,
      message: message || "arrival refresh request failed",
      target: targetUrl.toString(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function startManagedJob(spec) {
  const type = String(spec.type || "");
  const command = String(spec.command || "");
  const args = Array.isArray(spec.args) ? spec.args : [];
  const cwd = String(spec.cwd || BASE_DIR);
  if (!type || !command) {
    throw new Error("invalid job spec");
  }

  const runningId = RUNNING_JOB_BY_TYPE.get(type);
  if (runningId) {
    const runningJob = JOB_STORE.get(runningId);
    if (runningJob && runningJob.status === "running") {
      return { job: runningJob, reused: true };
    }
    RUNNING_JOB_BY_TYPE.delete(type);
  }

  const jobId = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const job = {
    id: jobId,
    type,
    command,
    args,
    cwd,
    status: "running",
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    ended_at: "",
    exit_code: null,
    error: "",
    logs: [],
  };
  JOB_STORE.set(jobId, job);
  RUNNING_JOB_BY_TYPE.set(type, jobId);

  const child = spawn(command, args, {
    cwd,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  appendJobLog(job, "system", `${command} ${args.join(" ")}`.trim());

  child.stdout.on("data", (chunk) => appendJobLog(job, "stdout", chunk));
  child.stderr.on("data", (chunk) => appendJobLog(job, "stderr", chunk));
  child.on("error", (err) => {
    job.status = "failed";
    job.error = String(err && err.message ? err.message : err);
    job.ended_at = new Date().toISOString();
    appendJobLog(job, "error", job.error);
    RUNNING_JOB_BY_TYPE.delete(type);
  });
  child.on("close", (code) => {
    job.exit_code = Number.isFinite(code) ? code : -1;
    job.status = job.exit_code === 0 ? "succeeded" : "failed";
    job.ended_at = new Date().toISOString();
    RUNNING_JOB_BY_TYPE.delete(type);
  });

  return { job, reused: false };
}

function proxyRequest(req, res, targetBase, options = {}) {
  const stripPrefix = String(options.stripPrefix || "");
  const prependPath = String(options.prependPath || "");
  const timeoutMs = Number(options.timeoutMs || 120000);
  const forceJsonBody = options.forceJsonBody === true;
  const baseUrl = new URL(targetBase);
  let targetPath = req.originalUrl || req.url || "/";
  if (stripPrefix && targetPath.startsWith(stripPrefix)) {
    targetPath = targetPath.slice(stripPrefix.length) || "/";
  }
  if (!targetPath.startsWith("/")) {
    targetPath = `/${targetPath}`;
  }
  if (prependPath) {
    const normalizedPrefix = prependPath.startsWith("/") ? prependPath : `/${prependPath}`;
    targetPath = `${normalizedPrefix}${targetPath}`;
  }
  const targetUrl = new URL(targetPath, baseUrl);

  const headers = { ...req.headers };
  headers.host = targetUrl.host;
  delete headers.connection;
  delete headers["proxy-connection"];

  const transport = targetUrl.protocol === "https:" ? https : http;
  const writeProxy = (bodyBuffer) => {
    const proxyReq = transport.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
        method: req.method,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        headers,
      },
      (proxyRes) => {
        res.status(proxyRes.statusCode || 502);
        Object.entries(proxyRes.headers || {}).forEach(([key, value]) => {
          if (value !== undefined) {
            res.setHeader(key, value);
          }
        });
        proxyRes.pipe(res);
      }
    );

    proxyReq.setTimeout(timeoutMs, () => {
      proxyReq.destroy(new Error("upstream timeout"));
    });

    proxyReq.on("error", (err) => {
      const message = String(err && err.message ? err.message : err);
      if (!res.headersSent) {
        res.status(502).json({
          ok: false,
          message: `upstream request failed: ${message}`,
          target: `${targetUrl.origin}${targetUrl.pathname}`,
        });
      } else {
        res.end();
      }
    });

    if (bodyBuffer && bodyBuffer.length) {
      proxyReq.write(bodyBuffer);
    }
    proxyReq.end();
  };

  if (req.method === "GET" || req.method === "HEAD") {
    delete headers["content-length"];
    delete headers["transfer-encoding"];
    writeProxy(null);
    return;
  }

  if (forceJsonBody) {
    const raw = JSON.stringify(req.body && typeof req.body === "object" ? req.body : {});
    const bodyBuffer = Buffer.from(raw, "utf8");
    headers["content-type"] = "application/json; charset=utf-8";
    headers["content-length"] = String(bodyBuffer.length);
    delete headers["transfer-encoding"];
    writeProxy(bodyBuffer);
    return;
  }

  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    const jsonRaw = JSON.stringify(req.body);
    const bodyBuffer = Buffer.from(jsonRaw, "utf8");
    headers["content-type"] = "application/json; charset=utf-8";
    headers["content-length"] = String(bodyBuffer.length);
    delete headers["transfer-encoding"];
    writeProxy(bodyBuffer);
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  req.on("end", () => {
    const bodyBuffer = chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
    headers["content-length"] = String(bodyBuffer.length);
    delete headers["transfer-encoding"];
    writeProxy(bodyBuffer);
  });
  req.on("error", (err) => {
    const message = String(err && err.message ? err.message : err);
    if (!res.headersSent) {
      res.status(400).json({ ok: false, message: `request read failed: ${message}` });
    } else {
      res.end();
    }
  });
}

async function proxyArrivalRequest(req, res, options = {}) {
  const arrivalStatus = await getArrivalServiceStatus({ allowAutoStart: true });
  if (!arrivalStatus.ok) {
    const hintPath = getArrivalStartScriptPath();
    if (!res.headersSent) {
      res.status(503).json({
        ok: false,
        message: `arrival service unavailable: ${arrivalStatus.message}`,
        target: ARRIVAL_BASE,
        hint: hintPath ? `run ${hintPath}` : "请先启动 Arrival 服务或配置 ARRIVAL_PROJECT_DIR",
        auto_start: arrivalStatus.auto_start,
      });
    } else {
      res.end();
    }
    return;
  }
  proxyRequest(req, res, ARRIVAL_BASE, options);
}

async function forwardNotesRequest(req, res) {
  try {
    const canViewAllNotes = isPrimaryAdminAccount(req.authSession?.account_id);
    const currentNoteUser = String(req.authSession?.name || "").trim();
    if (!canViewAllNotes && !currentNoteUser) {
      return res.status(403).json({ ok: false, message: "Forbidden" });
    }

    let targetPath = req.originalUrl || req.url || "/";
    if (targetPath.startsWith("/notes-api")) {
      targetPath = targetPath.slice("/notes-api".length) || "/";
    }
    if (!targetPath.startsWith("/")) {
      targetPath = `/${targetPath}`;
    }
    const targetUrl = new URL(targetPath, NOTES_BASE);
    const normalizedPath = targetUrl.pathname.replace(/\/+$/, "");

    if (!canViewAllNotes && normalizedPath.endsWith("/notes")) {
      targetUrl.searchParams.set("user_id", currentNoteUser);
    }

    const headers = { Accept: "application/json" };
    let body = undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      headers["Content-Type"] = "application/json; charset=utf-8";
      const payload = req.body && typeof req.body === "object" ? { ...req.body } : {};
      if (!canViewAllNotes && (normalizedPath.endsWith("/notes/upsert") || normalizedPath.endsWith("/notes/bulk_upsert"))) {
        payload.user_id = currentNoteUser;
        payload.updated_by = currentNoteUser;
      }
      body = JSON.stringify(payload);
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
    });
    const raw = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    res.send(raw);
  } catch (err) {
    res.status(502).json({
      ok: false,
      message: `notes proxy failed: ${String(err && err.message ? err.message : err)}`,
    });
  }
}

function probeJson(urlString, timeoutMs = 3000) {
  const urlObj = new URL(urlString);
  const transport = urlObj.protocol === "https:" ? https : http;
  return new Promise((resolve) => {
    const req = transport.request(
      {
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
        method: "GET",
        path: `${urlObj.pathname}${urlObj.search}`,
        timeout: timeoutMs,
      },
      (resp) => {
        const chunks = [];
        resp.on("data", (chunk) => chunks.push(chunk));
        resp.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch (_err) {
            data = null;
          }
          resolve({
            ok: resp.statusCode >= 200 && resp.statusCode < 300,
            status: resp.statusCode || 0,
            data,
            message: resp.statusMessage || "",
          });
        });
      }
    );
    req.on("error", (err) => resolve({ ok: false, status: 0, data: null, message: String(err.message || err) }));
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.end();
  });
}

app.use((req, _res, next) => {
  req.authSession = getSessionByRequest(req);
  req.authAccountId = req.authSession ? req.authSession.account_id : "";
  req.authUser = req.authSession ? req.authSession.username : "";
  req.authName = req.authSession ? req.authSession.name : "";
  req.authIsAdmin = !!(req.authSession && req.authSession.is_admin);
  req.authPermissions = req.authSession ? req.authSession.permissions : [];
  next();
});

// Sentry request handler must come BEFORE all other middleware/routes
// so it can capture exceptions from anywhere downstream. No-op if
// SENTRY_DSN is not configured.
const sentry = require("./lib/sentryClient");
app.use(sentry.expressRequestHandler());

// Prom-client metrics middleware: records duration + status class per route.
const { metricsMiddleware } = require("./middleware/metrics");
app.use(metricsMiddleware());

// Audit every request (after session enrichment, before routes).
const { createAuditLogger } = require("./services/auditLogger");
const { auditRequestMiddleware } = require("./middleware/auditRequest");
const auditLogger = createAuditLogger({
  getPool: () => reportRepo.getPool(),
});
app.use(auditRequestMiddleware(auditLogger));

// Expose Prometheus scrape endpoint (admin-gated via routes/metrics.js).
require("./routes/metrics").register(app, { requireAdmin });

require("./routes/auth-public").register(app, {
  express,
  getAuthStore,
  getMatchedAccount,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  SESSION_STORE,
  parseCookies,
  buildAuthMePayload,
  normalizeNext,
  resolvePostLoginRoute,
  renderLoginPage,
});

app.use((req, res, next) => {
  if (isPublicPath(req.path)) {
    return next();
  }
  if (req.authUser) {
    return next();
  }
  if (req.path.startsWith("/api/") || req.path.startsWith("/notes-api/")) {
    return res.status(401).json({ ok: false, message: "Unauthorized", login: "/login" });
  }
  return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl || "/")}`);
});

require("./routes/auth-session").register(app, {
  getAuthStore,
  clearSessionCookie,
  SESSION_STORE,
  parseCookies,
  buildAuthMePayload,
});

require("./routes/admin").register(app, {
  express,
  requireAdmin,
  runtimeSecrets,
  getAuthStore,
  sanitizeAccountForClient,
  createManagedAccount,
  updateManagedAccountPermissions,
  updateManagedAccountPassword,
  AUTH_PERMISSION_MODULES,
  getArrivalAutoStartState,
  getArrivalServiceStatus,
  refreshArrivalViaUpstream,
  startManagedJob,
  JOB_STORE,
  ARRIVAL_BASE,
  ARRIVAL_PROJECT_DIR,
  PG_PIPELINE_SCRIPT,
  PROJECT_ROOT,
});

app.use(express.static(PUBLIC_DIR, { index: false, fallthrough: true }));
app.use(express.static(WEB_DIST_DIR, { index: false, fallthrough: true }));

require("./routes/health").register(app, {
  host,
  port,
  appConfig,
  getReportDbStatus,
  getArrivalServiceStatus,
  getNotesServiceStatus,
  getAuthStore,
  getLanIps,
});


require("./routes/report").register(app, {
  requirePermission,
  requireAnyPermission,
  reportRepo,
  parsePositiveInt,
  stampNow,
  buildGapTemplateWorkbook,
});

require("./routes/dashboard").register(app, {
  requirePermission,
  reportRepo,
  parsePositiveInt,
});

require("./routes/agent").register(app, {
  express,
  requirePermission,
  requireAgentContextAccess,
  agentSkills,
  agentService,
  analysisContextProvider,
  metricsService,
  reportRepo,
  parsePositiveInt,
  normalizeAgentPeriodType,
});

require("./routes/arrival").register(app, {
  express,
  requirePermission,
  proxyArrivalRequest,
  forwardNotesRequest,
  getAuthStore,
  isPrimaryAdminAccount,
});

require("./routes/spa").register(app, {
  requirePermission,
  requireAdmin,
  sendReactApp,
});

require("./routes/docs").register(app, {
  requireAdmin,
});

// ── dispatch agent (开关由 DISPATCH_AGENT_ENABLED 控制) ──
if (dispatchModule.isEnabled()) {
  app.get(["/dispatch", "/dispatch/"], requirePermission("dispatch"), (_req, res) => {
    sendReactApp(res);
  });
  // 需求人确认页:走一次性 token,不要求登录
  app.get(["/dispatch/confirm/:taskId", "/dispatch/confirm/:taskId/"], (_req, res) => {
    sendReactApp(res);
  });
  dispatchModule.tryRegister(app, { requirePermission });
}

// Sentry error handler — runs before our generic handler, reports to DSN
// if configured. No-op otherwise (errors still reach generic handler).
app.use(sentry.expressErrorHandler());

app.use((err, _req, res, _next) => {
  const message = String(err && err.message ? err.message : err);
  res.status(500).json({ ok: false, message });
});

function startServer() {
  return app.listen(port, host, () => {
    const ips = getLanIps();
    const lanHint = ips.length ? ips.map((ip) => `http://${ip}:${port}`).join(" | ") : "N/A";
    log.info({ host, port }, `Gateway started on ${host}:${port}`);
    log.info({ lanHint }, `LAN URLs: ${lanHint}`);

    // Warm up default report payload to reduce first-screen latency.
    setTimeout(async () => {
      try {
        const { defaultWeek } = await reportRepo.getWeekChoices();
        if (!defaultWeek) {
          log.warn("[warmup] report skipped: no default week");
        } else {
          await reportRepo.getReportMeta(defaultWeek);
          await reportRepo.getReportRows({ week: defaultWeek, page: 1, pageSize: 50, keyword: "" });
          log.info({ defaultWeek }, `[warmup] report cache ready for ${defaultWeek}`);
        }
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        log.warn({ err: msg }, `[warmup] report cache failed: ${msg}`);
      }
      try {
        const dashboardDates = await reportRepo.getDashboardDateChoices();
        if (!dashboardDates.default_date_from || !dashboardDates.default_date_to) {
          log.warn("[warmup] dashboard skipped: no default range");
          return;
        }
        await reportRepo.getDashboardOverview("", dashboardDates.default_date_from, dashboardDates.default_date_to);
        log.info(
          { from: dashboardDates.default_date_from, to: dashboardDates.default_date_to },
          `[warmup] dashboard cache ready for ${dashboardDates.default_date_from}~${dashboardDates.default_date_to}`
        );
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        log.warn({ err: msg }, `[warmup] dashboard cache failed: ${msg}`);
      }
    }, 200);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
