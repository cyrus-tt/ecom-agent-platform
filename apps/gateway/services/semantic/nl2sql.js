"use strict";

const { OpenAI } = require("openai");
const runtimeSecrets = require("../runtimeSecrets");
const { buildPromptContext, getConfig } = require("./loader");
const { validateSQL, MAX_ROWS } = require("./validator");

const SYSTEM_PROMPT = `你是安踏电商数据分析 SQL 专家。根据用户的自然语言问题生成 PostgreSQL 查询。

## 规则
1. 只生成 SELECT 语句（可以用 WITH ... AS）
2. 所有查询必须加上全局过滤条件（排除测试 SKU）
3. 结果集默认 LIMIT ${MAX_ROWS}，除非用户明确要求更多
4. 折扣率计算：coalesce(nullif(sku_discount_xxx, 0), nullif(style_discount_xxx, 0), 1.0)
5. 文本维度需要 coalesce 处理空值（如 category → coalesce(nullif(trim(category), ''), '未分类')）
6. 日期用 PostgreSQL 语法：current_date, interval, date_trunc 等
7. 渠道是宽表列（每个渠道一列），不是行维度。比较渠道需要 UNION ALL 或分别计算
8. GMV = 销量 × 吊牌价 × 折扣率
9. 只查下面给出的表和列，不要编造不存在的表或列

## 输出格式
只输出 SQL，不要解释。不要用 markdown 代码块。`;

function createLLMClient() {
  const apiKey = runtimeSecrets.getDeepseekApiKey();
  if (!apiKey) {
    const err = new Error("DEEPSEEK_API_KEY 未配置");
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }
  return {
    model: String(
      process.env.DEEPSEEK_MODEL || runtimeSecrets.DEFAULT_DEEPSEEK_MODEL
    ),
    client: new OpenAI({
      apiKey,
      baseURL: String(
        process.env.DEEPSEEK_BASE_URL ||
          runtimeSecrets.DEFAULT_DEEPSEEK_BASE_URL
      ),
    }),
  };
}

async function generateSQL(question) {
  const llm = createLLMClient();
  const schemaContext = buildPromptContext();

  const messages = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${schemaContext}` },
    { role: "user", content: question },
  ];

  const completion = await llm.client.chat.completions.create(
    {
      model: llm.model,
      temperature: 0.0,
      max_tokens: 2000,
      messages,
    },
    { timeout: 30000 }
  );

  const raw = completion?.choices?.[0]?.message?.content || "";
  return cleanSQL(raw);
}

async function generateSQLWithRetry(question, errorMsg) {
  const llm = createLLMClient();
  const schemaContext = buildPromptContext();

  const messages = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${schemaContext}` },
    { role: "user", content: question },
    {
      role: "assistant",
      content: "(上一次生成的 SQL 执行出错)",
    },
    {
      role: "user",
      content: `SQL 执行报错：${errorMsg}\n请修正 SQL 后重新输出。只输出 SQL，不要解释。`,
    },
  ];

  const completion = await llm.client.chat.completions.create(
    {
      model: llm.model,
      temperature: 0.0,
      max_tokens: 2000,
      messages,
    },
    { timeout: 30000 }
  );

  const raw = completion?.choices?.[0]?.message?.content || "";
  return cleanSQL(raw);
}

function cleanSQL(raw) {
  let sql = raw.trim();
  sql = sql.replace(/^```(?:sql)?\n?/i, "").replace(/\n?```\s*$/, "");
  sql = sql.replace(/;\s*$/, "");
  return sql.trim();
}

async function queryDynamic(pool, question) {
  let sql = await generateSQL(question);

  const v1 = validateSQL(sql);
  if (!v1.valid) {
    return {
      success: false,
      error: `SQL 安全校验失败: ${v1.errors.join("; ")}`,
      sql,
    };
  }
  sql = v1.amendedSql;

  try {
    const { rows } = await pool.query(sql);
    return {
      success: true,
      sql,
      row_count: rows.length,
      rows: rows.slice(0, MAX_ROWS),
    };
  } catch (err) {
    const retrySQL = await generateSQLWithRetry(question, err.message);
    const v2 = validateSQL(retrySQL);
    if (!v2.valid) {
      return {
        success: false,
        error: `重试后 SQL 仍未通过安全校验: ${v2.errors.join("; ")}`,
        sql: retrySQL,
        original_sql: sql,
        original_error: err.message,
      };
    }

    try {
      const { rows } = await pool.query(v2.amendedSql);
      return {
        success: true,
        sql: v2.amendedSql,
        row_count: rows.length,
        rows: rows.slice(0, MAX_ROWS),
        retried: true,
        original_sql: sql,
        original_error: err.message,
      };
    } catch (retryErr) {
      return {
        success: false,
        error: retryErr.message,
        sql: v2.amendedSql,
        original_sql: sql,
        original_error: err.message,
      };
    }
  }
}

module.exports = { queryDynamic, generateSQL, validateSQL: validateSQL };
