"use strict";

const { getPool, timedQuery } = require("../../../lib/db");
const {
  normalizeDateInput,
  normalizeDailyRangeInput,
  buildDefaultDateRangeFromChoices,
  buildAnchorDateRange,
  daysBetweenInclusive,
  shiftDateText,
} = require("../shared/dateUtils");
const { SALES_HISTORY_TABLE, SALES_DAILY_TABLE, SKU_FILTER_SQL } = require("../constants");
const { DATE_CHOICES_CACHE_TTL_MS, DASHBOARD_CACHE_TTL_MS } = require("../cache");

let dateChoicesPromise = null;
let dashboardDatesPromise = null;
let dateChoicesCache = {
  savedAt: 0,
  payload: null,
};
let dashboardDatesCache = {
  savedAt: 0,
  payload: null,
};

async function getDateChoices() {
  if (dateChoicesCache.payload && Date.now() - Number(dateChoicesCache.savedAt || 0) <= DATE_CHOICES_CACHE_TTL_MS) {
    return dateChoicesCache.payload;
  }
  if (dateChoicesPromise) {
    return dateChoicesPromise;
  }

  const pool = await getPool();
  dateChoicesPromise = (async () => {
    try {
      const result = await timedQuery(
        pool,
        `
          select to_char(sales_date, 'YYYY-MM-DD') as sales_date
          from ${SALES_DAILY_TABLE}
          where ${SKU_FILTER_SQL}
          group by sales_date
          order by sales_date desc
        `,
        [],
        "getDateChoices"
      );
      const salesDates = result.rows.map((row) => row.sales_date).filter(Boolean);
      const payload = { salesDates, defaultSalesDate: salesDates[0] || "" };
      dateChoicesCache = {
        savedAt: Date.now(),
        payload,
      };
      return payload;
    } catch (_err) {
      const fallback = await timedQuery(
        pool,
        `
          select to_char(sales_date, 'YYYY-MM-DD') as sales_date
          from ${SALES_HISTORY_TABLE}
          where ${SKU_FILTER_SQL}
          group by sales_date
          order by sales_date desc
        `,
        [],
        "getDateChoices.fallback"
      );
      const salesDates = fallback.rows.map((row) => row.sales_date).filter(Boolean);
      const payload = { salesDates, defaultSalesDate: salesDates[0] || "" };
      dateChoicesCache = {
        savedAt: Date.now(),
        payload,
      };
      return payload;
    } finally {
      dateChoicesPromise = null;
    }
  })();

  return dateChoicesPromise;
}

async function getDashboardDateChoices() {
  if (dashboardDatesCache.payload && Date.now() - Number(dashboardDatesCache.savedAt || 0) <= DASHBOARD_CACHE_TTL_MS) {
    return dashboardDatesCache.payload;
  }
  if (dashboardDatesPromise) {
    return dashboardDatesPromise;
  }

  dashboardDatesPromise = (async () => {
    try {
      const choices = await getDateChoices();
      const defaultRange = buildDefaultDateRangeFromChoices(choices.salesDates, 7);
      const payload = {
        anchor_dates: choices.salesDates || [],
        default_anchor_date: choices.defaultSalesDate || "",
        sales_dates: choices.salesDates || [],
        default_date_from: defaultRange.dateFrom || "",
        default_date_to: defaultRange.dateTo || "",
      };
      dashboardDatesCache = {
        savedAt: Date.now(),
        payload,
      };
      return payload;
    } finally {
      dashboardDatesPromise = null;
    }
  })();

  return dashboardDatesPromise;
}

async function resolveDashboardAnchorDate(anchorDateText) {
  const { anchor_dates: anchorDates, default_anchor_date: defaultAnchorDate } = await getDashboardDateChoices();
  if (!Array.isArray(anchorDates) || anchorDates.length === 0) {
    return { anchorDate: "", anchorDates: [] };
  }

  const normalized = normalizeDateInput(anchorDateText);
  if (!normalized) {
    return { anchorDate: defaultAnchorDate || anchorDates[0], anchorDates };
  }
  if (anchorDates.includes(normalized)) {
    return { anchorDate: normalized, anchorDates };
  }
  const fallback = anchorDates.find((d) => d <= normalized) || anchorDates[0];
  return { anchorDate: fallback, anchorDates };
}

async function resolveDashboardRange({ dateFromText, dateToText, anchorDateText, defaultSpanDays = 7 }) {
  const choices = await getDateChoices();
  const salesDates = Array.isArray(choices.salesDates) ? choices.salesDates : [];
  const validDates = new Set(salesDates);
  const normalized = normalizeDailyRangeInput(dateFromText, dateToText);
  let dateFrom = normalized.dateFrom;
  let dateTo = normalized.dateTo;

  if (dateFrom && dateTo && validDates.has(dateFrom) && validDates.has(dateTo)) {
    if (dateFrom > dateTo) {
      const tmp = dateFrom;
      dateFrom = dateTo;
      dateTo = tmp;
    }
  } else if (normalizeDateInput(anchorDateText)) {
    const { anchorDate } = await resolveDashboardAnchorDate(anchorDateText);
    const derivedRange = buildAnchorDateRange(anchorDate, defaultSpanDays);
    dateFrom = derivedRange.dateFrom;
    dateTo = derivedRange.dateTo;
  } else {
    const fallback = buildDefaultDateRangeFromChoices(salesDates, defaultSpanDays);
    dateFrom = fallback.dateFrom;
    dateTo = fallback.dateTo;
  }

  const periodDays = Math.max(1, daysBetweenInclusive(dateFrom, dateTo));
  const comparisonTo = dateFrom ? shiftDateText(dateFrom, -1) : "";
  const comparisonFrom = comparisonTo ? shiftDateText(comparisonTo, -(periodDays - 1)) : "";
  return {
    salesDates,
    anchorDate: dateTo,
    dateFrom,
    dateTo,
    comparisonFrom,
    comparisonTo,
    periodDays,
  };
}

async function resolveOptionalDashboardRange({ dateFromText, dateToText }) {
  const choices = await getDateChoices();
  const salesDates = Array.isArray(choices.salesDates) ? choices.salesDates : [];
  const validDates = new Set(salesDates);
  const normalized = normalizeDailyRangeInput(dateFromText, dateToText);
  const dateFrom = normalized.dateFrom;
  const dateTo = normalized.dateTo;

  if (!dateFrom || !dateTo || !validDates.has(dateFrom) || !validDates.has(dateTo)) {
    return {
      salesDates,
      dateFrom: "",
      dateTo: "",
      periodDays: 0,
    };
  }

  return {
    salesDates,
    dateFrom,
    dateTo,
    periodDays: Math.max(1, daysBetweenInclusive(dateFrom, dateTo)),
  };
}

function clearDateChoiceCaches() {
  dateChoicesCache = {
    savedAt: 0,
    payload: null,
  };
  dashboardDatesCache = {
    savedAt: 0,
    payload: null,
  };
}

function getDateChoiceCacheStats() {
  return {
    caches: {
      date_choices: dateChoicesCache.payload ? 1 : 0,
      dashboard_dates: dashboardDatesCache.payload ? 1 : 0,
    },
    in_flight: {
      date_choices: dateChoicesPromise ? 1 : 0,
      dashboard_dates: dashboardDatesPromise ? 1 : 0,
    },
  };
}

module.exports = {
  getDateChoices,
  getDashboardDateChoices,
  resolveDashboardAnchorDate,
  resolveDashboardRange,
  resolveOptionalDashboardRange,
  clearDateChoiceCaches,
  getDateChoiceCacheStats,
};
