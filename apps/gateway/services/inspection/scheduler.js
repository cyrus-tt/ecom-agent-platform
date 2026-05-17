"use strict";

const cron = require("node-cron");
const engine = require("./engine");
const proposals = require("./proposals");

let task = null;

function start(pool, logger) {
  let schedule = process.env.INSPECTION_CRON || "0 9 * * *";
  if (!cron.validate(schedule)) {
    logger.warn({ schedule }, "Invalid INSPECTION_CRON, using default");
    schedule = "0 9 * * *";
  }

  task = cron.schedule(
    schedule,
    async () => {
      logger.info("Daily inspection started");
      try {
        const result = await engine.runInspection(pool);
        const inspectionId = await persistResult(pool, result, logger);
        if (inspectionId && result.anomalies.length) {
          const generated = proposals.generateProposals(result.anomalies);
          const persisted = await proposals.persistProposals(pool, inspectionId, generated);
          await proposals.autoExecuteLowMedium(pool, persisted);
          logger.info({ proposals: persisted.length, pending: persisted.filter(p => p.status === "pending").length }, "Proposals generated");
        }
        logger.info({ anomaly_count: result.anomaly_count, status: result.status }, "Daily inspection completed");
      } catch (err) {
        logger.error({ err }, "Daily inspection failed");
      }
    },
    { timezone: "Asia/Shanghai" }
  );

  logger.info({ schedule }, "Inspection scheduler registered");
}

function stop() {
  if (task) {
    task.stop();
    task = null;
  }
}

async function runNow(pool, logger) {
  logger.info("Daily inspection started (manual)");
  try {
    const result = await engine.runInspection(pool);
    const inspectionId = await persistResult(pool, result, logger);
    if (inspectionId && result.anomalies.length) {
      const generated = proposals.generateProposals(result.anomalies);
      const persisted = await proposals.persistProposals(pool, inspectionId, generated);
      await proposals.autoExecuteLowMedium(pool, persisted);
      result.proposals = persisted;
      logger.info({ proposals: persisted.length }, "Proposals generated (manual)");
    }
    logger.info({ anomaly_count: result.anomaly_count, status: result.status }, "Daily inspection completed (manual)");
    return result;
  } catch (err) {
    logger.error({ err }, "Daily inspection failed (manual)");
    throw err;
  }
}

async function persistResult(pool, result, logger) {
  if (!pool || result.status === "skipped") return null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const inspRow = await client.query(
      `INSERT INTO anta_daily.agent_inspections (run_date, anomaly_count, summary, findings, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        result.run_date,
        result.anomaly_count,
        result.summary,
        JSON.stringify(result.anomalies),
        result.status || "completed",
      ]
    );

    const inspectionId = inspRow.rows[0].id;

    for (const a of result.anomalies) {
      const aRow = await client.query(
        `INSERT INTO anta_daily.agent_anomalies
         (inspection_id, type, severity, title, description,
          metric_current, metric_previous, change_pct, suggested_action)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          inspectionId,
          a.type,
          a.severity,
          a.title,
          a.description,
          a.metric_current,
          a.metric_previous,
          a.change_pct,
          a.suggested_action,
        ]
      );
      a.id = aRow.rows[0].id;
    }

    await client.query("COMMIT");
    return inspectionId;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "42P01") {
      logger.warn("Inspection tables not found, skipping persist");
    } else {
      throw err;
    }
    return null;
  } finally {
    client.release();
  }
}

module.exports = { start, stop, runNow };
