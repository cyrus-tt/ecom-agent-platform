"use strict";

/**
 * Daily digest — generates a concise morning briefing message
 * suitable for push notification (DingTalk / WeChat Work / email).
 *
 * Called by the scheduler after inspection + proposals are done.
 * Output is a plain-text/markdown message ready to send.
 */

async function buildDigest(pool) {
  if (!pool) return null;

  const sections = [];

  // 1. Today's inspection summary
  const inspResult = await safeQuery(pool,
    `SELECT anomaly_count, summary, created_at
       FROM anta_daily.agent_inspections
      WHERE run_date = current_date
      ORDER BY created_at DESC LIMIT 1`
  );
  const inspection = inspResult.rows[0];

  if (!inspection) {
    return null; // No inspection today yet
  }

  sections.push(`📊 **今日巡检** (${new Date(inspection.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })})`);
  sections.push(inspection.summary || "无异常");

  // 2. Critical anomalies (top 3)
  const critResult = await safeQuery(pool,
    `SELECT title, change_pct
       FROM anta_daily.agent_anomalies a
       JOIN anta_daily.agent_inspections i ON i.id = a.inspection_id
      WHERE i.run_date = current_date AND a.severity = 'critical'
      ORDER BY abs(a.change_pct) DESC NULLS LAST
      LIMIT 3`
  );
  if (critResult.rows.length) {
    sections.push("");
    sections.push("🔴 **严重异常：**");
    for (const row of critResult.rows) {
      const pct = row.change_pct != null ? ` (${row.change_pct > 0 ? "+" : ""}${row.change_pct}%)` : "";
      sections.push(`• ${row.title}${pct}`);
    }
  }

  // 3. Pending proposals requiring action
  const pendingResult = await safeQuery(pool,
    `SELECT count(*)::int AS cnt
       FROM anta_daily.agent_proposals
      WHERE status = 'pending'`
  );
  const pendingCount = pendingResult.rows[0]?.cnt || 0;
  if (pendingCount > 0) {
    sections.push("");
    sections.push(`⚡ **${pendingCount} 个建议待审批** — 请打开操控台处理`);
  }

  // 4. Effect tracking wins (yesterday's evaluations)
  const winsResult = await safeQuery(pool,
    `SELECT count(*)::int AS cnt
       FROM anta_daily.agent_effects
      WHERE outcome = 'improved'
        AND evaluated_at >= current_date - interval '1 day'`
  );
  const wins = winsResult.rows[0]?.cnt || 0;
  if (wins > 0) {
    sections.push("");
    sections.push(`✅ 昨日 ${wins} 条建议验证有效`);
  }

  // 5. Overall health indicator
  const totalEffects = await safeQuery(pool,
    `SELECT
       count(*) FILTER (WHERE outcome = 'improved')::int AS improved,
       count(*) FILTER (WHERE outcome != 'pending')::int AS evaluated
     FROM anta_daily.agent_effects`
  );
  const eff = totalEffects.rows[0];
  if (eff && eff.evaluated > 0) {
    const rate = Math.round((eff.improved / eff.evaluated) * 100);
    sections.push("");
    sections.push(`📈 累计建议有效率：${rate}% (${eff.improved}/${eff.evaluated})`);
  }

  return sections.join("\n");
}

async function safeQuery(pool, sql, params) {
  try {
    return await pool.query(sql, params);
  } catch (err) {
    if (err.code === "42P01") return { rows: [] };
    throw err;
  }
}

module.exports = { buildDigest };
