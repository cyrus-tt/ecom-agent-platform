import http from "./http";

/* ============ report-daily ============ */

/**
 * GET /api/report-daily/dates — 可选销售日期 + 默认日期
 */
export async function getDailyReportDates() {
  const resp = await http.get("/api/report-daily/dates", { params: { _t: Date.now() } });
  return resp.data;
}

/**
 * GET /api/report-daily/meta
 * @param {{ dateFrom: string, dateTo: string }} params
 */
export async function getDailyReportMeta({ dateFrom, dateTo }) {
  const resp = await http.get("/api/report-daily/meta", {
    params: { dateFrom, dateTo, _t: Date.now() },
  });
  return resp.data;
}

/**
 * GET /api/report-daily/rows
 * @param {{ dateFrom: string, dateTo: string, page?: number, pageSize?: number, keyword?: string }} params
 */
export async function getDailyReportRows({ dateFrom, dateTo, page, pageSize, keyword }) {
  const resp = await http.get("/api/report-daily/rows", {
    params: {
      dateFrom,
      dateTo,
      page,
      pageSize,
      keyword: keyword || undefined,
      _t: Date.now(),
    },
  });
  return resp.data;
}

/**
 * 拼日报 XLSB 导出 URL（直接 window.open 用）
 * @param {{ dateFrom: string, dateTo: string }} params
 * @returns {string}
 */
export function dailyReportExportUrl({ dateFrom, dateTo }) {
  return `/api/report-daily/export.xlsb?dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`;
}

/* ============ dashboard ============ */

export async function getDashboardDates() {
  const resp = await http.get("/api/dashboard/dates", { params: { _t: Date.now() } });
  return resp.data;
}

/**
 * @param {{ dateFrom: string, dateTo: string }} params
 */
export async function getDashboardOverview({ dateFrom, dateTo }) {
  const resp = await http.get("/api/dashboard/overview", {
    params: { date_from: dateFrom, date_to: dateTo, _t: Date.now() },
  });
  return resp.data;
}

/**
 * @param {{ dateFrom: string, dateTo: string, channels?: string[] }} params
 */
export async function getDashboardChannelCompare({ dateFrom, dateTo, channels }) {
  const resp = await http.get("/api/dashboard/channel-compare", {
    params: {
      date_from: dateFrom,
      date_to: dateTo,
      channels: Array.isArray(channels) && channels.length ? channels.join(",") : undefined,
      _t: Date.now(),
    },
  });
  return resp.data;
}

/**
 * @param {{ anchorDate: string, dateFrom: string, dateTo: string, category?: string, level?: string, style?: string, page?: number, pageSize?: number }} params
 */
export async function getDashboardDrilldown({ anchorDate, dateFrom, dateTo, category, level, style, page, pageSize }) {
  const resp = await http.get("/api/dashboard/drilldown", {
    params: {
      anchor_date: anchorDate,
      date_from: dateFrom,
      date_to: dateTo,
      category: category || undefined,
      level: level || undefined,
      style: style || undefined,
      page,
      pageSize,
      _t: Date.now(),
    },
  });
  return resp.data;
}

/* ============ channel-dashboard ============ */

/**
 * @param {{ dateFrom: string, dateTo: string, comparisonDateFrom?: string, comparisonDateTo?: string, channels?: string[] }} params
 */
export async function getChannelDashboard({ dateFrom, dateTo, comparisonDateFrom, comparisonDateTo, channels }) {
  const resp = await http.get("/api/channel-dashboard", {
    params: {
      date_from: dateFrom,
      date_to: dateTo,
      comparison_date_from: comparisonDateFrom || undefined,
      comparison_date_to: comparisonDateTo || undefined,
      channels: Array.isArray(channels) && channels.length ? channels.join(",") : undefined,
      _t: Date.now(),
    },
  });
  return resp.data;
}

/* ============ health ============ */

export async function getHealth() {
  const resp = await http.get("/api/health", { params: { _t: Date.now() } });
  return resp.data;
}
