"use strict";

const { normalizeDateInput } = require("./shared/dateUtils");
const { toWeekRow } = require("./shared/rowTransforms");
const { filterObjectRowsByKeyword, paginateRows } = require("./shared/pagination");
const { getDateChoices } = require("./dashboard/dateChoices");

// 循环依赖处理：
// - daily.js 在顶部 require("./weekly") 仅为取常量 WEEK_COLUMN_HEADERS（已定义在本文件 export）
// - weekly.js 反向需要 daily.js 的 queryDailyUnionBaseRows / summarizeDailyRows（函数）
// - 用 lazy require（在函数体内 require）避免循环未求值导致 undefined
function getDailyModule() {
  return require("./daily");
}

const WEEK_COLUMN_HEADERS = [
  "出库时间",
  "款号",
  "货号",
  "大类",
  "中类",
  "品名",
  "吊牌价",
  "产品季",
  "性别",
  "故事包",
  "货通",
  "女子",
  "户外",
  "潮流",
  "休闲",
  "C店",
  "品类共享",
  "天猫奥莱",
  "共享",
  "天猫旗舰",
  "天猫专卖",
  "上海专卖",
  "京东旗舰",
  "京东专卖",
  "京自营",
  "得物",
  "兴趣",
  "唯品",
  "拼多多",
  "经销",
  "其他",
  "全渠道库存",
  "女子",
  "户外",
  "潮流",
  "休闲",
  "天猫羽球",
  "天猫奥莱",
  "C店",
  "奥莱安建立",
  "天猫旗舰",
  "天猫专卖",
  "上海专卖",
  "京东旗舰",
  "京东专卖",
  "京自营",
  "得物",
  "唯品",
  "拼多多",
  "兴趣",
  "官网",
  "团购",
  "经销",
  "其他",
  "全渠道销售",
  "女子",
  "户外",
  "潮流",
  "休闲",
  "天猫羽球",
  "天猫奥莱",
  "C店",
  "奥莱安建立",
  "天猫旗舰",
  "天猫专卖",
  "上海专卖",
  "京东旗舰",
  "京东专卖",
  "京自营",
  "得物",
  "唯品",
  "拼多多",
  "兴趣",
  "官网",
  "团购",
  "经销",
  "其他",
  "全渠道折扣（货号层级）",
  "女子",
  "户外",
  "潮流",
  "休闲",
  "天猫羽球",
  "天猫奥莱",
  "C店",
  "奥莱安建立",
  "天猫旗舰",
  "天猫专卖",
  "上海专卖",
  "京东旗舰",
  "京东专卖",
  "京自营",
  "得物",
  "唯品",
  "拼多多",
  "兴趣",
  "官网",
  "团购",
  "经销",
  "其他",
  "全渠道折扣（款号层级）",
];

function buildWeekGroupHeaders() {
  const group = Array(WEEK_COLUMN_HEADERS.length).fill("");
  group[0] = "日期";
  group[1] = "基础信息";
  group[10] = "库存";
  group[32] = "销售";
  group[55] = "货号折扣";
  group[78] = "款号折扣";
  return group;
}

async function getWeekChoices() {
  const payload = await getDateChoices();
  return {
    weeks: payload.salesDates,
    defaultWeek: payload.defaultSalesDate,
  };
}

async function resolveWeek(week) {
  const choices = await getWeekChoices();
  const normalized = normalizeDateInput(week);
  if (!normalized) {
    return { week: choices.defaultWeek, weeks: choices.weeks };
  }
  return {
    week: choices.weeks.includes(normalized) ? normalized : choices.defaultWeek,
    weeks: choices.weeks,
  };
}

async function getReportMeta(week) {
  const rows = await getDailyModule().queryDailyUnionBaseRows(week, week);
  const summary = getDailyModule().summarizeDailyRows(rows);
  return {
    report_week: week,
    group_headers: buildWeekGroupHeaders(),
    column_headers: WEEK_COLUMN_HEADERS,
    row_count: summary.row_count,
    generated_at: summary.generated_at,
    sales_date_from: week,
    sales_date_to: week,
    gap_summary: {
      missing_store_channel: 0,
      missing_pool_channel: 0,
      missing_pool_ratio: 0,
      unknown_inventory_channel: 0,
      unknown_sales_channel: 0,
    },
  };
}

async function getReportRows({ week, page, pageSize, keyword, fuzzy }) {
  const rows = await getDailyModule().queryDailyUnionBaseRows(week, week);
  const filtered = filterObjectRowsByKeyword(rows, keyword, fuzzy);
  const paged = paginateRows(filtered, page, pageSize);
  return {
    items: paged.items.map((row) => toWeekRow(row, week)),
    total: paged.total,
    page: paged.page,
    pageSize: paged.pageSize,
  };
}

async function getReportExportRows(week) {
  const rows = await getDailyModule().queryDailyUnionBaseRows(week, week);
  return rows.map((row) => toWeekRow(row, week));
}

module.exports = {
  WEEK_COLUMN_HEADERS,
  buildWeekGroupHeaders,
  getWeekChoices,
  resolveWeek,
  getReportMeta,
  getReportRows,
  getReportExportRows,
};
