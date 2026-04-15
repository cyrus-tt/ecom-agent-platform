"use strict";

const fs = require("fs");
const path = require("path");
const appConfig = require("./appConfig");
const metricsService = require("./metricsService");
const reportRepo = require("./reportRepo");

function normalizePeriodType(value) {
  const text = String(value || "").trim().toLowerCase();
  if (text === "day" || text === "week" || text === "month") {
    return text;
  }
  return "week";
}

function normalizeRequest(input) {
  const body = input && typeof input === "object" ? input : {};
  return {
    periodType: normalizePeriodType(body.periodType || body.period_type),
    startDate: String(body.startDate || body.start_date || "").trim(),
    endDate: String(body.endDate || body.end_date || "").trim(),
  };
}

function buildQueryString(params) {
  const searchParams = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    const text = String(value || "").trim();
    if (text) {
      searchParams.set(key, text);
    }
  });
  return searchParams.toString();
}

function normalizeRecentReports(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    id: Number(item?.id || 0),
    period_type: String(item?.period_type || ""),
    period_start: String(item?.period_start || ""),
    period_end: String(item?.period_end || ""),
    skill_name: String(item?.skill_name || ""),
    status: String(item?.status || ""),
    created_at: String(item?.created_at || ""),
  }));
}

function buildContextPayload({ mode, source, request, metrics, recentReports = [] }) {
  return {
    ok: true,
    mode,
    source,
    generated_at: new Date().toISOString(),
    request: {
      period_type: request.periodType,
      start_date: request.startDate,
      end_date: request.endDate,
    },
    period: metrics?.period || {},
    metrics,
    recent_reports: normalizeRecentReports(recentReports),
  };
}

async function getLocalContext(input) {
  const request = normalizeRequest(input);
  const [metrics, reportList] = await Promise.all([
    metricsService.calculateMetrics(request),
    reportRepo.listAnalysisReports({ page: 1, pageSize: 10 }),
  ]);
  return buildContextPayload({
    mode: "local",
    source: "local-postgres",
    request,
    metrics,
    recentReports: reportList?.items || [],
  });
}

async function getRemoteContext(input) {
  const request = normalizeRequest(input);
  const remoteUrl = new URL("/api/agent/context", appConfig.agentRemoteBaseUrl);
  const query = buildQueryString({
    period_type: request.periodType,
    start_date: request.startDate,
    end_date: request.endDate,
  });
  if (query) {
    remoteUrl.search = query;
  }

  const headers = {
    Accept: "application/json",
  };
  if (appConfig.agentRemoteReadToken) {
    headers.Authorization = `Bearer ${appConfig.agentRemoteReadToken}`;
  }

  const response = await fetch(remoteUrl, {
    method: "GET",
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(appConfig.agentRemoteTimeoutMs),
  });
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch (_err) {
    payload = null;
  }
  if (!response.ok || !payload || payload.ok === false) {
    throw new Error(
      payload?.message ||
        `remote context request failed: ${response.status} ${response.statusText}`.trim()
    );
  }

  return {
    ...payload,
    mode: "remote",
    source: payload?.source || remoteUrl.origin,
  };
}

function loadFixturePayload() {
  const fixturePath = path.resolve(appConfig.agentFixturePath);
  const raw = fs.readFileSync(fixturePath, "utf8");
  const payload = JSON.parse(raw);
  return { payload, fixturePath };
}

async function getFixtureContext(input) {
  const request = normalizeRequest(input);
  const { payload, fixturePath } = loadFixturePayload();
  const metrics = payload?.metrics && typeof payload.metrics === "object" ? payload.metrics : {};
  return buildContextPayload({
    mode: "fixture",
    source: fixturePath,
    request,
    metrics,
    recentReports: payload?.recent_reports || [],
  });
}

async function getContext(input) {
  const mode = appConfig.agentDataMode;
  if (mode === "remote") {
    return getRemoteContext(input);
  }
  if (mode === "fixture") {
    return getFixtureContext(input);
  }
  return getLocalContext(input);
}

module.exports = {
  getContext,
  getLocalContext,
  getRemoteContext,
  getFixtureContext,
};
