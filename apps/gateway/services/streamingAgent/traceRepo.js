"use strict";

const reportRepo = require("../reportRepo");

async function query(sql, params = []) {
  const pool = await reportRepo.getPool();
  return pool.query(sql, params);
}

function isMissingRuntimeTableError(err) {
  return err && (err.code === "42P01" || /agent_runs|agent_task_steps|agent_tool_calls|agent_artifacts/i.test(err.message || ""));
}

async function bestEffort(label, fn, fallback = null) {
  try {
    return await fn();
  } catch (err) {
    if (isMissingRuntimeTableError(err)) {
      return fallback;
    }
    throw err;
  }
}

async function createRun({ taskName, requestedBy, inputSnapshot }) {
  return bestEffort(
    "createRun",
    async () => {
      const result = await query(
        `
          insert into anta_daily.agent_runs (task_name, status, requested_by, input_snapshot, started_at)
          values ($1, 'running', $2, $3::jsonb, now())
          returning id, task_name, status, requested_by, started_at
        `,
        [taskName || "streaming-analysis", requestedBy || "anonymous", JSON.stringify(inputSnapshot || {})]
      );
      return result.rows[0] || null;
    },
    null
  );
}

async function updateRun(runId, { status, modelName, errorCode, errorMessage } = {}) {
  if (!runId) return;
  await bestEffort("updateRun", () =>
    query(
      `
        update anta_daily.agent_runs
        set status = $2,
            model_name = $3,
            error_code = $4,
            error_message = $5,
            ended_at = now()
        where id = $1
      `,
      [runId, status || "failed", modelName || null, errorCode || null, errorMessage || null]
    )
  );
}

async function createStep(runId, { stepName, stepOrder }) {
  if (!runId) return null;
  return bestEffort(
    "createStep",
    async () => {
      const result = await query(
        `
          insert into anta_daily.agent_task_steps (run_id, step_name, step_order, status, started_at)
          values ($1, $2, $3, 'running', now())
          returning id, step_name, step_order, status, started_at
        `,
        [runId, stepName, stepOrder]
      );
      return result.rows[0] || null;
    },
    null
  );
}

async function updateStep(stepId, { status } = {}) {
  if (!stepId) return;
  await bestEffort("updateStep", () =>
    query(
      `
        update anta_daily.agent_task_steps
        set status = $2, ended_at = now()
        where id = $1
      `,
      [stepId, status || "failed"]
    )
  );
}

async function recordToolCall(runId, stepId, { toolName, inputJson, outputJson, status, latencyMs }) {
  if (!runId) return;
  await bestEffort("recordToolCall", () =>
    query(
      `
        insert into anta_daily.agent_tool_calls
          (run_id, step_id, tool_name, input_json, output_json, status, latency_ms)
        values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
      `,
      [
        runId,
        stepId || null,
        toolName,
        JSON.stringify(inputJson || {}),
        JSON.stringify(outputJson || {}),
        status || "success",
        Math.max(0, Math.floor(Number(latencyMs) || 0)),
      ]
    )
  );
}

async function createArtifact(runId, { artifactType, contentJson }) {
  if (!runId) return;
  await bestEffort("createArtifact", () =>
    query(
      `
        insert into anta_daily.agent_artifacts (run_id, artifact_type, content_json)
        values ($1, $2, $3::jsonb)
      `,
      [runId, artifactType, JSON.stringify(contentJson || {})]
    )
  );
}

async function listRuns({ page = 1, pageSize = 20 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const offset = (safePage - 1) * safePageSize;
  return bestEffort(
    "listRuns",
    async () => {
      const [itemsResult, countResult] = await Promise.all([
        query(
          `
            select id, task_name, status, requested_by, model_name, input_snapshot,
                   started_at, ended_at, error_code, error_message, created_at
            from anta_daily.agent_runs
            order by created_at desc
            limit $1 offset $2
          `,
          [safePageSize, offset]
        ),
        query("select count(*)::int as total from anta_daily.agent_runs"),
      ]);
      return {
        items: itemsResult.rows || [],
        total: Number(countResult.rows[0]?.total || 0),
        page: safePage,
        pageSize: safePageSize,
        runtime_tables_ready: true,
      };
    },
    {
      items: [],
      total: 0,
      page: safePage,
      pageSize: safePageSize,
      runtime_tables_ready: false,
    }
  );
}

async function getRunDetail(runId) {
  const id = Number(runId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return bestEffort(
    "getRunDetail",
    async () => {
      const [runResult, stepsResult, callsResult, artifactsResult] = await Promise.all([
        query("select * from anta_daily.agent_runs where id = $1", [id]),
        query("select * from anta_daily.agent_task_steps where run_id = $1 order by step_order, id", [id]),
        query("select * from anta_daily.agent_tool_calls where run_id = $1 order by created_at, id", [id]),
        query("select * from anta_daily.agent_artifacts where run_id = $1 order by created_at, id", [id]),
      ]);
      if (!runResult.rows[0]) return null;
      return {
        run: runResult.rows[0],
        steps: stepsResult.rows || [],
        tool_calls: callsResult.rows || [],
        artifacts: artifactsResult.rows || [],
        runtime_tables_ready: true,
      };
    },
    null
  );
}

module.exports = {
  createRun,
  updateRun,
  createStep,
  updateStep,
  recordToolCall,
  createArtifact,
  listRuns,
  getRunDetail,
};
