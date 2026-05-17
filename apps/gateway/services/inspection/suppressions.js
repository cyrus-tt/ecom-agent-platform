"use strict";

/**
 * Suppression learning — reduces noise by learning from user acknowledgments.
 *
 * When a user acknowledges an anomaly, the system records the pattern.
 * Future inspections check against active suppressions before reporting.
 *
 * Suppression types:
 *   - channel-specific: "don't alert on women channel drops < 15%"
 *   - time-limited: "suppress for 7 days" (promotion window)
 *   - permanent: "this SKU category always has zero sales"
 */

const DEFAULT_EXPIRY_DAYS = 7;

async function getActiveSuppressions(pool) {
  if (!pool) return [];

  try {
    const { rows } = await pool.query(
      `SELECT anomaly_type, pattern
         FROM anta_daily.agent_suppressions
        WHERE expires_at IS NULL OR expires_at > now()`
    );
    return rows;
  } catch (err) {
    if (err.code === "42P01") return [];
    throw err;
  }
}

function shouldSuppress(anomaly, suppressions) {
  for (const rule of suppressions) {
    if (rule.anomaly_type !== anomaly.type) continue;

    const pattern = typeof rule.pattern === "string"
      ? JSON.parse(rule.pattern)
      : rule.pattern;

    if (matchesPattern(anomaly, pattern)) return true;
  }
  return false;
}

function matchesPattern(anomaly, pattern) {
  if (pattern.channel) {
    const titleChannel = anomaly.title?.match(/^(.+?)渠道/)?.[1];
    if (titleChannel !== pattern.channel) return false;
  }

  if (pattern.min_change_pct != null && anomaly.change_pct != null) {
    if (Math.abs(anomaly.change_pct) < Math.abs(pattern.min_change_pct)) return false;
  }

  if (pattern.max_change_pct != null && anomaly.change_pct != null) {
    if (Math.abs(anomaly.change_pct) > Math.abs(pattern.max_change_pct)) return true;
  }

  if (pattern.severity && anomaly.severity !== pattern.severity) return false;

  return true;
}

async function learnFromAcknowledgment(pool, anomaly, reason) {
  if (!pool || !anomaly) return null;

  const pattern = extractPattern(anomaly);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + DEFAULT_EXPIRY_DAYS);

  try {
    const { rows } = await pool.query(
      `INSERT INTO anta_daily.agent_suppressions
       (anomaly_type, pattern, reason, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [anomaly.type, JSON.stringify(pattern), reason || "user acknowledged", expiresAt, "system"]
    );
    return rows[0]?.id || null;
  } catch (err) {
    if (err.code === "42P01") return null;
    throw err;
  }
}

function extractPattern(anomaly) {
  const pattern = {};

  const channelMatch = anomaly.title?.match(/^(.+?)渠道/);
  if (channelMatch) {
    pattern.channel = channelMatch[1];
  }

  if (anomaly.change_pct != null) {
    pattern.max_change_pct = Math.abs(anomaly.change_pct);
  }

  if (anomaly.severity) {
    pattern.severity = anomaly.severity;
  }

  return pattern;
}

function filterSuppressed(anomalies, suppressions) {
  if (!suppressions.length) return anomalies;
  return anomalies.filter((a) => !shouldSuppress(a, suppressions));
}

module.exports = {
  getActiveSuppressions,
  shouldSuppress,
  filterSuppressed,
  learnFromAcknowledgment,
};
