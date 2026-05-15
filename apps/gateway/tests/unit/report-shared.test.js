import { describe, it, expect } from "vitest";

const dateUtils = require("../../services/report/shared/dateUtils");
const numberUtils = require("../../services/report/shared/numberUtils");

/**
 * Unit tests for shared utils extracted from reportRepo.js (V3 split).
 *
 * Goal: lock behavior of pure helpers so future refactors can't silently
 * change format strings, off-by-one errors, or NaN guards.
 */

describe("report/shared/dateUtils", () => {
  it("normalizeDateInput accepts YYYY-MM-DD and rejects everything else", () => {
    expect(dateUtils.normalizeDateInput("2026-04-25")).toBe("2026-04-25");
    expect(dateUtils.normalizeDateInput("  2026-04-25  ")).toBe("2026-04-25");
    expect(dateUtils.normalizeDateInput("")).toBe("");
    expect(dateUtils.normalizeDateInput(null)).toBe("");
    expect(dateUtils.normalizeDateInput(undefined)).toBe("");
    expect(dateUtils.normalizeDateInput("2026/04/25")).toBe("");
    expect(dateUtils.normalizeDateInput("not-a-date")).toBe("");
  });

  it("normalizeDailyRangeInput swaps reversed dates and fills missing endpoints", () => {
    expect(dateUtils.normalizeDailyRangeInput("2026-01-05", "2026-01-01")).toEqual({
      dateFrom: "2026-01-01",
      dateTo: "2026-01-05",
    });
    expect(dateUtils.normalizeDailyRangeInput("2026-01-05", "")).toEqual({
      dateFrom: "2026-01-05",
      dateTo: "2026-01-05",
    });
    expect(dateUtils.normalizeDailyRangeInput("", "")).toEqual({ dateFrom: "", dateTo: "" });
  });

  it("buildDefaultDateRangeFromChoices spans the requested days from the latest date", () => {
    const choices = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"];
    expect(dateUtils.buildDefaultDateRangeFromChoices(choices, 3)).toEqual({
      dateFrom: "2026-01-03",
      dateTo: "2026-01-05",
    });
    expect(dateUtils.buildDefaultDateRangeFromChoices([], 7)).toEqual({ dateFrom: "", dateTo: "" });
  });

  it("daysBetweenInclusive counts inclusive days", () => {
    expect(dateUtils.daysBetweenInclusive("2026-01-01", "2026-01-01")).toBe(1);
    expect(dateUtils.daysBetweenInclusive("2026-01-01", "2026-01-07")).toBe(7);
    expect(dateUtils.daysBetweenInclusive("2026-01-07", "2026-01-01")).toBe(0);
    expect(dateUtils.daysBetweenInclusive("invalid", "2026-01-07")).toBe(0);
  });

  it("shiftDateText offsets in UTC days", () => {
    expect(dateUtils.shiftDateText("2026-01-05", -1)).toBe("2026-01-04");
    expect(dateUtils.shiftDateText("2026-01-05", 7)).toBe("2026-01-12");
    expect(dateUtils.shiftDateText("invalid", 1)).toBe("");
  });

  it("parseDateTextUtc returns Date for valid input, null otherwise", () => {
    const d = dateUtils.parseDateTextUtc("2026-04-25");
    expect(d).toBeInstanceOf(Date);
    expect(d.toISOString()).toBe("2026-04-25T00:00:00.000Z");
    expect(dateUtils.parseDateTextUtc("")).toBeNull();
    expect(dateUtils.parseDateTextUtc("invalid")).toBeNull();
  });

  it("formatDateUtc returns YYYY-MM-DD in UTC", () => {
    expect(dateUtils.formatDateUtc(new Date("2026-04-25T15:30:00Z"))).toBe("2026-04-25");
    expect(dateUtils.formatDateUtc("invalid")).toBe("");
  });
});

describe("report/shared/numberUtils", () => {
  it("toNumber returns 0 for null/undefined/empty/NaN", () => {
    expect(numberUtils.toNumber(null)).toBe(0);
    expect(numberUtils.toNumber(undefined)).toBe(0);
    expect(numberUtils.toNumber("")).toBe(0);
    expect(numberUtils.toNumber("not a number")).toBe(0);
    expect(numberUtils.toNumber("3.14")).toBe(3.14);
    expect(numberUtils.toNumber(42)).toBe(42);
  });

  it("toIntValue rounds via toNumber", () => {
    expect(numberUtils.toIntValue("3.7")).toBe(4);
    expect(numberUtils.toIntValue("3.4")).toBe(3);
    expect(numberUtils.toIntValue(null)).toBe(0);
  });

  it("toPercentText formats with 2 decimals and % suffix", () => {
    expect(numberUtils.toPercentText(0.123456)).toBe("12.35%");
    expect(numberUtils.toPercentText(1)).toBe("100.00%");
    expect(numberUtils.toPercentText(null)).toBe("");
    expect(numberUtils.toPercentText("")).toBe("");
  });

  it("roundNumber respects digits and handles non-finite", () => {
    expect(numberUtils.roundNumber(3.14159, 2)).toBe(3.14);
    expect(numberUtils.roundNumber(3.14159, 4)).toBe(3.1416);
    expect(numberUtils.roundNumber("invalid")).toBe(0);
    expect(numberUtils.roundNumber(NaN)).toBe(0);
  });

  it("percentChange handles zero and infinite previous correctly", () => {
    expect(numberUtils.percentChange(110, 100)).toBeCloseTo(0.1, 6);
    expect(numberUtils.percentChange(90, 100)).toBeCloseTo(-0.1, 6);
    // both zero → 0
    expect(numberUtils.percentChange(0, 0)).toBe(0);
    // previous zero, current non-zero → null (undefined growth)
    expect(numberUtils.percentChange(50, 0)).toBeNull();
    // non-finite input → null
    expect(numberUtils.percentChange("abc", 100)).toBeNull();
  });

  it("toText trims and stringifies", () => {
    expect(numberUtils.toText("  hello  ")).toBe("hello");
    expect(numberUtils.toText(123)).toBe("123");
    expect(numberUtils.toText(null)).toBe("");
    expect(numberUtils.toText(undefined)).toBe("");
  });
});
