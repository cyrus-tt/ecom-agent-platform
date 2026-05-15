"use strict";

const { getPool, timedQuery } = require("../../lib/db");
const { toDateText } = require("./shared/dateUtils");

let analysisTableReadyPromise = null;

async function ensureAnalysisReportsTable() {
  if (analysisTableReadyPromise) {
    return analysisTableReadyPromise;
  }

  analysisTableReadyPromise = (async () => {
    const pool = await getPool();
    await timedQuery(
      pool,
      `
        create table if not exists anta_daily.analysis_reports (
          id serial primary key,
          period_type text not null,
          period_start date not null,
          period_end date not null,
          skill_id text,
          skill_name text,
          prompt_text text,
          metrics_json jsonb,
          report_md text not null,
          status text not null,
          error_msg text,
          created_at timestamptz not null default now()
        )
      `,
      [],
      "ensureAnalysisReportsTable.create"
    );

    await timedQuery(
      pool,
      `
        alter table anta_daily.analysis_reports
        add column if not exists skill_id text,
        add column if not exists skill_name text,
        add column if not exists prompt_text text
      `,
      [],
      "ensureAnalysisReportsTable.alter"
    );

    await timedQuery(
      pool,
      `
        create index if not exists idx_analysis_reports_created_at
        on anta_daily.analysis_reports (created_at desc)
      `,
      [],
      "ensureAnalysisReportsTable.index"
    );
  })().catch((err) => {
    analysisTableReadyPromise = null;
    throw err;
  });

  return analysisTableReadyPromise;
}

async function createAnalysisReport({
  periodType,
  periodStart,
  periodEnd,
  skillId,
  skillName,
  promptText,
  metricsJson,
  reportMd,
  status,
  errorMsg,
}) {
  await ensureAnalysisReportsTable();
  const pool = await getPool();
  const result = await timedQuery(
    pool,
    `
      insert into anta_daily.analysis_reports (
        period_type,
        period_start,
        period_end,
        skill_id,
        skill_name,
        prompt_text,
        metrics_json,
        report_md,
        status,
        error_msg
      ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
      returning id, period_type, period_start, period_end, skill_id, skill_name, prompt_text, status, error_msg, created_at
    `,
    [
      String(periodType || ""),
      String(periodStart || ""),
      String(periodEnd || ""),
      skillId ? String(skillId) : null,
      skillName ? String(skillName) : null,
      promptText ? String(promptText) : null,
      JSON.stringify(metricsJson || {}),
      String(reportMd || ""),
      String(status || "success"),
      errorMsg ? String(errorMsg) : null,
    ],
    "createAnalysisReport"
  );
  return result.rows[0] || null;
}

async function listAnalysisReports({ page, pageSize }) {
  await ensureAnalysisReportsTable();
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 10));
  const offset = (safePage - 1) * safePageSize;
  const pool = await getPool();

  const [countResult, rowsResult] = await Promise.all([
    timedQuery(
      pool,
      `
        select count(1) as total
        from anta_daily.analysis_reports
      `,
      [],
      "listAnalysisReports.count"
    ),
    timedQuery(
      pool,
      `
        select
          id,
          period_type,
          period_start,
          period_end,
          skill_name,
          status,
          created_at
        from anta_daily.analysis_reports
        order by created_at desc
        offset $1 limit $2
      `,
      [offset, safePageSize],
      "listAnalysisReports.rows"
    ),
  ]);

  const total = Number(countResult.rows[0]?.total || 0);
  const items = (rowsResult.rows || []).map((row) => ({
    id: Number(row.id),
    period_type: String(row.period_type || ""),
    period_start: toDateText(row.period_start),
    period_end: toDateText(row.period_end),
    skill_name: String(row.skill_name || ""),
    status: String(row.status || ""),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : "",
  }));
  return {
    items,
    total,
    page: safePage,
    pageSize: safePageSize,
  };
}

async function getAnalysisReportById(id) {
  await ensureAnalysisReportsTable();
  const reportId = Number(id);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    return null;
  }

  const pool = await getPool();
  const result = await timedQuery(
    pool,
    `
      select
        id,
        period_type,
        period_start,
        period_end,
        skill_id,
        skill_name,
        prompt_text,
        metrics_json,
        report_md,
        status,
        error_msg,
        created_at
      from anta_daily.analysis_reports
      where id = $1
      limit 1
    `,
    [reportId],
    "getAnalysisReportById"
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    period_type: String(row.period_type || ""),
    period_start: toDateText(row.period_start),
    period_end: toDateText(row.period_end),
    skill_id: String(row.skill_id || ""),
    skill_name: String(row.skill_name || ""),
    prompt_text: String(row.prompt_text || ""),
    metrics_json: row.metrics_json && typeof row.metrics_json === "object" ? row.metrics_json : {},
    report_md: String(row.report_md || ""),
    status: String(row.status || ""),
    error_msg: row.error_msg ? String(row.error_msg) : "",
    created_at: row.created_at ? new Date(row.created_at).toISOString() : "",
  };
}

module.exports = {
  ensureAnalysisReportsTable,
  createAnalysisReport,
  listAnalysisReports,
  getAnalysisReportById,
};
