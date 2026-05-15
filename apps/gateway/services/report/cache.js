"use strict";

// ============================================================================
// 缓存 TTL（毫秒）
// ============================================================================

const REPORT_CACHE_TTL_MS = readPositiveInt(process.env.REPORT_CACHE_TTL_MS, 5 * 60 * 1000);
const REPORT_CACHE_MAX_ENTRIES = readPositiveInt(process.env.REPORT_CACHE_MAX_ENTRIES, 120);
const DAILY_UNION_CACHE_TTL_MS = readPositiveInt(process.env.DAILY_UNION_CACHE_TTL_MS, REPORT_CACHE_TTL_MS);
const DATE_CHOICES_CACHE_TTL_MS = readPositiveInt(process.env.DATE_CHOICES_CACHE_TTL_MS, REPORT_CACHE_TTL_MS);
const DASHBOARD_CACHE_TTL_MS = readPositiveInt(process.env.DASHBOARD_CACHE_TTL_MS, REPORT_CACHE_TTL_MS);
const CHANNEL_DASHBOARD_CACHE_TTL_MS = readPositiveInt(process.env.CHANNEL_DASHBOARD_CACHE_TTL_MS, REPORT_CACHE_TTL_MS);

// ============================================================================
// 模块级 Map（跨 require 单例 —— 依赖 Node require 缓存）
// ============================================================================

const DAILY_UNION_CACHE = new Map();
const DASHBOARD_OVERVIEW_CACHE = new Map();
const DASHBOARD_OVERVIEW_IN_FLIGHT = new Map();
const CHANNEL_DASHBOARD_CACHE = new Map();

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// ============================================================================
// daily union cache（D 块）
// ============================================================================

function makeDailyUnionCacheKey(dateFrom, dateTo) {
  return `${dateFrom}|${dateTo}`;
}

function getDailyUnionCache(dateFrom, dateTo) {
  const key = makeDailyUnionCacheKey(dateFrom, dateTo);
  const cached = DAILY_UNION_CACHE.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - Number(cached.savedAt || 0) > DAILY_UNION_CACHE_TTL_MS) {
    DAILY_UNION_CACHE.delete(key);
    return null;
  }
  return cached.rows || null;
}

function setDailyUnionCache(dateFrom, dateTo, rows) {
  const key = makeDailyUnionCacheKey(dateFrom, dateTo);
  DAILY_UNION_CACHE.set(key, {
    savedAt: Date.now(),
    rows: Array.isArray(rows) ? rows : [],
  });
}

// ============================================================================
// channel dashboard cache（D 块）
// ============================================================================

function makeChannelDashboardCacheKey(dateFrom, dateTo, selectedChannelCodes, comparisonDateFrom = "", comparisonDateTo = "") {
  return `${dateFrom}|${dateTo}|${comparisonDateFrom}|${comparisonDateTo}|${(selectedChannelCodes || []).join(",")}`;
}

function getChannelDashboardCache(dateFrom, dateTo, selectedChannelCodes, comparisonDateFrom = "", comparisonDateTo = "") {
  const key = makeChannelDashboardCacheKey(dateFrom, dateTo, selectedChannelCodes, comparisonDateFrom, comparisonDateTo);
  const cached = CHANNEL_DASHBOARD_CACHE.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - Number(cached.savedAt || 0) > CHANNEL_DASHBOARD_CACHE_TTL_MS) {
    CHANNEL_DASHBOARD_CACHE.delete(key);
    return null;
  }
  return cached.payload || null;
}

function setChannelDashboardCache(dateFrom, dateTo, selectedChannelCodes, comparisonDateFrom, comparisonDateTo, payload) {
  const key = makeChannelDashboardCacheKey(dateFrom, dateTo, selectedChannelCodes, comparisonDateFrom, comparisonDateTo);
  CHANNEL_DASHBOARD_CACHE.set(key, {
    savedAt: Date.now(),
    payload,
  });
}

// ============================================================================
// dashboard overview cache（I 块）
// ============================================================================

function makeDashboardOverviewCacheKey(dateFrom, dateTo) {
  return `${dateFrom}|${dateTo}`;
}

function getDashboardOverviewCache(dateFrom, dateTo) {
  const key = makeDashboardOverviewCacheKey(dateFrom, dateTo);
  if (!key) {
    return null;
  }
  const cached = DASHBOARD_OVERVIEW_CACHE.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - Number(cached.savedAt || 0) > DASHBOARD_CACHE_TTL_MS) {
    DASHBOARD_OVERVIEW_CACHE.delete(key);
    return null;
  }
  return cached.payload || null;
}

function setDashboardOverviewCache(dateFrom, dateTo, payload) {
  const key = makeDashboardOverviewCacheKey(dateFrom, dateTo);
  if (!key) {
    return;
  }
  DASHBOARD_OVERVIEW_CACHE.set(key, {
    savedAt: Date.now(),
    payload,
  });
}

function clearReportCacheMaps() {
  DAILY_UNION_CACHE.clear();
  DASHBOARD_OVERVIEW_CACHE.clear();
  CHANNEL_DASHBOARD_CACHE.clear();
}

function getReportCacheMapStats() {
  return {
    daily_union: DAILY_UNION_CACHE.size,
    dashboard_overview: DASHBOARD_OVERVIEW_CACHE.size,
    dashboard_compare: 0,
    dashboard_drilldown: 0,
    channel_dashboard: CHANNEL_DASHBOARD_CACHE.size,
    channel_drilldown: 0,
  };
}

function getReportInFlightStats() {
  return {
    daily_union: 0,
    dashboard_overview: DASHBOARD_OVERVIEW_IN_FLIGHT.size,
    dashboard_compare: 0,
    dashboard_drilldown: 0,
    channel_dashboard: 0,
    channel_drilldown: 0,
  };
}

module.exports = {
  // TTL constants（暴露给 dateChoices.js 等需要的模块）
  REPORT_CACHE_TTL_MS,
  REPORT_CACHE_MAX_ENTRIES,
  DAILY_UNION_CACHE_TTL_MS,
  DATE_CHOICES_CACHE_TTL_MS,
  DASHBOARD_CACHE_TTL_MS,
  CHANNEL_DASHBOARD_CACHE_TTL_MS,
  // Maps（DASHBOARD_OVERVIEW_IN_FLIGHT 暴露给 overview.js 直接用）
  DAILY_UNION_CACHE,
  DASHBOARD_OVERVIEW_CACHE,
  DASHBOARD_OVERVIEW_IN_FLIGHT,
  CHANNEL_DASHBOARD_CACHE,
  // 函数
  makeDailyUnionCacheKey,
  getDailyUnionCache,
  setDailyUnionCache,
  makeChannelDashboardCacheKey,
  getChannelDashboardCache,
  setChannelDashboardCache,
  makeDashboardOverviewCacheKey,
  getDashboardOverviewCache,
  setDashboardOverviewCache,
  clearReportCacheMaps,
  getReportCacheMapStats,
  getReportInFlightStats,
};
