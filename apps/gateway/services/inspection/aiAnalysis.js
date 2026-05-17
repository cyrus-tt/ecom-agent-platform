"use strict";

/**
 * AI-enhanced anomaly analysis — uses DeepSeek (if configured) to generate
 * deeper insights and more specific action recommendations beyond the rule engine.
 *
 * Falls back gracefully if LLM is unavailable (no API key or network error).
 * This is a best-effort enhancement, not a critical path.
 */

const { OpenAI } = require("openai");
const runtimeSecrets = require("../runtimeSecrets");

const ANALYSIS_PROMPT = `你是安踏电商运营 AI 顾问。根据以下巡检异常数据，生成简短的分析和建议。

要求：
1. 用 2-3 句话总结今天的异常模式（是系统性问题还是个别渠道？有无共同原因？）
2. 给出 1-2 个最关键的行动建议（具体到操作层面）
3. 如果多个异常之间有关联，指出关联性

输出 JSON 格式：
{
  "pattern_summary": "一句话总结",
  "key_insight": "核心洞察",
  "priority_actions": ["建议1", "建议2"],
  "correlation": "关联分析（如果有）"
}`;

async function analyzeAnomalies(anomalies) {
  const apiKey = runtimeSecrets.getDeepseekApiKey();
  if (!apiKey || !anomalies.length) return null;

  const client = new OpenAI({
    apiKey,
    baseURL: String(process.env.DEEPSEEK_BASE_URL || runtimeSecrets.DEFAULT_DEEPSEEK_BASE_URL),
  });
  const model = String(process.env.DEEPSEEK_MODEL || runtimeSecrets.DEFAULT_DEEPSEEK_MODEL);

  const anomalyData = anomalies.map((a) => ({
    type: a.type,
    severity: a.severity,
    title: a.title,
    change_pct: a.change_pct,
    suggested_action: a.suggested_action,
  }));

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: ANALYSIS_PROMPT },
        { role: "user", content: JSON.stringify(anomalyData, null, 2) },
      ],
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: "json_object" },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) return null;

    return JSON.parse(content);
  } catch (err) {
    // LLM failures are non-critical
    return null;
  }
}

module.exports = { analyzeAnomalies };
