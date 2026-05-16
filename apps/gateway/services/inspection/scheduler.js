"use strict";

const cron = require("node-cron");
const engine = require("./engine");

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
        await persistResult(pool, result, logger);
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
    await persistResult(pool, result, logger);
    logger.info({ anomaly_count: result.anomaly_count, status: result.status }, "Daily inspection completed (manual)");
    return result;
  } catch (err) {
    logger.error({ err }, "Daily inspection failed (manual)");
    throw err;
  }
}

async function persistResult(pool, result, logger) {
  if (!pool || result.status === "skipped") return;

  try {
    const inspRow = await pool.query(
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
      await pool.query(
        `INSERT INTO anta_daily.agent_anomalies
         (inspection_id, type, severity, title, description,
          metric_current, metric_previous, change_pct, suggested_action)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
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
    }
  } catch (err) {
    // Best-effort: tables may not exist yet in dev/fixture mode
    if (err.code === "42P01") {
      logger.warn("Inspection tables not found, skipping persist");
    } else {
      throw err;
    }
  }
}

module.exports = { start, stop, runNow };
