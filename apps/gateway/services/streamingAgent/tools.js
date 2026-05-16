"use strict";

const { z } = require("zod");
const reportRepo = require("../reportRepo");
const metricsService = require("../metricsService");
const { CHANNEL_DASHBOARD_OPTIONS } = require("../report/channel/options");
const { SALES_DAILY_TABLE, SKU_FILTER_SQL } = require("../report/constants");

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FORBIDDEN_OUTPUT_KEYS = ["sku", "style", "product_name", "货号", "款号", "品名"];

function toDateText(value) {
  const text = String(value || "").trim();
  return ISO_DATE_RE.test(text) ? text : "";
}

function round(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = Math.pow(10, digits);
  return Math.round(n * factor) / factor;
}

function hasUnsafeKey(key) {
  const lower = String(key || "").toLowerCase();
  return FORBIDDEN_OUTPUT_KEYS.some((token) => lower.includes(token));
}

function assertSafeModelPayload(value, path = "") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeModelPayload(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (hasUnsafeKey(key)) {
      throw new Error(`出站数据审计失败，检测到明细字段: ${nextPath}`);
    }
    assertSafeModelPayload(child, nextPath);
  }
}

function summarizeForObservation(value, maxChars = 1800) {
  assertSafeModelPayload(value);
  const text = JSON.stringify(value, null, 0);
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function normalizeChannel(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return null;
  return (
    CHANNEL_DASHBOARD_OPTIONS.find((item) => item.code.toLowerCase() === text) ||
    CHANNEL_DASHBOARD_OPTIONS.find((item) => item.label.toLowerCase() === text) ||
    CHANNEL_DASHBOARD_OPTIONS.find((item) => item.label.includes(String(value || "").trim()))
  );
}

async function resolveDefaultRange(startDate, endDate) {
  const requestedStart = toDateText(startDate);
  const requestedEnd = toDateText(endDate);
  if (requestedStart && requestedEnd) {
    return requestedStart <= requestedEnd
      ? { startDate: requestedStart, endDate: requestedEnd }
      : { startDate: requestedEnd, endDate: requestedStart };
  }
  const choices = await reportRepo.getDashboardDateChoices();
  const fallbackStart = toDateText(choices?.default_date_from || choices?.default_anchor_date);
  const fallbackEnd = toDateText(choices?.default_date_to || choices?.default_anchor_date);
  return {
    startDate: requestedStart || fallbackStart || fallbackEnd,
    endDate: requestedEnd || fallbackEnd || fallbackStart,
  };
}

function getGroupSql(groupBy) {
  if (groupBy === "major_category") return "coalesce(nullif(trim(major_category), ''), '未分类')";
  if (groupBy === "gender") return "coalesce(nullif(trim(gender), ''), '未标记')";
  return "coalesce(nullif(trim(category), ''), '未分类')";
}

async function queryChannelTotals(input) {
  const option = normalizeChannel(input.channel);
  if (!option) {
    throw new Error(`无法识别渠道：${input.channel}`);
  }
  const { startDate, endDate } = await resolveDefaultRange(input.start_date, input.end_date);
  const salesQtyKey = option.salesQtyKey;
  const skuDiscountKey = option.skuDiscountKey;
  const styleDiscountKey = option.styleDiscountKey;
  const pool = await reportRepo.getPool();
  const result = await pool.query(
    `
      select
        coalesce(sum(coalesce(${salesQtyKey}, 0)), 0)::numeric as qty,
        coalesce(sum(
          coalesce(tag_price, 0) *
          coalesce(${salesQtyKey}, 0) *
          coalesce(nullif(${skuDiscountKey}, 0), nullif(${styleDiscountKey}, 0), 1)
        ), 0)::numeric as gmv,
        count(distinct case when coalesce(${salesQtyKey}, 0) <> 0 then sales_date end)::int as active_days,
        count(distinct case when coalesce(${salesQtyKey}, 0) <> 0 then sku end)::int as active_item_count
      from ${SALES_DAILY_TABLE}
      where sales_date between $1::date and $2::date
        and ${SKU_FILTER_SQL}
    `,
    [startDate, endDate]
  );
  const row = result.rows[0] || {};
  return {
    channel: { code: option.code, label: option.label },
    period: { start_date: startDate, end_date: endDate },
    totals: {
      gmv: round(row.gmv, 2),
      qty: round(row.qty, 2),
      active_item_count: Number(row.active_item_count || 0),
      active_days: Number(row.active_days || 0),
    },
  };
}

async function queryChannelBreakdown(input) {
  const option = normalizeChannel(input.channel);
  if (!option) {
    throw new Error(`无法识别渠道：${input.channel}`);
  }
  const groupBy = ["category", "major_category", "gender"].includes(input.group_by) ? input.group_by : "category";
  const { startDate, endDate } = await resolveDefaultRange(input.start_date, input.end_date);
  const salesQtyKey = option.salesQtyKey;
  const skuDiscountKey = option.skuDiscountKey;
  const styleDiscountKey = option.styleDiscountKey;
  const groupSql = getGroupSql(groupBy);
  const pool = await reportRepo.getPool();
  const result = await pool.query(
    `
      with grouped as (
        select
          ${groupSql} as group_value,
          coalesce(sum(coalesce(${salesQtyKey}, 0)), 0)::numeric as qty,
          coalesce(sum(
            coalesce(tag_price, 0) *
            coalesce(${salesQtyKey}, 0) *
            coalesce(nullif(${skuDiscountKey}, 0), nullif(${styleDiscountKey}, 0), 1)
          ), 0)::numeric as gmv,
          count(distinct case when coalesce(${salesQtyKey}, 0) <> 0 then sku end)::int as active_item_count
        from ${SALES_DAILY_TABLE}
        where sales_date between $1::date and $2::date
          and ${SKU_FILTER_SQL}
        group by ${groupSql}
      ),
      totals as (
        select coalesce(sum(gmv), 0)::numeric as total_gmv,
               coalesce(sum(qty), 0)::numeric as total_qty
        from grouped
      )
      select
        group_value,
        qty,
        gmv,
        active_item_count,
        case when totals.total_gmv = 0 then 0 else grouped.gmv / totals.total_gmv end as gmv_share,
        case when totals.total_qty = 0 then 0 else grouped.qty / totals.total_qty end as qty_share
      from grouped
      cross join totals
      where qty <> 0 or gmv <> 0
      order by gmv desc
      limit 20
    `,
    [startDate, endDate]
  );
  const items = (result.rows || []).map((row) => ({
    group_value: String(row.group_value || "未分类"),
    gmv: round(row.gmv, 2),
    qty: round(row.qty, 2),
    active_item_count: Number(row.active_item_count || 0),
    gmv_share_pct: round(Number(row.gmv_share || 0) * 100, 2),
    qty_share_pct: round(Number(row.qty_share || 0) * 100, 2),
  }));
  return {
    channel: { code: option.code, label: option.label },
    period: { start_date: startDate, end_date: endDate },
    group_by: groupBy,
    items,
    totals: {
      gmv: round(items.reduce((sum, item) => sum + item.gmv, 0), 2),
      qty: round(items.reduce((sum, item) => sum + item.qty, 0), 2),
      group_count: items.length,
    },
  };
}

const TOOL_DEFS = [
  {
    name: "get_available_dates",
    description: "读取当前经营数据可用日期范围和默认分析区间。",
    schema: z.object({}),
    parameters: { type: "object", properties: {}, required: [] },
    async call() {
      const choices = await reportRepo.getDashboardDateChoices();
      return {
        default_date_from: choices?.default_date_from || "",
        default_date_to: choices?.default_date_to || "",
        default_anchor_date: choices?.default_anchor_date || "",
        available_date_count: Array.isArray(choices?.anchor_dates) ? choices.anchor_dates.length : 0,
      };
    },
  },
  {
    name: "get_dashboard_overview",
    description: "按日/周/月或指定起止日期读取平台整体聚合经营指标、品类结构和库存风险摘要。",
    schema: z.object({
      period_type: z.enum(["day", "week", "month"]).optional().default("week"),
      start_date: z.string().optional().default(""),
      end_date: z.string().optional().default(""),
    }),
    parameters: {
      type: "object",
      properties: {
        period_type: { type: "string", enum: ["day", "week", "month"], description: "分析周期，默认 week" },
        start_date: { type: "string", description: "起始日期 YYYY-MM-DD，可选" },
        end_date: { type: "string", description: "结束日期 YYYY-MM-DD，可选" },
      },
      required: [],
    },
    async call(input) {
      const parsed = this.schema.parse(input || {});
      const metrics = await metricsService.calculateMetrics({
        periodType: parsed.period_type,
        startDate: parsed.start_date,
        endDate: parsed.end_date,
      });
      return metrics;
    },
  },
  {
    name: "query_channel_totals",
    description: "读取某个渠道在指定日期范围内的总 GMV、销量、活跃款数和活跃天数。",
    schema: z.object({
      channel: z.string().min(1),
      start_date: z.string().optional().default(""),
      end_date: z.string().optional().default(""),
    }),
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", description: "渠道中文名或代码，例如 女子 / women / 天猫旗舰" },
        start_date: { type: "string", description: "起始日期 YYYY-MM-DD，可选" },
        end_date: { type: "string", description: "结束日期 YYYY-MM-DD，可选" },
      },
      required: ["channel"],
    },
    call: queryChannelTotals,
  },
  {
    name: "query_channel_breakdown",
    description: "读取某个渠道按品类/大类/性别分组的 GMV、销量和占比。",
    schema: z.object({
      channel: z.string().min(1),
      group_by: z.enum(["category", "major_category", "gender"]).optional().default("category"),
      start_date: z.string().optional().default(""),
      end_date: z.string().optional().default(""),
    }),
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", description: "渠道中文名或代码，例如 女子 / women / 天猫旗舰" },
        group_by: { type: "string", enum: ["category", "major_category", "gender"], description: "分组维度" },
        start_date: { type: "string", description: "起始日期 YYYY-MM-DD，可选" },
        end_date: { type: "string", description: "结束日期 YYYY-MM-DD，可选" },
      },
      required: ["channel"],
    },
    call: queryChannelBreakdown,
  },
];

const TOOL_MAP = new Map(TOOL_DEFS.map((tool) => [tool.name, tool]));

function listTools() {
  return TOOL_DEFS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    read_only: true,
    outbound_data_level: "aggregate_only",
  }));
}

function getOpenAITools() {
  return TOOL_DEFS.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

async function callTool(name, input) {
  const tool = TOOL_MAP.get(name);
  if (!tool) {
    const err = new Error(`Unknown tool: ${name}`);
    err.code = "TOOL_NOT_FOUND";
    throw err;
  }
  const parsed = tool.schema.parse(input || {});
  const result = await tool.call(parsed);
  assertSafeModelPayload(result);
  return result;
}

module.exports = {
  listTools,
  getOpenAITools,
  callTool,
  summarizeForObservation,
  assertSafeModelPayload,
};
