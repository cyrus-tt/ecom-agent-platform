"use strict";

const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");

const BASE_DIR = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(BASE_DIR, "config.json");

const DANGEROUS_SQL_PATTERN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY|EXECUTE|CALL|INTO)\b/i;
const DANGEROUS_FUNC_PATTERN = /\b(pg_terminate_backend|pg_cancel_backend|pg_sleep|pg_read_file|pg_read_binary_file|lo_import|lo_export|pg_ls_dir|set_config)\b/i;
const MAX_ROWS = 5000;
const STATEMENT_TIMEOUT_MS = 30000;
const SCHEMA_CACHE_TTL_MS = 10 * 60 * 1000;

let biPool = null;
let appFallbackPool = null;
let biReadonlyUnavailableWarned = false;
let schemaCache = { savedAt: 0, payload: null };

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8").replace(/^\uFEFF/, ""));
    return {
      readonly: raw.postgres_bi_readonly || null,
      app: raw.postgres || null,
    };
  } catch (_err) {
    return { readonly: null, app: null };
  }
}

function createPool(cfg, fallbackUser) {
  const safeCfg = cfg || {};
  return new Pool({
    host: String(safeCfg.host || "127.0.0.1"),
    port: Number(safeCfg.port || 5432),
    database: String(safeCfg.database || "ecom_dashboard_v2"),
    user: String(safeCfg.user || fallbackUser),
    password: String(safeCfg.password || ""),
    max: 5,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    ssl: safeCfg.ssl ? { rejectUnauthorized: false } : false,
  });
}

function getBiPool() {
  if (biPool) return biPool;
  const cfg = loadConfig();
  biPool = createPool(cfg.readonly || cfg.app || {}, "bi_readonly");
  return biPool;
}

function getAppFallbackPool() {
  if (appFallbackPool) return appFallbackPool;
  const cfg = loadConfig();
  appFallbackPool = createPool(cfg.app || cfg.readonly || {}, "ecom_app");
  return appFallbackPool;
}

function hasAppFallbackConfig() {
  const cfg = loadConfig();
  return !!(cfg.app && cfg.app.user && cfg.app.database);
}

function isBiConnectionError(err) {
  const code = String(err?.code || "");
  const message = String(err?.message || err || "").toLowerCase();
  return (
    code === "28P01" ||
    code === "28000" ||
    message.includes("password authentication failed") ||
    message.includes("role") && message.includes("does not exist") ||
    message.includes("client password must be a string")
  );
}

async function queryReadOnly(pool, sql) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const result = await client.query(sql);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackErr) {
      // ignore rollback errors; the original query error is more useful.
    }
    throw err;
  } finally {
    client.release();
  }
}

async function queryWithBiPool(sql) {
  try {
    return await queryReadOnly(getBiPool(), sql);
  } catch (err) {
    if (!isBiConnectionError(err) || !hasAppFallbackConfig()) {
      throw err;
    }
    if (!biReadonlyUnavailableWarned) {
      biReadonlyUnavailableWarned = true;
      console.warn("[bi] postgres_bi_readonly unavailable; falling back to app connection inside READ ONLY transactions");
    }
    return await queryReadOnly(getAppFallbackPool(), sql);
  }
}

function validateSql(sql) {
  const trimmed = String(sql || "").trim();
  if (!trimmed) {
    return { ok: false, message: "SQL 不能为空" };
  }
  if (DANGEROUS_SQL_PATTERN.test(trimmed)) {
    const match = trimmed.match(DANGEROUS_SQL_PATTERN);
    return { ok: false, message: `禁止执行写操作: ${match ? match[0].toUpperCase() : ""}` };
  }
  if (DANGEROUS_FUNC_PATTERN.test(trimmed)) {
    const match = trimmed.match(DANGEROUS_FUNC_PATTERN);
    return { ok: false, message: `禁止调用危险函数: ${match ? match[0] : ""}` };
  }
  if (!/^\s*SELECT\b/i.test(trimmed) && !/^\s*WITH\b/i.test(trimmed)) {
    return { ok: false, message: "仅允许 SELECT / WITH 查询" };
  }
  return { ok: true };
}

function ensureLimit(sql) {
  const trimmed = String(sql || "").trim().replace(/;\s*$/, "");
  if (/\bLIMIT\s+\d+/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}\nLIMIT ${MAX_ROWS}`;
}

async function executeBiQuery(sql) {
  const validation = validateSql(sql);
  if (!validation.ok) {
    throw new Error(validation.message);
  }
  const safeSql = ensureLimit(sql);
  const start = Date.now();
  const result = await queryWithBiPool(safeSql);
  const elapsed = Date.now() - start;
  const columns = Array.isArray(result.fields)
    ? result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID }))
    : [];
  const rows = Array.isArray(result.rows) ? result.rows : [];
  return {
    columns,
    rows,
    rowCount: rows.length,
    elapsed_ms: elapsed,
  };
}

async function getSchemaInfo() {
  if (schemaCache.payload && Date.now() - schemaCache.savedAt < SCHEMA_CACHE_TTL_MS) {
    return schemaCache.payload;
  }
  const result = await queryWithBiPool(`
    SELECT
      table_name,
      column_name,
      data_type,
      is_nullable,
      col_description(
        (quote_ident(table_schema) || '.' || quote_ident(table_name))::regclass,
        ordinal_position
      ) as column_comment
    FROM information_schema.columns
    WHERE table_schema = 'anta_daily'
    ORDER BY table_name, ordinal_position
  `);
  const tables = {};
  for (const row of result.rows || []) {
    const tbl = row.table_name;
    if (!tables[tbl]) tables[tbl] = { table_name: tbl, columns: [] };
    tables[tbl].columns.push({
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === "YES",
      comment: row.column_comment || "",
    });
  }
  const payload = Object.values(tables);
  schemaCache = { savedAt: Date.now(), payload };
  return payload;
}

function buildSchemaPromptText(schema) {
  return schema
    .map((tbl) => {
      const cols = tbl.columns
        .map((c) => `  ${c.name} ${c.type}${c.comment ? ` -- ${c.comment}` : ""}`)
        .join("\n");
      return `anta_daily.${tbl.table_name}\n${cols}`;
    })
    .join("\n\n");
}

module.exports = {
  validateSql,
  ensureLimit,
  executeBiQuery,
  getSchemaInfo,
  buildSchemaPromptText,
  MAX_ROWS,
};
