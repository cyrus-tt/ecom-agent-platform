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
const appConfig = require("./services/appConfig");
const runtimeSecrets = require("./services/runtimeSecrets");

const app = express();
app.set("trust proxy", 1);
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, "public");
const PROJECT_ROOT = path.resolve(BASE_DIR, "..", "..");
const WEB_DIST_DIR = process.env.WEB_DIST_DIR || path.join(PROJECT_ROOT, "apps", "web", "dist");
const WEB_INDEX_PATH = path.join(WEB_DIST_DIR, "index.html");
const AUTH_CONFIG_DEFAULT_PATH = path.join(BASE_DIR, "config", "auth.json");
const AUTH_CONFIG_LOCAL_PATH = path.join(BASE_DIR, "config", "auth.local.json");
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
  return {
    id,
    name: String(raw.name || raw.display_name || username).trim() || username,
    username,
    password_hash: passwordHash,
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
  const nextStore = updateAuthStore((draft) => {
    const nextName = validateAccountName(name, draft.accounts);
    draft.accounts.push({
      id: `acct_${crypto.randomBytes(8).toString("hex")}`,
      name: nextName,
      username: draft.username,
      password_hash: sha256(nextPassword),
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
  const normalizedExpected = String(expectedHex || "").toLowerCase();
  const providedHex = sha256(String(password || "")).toLowerCase();
  try {
    const expected = Buffer.from(normalizedExpected, "hex");
    const provided = Buffer.from(providedHex, "hex");
    if (!expected.length || expected.length !== provided.length) {
      return false;
    }
    return crypto.timingSafeEqual(expected, provided);
  } catch (_err) {
    return false;
  }
}

function findAccountByCredentials(username, password) {
  const normalizedUsername = String(username || "").trim();
  if (!normalizedUsername) {
    return null;
  }
  for (const account of getAuthStore().accounts || []) {
    if (!account || account.username !== normalizedUsername) {
      continue;
    }
    if (verifyPasswordHash(password, account.password_hash)) {
      return account;
    }
  }
  return null;
}

function getMatchedAccount(username, password) {
  return findAccountByCredentials(username, password);
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
    pathname === "/healthz" ||
    pathname === "/readyz" ||
    pathname === "/favicon.ico" ||
    pathname === "/login.css" ||
    pathname === "/login.js"
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
    console.log(`[arrival-service:${streamName}] ${line}`);
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

app.post("/api/auth/login", express.json({ limit: "256kb" }), (req, res) => {
  const body = req.body || {};
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const nextUrl = normalizeNext(body.next);
  const matchedAccount = getMatchedAccount(username, password);

  if (!matchedAccount) {
    return res.status(401).json({ ok: false, message: "账号或密码错误" });
  }

  const session = createSession(matchedAccount);
  setSessionCookie(res, session.sid);
  return res.json({
    ...buildAuthMePayload(session),
    next: resolvePostLoginRoute(matchedAccount, nextUrl),
  });
});

app.get("/login", (req, res) => {
  if (req.authUser) {
    const nextUrl = normalizeNext(req.query.next);
    return res.redirect(resolvePostLoginRoute(req.authSession, nextUrl));
  }
  return res.type("html").send(renderLoginPage(getAuthStore().username));
});

app.get("/logout", (req, res) => {
  const sid = parseCookies(req.headers.cookie)[getAuthStore().cookie_name];
  if (sid) {
    SESSION_STORE.delete(sid);
  }
  clearSessionCookie(res);
  res.redirect("/login");
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

app.post("/api/auth/logout", (req, res) => {
  const sid = parseCookies(req.headers.cookie)[getAuthStore().cookie_name];
  if (sid) {
    SESSION_STORE.delete(sid);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.authSession) {
    return res.status(401).json({ ok: false, message: "Unauthorized" });
  }
  return res.json(buildAuthMePayload(req.authSession));
});

app.get("/api/arrival/note-users", requirePermission("arrival"), (req, res) => {
  const canViewAllNotes = isPrimaryAdminAccount(req.authSession?.account_id);
  const currentName = String(req.authSession?.name || "").trim();
  if (!canViewAllNotes) {
    return res.json({
      ok: true,
      users: currentName
        ? [
            {
              account_id: String(req.authSession?.account_id || "").trim(),
              name: currentName,
              is_primary_admin: false,
            },
          ]
        : [],
    });
  }

  const seenNames = new Set();
  const users = [];
  for (const account of getAuthStore().accounts || []) {
    const name = String(account?.name || "").trim();
    if (!name || seenNames.has(name)) {
      continue;
    }
    seenNames.add(name);
    users.push({
      account_id: account.id,
      name,
      is_primary_admin: isPrimaryAdminAccount(account.id),
    });
  }

  if (currentName && !seenNames.has(currentName)) {
    users.unshift({
      account_id: String(req.authSession?.account_id || "").trim(),
      name: currentName,
      is_primary_admin: req.authSession?.is_admin === true,
    });
  }

  return res.json({
    ok: true,
    users,
  });
});

app.get("/api/admin/accounts", requireAdmin, (_req, res) => {
  const authStore = getAuthStore();
  return res.json({
    ok: true,
    shared_username: authStore.username,
    primary_admin_id: authStore.primary_admin_id,
    modules: AUTH_PERMISSION_MODULES,
    accounts: authStore.accounts.map((account) => sanitizeAccountForClient(account)),
  });
});

app.post("/api/admin/accounts", requireAdmin, express.json({ limit: "256kb" }), (req, res) => {
  try {
    const account = createManagedAccount({
      name: req.body?.name,
      password: req.body?.password,
      permissions: req.body?.permissions,
    });
    return res.status(201).json({
      ok: true,
      account: sanitizeAccountForClient(account),
    });
  } catch (err) {
    return res.status(400).json({ ok: false, message: String(err?.message || err) });
  }
});

app.patch("/api/admin/accounts/:accountId/permissions", requireAdmin, express.json({ limit: "256kb" }), (req, res) => {
  try {
    const account = updateManagedAccountPermissions(req.params.accountId, req.body?.permissions);
    if (!account) {
      return res.status(404).json({ ok: false, message: "account not found" });
    }
    return res.json({
      ok: true,
      account: sanitizeAccountForClient(account),
    });
  } catch (err) {
    const message = String(err?.message || err);
    const status = message === "account not found" ? 404 : 400;
    return res.status(status).json({ ok: false, message });
  }
});

app.patch("/api/admin/accounts/:accountId/password", requireAdmin, express.json({ limit: "256kb" }), (req, res) => {
  try {
    const account = updateManagedAccountPassword(req.params.accountId, req.body?.password);
    if (!account) {
      return res.status(404).json({ ok: false, message: "account not found" });
    }
    return res.json({
      ok: true,
      account: sanitizeAccountForClient(account),
    });
  } catch (err) {
    const message = String(err?.message || err);
    const status = message === "account not found" ? 404 : 400;
    return res.status(status).json({ ok: false, message });
  }
});

app.get("/api/settings/ai", requireAdmin, (_req, res) => {
  return res.json({
    ok: true,
    settings: runtimeSecrets.getDeepseekStatus(),
  });
});

app.post("/api/settings/ai/deepseek-key", requireAdmin, express.json({ limit: "128kb" }), (req, res) => {
  try {
    const apiKey = String(req.body?.api_key || "").trim();
    if (!apiKey) {
      return res.status(400).json({ ok: false, message: "api_key is required" });
    }
    const settings = runtimeSecrets.setDeepseekApiKey(apiKey);
    return res.json({
      ok: true,
      settings,
    });
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    return res.status(500).json({ ok: false, message });
  }
});

app.delete("/api/settings/ai/deepseek-key", requireAdmin, (_req, res) => {
  const settings = runtimeSecrets.clearDeepseekApiKey();
  return res.json({
    ok: true,
    settings,
  });
});

app.use(express.static(PUBLIC_DIR, { index: false, fallthrough: true }));
app.use(express.static(WEB_DIST_DIR, { index: false, fallthrough: true }));

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "ecom-dashboard-gateway",
    host,
    port,
    server_time: new Date().toISOString(),
  });
});

app.get("/readyz", async (_req, res) => {
  const [reportDb, arrival, notes] = await Promise.all([
    getReportDbStatus(),
    getArrivalServiceStatus({ allowAutoStart: false }),
    getNotesServiceStatus(),
  ]);
  const ok = reportDb.ok && arrival.ok && notes.ok;

  res.status(ok ? 200 : 503).json({
    ok,
    service: "ecom-dashboard-gateway",
    host,
    port,
    server_time: new Date().toISOString(),
    dependencies: {
      report_db: reportDb,
      arrival: arrival,
      notes: notes,
    },
    config: {
      arrival_service_url_source: appConfig.arrivalServiceUrlSource,
      notes_service_url_source: appConfig.notesServiceUrlSource,
      arrival_project_dir_configured: appConfig.arrivalProjectDirConfigured,
      arrival_project_dir_source: appConfig.arrivalProjectDirSource,
      notes_project_dir_configured: appConfig.notesProjectDirConfigured,
      notes_project_dir_source: appConfig.notesProjectDirSource,
    },
  });
});

app.get("/api/health", async (_req, res) => {
  const [reportDb, arrival, notes] = await Promise.all([
    getReportDbStatus(),
    getArrivalServiceStatus({ allowAutoStart: false }),
    getNotesServiceStatus(),
  ]);
  const authStore = getAuthStore();

  res.json({
    ok: reportDb.ok && arrival.ok && notes.ok,
    service: "ecom-dashboard-gateway",
    host,
    port,
    lan_ips: getLanIps(),
    server_time: new Date().toISOString(),
    auth: {
      cookie_name: authStore.cookie_name,
      session_ttl_seconds: authStore.session_ttl_seconds,
    },
    report_db: {
      ok: reportDb.ok,
      message: reportDb.message,
    },
    upstream: {
      arrival: {
        ok: arrival.ok,
        status: arrival.status,
        message: arrival.message,
        auto_start: arrival.auto_start,
      },
      notes: {
        ok: notes.ok,
        status: notes.status,
        message: notes.message,
      },
    },
    config: {
      arrival_service_url_source: appConfig.arrivalServiceUrlSource,
      notes_service_url_source: appConfig.notesServiceUrlSource,
      arrival_project_dir_configured: appConfig.arrivalProjectDirConfigured,
      notes_project_dir_configured: appConfig.notesProjectDirConfigured,
    },
  });
});

app.get("/api/ping", (req, res) => {
  res.json({
    ok: true,
    message: "pong",
    user: req.authUser || "",
    client_ip: req.ip,
    x_forwarded_for: req.headers["x-forwarded-for"] || "",
    server_time: new Date().toISOString(),
  });
});

app.post("/api/admin/refresh-arrival", requireAdmin, (req, res) => {
  try {
    const autoStartState = getArrivalAutoStartState();
    if (!autoStartState.ready) {
      return res.status(503).json({
        ok: false,
        message: autoStartState.message,
        target: ARRIVAL_BASE,
        auto_start: autoStartState,
      });
    }
    const result = startManagedJob({
      type: "refresh-arrival",
      command: "python",
      args: ["dashboard_service.py", "--refresh-once"],
      cwd: ARRIVAL_PROJECT_DIR,
    });
    res.json({
      ok: true,
      reused: result.reused,
      job: result.job,
    });
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    res.status(500).json({ ok: false, message });
  }
});

app.post("/api/admin/rebuild-weekly", requireAdmin, (req, res) => {
  try {
    if (!fs.existsSync(PG_PIPELINE_SCRIPT)) {
      return res.status(500).json({ ok: false, message: "pipeline script not found" });
    }
    const result = startManagedJob({
      type: "rebuild-weekly",
      command: "powershell",
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PG_PIPELINE_SCRIPT],
      cwd: PROJECT_ROOT,
    });
    res.json({
      ok: true,
      reused: result.reused,
      job: result.job,
    });
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    res.status(500).json({ ok: false, message });
  }
});

app.get("/api/admin/jobs/:jobId", requireAdmin, (req, res) => {
  const jobId = String(req.params.jobId || "");
  const job = JOB_STORE.get(jobId);
  if (!job) {
    return res.status(404).json({ ok: false, message: "job not found" });
  }
  return res.json({ ok: true, job });
});

app.get("/api/report/weeks", requirePermission("report_daily"), async (_req, res, next) => {
  try {
    const { weeks, defaultWeek } = await reportRepo.getWeekChoices();
    res.json({
      ok: true,
      weeks,
      default_week: defaultWeek,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/report/meta", requirePermission("report_daily"), async (req, res, next) => {
  try {
    const { week, weeks } = await reportRepo.resolveWeek(req.query.week);
    if (!week) {
      return res.status(404).json({ ok: false, message: "No report week available." });
    }
    const meta = await reportRepo.getReportMeta(week);
    res.json({
      ok: true,
      week,
      weeks,
      ...meta,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/report/rows", requirePermission("report_daily"), async (req, res, next) => {
  try {
    const { week } = await reportRepo.resolveWeek(req.query.week);
    if (!week) {
      return res.status(404).json({ ok: false, message: "No report week available." });
    }
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(500, parsePositiveInt(req.query.pageSize, 50));
    const keyword = String(req.query.keyword || "");
    const fuzzy = String(req.query.fuzzy || "").trim() === "1";
    const payload = await reportRepo.getReportRows({ week, page, pageSize, keyword, fuzzy });
    res.json({
      ok: true,
      week,
      ...payload,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/report/export.xlsx", requirePermission("report_daily"), async (req, res, next) => {
  try {
    const { week } = await reportRepo.resolveWeek(req.query.week);
    if (!week) {
      return res.status(404).json({ ok: false, message: "No report week available." });
    }
    const meta = await reportRepo.getReportMeta(week);
    const rows = await reportRepo.getReportExportRows(week);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([meta.group_headers, meta.column_headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, "周报主表");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });

    const filename = `周报主表_${week.replace(/-/g, "")}_${stampNow()}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

app.get("/api/report/gap-template.xlsx", requirePermission("report_daily"), async (req, res, next) => {
  try {
    const { week } = await reportRepo.resolveWeek(req.query.week);
    if (!week) {
      return res.status(404).json({ ok: false, message: "No report week available." });
    }
    const meta = await reportRepo.getReportMeta(week);
    const { wb } = buildGapTemplateWorkbook(week, meta.gap_summary || {});
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true });
    const filename = `缺口模板_${week.replace(/-/g, "")}_${stampNow()}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

app.get("/api/report-daily/dates", requireAnyPermission(["report_daily", "analysis"]), async (_req, res, next) => {
  try {
    const { salesDates, defaultSalesDate } = await reportRepo.getDailyDateChoices();
    res.json({
      ok: true,
      sales_dates: salesDates,
      default_sales_date: defaultSalesDate,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/report-daily/meta", requirePermission("report_daily"), async (req, res, next) => {
  try {
    const dateFromRaw = String(req.query.dateFrom || "").trim();
    const dateToRaw = String(req.query.dateTo || "").trim();
    if (dateFromRaw || dateToRaw) {
      const { dateFrom, dateTo, salesDates } = await reportRepo.resolveDailyRange(dateFromRaw, dateToRaw);
      if (!dateFrom || !dateTo) {
        return res.status(404).json({ ok: false, message: "No daily report date available." });
      }
      const meta = await reportRepo.getDailyRangeMeta({ dateFrom, dateTo });
      return res.json({
        ok: true,
        date_from: dateFrom,
        date_to: dateTo,
        sales_dates: salesDates,
        ...meta,
      });
    }

    const { salesDate, salesDates } = await reportRepo.resolveDailyDate(req.query.salesDate);
    if (!salesDate) {
      return res.status(404).json({ ok: false, message: "No daily report date available." });
    }
    const meta = await reportRepo.getDailyMeta(salesDate);
    res.json({
      ok: true,
      sales_date: salesDate,
      sales_dates: salesDates,
      ...meta,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/report-daily/rows", requirePermission("report_daily"), async (req, res, next) => {
  try {
    const dateFromRaw = String(req.query.dateFrom || "").trim();
    const dateToRaw = String(req.query.dateTo || "").trim();
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(500, parsePositiveInt(req.query.pageSize, 50));
    const keyword = String(req.query.keyword || "");
    const fuzzy = String(req.query.fuzzy || "").trim() === "1";

    if (dateFromRaw || dateToRaw) {
      const { dateFrom, dateTo } = await reportRepo.resolveDailyRange(dateFromRaw, dateToRaw);
      if (!dateFrom || !dateTo) {
        return res.status(404).json({ ok: false, message: "No daily report date available." });
      }
      const payload = await reportRepo.getDailyRowsRange({ dateFrom, dateTo, page, pageSize, keyword, fuzzy });
      return res.json({
        ok: true,
        date_from: dateFrom,
        date_to: dateTo,
        ...payload,
      });
    }

    const { salesDate } = await reportRepo.resolveDailyDate(req.query.salesDate);
    if (!salesDate) {
      return res.status(404).json({ ok: false, message: "No daily report date available." });
    }
    const payload = await reportRepo.getDailyRows({ salesDate, page, pageSize, keyword, fuzzy });
    res.json({
      ok: true,
      sales_date: salesDate,
      ...payload,
    });
  } catch (err) {
    next(err);
  }
});

async function sendDailyExport(req, res, next, options) {
  const bookType = String(options?.bookType || "xlsx");
  const ext = String(options?.ext || "xlsx");
  const contentType =
    String(options?.contentType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

  try {
    const dateFromRaw = String(req.query.dateFrom || "").trim();
    const dateToRaw = String(req.query.dateTo || "").trim();

    if (dateFromRaw || dateToRaw) {
      const { dateFrom, dateTo } = await reportRepo.resolveDailyRange(dateFromRaw, dateToRaw);
      if (!dateFrom || !dateTo) {
        return res.status(404).json({ ok: false, message: "No daily report date available." });
      }
      const meta = await reportRepo.getDailyRangeMeta({ dateFrom, dateTo });
      const rows = await reportRepo.getDailyExportRowsRange({ dateFrom, dateTo });
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([meta.group_headers, meta.column_headers, ...rows]);
      XLSX.utils.book_append_sheet(wb, ws, "日报主表");
      const buf = XLSX.write(wb, { type: "buffer", bookType, compression: true });
      const filename = `日报主表_${dateFrom.replace(/-/g, "")}_${dateTo.replace(/-/g, "")}_${stampNow()}.${ext}`;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      return res.send(buf);
    }

    const { salesDate } = await reportRepo.resolveDailyDate(req.query.salesDate);
    if (!salesDate) {
      return res.status(404).json({ ok: false, message: "No daily report date available." });
    }
    const meta = await reportRepo.getDailyMeta(salesDate);
    const rows = await reportRepo.getDailyExportRows(salesDate);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([meta.group_headers, meta.column_headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, "日报主表");
    const buf = XLSX.write(wb, { type: "buffer", bookType, compression: true });

    const filename = `日报主表_${salesDate.replace(/-/g, "")}_${stampNow()}.${ext}`;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return res.send(buf);
  } catch (err) {
    next(err);
    return null;
  }
}

app.get("/api/report-daily/export.xlsx", requirePermission("report_daily"), async (req, res, next) => {
  await sendDailyExport(req, res, next, {
    bookType: "xlsx",
    ext: "xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
});

app.get("/api/report-daily/export.xlsb", requirePermission("report_daily"), async (req, res, next) => {
  await sendDailyExport(req, res, next, {
    bookType: "xlsb",
    ext: "xlsb",
    contentType: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  });
});

app.get("/api/dashboard/dates", requirePermission("dashboard"), async (_req, res, next) => {
  try {
    const payload = await reportRepo.getDashboardDateChoices();
    res.json({
      ok: true,
      ...payload,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/dashboard/overview", requirePermission("dashboard"), async (req, res, next) => {
  try {
    const anchorDate = String(req.query.anchor_date || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();
    const payload = await reportRepo.getDashboardOverview(anchorDate, dateFrom, dateTo);
    res.json({
      ok: true,
      ...payload,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/dashboard/channel-compare", requirePermission("dashboard"), async (req, res, next) => {
  try {
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();
    const rawChannels = Array.isArray(req.query.channels)
      ? req.query.channels.join(",")
      : String(req.query.channels || "").trim();
    const payload = await reportRepo.getDashboardChannelCompare({
      dateFromText: dateFrom,
      dateToText: dateTo,
      channelCodesText: rawChannels,
    });
    res.json({
      ok: true,
      ...payload,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/dashboard/drilldown", requirePermission("dashboard"), async (req, res, next) => {
  try {
    const anchorDate = String(req.query.anchor_date || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();
    const category = String(req.query.category || "").trim();
    const level = String(req.query.level || "").trim().toLowerCase();
    const style = String(req.query.style || "").trim();
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(100, parsePositiveInt(req.query.pageSize, 20));

    if (!category) {
      return res.status(400).json({ ok: false, message: "category is required" });
    }
    if (level !== "style" && level !== "sku") {
      return res.status(400).json({ ok: false, message: "level must be style or sku" });
    }
    if (level === "sku" && !style) {
      return res.status(400).json({ ok: false, message: "style is required when level=sku" });
    }

    const payload = await reportRepo.getDashboardDrilldown({
      anchorDateText: anchorDate,
      dateFromText: dateFrom,
      dateToText: dateTo,
      category,
      level,
      style,
      page,
      pageSize,
    });
    res.json({
      ok: true,
      ...payload,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/channel-dashboard", requirePermission("channel_dashboard"), async (req, res, next) => {
  try {
    const anchorDate = String(req.query.anchor_date || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();
    const comparisonDateFrom = String(req.query.comparison_date_from || "").trim();
    const comparisonDateTo = String(req.query.comparison_date_to || "").trim();
    const rawChannels = Array.isArray(req.query.channels)
      ? req.query.channels.join(",")
      : String(req.query.channels || "").trim();
    const payload = await reportRepo.getChannelDashboard({
      anchorDateText: anchorDate,
      dateFromText: dateFrom,
      dateToText: dateTo,
      channelCodesText: rawChannels,
      comparisonDateFromText: comparisonDateFrom,
      comparisonDateToText: comparisonDateTo,
    });
    res.json({
      ok: true,
      ...payload,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/channel-dashboard/drilldown", requirePermission("channel_dashboard"), async (req, res, next) => {
  try {
    const anchorDate = String(req.query.anchor_date || "").trim();
    const dateFrom = String(req.query.date_from || "").trim();
    const dateTo = String(req.query.date_to || "").trim();
    const channel = String(req.query.channel || "").trim();
    const style = String(req.query.style || "").trim();

    if (!channel) {
      return res.status(400).json({ ok: false, message: "channel is required" });
    }
    if (!style) {
      return res.status(400).json({ ok: false, message: "style is required" });
    }

    const payload = await reportRepo.getChannelDashboardStyleDrilldown({
      anchorDateText: anchorDate,
      dateFromText: dateFrom,
      dateToText: dateTo,
      channelCode: channel,
      style,
    });
    res.json({
      ok: true,
      ...payload,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/agent/skills", requirePermission("analysis"), (_req, res) => {
  res.json({
    ok: true,
    default_skill_id: agentSkills.DEFAULT_SKILL_ID,
    items: agentSkills.listSkills(),
  });
});

app.post("/api/agent/run", requirePermission("analysis"), express.json({ limit: "1mb" }), async (req, res, next) => {
  try {
    res.setTimeout(95000);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const periodType = normalizeAgentPeriodType(body.period_type);
    const startDate = String(body.start_date || "").trim();
    const endDate = String(body.end_date || "").trim();
    const skillId = String(body.skill_id || agentSkills.DEFAULT_SKILL_ID).trim();
    const promptText = String(body.prompt_text || "").trim();
    const promptConfig = agentSkills.resolveSkillPrompt(skillId, promptText);

    const metrics = await metricsService.calculateMetrics({
      periodType,
      startDate,
      endDate,
    });
    if (!metrics.has_data) {
      return res.status(200).json({
        ok: false,
        message: "所选周期没有可用销售数据，请调整日期后重试。",
      });
    }

    let reportMd = "";
    let status = "success";
    let errorMessage = "";
    try {
      const aiResult = await agentService.generateAnalysisReport({
        metrics,
        skillId: promptConfig.skill_id,
        promptText: promptConfig.prompt_text,
      });
      reportMd = aiResult.report_md;
      promptConfig.skill_id = aiResult.skill_id || promptConfig.skill_id;
      promptConfig.skill_name = aiResult.skill_name || promptConfig.skill_name;
      promptConfig.prompt_text = aiResult.prompt_text || promptConfig.prompt_text;
    } catch (err) {
      status = "error";
      errorMessage = String(err && err.message ? err.message : err);
      reportMd = [
        "## 报告生成失败",
        "",
        "本次调用 AI 服务失败，请检查密钥配置或稍后重试。",
        "",
        `错误信息：${errorMessage}`,
      ].join("\n");
    }

    const saved = await reportRepo.createAnalysisReport({
      periodType: metrics.period.type,
      periodStart: metrics.period.start,
      periodEnd: metrics.period.end,
      skillId: promptConfig.skill_id,
      skillName: promptConfig.skill_name,
      promptText: promptConfig.prompt_text,
      metricsJson: metrics,
      reportMd,
      status,
      errorMsg: status === "error" ? errorMessage : "",
    });

    if (status === "error") {
      return res.status(502).json({
        ok: false,
        message: "AI 报告生成失败，错误信息已记录。",
        report_id: Number(saved?.id || 0),
        skill_id: promptConfig.skill_id,
        skill_name: promptConfig.skill_name,
        prompt_text: promptConfig.prompt_text,
        created_at: saved?.created_at ? new Date(saved.created_at).toISOString() : new Date().toISOString(),
      });
    }

    return res.json({
      ok: true,
      report_id: Number(saved?.id || 0),
      report_md: reportMd,
      skill_id: promptConfig.skill_id,
      skill_name: promptConfig.skill_name,
      prompt_text: promptConfig.prompt_text,
      metrics_summary: metrics.summary,
      created_at: saved?.created_at ? new Date(saved.created_at).toISOString() : new Date().toISOString(),
    });
  } catch (err) {
    next(err);
    return null;
  }
});

app.get("/api/agent/reports", requirePermission("analysis"), async (req, res, next) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = Math.min(100, parsePositiveInt(req.query.pageSize, 10));
    const payload = await reportRepo.listAnalysisReports({ page, pageSize });
    res.json({
      ok: true,
      ...payload,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/agent/reports/:id", requirePermission("analysis"), async (req, res, next) => {
  try {
    const report = await reportRepo.getAnalysisReportById(req.params.id);
    if (!report) {
      return res.status(404).json({ ok: false, message: "report not found" });
    }
    return res.json({
      ok: true,
      report,
    });
  } catch (err) {
    next(err);
    return null;
  }
});

app.all(["/api/arrival/status", "/api/arrival/data", "/api/arrival/config", "/api/arrival/review"], requirePermission("arrival"), (req, res) => {
  proxyArrivalRequest(req, res, { stripPrefix: "/api/arrival", prependPath: "/api" });
});

app.all("/api/arrival/image/*", (req, res) => {
  proxyArrivalRequest(req, res, { stripPrefix: "/api/arrival", prependPath: "/api" });
});

app.all("/api/arrival/refresh", requirePermission("arrival"), (req, res) => {
  proxyArrivalRequest(req, res, { stripPrefix: "/api/arrival", prependPath: "/api", timeoutMs: 600000 });
});

app.all(["/api/status", "/api/data", "/api/config", "/api/review"], requirePermission("arrival"), (req, res) => {
  proxyArrivalRequest(req, res);
});

app.all("/api/image/*", (req, res) => {
  proxyArrivalRequest(req, res);
});

app.all("/api/refresh", requirePermission("arrival"), (req, res) => {
  proxyArrivalRequest(req, res, { timeoutMs: 600000 });
});

app.get("/notes-api/*", requirePermission("arrival"), (req, res) => {
  forwardNotesRequest(req, res);
});

app.post("/notes-api/*", requirePermission("arrival"), express.json({ limit: "2mb" }), (req, res) => {
  forwardNotesRequest(req, res);
});

app.get(["/no-access", "/no-access/"], (_req, res) => {
  sendReactApp(res);
});

app.get(["/admin/accounts", "/admin/accounts/"], requireAdmin, (_req, res) => {
  sendReactApp(res);
});

app.get("/", requirePermission("portal"), (_req, res) => {
  sendReactApp(res);
});

app.get(["/dashboard", "/dashboard/"], requirePermission("dashboard"), (_req, res) => {
  sendReactApp(res);
});

app.get(["/channel-dashboard", "/channel-dashboard/"], requirePermission("channel_dashboard"), (_req, res) => {
  sendReactApp(res);
});

app.get("/report", requirePermission("report_daily"), (_req, res) => {
  res.redirect("/report-daily");
});

app.get(["/report-daily", "/report-daily/"], requirePermission("report_daily"), (_req, res) => {
  sendReactApp(res);
});

app.get(["/analysis", "/analysis/"], requirePermission("analysis"), (_req, res) => {
  sendReactApp(res);
});

app.get(["/arrival", "/arrival/"], requirePermission("arrival"), (_req, res) => {
  sendReactApp(res);
});

app.use((err, _req, res, _next) => {
  const message = String(err && err.message ? err.message : err);
  res.status(500).json({ ok: false, message });
});

function startServer() {
  return app.listen(port, host, () => {
    const ips = getLanIps();
    const lanHint = ips.length ? ips.map((ip) => `http://${ip}:${port}`).join(" | ") : "N/A";
    console.log(`Gateway started on ${host}:${port}`);
    console.log(`LAN URLs: ${lanHint}`);

    // Warm up default report payload to reduce first-screen latency.
    setTimeout(async () => {
      try {
        const { defaultWeek } = await reportRepo.getWeekChoices();
        if (!defaultWeek) {
          console.warn("[warmup] report skipped: no default week");
        } else {
          await reportRepo.getReportMeta(defaultWeek);
          await reportRepo.getReportRows({ week: defaultWeek, page: 1, pageSize: 50, keyword: "" });
          console.log(`[warmup] report cache ready for ${defaultWeek}`);
        }
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        console.warn(`[warmup] report cache failed: ${msg}`);
      }
      try {
        const dashboardDates = await reportRepo.getDashboardDateChoices();
        if (!dashboardDates.default_date_from || !dashboardDates.default_date_to) {
          console.warn("[warmup] dashboard skipped: no default range");
          return;
        }
        await reportRepo.getDashboardOverview("", dashboardDates.default_date_from, dashboardDates.default_date_to);
        console.log(`[warmup] dashboard cache ready for ${dashboardDates.default_date_from}~${dashboardDates.default_date_to}`);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        console.warn(`[warmup] dashboard cache failed: ${msg}`);
      }
    }, 200);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
