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
const toolsModule = require("./services/tools");
const biQueryService = require("./services/biQueryService");
const dispatchModule = require("./services/dispatch");
const { childLogger } = require("./lib/logger");
const auth = require("./lib/auth");
const { sessionEnrichment } = require("./middleware/sessionEnrichment");
const { requirePermission, requireAnyPermission } = require("./middleware/requirePermission");
const { requireAdmin } = require("./middleware/requireAdmin");
const { requireAgentContextAccess } = require("./middleware/requireAgentContextAccess");
const { Semaphore, limitConcurrency } = require("./lib/concurrencyLimit");
const log = childLogger("server");

// F-PERF-40C §S6: 重操作并发保护，防止 Excel 导出 / AI 报告生成拖垮普通看板访问
// Excel 4 个 endpoint 共用 ≤2 / AI 报告 ≤1
const EXCEL_EXPORT_SEMAPHORE = new Semaphore(2, "excel-export");
const AI_REPORT_SEMAPHORE = new Semaphore(1, "ai-report");

const app = express();
app.set("trust proxy", 1);
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const BASE_DIR = __dirname;
const PUBLIC_DIR = path.join(BASE_DIR, "public");
const PROJECT_ROOT = path.resolve(BASE_DIR, "..", "..");
const WEB_DIST_DIR = process.env.WEB_DIST_DIR || path.join(PROJECT_ROOT, "apps", "web", "dist");
const WEB_INDEX_PATH = path.join(WEB_DIST_DIR, "index.html");
const ARRIVAL_BASE = appConfig.arrivalServiceUrl;
const NOTES_BASE = appConfig.notesServiceUrl;
const ARRIVAL_PROJECT_DIR = appConfig.arrivalProjectDir;
const PG_PIPELINE_SCRIPT = path.join(PROJECT_ROOT, "ops", "windows", "run_pg_pipeline.ps1");
const ARRIVAL_URL = new URL(ARRIVAL_BASE);
const ARRIVAL_START_TIMEOUT_MS = Math.max(3000, Number(process.env.ARRIVAL_START_TIMEOUT_MS || 20000));
const ARRIVAL_PROBE_TIMEOUT_MS = Math.max(1000, Number(process.env.ARRIVAL_PROBE_TIMEOUT_MS || 2500));

const JOB_STORE = new Map();
const RUNNING_JOB_BY_TYPE = new Map();
const JOB_LOG_LIMIT = 300;
let ARRIVAL_SERVICE_PROCESS = null;
let ARRIVAL_SERVICE_START_PROMISE = null;
let ARRIVAL_SERVICE_LAST_ERROR = "";

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function renderLoginPage(sharedUsername) {
  const template = fs.readFileSync(path.join(PUBLIC_DIR, "login.html"), "utf8");
  return template.replace(/__SHARED_USERNAME__/g, escapeHtml(sharedUsername));
}

// ── arrival/notes job + proxy plumbing (V4 will move to lib/jobs + lib/proxy) ──

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
    if (type === "rebuild-weekly" && job.status === "succeeded") {
      try {
        const result = reportRepo.clearAllCaches("rebuild-weekly");
        appendJobLog(job, "system", `[cache] cleared after rebuild: ${JSON.stringify(result.before)}`);
      } catch (err) {
        appendJobLog(job, "warn", `[cache] clear failed: ${String(err && err.message ? err.message : err)}`);
      }
    }
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
    const canViewAllNotes = auth.isPrimaryAdminAccount(req.authSession?.account_id);
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

// ── middleware pipeline ────────────────────────────────────────────────

app.use(sessionEnrichment());

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
require("./routes/metrics").register(app);

require("./routes/auth-public").register(app, {
  express,
  renderLoginPage,
});

app.use((req, res, next) => {
  if (auth.isPublicPath(req.path)) {
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

require("./routes/auth-session").register(app);

require("./routes/admin").register(app, {
  express,
  runtimeSecrets,
  reportRepo,
  getArrivalAutoStartState,
  getArrivalServiceStatus,
  refreshArrivalViaUpstream,
  startManagedJob,
  JOB_STORE,
  ARRIVAL_BASE,
  ARRIVAL_PROJECT_DIR,
  PG_PIPELINE_SCRIPT,
  PROJECT_ROOT,
  getPool: () => reportRepo.getPool(),
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
  getLanIps,
});


require("./routes/report").register(app, {
  reportRepo,
  parsePositiveInt,
  stampNow,
  buildGapTemplateWorkbook,
  excelExportLimiter: limitConcurrency(EXCEL_EXPORT_SEMAPHORE),
});

require("./routes/dashboard").register(app, {
  reportRepo,
  parsePositiveInt,
});

require("./routes/agent").register(app, {
  express,
  agentSkills,
  agentService,
  analysisContextProvider,
  metricsService,
  reportRepo,
  parsePositiveInt,
  normalizeAgentPeriodType,
  aiReportLimiter: limitConcurrency(AI_REPORT_SEMAPHORE),
});

require("./routes/streaming-agent").register(app, {
  express,
  parsePositiveInt,
  aiReportLimiter: limitConcurrency(AI_REPORT_SEMAPHORE),
});

require("./routes/report-export").register(app, {
  express,
  excelExportLimiter: limitConcurrency(EXCEL_EXPORT_SEMAPHORE),
});

require("./routes/arrival").register(app, {
  express,
  proxyArrivalRequest,
  forwardNotesRequest,
});

app.get("/api/bi/datasets", requirePermission("bi"), (_req, res) => {
  res.json({ ok: true, datasets: Object.values(biQueryService.PRESET_DATASETS) });
});

app.post("/api/bi/dataset", requirePermission("bi"), express.json({ limit: "64kb" }), async (req, res, next) => {
  try {
    const key = String(req.body?.key || "").trim();
    const dateFrom = String(req.body?.date_from || "").trim();
    const dateTo = String(req.body?.date_to || "").trim();
    const result = await biQueryService.queryPresetDataset(key, dateFrom, dateTo);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

app.get("/api/bi/templates", requirePermission("bi"), (req, res) => {
  const accountId = String(req.authSession?.account_id || "");
  res.json({ ok: true, templates: biQueryService.getTemplatesByAccount(accountId) });
});

app.post("/api/bi/templates", requirePermission("bi"), express.json({ limit: "64kb" }), (req, res, next) => {
  try {
    const accountId = String(req.authSession?.account_id || "");
    const tpl = biQueryService.saveTemplate(accountId, {
      name: req.body?.name,
      dataset_key: req.body?.dataset_key,
      rows: req.body?.rows,
      cols: req.body?.cols,
      vals: req.body?.vals,
      aggregatorName: req.body?.aggregatorName,
      rendererName: req.body?.rendererName,
    });
    res.json({ ok: true, template: tpl });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/bi/templates/:id", requirePermission("bi"), (req, res, next) => {
  try {
    const accountId = String(req.authSession?.account_id || "");
    biQueryService.deleteTemplate(accountId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get("/api/bi/schema", requirePermission("bi"), async (_req, res, next) => {
  try {
    const schema = await biQueryService.getSchemaInfo();
    res.json({ ok: true, tables: schema });
  } catch (err) {
    next(err);
  }
});

app.post("/api/bi/query", requirePermission("bi"), express.json({ limit: "64kb" }), async (req, res, next) => {
  try {
    const sql = String(req.body?.sql || "").trim();
    const result = await biQueryService.executeBiQuery(sql);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

app.post("/api/bi/ask", requirePermission("bi"), express.json({ limit: "64kb" }), async (req, res, next) => {
  const question = String(req.body?.question || "").trim();
  if (!question) {
    return res.status(400).json({ ok: false, message: "question required" });
  }
  try {
    const { OpenAI } = require("openai");
    const apiKey = runtimeSecrets.getDeepseekApiKey();
    if (!apiKey) {
      return res.status(400).json({ ok: false, message: "请先在 AI 设置中填写 DeepSeek API Key" });
    }
    const schema = await biQueryService.getSchemaInfo();
    const schemaText = biQueryService.buildSchemaPromptText(schema);
    const client = new OpenAI({
      apiKey,
      baseURL: appConfig.deepseekBaseUrl,
    });
    const prompt = [
      "你是电商经营数据分析师。请基于给定数据库 schema，把用户问题转换为安全 SQL。",
      "要求：",
      "1. 只能生成 SELECT 语句（可用 WITH CTE），禁止任何写操作",
      `2. 必须包含 LIMIT（最大 ${biQueryService.MAX_ROWS}）`,
      "3. 所有表都在 anta_daily schema 下，查询时必须加 schema 前缀 anta_daily.",
      "4. 返回 JSON 格式，包含 sql、pivotConfig、title 三个字段",
      "5. pivotConfig 使用 react-pivottable 的字段名，rows/cols/vals/aggregatorName/rendererName",
      "",
      "Schema:",
      schemaText,
      "",
      `用户问题：${question}`,
    ].join("\n");
    const completion = await client.chat.completions.create({
      model: appConfig.deepseekModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    });
    const text = completion.choices?.[0]?.message?.content || "";
    const parsed = biQueryService.parseAiJson(text);
    if (!parsed?.sql) {
      return res.status(502).json({ ok: false, message: "AI 未返回有效 SQL", raw: text });
    }
    const result = await biQueryService.executeBiQuery(parsed.sql);
    return res.json({
      ok: true,
      sql: parsed.sql,
      title: parsed.title || "AI 查询结果",
      pivotConfig: parsed.pivotConfig || {},
      ...result,
    });
  } catch (err) {
    next(err);
  }
});

require("./routes/spa").register(app, {
  sendReactApp,
});

require("./routes/docs").register(app);

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
