"use strict";

// 顶层聚合：公共 API 与原 reportRepo.js module.exports 对齐

const { getPool } = require("../../lib/db");
const { SALES_DAILY_TABLE, SKU_FILTER_SQL } = require("./constants");
const {
  REPORT_CACHE_TTL_MS,
  REPORT_CACHE_MAX_ENTRIES,
  clearReportCacheMaps,
  getReportCacheMapStats,
  getReportInFlightStats,
} = require("./cache");
const {
  ensureAnalysisReportsTable,
  createAnalysisReport,
  listAnalysisReports,
  getAnalysisReportById,
} = require("./analysisReports");
const {
  getDashboardDateChoices,
  resolveDashboardAnchorDate,
  getDashboardOverview,
  getDashboardChannelCompare,
  getDashboardDrilldown,
  clearDateChoiceCaches,
  getDateChoiceCacheStats,
} = require("./dashboard");
const {
  getChannelDashboard,
  getChannelDashboardStyleDrilldown,
  getChannelDashboardAvailableChannels,
} = require("./channel");
const {
  getWeekChoices,
  resolveWeek,
  getReportMeta,
  getReportRows,
  getReportExportRows,
} = require("./weekly");
const {
  getDailyDateChoices,
  resolveDailyDate,
  resolveDailyRange,
  getDailyMeta,
  getDailyRangeMeta,
  getDailyRows,
  getDailyRowsRange,
  getDailyExportRows,
  getDailyExportRowsRange,
} = require("./daily");

function getCacheStats() {
  const dateChoiceStats = getDateChoiceCacheStats();
  return {
    ttl_ms: REPORT_CACHE_TTL_MS,
    max_entries: REPORT_CACHE_MAX_ENTRIES,
    caches: {
      ...getReportCacheMapStats(),
      ...dateChoiceStats.caches,
    },
    in_flight: {
      ...getReportInFlightStats(),
      ...dateChoiceStats.in_flight,
    },
  };
}

function clearReportCaches(reason = "manual") {
  const before = getCacheStats();
  clearReportCacheMaps();
  clearDateChoiceCaches();
  return {
    reason,
    cleared_at: new Date().toISOString(),
    before,
    after: getCacheStats(),
  };
}

function clearAllCaches(reason = "manual") {
  return clearReportCaches(reason);
}

async function getAvailableCategories() {
  const pool = await getPool();
  const result = await pool.query(`
    select distinct
      coalesce(nullif(trim(major_category), ''), '未分类') as major_category,
      coalesce(nullif(trim(category), ''), '未分类') as category
    from ${SALES_DAILY_TABLE}
    where ${SKU_FILTER_SQL}
    order by major_category, category
  `);
  return (result.rows || []).map((row) => ({
    major_category: row.major_category,
    category: row.category,
  }));
}

module.exports = {
  getPool,
  ensureAnalysisReportsTable,
  createAnalysisReport,
  listAnalysisReports,
  getAnalysisReportById,
  getDashboardDateChoices,
  resolveDashboardAnchorDate,
  getDashboardOverview,
  getDashboardChannelCompare,
  getDashboardDrilldown,
  getChannelDashboard,
  getChannelDashboardStyleDrilldown,
  getWeekChoices,
  resolveWeek,
  getReportMeta,
  getReportRows,
  getReportExportRows,
  getDailyDateChoices,
  resolveDailyDate,
  resolveDailyRange,
  getDailyMeta,
  getDailyRangeMeta,
  getDailyRows,
  getDailyRowsRange,
  getDailyExportRows,
  getDailyExportRowsRange,
  getChannelDashboardAvailableChannels,
  getAvailableCategories,
  getCacheStats,
  clearReportCaches,
  clearAllCaches,
};
