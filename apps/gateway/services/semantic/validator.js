"use strict";

const { getAllowedTables, getAllowedColumns, getConfig } = require("./loader");

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "TRUNCATE",
  "ALTER",
  "CREATE",
  "GRANT",
  "REVOKE",
  "COPY",
  "EXECUTE",
  "DO ",
  "CALL ",
  "SET ",
  "VACUUM",
  "REINDEX",
  "CLUSTER",
  "COMMENT",
];

const MAX_ROWS = 500;

function validateSQL(sql) {
  const errors = [];
  const upper = sql.toUpperCase().replace(/\s+/g, " ").trim();

  if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
    errors.push("Only SELECT / WITH ... SELECT statements are allowed");
  }

  for (const kw of FORBIDDEN_KEYWORDS) {
    const pattern = new RegExp(`\\b${kw.trim()}\\b`, "i");
    if (pattern.test(upper) && !upper.startsWith("WITH")) {
      if (kw.trim() === "SET" && upper.includes("CASE")) continue;
      errors.push(`Forbidden keyword: ${kw.trim()}`);
    }
    if (kw.trim() === "DROP" && pattern.test(upper)) {
      errors.push(`Forbidden keyword: DROP`);
    }
  }

  const cfg = getConfig();
  const schemaName = cfg.schema_name;
  const allowedFQ = getAllowedTables();
  const fromMatches = sql.match(
    /\bFROM\s+([\w."]+)/gi
  ) || [];
  const joinMatches = sql.match(
    /\bJOIN\s+([\w."]+)/gi
  ) || [];
  const allTableRefs = [...fromMatches, ...joinMatches].map((m) =>
    m.replace(/^(FROM|JOIN)\s+/i, "").replace(/"/g, "").trim()
  );

  for (const ref of allTableRefs) {
    const fq = ref.includes(".") ? ref : `${schemaName}.${ref}`;
    if (!allowedFQ.includes(fq.toLowerCase()) && !isCTE(ref, sql)) {
      errors.push(`Table not in whitelist: ${ref}`);
    }
  }

  if (!upper.includes("LIMIT")) {
    return { valid: errors.length === 0, errors, amendedSql: `${sql.replace(/;?\s*$/, "")}\nLIMIT ${MAX_ROWS}` };
  }

  return { valid: errors.length === 0, errors, amendedSql: sql };
}

function isCTE(name, sql) {
  const ctePattern = new RegExp(
    `\\bWITH\\b[\\s\\S]*?\\b${escapeRegex(name)}\\b\\s+AS\\s*\\(`,
    "i"
  );
  const recursivePattern = new RegExp(
    `,\\s*${escapeRegex(name)}\\s+AS\\s*\\(`,
    "i"
  );
  return ctePattern.test(sql) || recursivePattern.test(sql);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { validateSQL, MAX_ROWS };
