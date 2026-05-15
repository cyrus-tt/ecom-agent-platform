"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { childLogger } = require("./logger");

const log = childLogger("lib:db");

const BASE_DIR = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(BASE_DIR, "config.json");

const SLOW_SQL_THRESHOLD_MS = 300;

let poolPromise = null;

function readConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, "utf-8").replace(/^﻿/, "");
  return JSON.parse(raw);
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(text)) {
    return true;
  }
  if (["0", "false", "no", "n"].includes(text)) {
    return false;
  }
  return fallback;
}

function buildPgConfig(pgConfig) {
  const statementTimeout = Number(pgConfig?.statement_timeout_ms || 120000);
  const connectionTimeout = Number(pgConfig?.connection_timeout_ms || 10000);
  return {
    host: String(pgConfig?.host || "127.0.0.1"),
    port: Number(pgConfig?.port || 5432),
    database: String(pgConfig?.database || "ecom_dashboard_v2"),
    user: String(pgConfig?.user || "ecom_app"),
    password: String(pgConfig?.password || "ecom123456"),
    max: Number(pgConfig?.max_pool_size || 10),
    statement_timeout: Number.isFinite(statementTimeout) && statementTimeout > 0 ? statementTimeout : 120000,
    connectionTimeoutMillis: Number.isFinite(connectionTimeout) && connectionTimeout > 0 ? connectionTimeout : 10000,
    ssl: toBool(pgConfig?.ssl, false) ? { rejectUnauthorized: false } : false,
  };
}

function compactSqlText(queryText) {
  return String(queryText || "").replace(/\s+/g, " ").trim().slice(0, 260);
}

async function timedQuery(pool, queryText, values, tag) {
  const startedAt = Date.now();
  try {
    return await pool.query(queryText, values);
  } finally {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > SLOW_SQL_THRESHOLD_MS) {
      const label = tag ? `[${tag}]` : "";
      log.warn({ tag, elapsedMs, sql: compactSqlText(queryText) }, `[slow-sql]${label} ${elapsedMs}ms`);
    }
  }
}

async function getPool() {
  if (poolPromise) {
    return poolPromise;
  }
  const cfg = readConfig();
  const pgCfg = buildPgConfig(cfg.postgres || {});
  const pool = new Pool(pgCfg);
  poolPromise = pool
    .query("select 1 as ok")
    .then(() => pool)
    .catch(async (err) => {
      poolPromise = null;
      try {
        await pool.end();
      } catch (_err) {
        // ignore
      }
      throw err;
    });
  return poolPromise;
}

module.exports = {
  BASE_DIR,
  CONFIG_PATH,
  SLOW_SQL_THRESHOLD_MS,
  getPool,
  timedQuery,
  compactSqlText,
};
