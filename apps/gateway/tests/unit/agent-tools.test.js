import { describe, it, expect } from "vitest";

const {
  listTools,
  getOpenAITools,
  assertSafeModelPayload,
  reportSchema,
} = require("../../services/streamingAgent/tools");

/**
 * Unit tests for streamingAgent/tools.js — S1 expansion.
 *
 * These test tool definitions, schema validation, and data safety checks
 * without hitting the database (no pool required).
 */

describe("streamingAgent/tools — tool definitions", () => {
  const toolList = listTools();
  const openAITools = getOpenAITools();

  it("exports 8 tools total after S1 expansion", () => {
    expect(toolList.length).toBe(8);
    expect(openAITools.length).toBe(8);
  });

  it("includes the 4 new tools by name", () => {
    const names = toolList.map((t) => t.name);
    expect(names).toContain("query_daily_summary");
    expect(names).toContain("query_sku_details");
    expect(names).toContain("query_comparison");
    expect(names).toContain("build_report");
  });

  it("marks build_report as read_only=false", () => {
    const buildReport = toolList.find((t) => t.name === "build_report");
    expect(buildReport.read_only).toBe(false);
  });

  it("marks all other tools as read_only=true", () => {
    toolList
      .filter((t) => t.name !== "build_report")
      .forEach((t) => {
        expect(t.read_only).toBe(true);
      });
  });

  it("all tools have outbound_data_level=aggregate_only", () => {
    toolList.forEach((t) => {
      expect(t.outbound_data_level).toBe("aggregate_only");
    });
  });

  it("getOpenAITools returns correct function structure for new tools", () => {
    const dailySummary = openAITools.find((t) => t.function.name === "query_daily_summary");
    expect(dailySummary.type).toBe("function");
    expect(dailySummary.function.parameters.type).toBe("object");

    const comparison = openAITools.find((t) => t.function.name === "query_comparison");
    expect(comparison.function.parameters.required).toContain("current_start");
    expect(comparison.function.parameters.required).toContain("previous_end");
  });
});

describe("streamingAgent/tools — build_report schema validation", () => {
  it("accepts a valid report schema", () => {
    const valid = {
      title: "测试报表",
      sheets: [
        {
          name: "Sheet1",
          columns: [
            { header: "日期", key: "date", type: "date" },
            { header: "GMV", key: "gmv", type: "currency", width: 20 },
          ],
          data: [{ date: "2026-01-01", gmv: 12345.67 }],
          options: { freezeRow: 1, autoFilter: true },
        },
      ],
    };
    expect(() => reportSchema.parse(valid)).not.toThrow();
  });

  it("rejects report without title", () => {
    const invalid = {
      sheets: [
        {
          name: "Sheet1",
          columns: [{ header: "A", key: "a" }],
          data: [],
        },
      ],
    };
    expect(() => reportSchema.parse(invalid)).toThrow();
  });

  it("rejects report without sheets", () => {
    const invalid = { title: "无工作表" };
    expect(() => reportSchema.parse(invalid)).toThrow();
  });

  it("rejects sheet without columns", () => {
    const invalid = {
      title: "坏报表",
      sheets: [{ name: "Sheet1", data: [] }],
    };
    expect(() => reportSchema.parse(invalid)).toThrow();
  });

  it("rejects sheet with invalid column type", () => {
    const invalid = {
      title: "坏报表",
      sheets: [
        {
          name: "Sheet1",
          columns: [{ header: "A", key: "a", type: "invalid_type" }],
          data: [],
        },
      ],
    };
    expect(() => reportSchema.parse(invalid)).toThrow();
  });

  it("applies defaults for optional fields", () => {
    const minimal = {
      title: "最小报表",
      sheets: [
        {
          name: "Sheet1",
          columns: [{ header: "A", key: "a" }],
          data: [{ a: 1 }],
        },
      ],
    };
    const parsed = reportSchema.parse(minimal);
    expect(parsed.sheets[0].columns[0].width).toBe(15);
    expect(parsed.sheets[0].columns[0].type).toBe("text");
  });
});

describe("streamingAgent/tools — query_sku_details data safety", () => {
  it("assertSafeModelPayload rejects objects with style_no key", () => {
    const unsafe = {
      items: [{ style_no: "ABC123", gmv: 100 }],
    };
    // style_no contains "style" which is in FORBIDDEN_OUTPUT_KEYS
    expect(() => assertSafeModelPayload(unsafe)).toThrow(/明细字段/);
  });

  it("assertSafeModelPayload rejects objects with sku key", () => {
    const unsafe = { sku: "X001" };
    expect(() => assertSafeModelPayload(unsafe)).toThrow(/明细字段/);
  });

  it("assertSafeModelPayload accepts safe aggregate data", () => {
    const safe = {
      channel: { code: "women", label: "女子" },
      total_gmv: 12345.67,
      total_qty: 100,
      top_categories: [{ category: "鞋", gmv: 5000 }],
    };
    expect(() => assertSafeModelPayload(safe)).not.toThrow();
  });

  it("assertSafeModelPayload accepts summary from query_sku_details pattern", () => {
    // This mirrors the summary shape returned by querySkuDetails
    const summary = {
      channel: { code: "women", label: "女子" },
      period: { start_date: "2026-01-01", end_date: "2026-01-07" },
      sort_by: "gmv",
      result_count: 5,
      top_categories: [{ category: "鞋", gmv: 5000 }],
      total_gmv: 10000,
      total_qty: 200,
      avg_discount_rate: 0.85,
    };
    expect(() => assertSafeModelPayload(summary)).not.toThrow();
  });
});
