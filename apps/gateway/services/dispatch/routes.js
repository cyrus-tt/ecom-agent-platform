"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const XLSX = require("xlsx");

const taskStore = require("./taskStore");
const eventBus = require("./eventBus");
const orchestrator = require("./orchestrator");

let multer = null;
try { multer = require("multer"); } catch {}

function ensureInit() {
  taskStore.init();
}

function makeUploader() {
  if (!multer) {
    throw new Error("multer 未安装,请在 apps/gateway 下运行: npm install multer");
  }
  const dataDir = taskStore.getDataDir();
  const storage = multer.diskStorage({
    destination(req, _file, cb) {
      const taskId = req._dispatchTaskId;
      const dest = path.join(dataDir, "uploads", taskId);
      if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename(_req, file, cb) {
      // 保留原始文件名(转 utf8)
      const original = Buffer.from(file.originalname, "latin1").toString("utf8");
      cb(null, original);
    },
  });
  return multer({
    storage,
    limits: { fileSize: 30 * 1024 * 1024, files: 3 },
  });
}

function registerRoutes(app, { requirePermission }) {
  ensureInit();

  // 给上传请求分配 taskId(放最前面做中间件)
  const assignTaskId = (req, _res, next) => {
    req._dispatchTaskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    next();
  };

  const uploader = multer ? makeUploader() : null;

  // ── 任务:上传并创建 ─────────────────────────────────
  app.post(
    "/api/dispatch/tasks",
    requirePermission("dispatch"),
    assignTaskId,
    (req, res, next) => {
      if (!uploader) {
        return res.status(500).json({ ok: false, message: "multer 未安装" });
      }
      uploader.fields([
        { name: "demand", maxCount: 1 },
        { name: "virtual", maxCount: 1 },
        { name: "physical", maxCount: 1 },
      ])(req, res, next);
    },
    async (req, res) => {
      try {
        const files = req.files || {};
        if (!files.demand || !files.virtual || !files.physical) {
          return res.status(400).json({
            ok: false,
            message: "需要同时上传 demand / virtual / physical 三个文件",
          });
        }
        const taskId = req._dispatchTaskId;
        const title = String(req.body.title || files.demand[0].originalname || taskId).slice(0, 100);
        const dataDir = taskStore.getDataDir();
        const outDir = path.join(dataDir, "outputs", taskId);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        const task = await orchestrator.startTask({
          taskId,
          title,
          demandFile: files.demand[0].path,
          virtualStockFile: files.virtual[0].path,
          physicalStockFile: files.physical[0].path,
          createdBy: req.authUser || "",
          outDir,
        });
        res.json({ ok: true, task });
      } catch (err) {
        res.status(500).json({ ok: false, message: String(err.message || err) });
      }
    }
  );

  // ── 列表 ─────────────────────────────────────────
  app.get("/api/dispatch/tasks", requirePermission("dispatch"), (_req, res) => {
    const tasks = taskStore.listTasks({ limit: 50 });
    res.json({ ok: true, tasks });
  });

  // ── 详情 + 全部事件 ───────────────────────────────
  app.get("/api/dispatch/tasks/:id", requirePermission("dispatch"), (req, res) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return res.status(404).json({ ok: false, message: "task_not_found" });
    const events = taskStore.listEvents(req.params.id, 0);
    const artifacts = orchestrator.collectArtifacts(task).map((a) => ({
      ...a,
      url: `/api/dispatch/tasks/${task.id}/files/${encodeURIComponent(a.name)}`,
    }));
    res.json({ ok: true, task, events, artifacts });
  });

  // ── SSE 事件流 ───────────────────────────────────
  app.get("/api/dispatch/tasks/:id/events", requirePermission("dispatch"), (req, res) => {
    const taskId = req.params.id;
    const task = taskStore.getTask(taskId);
    if (!task) return res.status(404).end();

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (typeof res.flushHeaders === "function") res.flushHeaders();

    const lastId = Number(req.headers["last-event-id"] || req.query.lastEventId || 0);
    // 先补发历史
    const history = taskStore.listEvents(taskId, lastId);
    for (const evt of history) {
      writeEvent(res, evt);
    }

    const unsubscribe = eventBus.subscribe(taskId, (evt) => {
      writeEvent(res, evt);
    });
    const heartbeat = setInterval(() => {
      res.write(`: ping ${Date.now()}\n\n`);
    }, 25000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  // ── 产物下载 ─────────────────────────────────────
  app.get("/api/dispatch/tasks/:id/files/:name", requirePermission("dispatch"), (req, res) => {
    const task = taskStore.getTask(req.params.id);
    if (!task) return res.status(404).end();
    const name = String(req.params.name || "");
    const artifacts = orchestrator.collectArtifacts(task);
    const hit = artifacts.find((a) => a.name === name);
    if (!hit) return res.status(404).end();
    // 白名单匹配基名,真实路径按 meta 查
    let full = "";
    if (hit.kind === "cleaned") full = task.meta.cleanedFile;
    else if (hit.kind === "dispatch_template") full = task.meta.dispatchTemplateFile;
    else if (hit.kind === "move_template") full = task.meta.moveTemplateFile;
    if (!full || !fs.existsSync(full)) return res.status(404).end();
    res.download(full, name);
  });

  // ── 需求表预览(给确认页用),用 token 授权,不走 session ─
  app.get("/api/dispatch/public/preview", (req, res) => {
    const token = String(req.query.token || "");
    const verified = taskStore.verifyConfirmToken(token);
    if (!verified) return res.status(401).json({ ok: false, message: "token_invalid_or_expired" });
    const task = taskStore.getTask(verified.taskId);
    if (!task) return res.status(404).json({ ok: false, message: "task_not_found" });
    const file = task.meta.cleanedFile || task.meta.files.demandFile;
    if (!file || !fs.existsSync(file)) return res.status(404).json({ ok: false, message: "file_missing" });
    try {
      const wb = XLSX.readFile(file);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
      const headers = (data[0] || []).map((h) => String(h || "").trim());
      const rows = data.slice(1);
      const rowNums = Array.isArray(task.meta.cleanReport && task.meta.cleanReport.rowNums)
        ? task.meta.cleanReport.rowNums
        : rows.map((_, i) => i + 2);
      // 根据任务当前状态决定用哪组 issues
      let issues = [];
      let issueKind = "warning";
      if (task.state === "CONFIRMING_SIZE" && task.meta.sizeConfirmMeta) {
        issues = task.meta.sizeConfirmMeta.issues || [];
        issueKind = "size_substitution";
      } else if (task.meta.confirmMeta) {
        issues = task.meta.confirmMeta.issues || [];
        issueKind = "warning";
      }
      res.json({
        ok: true,
        taskId: task.id,
        title: task.title,
        state: task.state,
        headers,
        rows,
        rowNums,
        issues,
        issueKind,
      });
    } catch (err) {
      res.status(500).json({ ok: false, message: String(err.message || err) });
    }
  });

  // ── 提交确认(token 授权) ────────────────────────
  app.post("/api/dispatch/public/confirm",
    express.json({ limit: "256kb" }),
    (req, res) => {
      const token = String(req.query.token || req.body.token || "");
      const verified = taskStore.verifyConfirmToken(token);
      if (!verified) return res.status(401).json({ ok: false, message: "token_invalid_or_expired" });
      const responses = (req.body && req.body.responses) || {};
      const result = orchestrator.submitConfirm(verified.taskId, responses);
      if (!result.ok) {
        return res.status(409).json({ ok: false, message: "task_not_waiting_for_confirm" });
      }
      taskStore.markTokenUsed(token);
      res.json({ ok: true });
    }
  );
}

function writeEvent(res, evt) {
  const line = `id: ${evt.id}\nevent: dispatch\ndata: ${JSON.stringify(evt)}\n\n`;
  res.write(line);
}

module.exports = { registerRoutes };
