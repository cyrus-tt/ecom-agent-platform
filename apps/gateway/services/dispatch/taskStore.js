"use strict";

const fs = require("fs");
const path = require("path");
const { childLogger } = require("../../lib/logger");

const log = childLogger("dispatch.taskStore");

let Database;
try {
  Database = require("better-sqlite3");
} catch (err) {
  Database = null;
}

let db = null;
let dataDir = "";

function resolveDataDir() {
  const base = process.env.DISPATCH_DATA_DIR
    ? path.resolve(process.env.DISPATCH_DATA_DIR)
    : path.resolve(__dirname, "..", "..", "..", "..", "data", "dispatch");
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  if (!fs.existsSync(path.join(base, "uploads"))) fs.mkdirSync(path.join(base, "uploads"), { recursive: true });
  if (!fs.existsSync(path.join(base, "outputs"))) fs.mkdirSync(path.join(base, "outputs"), { recursive: true });
  return base;
}

function init() {
  if (!Database) {
    throw new Error("better-sqlite3 未安装,请在 apps/gateway 下运行: npm install better-sqlite3");
  }
  if (db) return db;
  dataDir = resolveDataDir();
  const dbPath = path.join(dataDir, "tasks.db");
  try {
    db = new Database(dbPath);
  } catch (err) {
    // 尝试备份损坏文件
    const backup = `${dbPath}.corrupt.${Date.now()}`;
    try { fs.renameSync(dbPath, backup); } catch {}
    log.warn({ backup, err: err.message }, `tasks.db 损坏已备份 -> ${backup}: ${err.message}`);
    db = new Database(dbPath);
  }
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      state TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error TEXT,
      meta_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      phase TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, id);
    CREATE TABLE IF NOT EXISTS confirm_tokens (
      token TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    );
  `);
  // 启动时把未完成任务标记为 INTERRUPTED
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE tasks SET state = 'INTERRUPTED', updated_at = ? WHERE state NOT IN ('DONE', 'FAILED', 'INTERRUPTED')"
  ).run(now);
  return db;
}

function getDataDir() {
  if (!dataDir) init();
  return dataDir;
}

function insertTask(task) {
  init();
  db.prepare(
    "INSERT INTO tasks(id, title, state, created_by, created_at, updated_at, error, meta_json) VALUES(?,?,?,?,?,?,?,?)"
  ).run(
    task.id,
    task.title,
    task.state,
    task.createdBy || "",
    task.createdAt,
    task.updatedAt,
    task.error || null,
    JSON.stringify(task.meta || {})
  );
}

function updateTask(taskId, patch) {
  init();
  const cur = getTask(taskId);
  if (!cur) return;
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  db.prepare(
    "UPDATE tasks SET title=?, state=?, updated_at=?, error=?, meta_json=? WHERE id=?"
  ).run(
    next.title,
    next.state,
    next.updatedAt,
    next.error || null,
    JSON.stringify(next.meta || {}),
    taskId
  );
}

function getTask(taskId) {
  init();
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!row) return null;
  return rowToTask(row);
}

function listTasks({ limit = 50, createdBy = null } = {}) {
  init();
  const stmt = createdBy
    ? db.prepare("SELECT * FROM tasks WHERE created_by = ? ORDER BY created_at DESC LIMIT ?")
    : db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?");
  const rows = createdBy ? stmt.all(createdBy, limit) : stmt.all(limit);
  return rows.map(rowToTask);
}

function rowToTask(row) {
  let meta = {};
  try { meta = JSON.parse(row.meta_json || "{}"); } catch {}
  return {
    id: row.id,
    title: row.title,
    state: row.state,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    error: row.error,
    meta,
  };
}

function appendEvent(taskId, evt) {
  init();
  const ts = evt.ts || new Date().toISOString();
  const info = db.prepare(
    "INSERT INTO events(task_id, ts, phase, level, message, payload_json) VALUES(?,?,?,?,?,?)"
  ).run(
    taskId,
    ts,
    evt.phase || "INFO",
    evt.level || "info",
    evt.message || "",
    evt.payload ? JSON.stringify(evt.payload) : null
  );
  return {
    id: info.lastInsertRowid,
    taskId,
    ts,
    phase: evt.phase || "INFO",
    level: evt.level || "info",
    message: evt.message || "",
    payload: evt.payload || null,
  };
}

function listEvents(taskId, afterId = 0) {
  init();
  const rows = db
    .prepare("SELECT * FROM events WHERE task_id = ? AND id > ? ORDER BY id ASC")
    .all(taskId, afterId);
  return rows.map(rowToEvent);
}

function rowToEvent(row) {
  let payload = null;
  if (row.payload_json) {
    try { payload = JSON.parse(row.payload_json); } catch {}
  }
  return {
    id: row.id,
    taskId: row.task_id,
    ts: row.ts,
    phase: row.phase,
    level: row.level,
    message: row.message,
    payload,
  };
}

function createConfirmToken(taskId, ttlMs = 24 * 3600 * 1000) {
  init();
  const token = require("crypto").randomBytes(16).toString("hex");
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs);
  db.prepare(
    "INSERT INTO confirm_tokens(token, task_id, created_at, expires_at, used) VALUES(?,?,?,?,0)"
  ).run(token, taskId, now.toISOString(), expires.toISOString());
  return token;
}

function verifyConfirmToken(token) {
  init();
  const row = db.prepare("SELECT * FROM confirm_tokens WHERE token = ?").get(token);
  if (!row) return null;
  if (row.used) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { token, taskId: row.task_id };
}

function markTokenUsed(token) {
  init();
  db.prepare("UPDATE confirm_tokens SET used = 1 WHERE token = ?").run(token);
}

module.exports = {
  init,
  getDataDir,
  insertTask,
  updateTask,
  getTask,
  listTasks,
  appendEvent,
  listEvents,
  createConfirmToken,
  verifyConfirmToken,
  markTokenUsed,
};
