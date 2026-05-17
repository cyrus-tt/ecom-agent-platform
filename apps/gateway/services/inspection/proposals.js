"use strict";

/**
 * Proposal engine — generates actionable proposals from detected anomalies,
 * applies risk-based routing (auto-execute vs. approval queue).
 *
 * Risk levels:
 *   low    → auto-execute immediately (acknowledge, no user action needed)
 *   medium → auto-execute + record in timeline (notify)
 *   high   → queue for explicit user approval (inventory/promotion changes)
 */

const ACTION_RULES = [
  {
    anomalyType: "sales_drop_dod",
    severityMin: "critical",
    riskLevel: "high",
    actionType: "investigate",
    titleFn: (a) => `排查${a.title.split("渠道")[0]}渠道异常下跌`,
    buildAction: (a) => ({
      operation: "flag_for_investigation",
      channel: a.title.split("渠道")[0],
      severity: a.severity,
      context: a.description,
    }),
  },
  {
    anomalyType: "sales_drop_dod",
    severityMin: "warning",
    riskLevel: "medium",
    actionType: "notify",
    titleFn: (a) => `发送${a.title.split("渠道")[0]}渠道预警通知`,
    buildAction: (a) => ({
      operation: "send_alert",
      channel: a.title.split("渠道")[0],
      message: `⚠️ ${a.title}`,
      context: a.description,
    }),
  },
  {
    anomalyType: "sales_drop_wow",
    severityMin: "critical",
    riskLevel: "high",
    actionType: "investigate",
    titleFn: (a) => `排查${a.title.split("渠道")[0]}渠道周趋势异常`,
    buildAction: (a) => ({
      operation: "flag_for_investigation",
      channel: a.title.split("渠道")[0],
      severity: a.severity,
      context: a.description,
    }),
  },
  {
    anomalyType: "sales_drop_wow",
    severityMin: "warning",
    riskLevel: "medium",
    actionType: "notify",
    titleFn: (a) => `发送${a.title.split("渠道")[0]}渠道周环比预警`,
    buildAction: (a) => ({
      operation: "send_alert",
      channel: a.title.split("渠道")[0],
      message: `⚠️ ${a.title}`,
      context: a.description,
    }),
  },
  {
    anomalyType: "zero_sales_sku",
    severityMin: "warning",
    riskLevel: "high",
    actionType: "adjust_inventory",
    titleFn: (a) => `建议处理${a.title.split("有")[0]}滞销SKU`,
    buildAction: (a) => ({
      operation: "suggest_clearance",
      category: a.description.match(/品类 (.+?) 中/)?.[1] || "未知",
      sku_count: a.metric_current,
      suggestion: a.suggested_action,
    }),
  },
  {
    anomalyType: "new_product_underperform",
    severityMin: "warning",
    riskLevel: "high",
    actionType: "create_promotion",
    titleFn: (a) => `建议为滞销新品制定推广方案`,
    buildAction: (a) => ({
      operation: "suggest_promotion",
      sku_count: a.metric_current,
      age_bucket: a.title.match(/上架(.+?)仍/)?.[1] || "",
      suggestion: a.suggested_action,
    }),
  },
  {
    anomalyType: "new_product_underperform",
    severityMin: "info",
    riskLevel: "low",
    actionType: "acknowledge",
    titleFn: (a) => `记录新品观察期异常`,
    buildAction: (a) => ({
      operation: "acknowledge_observation",
      sku_count: a.metric_current,
      note: "新品上架初期，持续观察",
    }),
  },
];

const SEVERITY_RANK = { critical: 3, warning: 2, info: 1 };

function severityGte(actual, minimum) {
  return (SEVERITY_RANK[actual] || 0) >= (SEVERITY_RANK[minimum] || 0);
}

function generateProposals(anomalies) {
  const proposals = [];
  for (const anomaly of anomalies) {
    const matchedRules = ACTION_RULES.filter(
      (r) =>
        r.anomalyType === anomaly.type && severityGte(anomaly.severity, r.severityMin)
    );
    const rule = matchedRules[0];
    if (!rule) continue;

    proposals.push({
      anomaly_id: anomaly.id || null,
      risk_level: rule.riskLevel,
      action_type: rule.actionType,
      title: rule.titleFn(anomaly),
      description: anomaly.suggested_action,
      proposed_action: rule.buildAction(anomaly),
    });
  }
  return proposals;
}

async function persistProposals(pool, inspectionId, proposals) {
  if (!pool || !proposals.length) return [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const persisted = [];
    for (const p of proposals) {
      const { rows } = await client.query(
        `INSERT INTO anta_daily.agent_proposals
         (anomaly_id, inspection_id, risk_level, action_type, title, description, proposed_action, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, status`,
        [
          p.anomaly_id,
          inspectionId,
          p.risk_level,
          p.action_type,
          p.title,
          p.description,
          JSON.stringify(p.proposed_action),
          p.risk_level === "high" ? "pending" : "approved",
        ]
      );
      persisted.push({ ...p, id: rows[0].id, status: rows[0].status });
    }

    await client.query("COMMIT");
    return persisted;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "42P01") return [];
    throw err;
  } finally {
    client.release();
  }
}

async function executeProposal(pool, proposalId) {
  if (!pool) return null;

  const { rows } = await pool.query(
    `SELECT * FROM anta_daily.agent_proposals WHERE id = $1`,
    [proposalId]
  );
  if (!rows.length) return null;
  const proposal = rows[0];

  if (proposal.status !== "approved") {
    return { error: "proposal not in approved state" };
  }

  const action = typeof proposal.proposed_action === "string"
    ? JSON.parse(proposal.proposed_action)
    : proposal.proposed_action;

  let result;
  try {
    result = await runAction(action);
  } catch (err) {
    await pool.query(
      `UPDATE anta_daily.agent_proposals SET status = 'failed', execution_result = $2 WHERE id = $1`,
      [proposalId, JSON.stringify({ error: err.message })]
    );
    return { error: err.message };
  }

  await pool.query(
    `UPDATE anta_daily.agent_proposals SET status = 'executed', execution_result = $2 WHERE id = $1`,
    [proposalId, JSON.stringify(result)]
  );

  if (proposal.anomaly_id) {
    await pool.query(
      `UPDATE anta_daily.agent_anomalies SET status = 'resolved' WHERE id = $1`,
      [proposal.anomaly_id]
    ).catch(() => {});

    // Record baseline for effect tracking
    try {
      const effects = require("./effects");
      const anomalyResult = await pool.query(
        `SELECT * FROM anta_daily.agent_anomalies WHERE id = $1`,
        [proposal.anomaly_id]
      );
      if (anomalyResult.rows[0]) {
        await effects.recordBaseline(pool, proposal, anomalyResult.rows[0]);
      }
    } catch (_) { /* effect tracking is best-effort */ }
  }

  return result;
}

async function runAction(action) {
  switch (action.operation) {
    case "acknowledge_observation":
      return { executed: true, note: "Anomaly acknowledged and logged" };
    case "send_alert":
      return { executed: true, note: `Alert queued: ${action.message}` };
    case "flag_for_investigation":
      return { executed: true, note: `Investigation flag set for ${action.channel}` };
    case "suggest_clearance":
      return { executed: true, note: `Clearance suggestion recorded for ${action.category} (${action.sku_count} SKUs)` };
    case "suggest_promotion":
      return { executed: true, note: `Promotion suggestion recorded for ${action.sku_count} underperforming SKUs` };
    default:
      return { executed: true, note: `Action recorded: ${action.operation}` };
  }
}

async function autoExecuteLowMedium(pool, proposals) {
  const autoExec = proposals.filter((p) => p.risk_level !== "high" && p.status === "approved");
  for (const p of autoExec) {
    await executeProposal(pool, p.id);
  }
}

module.exports = { generateProposals, persistProposals, executeProposal, autoExecuteLowMedium };
