"use strict";

const { OpenAI } = require("openai");
const { resolveSkillPrompt } = require("./agentSkills");
const runtimeSecrets = require("./runtimeSecrets");

const FORBIDDEN_KEY_TOKENS = ["sku", "style", "product_name", "货号", "款号", "品名"];
const DEFAULT_BASE_URL = runtimeSecrets.DEFAULT_DEEPSEEK_BASE_URL;
const DEFAULT_MODEL = runtimeSecrets.DEFAULT_DEEPSEEK_MODEL;

const SYSTEM_PROMPT = [
  "你是安踏电商经营分析助手。",
  "你只能基于输入的聚合经营指标进行分析，不得虚构数据。",
  "输出要简洁、可执行、数据驱动。",
  "如果数据不足，请明确指出并给出保守建议。",
].join("\n");

function walkObject(value, path, onVisit) {
  if (value === null || value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      walkObject(value[index], `${path}[${index}]`, onVisit);
    }
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      onVisit({ key, path: nextPath });
      walkObject(child, nextPath, onVisit);
    }
  }
}

function assertSafeOutboundMetrics(metrics) {
  let unsafePath = "";
  walkObject(metrics, "", ({ key, path }) => {
    const lowerKey = String(key || "").toLowerCase();
    if (FORBIDDEN_KEY_TOKENS.some((token) => lowerKey.includes(token))) {
      unsafePath = path;
    }
  });
  if (unsafePath) {
    throw new Error(`出站数据审计失败，检测到敏感字段: ${unsafePath}`);
  }
}

function pctText(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "N/A";
  }
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function buildUserPrompt(metrics, { skillName, promptText }) {
  const compact = {
    period: metrics.period,
    current: metrics.current,
    comparison: metrics.comparison,
    changes: metrics.changes,
    category_structure: metrics.category_structure,
    rising_categories: metrics.rising_categories,
    falling_categories: metrics.falling_categories,
    stockout_risk_summary: metrics.stockout_risk_summary,
    slow_movers_summary: metrics.slow_movers_summary,
  };

  return [
    `请基于以下 ${metrics.period.type} 周期经营数据生成复盘报告（${metrics.period.start} 至 ${metrics.period.end}）。`,
    `对比周期：${metrics.period.comparison_start} 至 ${metrics.period.comparison_end}。`,
    "",
    "本次分析技能：",
    `- ${skillName || "经营总览"}`,
    "",
    "本次补充要求：",
    promptText || "请按默认经营总览模板输出。",
    "",
    "输入数据（JSON）：",
    "```json",
    JSON.stringify(compact, null, 2),
    "```",
    "",
    "输出要求（Markdown）：",
    "1) 核心指标摘要：用表格给出本期、对比期、变化率与一句话评价。",
    "2) 变化归因：3-5条，必须引用具体数字（可用百分比）。",
    "3) 品类动态：上升品类与下降品类各给出重点观察。",
    "4) 库存风险预警：缺货风险与滞销风险分别说明优先级。",
    "5) 可执行清单：用表格给出优先级、动作、对象、建议、预期效果。",
    "",
    "动作类型仅限：补货 / 调拨 / 下架 / 加推 / 降推 / 改价。",
    `提示：如果变化率为 N/A（如对比期为 0），请在结论中说明。当前 GMV 变化率 ${pctText(
      metrics?.changes?.gmv_pct
    )}。`,
  ].join("\n");
}

async function generateAnalysisReport({ metrics, skillId, promptText }) {
  assertSafeOutboundMetrics(metrics);

  const promptConfig = resolveSkillPrompt(skillId, promptText);
  const apiKey = runtimeSecrets.getDeepseekApiKey();
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY 未配置，无法生成 AI 报告。");
  }

  const client = new OpenAI({
    apiKey,
    baseURL: String(process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL),
  });

  const completion = await client.chat.completions.create(
    {
      model: String(process.env.DEEPSEEK_MODEL || DEFAULT_MODEL),
      temperature: 0.3,
      max_tokens: 4000,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: buildUserPrompt(metrics, {
            skillName: promptConfig.skill_name,
            promptText: promptConfig.prompt_text,
          }),
        },
      ],
    },
    { timeout: 90000 }
  );

  const content = completion?.choices?.[0]?.message?.content;
  const reportMd = Array.isArray(content)
    ? content.map((item) => item?.text || "").join("\n").trim()
    : String(content || "").trim();
  if (!reportMd) {
    throw new Error("DeepSeek 返回内容为空。");
  }

  return {
    report_md: reportMd,
    model: completion?.model || String(process.env.DEEPSEEK_MODEL || DEFAULT_MODEL),
    skill_id: promptConfig.skill_id,
    skill_name: promptConfig.skill_name,
    prompt_text: promptConfig.prompt_text,
  };
}

module.exports = {
  generateAnalysisReport,
  assertSafeOutboundMetrics,
};
