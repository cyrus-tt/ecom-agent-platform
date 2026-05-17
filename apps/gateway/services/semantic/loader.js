"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { SemanticConfigSchema } = require("./schema");

const CONFIG_PATH = path.resolve(
  __dirname,
  "../../../../config/semantic.yml"
);

let _cached = null;

function load(configPath) {
  const filePath = configPath || CONFIG_PATH;
  const raw = fs.readFileSync(filePath, "utf-8");
  const doc = yaml.load(raw);
  const result = SemanticConfigSchema.safeParse(doc);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`semantic.yml validation failed:\n${issues}`);
  }
  return result.data;
}

function getConfig(configPath) {
  if (!_cached) {
    _cached = load(configPath);
  }
  return _cached;
}

function reload(configPath) {
  _cached = null;
  return getConfig(configPath);
}

function getChannel(code) {
  const cfg = getConfig();
  return cfg.channels.find((ch) => ch.code === code) || null;
}

function resolveChannelLabel(text) {
  const cfg = getConfig();
  for (const ch of cfg.channels) {
    if (text.includes(ch.label) || text.includes(ch.code)) {
      return ch;
    }
  }
  return null;
}

function getMetric(name) {
  const cfg = getConfig();
  return cfg.metrics[name] || null;
}

function getAllowedTables() {
  const cfg = getConfig();
  return Object.keys(cfg.tables).map(
    (t) => `${cfg.schema_name}.${t}`
  );
}

function getAllowedColumns() {
  const cfg = getConfig();
  const cols = new Set();
  for (const table of Object.values(cfg.tables)) {
    for (const col of Object.keys(table.columns)) {
      cols.add(col);
    }
  }
  return cols;
}

function getDetectionRule(type) {
  const cfg = getConfig();
  return cfg.detection_rules[type] || null;
}

function buildPromptContext() {
  const cfg = getConfig();

  const tableDescs = Object.entries(cfg.tables)
    .map(([name, t]) => {
      const colList = Object.entries(t.columns)
        .map(([col, def]) => `    - ${col} (${def.type}): ${def.description}`)
        .join("\n");
      return `  ${cfg.schema_name}.${name}: ${t.description}\n    主键: ${t.primary_key.join(", ")}\n${colList}`;
    })
    .join("\n\n");

  const channelList = cfg.channels
    .map((ch) => `  - ${ch.code} (${ch.label}): sales=${ch.sales_qty_col}, inv=${ch.inventory_qty_col || "无"}, discount=${ch.sku_discount_col}`)
    .join("\n");

  const metricList = Object.entries(cfg.metrics)
    .map(([name, m]) => {
      if (m.derived) return `  - ${name} (${m.label}): ${m.description} [派生: ${m.formula}]`;
      return `  - ${name} (${m.label}): ${m.description} [${m.unit}]`;
    })
    .join("\n");

  const dimList = Object.entries(cfg.dimensions)
    .map(([name, d]) => `  - ${name} (${d.label}): ${d.coalesce || d.column || d.description || ""}`)
    .join("\n");

  const examples = cfg.examples
    .map((e, i) => `  Q${i + 1}: ${e.question}\n  SQL: ${e.sql.trim()}\n  说明: ${e.explanation}`)
    .join("\n\n");

  const filters = Object.values(cfg.global_filters)
    .filter((f) => f.always_apply)
    .map((f) => f.sql)
    .join(" AND ");

  return [
    "## 数据库表结构",
    tableDescs,
    "",
    "## 渠道映射（22 个）",
    channelList,
    "",
    "## 可用指标",
    metricList,
    "",
    "## 可用维度",
    dimList,
    "",
    "## 全局过滤条件（每条查询必须加）",
    `  ${filters}`,
    "",
    "## 参考示例",
    examples,
  ].join("\n");
}

module.exports = {
  load,
  getConfig,
  reload,
  getChannel,
  resolveChannelLabel,
  getMetric,
  getAllowedTables,
  getAllowedColumns,
  getDetectionRule,
  buildPromptContext,
};
