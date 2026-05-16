"use strict";

const { z } = require("zod");
const reportRepo = require("../reportRepo");
const metricsService = require("../metricsService");
const { CHANNEL_DASHBOARD_OPTIONS } = require("../report/channel/options");
const { SALES_DAILY_TABLE, SKU_FILTER_SQL } = require("../report/constants");

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FORBIDDEN_OUTPUT_KEYS = ["sku", "style", "product_name", "货号", "款号", "品名"];

// Report schema for build_report tool — validated by Zod at call time.
const reportSheetColumnSchema = z.object({
  header: z.string(),
  key: z.string(),
  width: z.number().optional().default(15),
  type: z.enum(["text", "number", "currency", "percent", "date"]).optional().default("text"),
  conditional: z.object({
    negative: z.string().optional(),
    positive: z.string().optional(),
  }).optional(),
});

const reportSheetSchema = z.object({
  name: z.string(),
  columns: z.array(reportSheetColumnSchema),
  data: z.array(z.record(z.any())),
  options: z.object({
    freezeRow: z.number().optional().default(1),
    autoFilter: z.boolean().optional().default(true),
    sortBy: z.object({
      key: z.string(),
      order: z.enum(["asc", "desc"]),
    }).optional(),
  }).optional(),
});

const reportSchema = z.object({
  title: z.string(),
  sheets: z.array(reportSheetSchema),
});

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

// ---------------------------------------------------------------------------
// query_daily_summary — daily aggregated data with optional channel/category
// ---------------------------------------------------------------------------
async function queryDailySummary(input) {
  const { startDate, endDate } = await resolveDefaultRange(input.start_date, input.end_date);
  const groupBy = ["date", "date_channel", "date_category"].includes(input.group_by) ? input.group_by : "date";

  // Resolve optional channel filter
  let option = null;
  if (input.channel) {
    option = normalizeChannel(input.channel);
    if (!option) throw new Error(`无法识别渠道：${input.channel}`);
  }

  // Build dynamic select/group columns
  const salesExpr = option
    ? `coalesce(${option.salesQtyKey}, 0)`
    : `coalesce(sales_total_qty, 0)`;
  const discountExpr = option
    ? `coalesce(nullif(${option.skuDiscountKey}, 0), nullif(${option.styleDiscountKey}, 0), 1)`
    : `1`;

  let extraSelect = "";
  let extraGroup = "";
  if (groupBy === "date_channel" && option) {
    // When grouped by date+channel with a specific channel, just label it
    extraSelect = `, '${option.label}' as channel_label`;
  } else if (groupBy === "date_category") {
    extraSelect = `, coalesce(nullif(trim(category), ''), '未分类') as category_label`;
    extraGroup = `, coalesce(nullif(trim(category), ''), '未分类')`;
  }

  // Optional category filter
  const params = [startDate, endDate];
  let categoryClause = "";
  if (input.category) {
    params.push(input.category);
    categoryClause = ` and trim(category) = $${params.length}`;
  }

  const pool = await reportRepo.getPool();
  const result = await pool.query(
    `
      select
        sales_date::text as sales_date,
        coalesce(sum(${salesExpr}), 0)::numeric as qty,
        coalesce(sum(
          coalesce(tag_price, 0) * ${salesExpr} * ${discountExpr}
        ), 0)::numeric as gmv,
        count(distinct case when ${salesExpr} <> 0 then sku end)::int as active_sku_count
        ${extraSelect}
      from ${SALES_DAILY_TABLE}
      where sales_date between $1::date and $2::date
        and ${SKU_FILTER_SQL}
        ${categoryClause}
      group by sales_date ${extraGroup}
      order by sales_date
    `,
    params
  );

  const items = (result.rows || []).map((row) => {
    const obj = {
      sales_date: row.sales_date,
      gmv: round(row.gmv, 2),
      qty: round(row.qty, 2),
      active_sku_count: Number(row.active_sku_count || 0),
    };
    if (row.channel_label) obj.channel_label = row.channel_label;
    if (row.category_label) obj.category_label = row.category_label;
    return obj;
  });

  return {
    period: { start_date: startDate, end_date: endDate },
    group_by: groupBy,
    channel: option ? { code: option.code, label: option.label } : null,
    category_filter: input.category || null,
    items,
    totals: {
      gmv: round(items.reduce((s, r) => s + r.gmv, 0), 2),
      qty: round(items.reduce((s, r) => s + r.qty, 0), 2),
      day_count: new Set(items.map((r) => r.sales_date)).size,
    },
  };
}

// ---------------------------------------------------------------------------
// query_sku_details — SKU-level top sellers (detail_rows for report, summary for LLM)
// ---------------------------------------------------------------------------
async function querySkuDetails(input) {
  const option = normalizeChannel(input.channel);
  if (!option) throw new Error(`无法识别渠道：${input.channel}`);

  const { startDate, endDate } = await resolveDefaultRange(input.start_date, input.end_date);
  const sortBy = input.sort_by === "qty" ? "qty" : "gmv";
  const limit = Math.max(1, Math.min(Number(input.limit) || 20, 100));

  const salesQtyKey = option.salesQtyKey;
  const skuDiscountKey = option.skuDiscountKey;
  const styleDiscountKey = option.styleDiscountKey;

  const params = [startDate, endDate, limit];
  let categoryClause = "";
  if (input.category) {
    params.push(input.category);
    categoryClause = ` and trim(category) = $${params.length}`;
  }

  const pool = await reportRepo.getPool();
  const result = await pool.query(
    `
      select
        coalesce(nullif(trim(style_no), ''), '未标记') as style_no,
        coalesce(nullif(trim(category), ''), '未分类') as category,
        coalesce(nullif(trim(major_category), ''), '未分类') as major_category,
        coalesce(sum(coalesce(${salesQtyKey}, 0)), 0)::numeric as qty,
        coalesce(sum(
          coalesce(tag_price, 0) *
          coalesce(${salesQtyKey}, 0) *
          coalesce(nullif(${skuDiscountKey}, 0), nullif(${styleDiscountKey}, 0), 1)
        ), 0)::numeric as gmv,
        max(tag_price)::numeric as tag_price,
        case
          when coalesce(sum(coalesce(tag_price, 0) * coalesce(${salesQtyKey}, 0)), 0) = 0 then 0
          else coalesce(sum(
            coalesce(tag_price, 0) *
            coalesce(${salesQtyKey}, 0) *
            coalesce(nullif(${skuDiscountKey}, 0), nullif(${styleDiscountKey}, 0), 1)
          ), 0) / sum(coalesce(tag_price, 0) * coalesce(${salesQtyKey}, 0))
        end as discount_rate
      from ${SALES_DAILY_TABLE}
      where sales_date between $1::date and $2::date
        and ${SKU_FILTER_SQL}
        ${categoryClause}
      group by style_no, category, major_category
      having coalesce(sum(coalesce(${salesQtyKey}, 0)), 0) > 0
      order by ${sortBy} desc
      limit $3
    `,
    params
  );

  // detail_rows contains style_no — for report building only, NOT sent to LLM
  const detailRows = (result.rows || []).map((row) => ({
    style_no: row.style_no,
    category: row.category,
    major_category: row.major_category,
    gmv: round(row.gmv, 2),
    qty: round(row.qty, 2),
    tag_price: round(row.tag_price, 2),
    discount_rate: round(Number(row.discount_rate || 0), 4),
  }));

  // LLM-safe summary — no style_no, only aggregated stats
  const summary = {
    channel: { code: option.code, label: option.label },
    period: { start_date: startDate, end_date: endDate },
    sort_by: sortBy,
    result_count: detailRows.length,
    top_categories: Object.entries(
      detailRows.reduce((acc, r) => {
        acc[r.category] = (acc[r.category] || 0) + r.gmv;
        return acc;
      }, {})
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat, gmv]) => ({ category: cat, gmv: round(gmv, 2) })),
    total_gmv: round(detailRows.reduce((s, r) => s + r.gmv, 0), 2),
    total_qty: round(detailRows.reduce((s, r) => s + r.qty, 0), 2),
    avg_discount_rate: detailRows.length > 0
      ? round(detailRows.reduce((s, r) => s + r.discount_rate, 0) / detailRows.length, 4)
      : 0,
  };

  return { summary, detail_rows: detailRows };
}

// ---------------------------------------------------------------------------
// query_comparison — period-over-period comparison
// ---------------------------------------------------------------------------
async function queryComparison(input) {
  const { startDate: curStart, endDate: curEnd } = await resolveDefaultRange(input.current_start, input.current_end);
  const prevStart = toDateText(input.previous_start);
  const prevEnd = toDateText(input.previous_end);
  if (!prevStart || !prevEnd) {
    throw new Error("对比期起止日期 (previous_start, previous_end) 必填且格式为 YYYY-MM-DD");
  }

  // Optional channel
  let option = null;
  if (input.channel) {
    option = normalizeChannel(input.channel);
    if (!option) throw new Error(`无法识别渠道：${input.channel}`);
  }

  const salesExpr = option
    ? `coalesce(${option.salesQtyKey}, 0)`
    : `coalesce(sales_total_qty, 0)`;
  const discountExpr = option
    ? `coalesce(nullif(${option.skuDiscountKey}, 0), nullif(${option.styleDiscountKey}, 0), 1)`
    : `1`;

  // Optional group_by
  const groupBy = ["channel", "category"].includes(input.group_by) ? input.group_by : null;
  let groupSelectSql = "";
  let groupBySql = "";
  if (groupBy === "category") {
    groupSelectSql = `, coalesce(nullif(trim(category), ''), '未分类') as group_label`;
    groupBySql = `group by coalesce(nullif(trim(category), ''), '未分类')`;
  }
  // Note: group_by=channel only meaningful without a specific channel filter
  // We just label it in that case; actual multi-channel split requires iterating CHANNEL_DASHBOARD_OPTIONS
  // which is a design choice for the future. For now group_by=channel with no channel filter returns total.

  const params = [curStart, curEnd, prevStart, prevEnd];
  const pool = await reportRepo.getPool();

  const result = await pool.query(
    `
      with current_period as (
        select
          coalesce(sum(${salesExpr}), 0)::numeric as qty,
          coalesce(sum(
            coalesce(tag_price, 0) * ${salesExpr} * ${discountExpr}
          ), 0)::numeric as gmv,
          count(distinct case when ${salesExpr} <> 0 then sku end)::int as active_sku_count
          ${groupSelectSql}
        from ${SALES_DAILY_TABLE}
        where sales_date between $1::date and $2::date
          and ${SKU_FILTER_SQL}
        ${groupBySql}
      ),
      previous_period as (
        select
          coalesce(sum(${salesExpr}), 0)::numeric as qty,
          coalesce(sum(
            coalesce(tag_price, 0) * ${salesExpr} * ${discountExpr}
          ), 0)::numeric as gmv,
          count(distinct case when ${salesExpr} <> 0 then sku end)::int as active_sku_count
          ${groupSelectSql}
        from ${SALES_DAILY_TABLE}
        where sales_date between $3::date and $4::date
          and ${SKU_FILTER_SQL}
        ${groupBySql}
      )
      select
        c.gmv as cur_gmv, c.qty as cur_qty, c.active_sku_count as cur_active_sku_count,
        p.gmv as prev_gmv, p.qty as prev_qty, p.active_sku_count as prev_active_sku_count
        ${groupBy === "category" ? ", c.group_label" : ""}
      from current_period c
      ${groupBy === "category"
        ? "full outer join previous_period p on c.group_label = p.group_label"
        : "cross join previous_period p"}
    `,
    params
  );

  function calcChange(cur, prev) {
    const change = round(cur - prev, 2);
    const pct = prev === 0 ? (cur === 0 ? 0 : 100) : round(((cur - prev) / Math.abs(prev)) * 100, 2);
    return { change, change_pct: pct };
  }

  const items = (result.rows || []).map((row) => {
    const curGmv = round(row.cur_gmv, 2);
    const curQty = round(row.cur_qty, 2);
    const curSku = Number(row.cur_active_sku_count || 0);
    const prevGmv = round(row.prev_gmv, 2);
    const prevQty = round(row.prev_qty, 2);
    const prevSku = Number(row.prev_active_sku_count || 0);
    const obj = {
      current: { gmv: curGmv, qty: curQty, active_sku_count: curSku },
      previous: { gmv: prevGmv, qty: prevQty, active_sku_count: prevSku },
      gmv_change: calcChange(curGmv, prevGmv),
      qty_change: calcChange(curQty, prevQty),
    };
    if (row.group_label) obj.group_label = row.group_label;
    return obj;
  });

  return {
    current_period: { start_date: curStart, end_date: curEnd },
    previous_period: { start_date: prevStart, end_date: prevEnd },
    channel: option ? { code: option.code, label: option.label } : null,
    group_by: groupBy,
    items: items.length > 0 ? items : [{
      current: { gmv: 0, qty: 0, active_sku_count: 0 },
      previous: { gmv: 0, qty: 0, active_sku_count: 0 },
      gmv_change: { change: 0, change_pct: 0 },
      qty_change: { change: 0, change_pct: 0 },
    }],
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
  {
    name: "query_daily_summary",
    description: "按天聚合读取 GMV、销量和活跃 SKU 数，可按渠道或品类过滤，支持按日期/日期+渠道/日期+品类分组。",
    schema: z.object({
      start_date: z.string().optional().default(""),
      end_date: z.string().optional().default(""),
      channel: z.string().optional().default(""),
      category: z.string().optional().default(""),
      group_by: z.enum(["date", "date_channel", "date_category"]).optional().default("date"),
    }),
    parameters: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "起始日期 YYYY-MM-DD，可选" },
        end_date: { type: "string", description: "结束日期 YYYY-MM-DD，可选" },
        channel: { type: "string", description: "渠道中文名或代码，可选" },
        category: { type: "string", description: "品类过滤，可选" },
        group_by: { type: "string", enum: ["date", "date_channel", "date_category"], description: "分组维度，默认 date" },
      },
      required: [],
    },
    call: queryDailySummary,
  },
  {
    name: "query_sku_details",
    description: "读取某渠道按款维度的 Top 销售排行（按 GMV 或销量排序），返回聚合摘要供分析和明细行供报表。",
    schema: z.object({
      channel: z.string().min(1),
      start_date: z.string().optional().default(""),
      end_date: z.string().optional().default(""),
      category: z.string().optional().default(""),
      sort_by: z.enum(["gmv", "qty"]).optional().default("gmv"),
      limit: z.number().optional().default(20),
    }),
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", description: "渠道中文名或代码" },
        start_date: { type: "string", description: "起始日期 YYYY-MM-DD，可选" },
        end_date: { type: "string", description: "结束日期 YYYY-MM-DD，可选" },
        category: { type: "string", description: "品类过滤，可选" },
        sort_by: { type: "string", enum: ["gmv", "qty"], description: "排序依据，默认 gmv" },
        limit: { type: "number", description: "返回行数，默认 20，最大 100" },
      },
      required: ["channel"],
    },
    call: querySkuDetails,
  },
  {
    name: "query_comparison",
    description: "对比两个时段的 GMV、销量和活跃 SKU 数，返回变化量和变化率。",
    schema: z.object({
      current_start: z.string().min(1),
      current_end: z.string().min(1),
      previous_start: z.string().min(1),
      previous_end: z.string().min(1),
      channel: z.string().optional().default(""),
      group_by: z.enum(["channel", "category"]).optional(),
    }),
    parameters: {
      type: "object",
      properties: {
        current_start: { type: "string", description: "当前期起始日期 YYYY-MM-DD" },
        current_end: { type: "string", description: "当前期结束日期 YYYY-MM-DD" },
        previous_start: { type: "string", description: "对比期起始日期 YYYY-MM-DD" },
        previous_end: { type: "string", description: "对比期结束日期 YYYY-MM-DD" },
        channel: { type: "string", description: "渠道中文名或代码，可选" },
        group_by: { type: "string", enum: ["channel", "category"], description: "分组维度，可选" },
      },
      required: ["current_start", "current_end", "previous_start", "previous_end"],
    },
    call: queryComparison,
  },
  {
    name: "build_report",
    description: "将已收集的数据结构化为 Excel 报表 Schema（含 title、sheets、columns、data），交给前端生成下载。此工具不查询数据库。",
    schema: reportSchema,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "报表标题" },
        sheets: {
          type: "array",
          description: "工作表定义数组",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              columns: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    header: { type: "string" },
                    key: { type: "string" },
                    width: { type: "number" },
                    type: { type: "string", enum: ["text", "number", "currency", "percent", "date"] },
                    conditional: {
                      type: "object",
                      properties: {
                        negative: { type: "string" },
                        positive: { type: "string" },
                      },
                    },
                  },
                  required: ["header", "key"],
                },
              },
              data: { type: "array", items: { type: "object" } },
              options: {
                type: "object",
                properties: {
                  freezeRow: { type: "number" },
                  autoFilter: { type: "boolean" },
                  sortBy: {
                    type: "object",
                    properties: {
                      key: { type: "string" },
                      order: { type: "string", enum: ["asc", "desc"] },
                    },
                    required: ["key", "order"],
                  },
                },
              },
            },
            required: ["name", "columns", "data"],
          },
        },
      },
      required: ["title", "sheets"],
    },
    call(input) {
      // Validation is handled by schema.parse in callTool; just return the validated schema.
      return input;
    },
  },
];

const TOOL_MAP = new Map(TOOL_DEFS.map((tool) => [tool.name, tool]));

const WRITE_TOOLS = new Set(["build_report"]);

function listTools() {
  return TOOL_DEFS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    read_only: !WRITE_TOOLS.has(tool.name),
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

  // query_sku_details returns { summary, detail_rows }.
  // Only summary is safe for the LLM observation; detail_rows contains style_no for report building.
  if (name === "query_sku_details") {
    assertSafeModelPayload(result.summary);
    return result; // caller must only send summary to LLM
  }

  // build_report schema may contain user-facing fields (style_no etc.) — skip assertSafeModelPayload
  if (name === "build_report") {
    return result;
  }

  assertSafeModelPayload(result);
  return result;
}

module.exports = {
  listTools,
  getOpenAITools,
  callTool,
  summarizeForObservation,
  assertSafeModelPayload,
  reportSchema,
};
