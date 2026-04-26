"use strict";

// 顶层聚合：26 个公共 API（与原 reportRepo.js module.exports 完全对齐）

const { getPool } = require("../../lib/db");
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
} = require("./dashboard");
const {
  getChannelDashboard,
  getChannelDashboardStyleDrilldown,
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
};
