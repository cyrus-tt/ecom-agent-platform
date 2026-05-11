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
const TEMPLATES_PATH = path.join(BASE_DIR, "config", "bi-templates.json");

const SALES_DAILY_TABLE = "anta_daily.rpt_sales_sku_daily";
const INVENTORY_TABLE = "anta_daily.rpt_inventory_sku_latest";
const SKU_FILTER = "coalesce(sku, '') not ilike '%u%' and coalesce(sku, '') not ilike '%v%'";

const COLUMN_LABEL_MAP = {
  sales_date: "销售日期",
  style: "款号",
  sku: "货号",
  major_category: "大类",
  category: "中类",
  product_name: "品名",
  tag_price: "吊牌价",
  season: "产品季",
  gender: "性别",
  story_pack: "系列",
  sales_women_qty: "女子销量",
  sales_outdoor_qty: "户外销量",
  sales_trend_qty: "潮流销量",
  sales_casual_qty: "休闲销量",
  sales_tmall_badminton_qty: "天猫羽球销量",
  sales_tmall_outlet_qty: "天猫奥莱销量",
  sales_c_store_qty: "C店销量",
  sales_outlet_anjianli_qty: "奥莱安建立销量",
  sales_tmall_flagship_qty: "天猫旗舰销量",
  sales_tmall_franchise_qty: "天猫专卖销量",
  sales_shanghai_franchise_qty: "上海专卖销量",
  sales_jd_flagship_qty: "京东旗舰销量",
  sales_jd_franchise_qty: "京东专卖销量",
  sales_jd_self_qty: "京自营销量",
  sales_dewu_qty: "得物销量",
  sales_vip_qty: "唯品销量",
  sales_pdd_qty: "拼多多销量",
  sales_interest_qty: "兴趣销量",
  sales_official_qty: "官网销量",
  sales_group_buy_qty: "团购销量",
  sales_distributor_qty: "经销销量",
  sales_other_qty: "其他销量",
  sales_total_qty: "总销量",
  sales_total_amount: "出库金额",
  sales_total_tag_amount: "吊牌金额",
  inv_huotong_qty: "火通库存",
  inv_women_qty: "女子库存",
  inv_outdoor_qty: "户外库存",
  inv_trend_qty: "潮流库存",
  inv_casual_qty: "休闲库存",
  inv_c_store_qty: "C店库存",
  inv_category_shared_qty: "品类共享库存",
  inv_tmall_outlet_qty: "天猫奥莱库存",
  inv_shared_qty: "共享库存",
  inv_tmall_flagship_qty: "天猫旗舰库存",
  inv_tmall_franchise_qty: "天猫专卖库存",
  inv_shanghai_franchise_qty: "上海专卖库存",
  inv_jd_flagship_qty: "京东旗舰库存",
  inv_jd_franchise_qty: "京东专卖库存",
  inv_jd_self_qty: "京自营库存",
  inv_dewu_qty: "得物库存",
  inv_interest_qty: "兴趣库存",
  inv_vip_qty: "唯品库存",
  inv_pdd_qty: "拼多多库存",
  inv_distributor_qty: "经销库存",
  inv_other_qty: "其他库存",
  inventory_total_qty: "总库存",
};

function mapRowToChinese(row) {
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    result[COLUMN_LABEL_MAP[key] || key] = value;
  }
  return result;
}

function mapColumnsToChinese(columns) {
  return columns.map((col) => ({
    ...col,
    name: COLUMN_LABEL_MAP[col.name] || col.name,
  }));
}

const DATASET_DAILY_SALES_COLS = [
  "sales_date", "style", "sku", "major_category", "category", "product_name", "tag_price", "season",
  "sales_women_qty", "sales_outdoor_qty", "sales_trend_qty", "sales_casual_qty",
  "sales_tmall_badminton_qty", "sales_tmall_outlet_qty", "sales_c_store_qty",
  "sales_tmall_flagship_qty", "sales_tmall_franchise_qty", "sales_shanghai_franchise_qty",
  "sales_jd_flagship_qty", "sales_jd_franchise_qty", "sales_jd_self_qty",
  "sales_dewu_qty", "sales_vip_qty", "sales_pdd_qty", "sales_interest_qty",
  "sales_official_qty", "sales_group_buy_qty", "sales_distributor_qty", "sales_other_qty",
  "sales_total_qty", "sales_total_amount",
];

const DATASET_INVENTORY_COLS = [
  "style", "sku", "major_category", "category", "product_name", "tag_price", "season",
  "inv_women_qty", "inv_outdoor_qty", "inv_trend_qty", "inv_casual_qty",
  "inv_c_store_qty", "inv_tmall_outlet_qty", "inv_shared_qty",
  "inv_tmall_flagship_qty", "inv_tmall_franchise_qty", "inv_shanghai_franchise_qty",
  "inv_jd_flagship_qty", "inv_jd_franchise_qty", "inv_jd_self_qty",
  "inv_dewu_qty", "inv_vip_qty", "inv_pdd_qty", "inv_interest_qty",
  "inv_distributor_qty", "inv_other_qty", "inventory_total_qty",
];

const PRESET_DATASETS = {
  daily_sales: {
    key: "daily_sales",
    label: "日报销售明细",
    description: "按日期+货号的全渠道销售数据，支持选择日期区间",
    needsDateRange: true,
  },
  inventory: {
    key: "inventory",
    label: "最新库存快照",
    description: "当前各渠道库存分布",
    needsDateRange: false,
  },
  sales_inventory: {
    key: "sales_inventory",
    label: "销售+库存合并",
    description: "销售与库存数据合并，可分析售罄率",
    needsDateRange: true,
  },
};

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

async function queryPresetDataset(key, dateFrom, dateTo) {
  const dataset = PRESET_DATASETS[key];
  if (!dataset) throw new Error(`未知数据集: ${key}`);

  let sql;
  if (key === "daily_sales") {
    if (!dateFrom || !dateTo) throw new Error("日报销售明细需要选择日期区间");
    const cols = DATASET_DAILY_SALES_COLS.map((c) => `${c} as "${COLUMN_LABEL_MAP[c] || c}"`).join(", ");
    sql = `SELECT ${cols} FROM ${SALES_DAILY_TABLE} WHERE sales_date BETWEEN '${dateFrom}' AND '${dateTo}' AND ${SKU_FILTER} ORDER BY sales_date DESC, sales_total_amount DESC LIMIT ${MAX_ROWS}`;
  } else if (key === "inventory") {
    const cols = DATASET_INVENTORY_COLS.map((c) => `${c} as "${COLUMN_LABEL_MAP[c] || c}"`).join(", ");
    sql = `SELECT ${cols} FROM ${INVENTORY_TABLE} WHERE ${SKU_FILTER} ORDER BY inventory_total_qty DESC LIMIT ${MAX_ROWS}`;
  } else if (key === "sales_inventory") {
    if (!dateFrom || !dateTo) throw new Error("销售+库存合并需要选择日期区间");
    const salesCols = DATASET_DAILY_SALES_COLS.filter((c) => c !== "style" && c !== "sku" && c !== "major_category" && c !== "category" && c !== "product_name" && c !== "tag_price" && c !== "season")
      .map((c) => `s.${c} as "${COLUMN_LABEL_MAP[c] || c}"`);
    const invCols = DATASET_INVENTORY_COLS.filter((c) => c !== "style" && c !== "sku" && c !== "major_category" && c !== "category" && c !== "product_name" && c !== "tag_price" && c !== "season")
      .map((c) => `i.${c} as "${COLUMN_LABEL_MAP[c] || c}"`);
    const baseCols = ["s.style", "s.sku", "s.major_category", "s.category", "s.product_name", "s.tag_price", "s.season"]
      .map((c) => { const name = c.split(".")[1]; return `${c} as "${COLUMN_LABEL_MAP[name] || name}"`; });
    sql = `SELECT ${[...baseCols, ...salesCols, ...invCols].join(", ")} FROM ${SALES_DAILY_TABLE} s LEFT JOIN ${INVENTORY_TABLE} i ON s.sku = i.sku WHERE s.sales_date BETWEEN '${dateFrom}' AND '${dateTo}' AND ${SKU_FILTER.replace(/\bsku\b/g, "s.sku")} ORDER BY s.sales_date DESC, s.sales_total_amount DESC LIMIT ${MAX_ROWS}`;
  }

  const start = Date.now();
  const result = await queryWithBiPool(sql);
  const elapsed = Date.now() - start;
  const columns = Array.isArray(result.fields)
    ? result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID }))
    : [];
  const rows = Array.isArray(result.rows) ? result.rows : [];
  return { columns, rows, rowCount: rows.length, elapsed_ms: elapsed };
}

function readTemplates() {
  try {
    const raw = JSON.parse(fs.readFileSync(TEMPLATES_PATH, "utf8").replace(/^﻿/, ""));
    return Array.isArray(raw.templates) ? raw.templates : [];
  } catch (_err) {
    return [];
  }
}

function writeTemplates(templates) {
  fs.mkdirSync(path.dirname(TEMPLATES_PATH), { recursive: true });
  fs.writeFileSync(TEMPLATES_PATH, JSON.stringify({ templates }, null, 2), "utf8");
}

function getTemplatesByAccount(accountId) {
  return readTemplates().filter((t) => t.account_id === accountId);
}

function saveTemplate(accountId, { name, dataset_key, pivotState }) {
  const templates = readTemplates();
  const id = `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const tpl = {
    id,
    name: String(name || "").trim() || "未命名模板",
    account_id: accountId,
    dataset_key: String(dataset_key || ""),
    pivotState: pivotState || {},
    created_at: new Date().toISOString(),
  };
  templates.push(tpl);
  writeTemplates(templates);
  return tpl;
}

function deleteTemplate(accountId, templateId) {
  const templates = readTemplates();
  const idx = templates.findIndex((t) => t.id === templateId && t.account_id === accountId);
  if (idx === -1) throw new Error("模板不存在");
  templates.splice(idx, 1);
  writeTemplates(templates);
}

module.exports = {
  validateSql,
  ensureLimit,
  executeBiQuery,
  getSchemaInfo,
  buildSchemaPromptText,
  queryPresetDataset,
  getTemplatesByAccount,
  saveTemplate,
  deleteTemplate,
  PRESET_DATASETS,
  COLUMN_LABEL_MAP,
  MAX_ROWS,
};
