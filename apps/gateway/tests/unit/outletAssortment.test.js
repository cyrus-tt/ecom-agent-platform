import { describe, it, expect } from "vitest";

const outlet = require("../../services/report/outletAssortment");
const workbook = require("../../lib/report/outletAssortmentWorkbook");

describe("report/outletAssortment column contract", () => {
  it("keeps the added 奥莱安建立 sales and discount columns next to 奥莱", () => {
    const headers = outlet.OUTLET_ASSORTMENT_COLUMNS.map((column) => column.header);
    const keys = outlet.OUTLET_ASSORTMENT_COLUMNS.map((column) => column.key);

    expect(keys.indexOf("sales_outlet_anjianli_qty")).toBe(keys.indexOf("sales_outlet_qty") + 1);
    expect(keys.indexOf("discount_outlet_anjianli")).toBe(keys.indexOf("discount_outlet") + 1);
    expect(headers[keys.indexOf("sales_outlet_anjianli_qty")]).toBe("奥莱安建立");
    expect(headers[keys.indexOf("discount_outlet_anjianli")]).toBe("奥莱安建立");
  });

  it("builds group headers matching the legacy 明细 sheet layout", () => {
    const group = outlet.buildOutletAssortmentGroupHeaders({
      inventoryDate: "2026-05-18",
      dateTo: "2026-05-17",
    });

    expect(group[0]).toBe("0518库存更新");
    expect(group[9]).toBe("上架情况");
    expect(group[13]).toBe("前端同步");
    expect(group[14]).toBe("货通");
    expect(group[15]).toBe("独享仓");
    expect(group[18]).toBe("正价共享");
    expect(group[31]).toBe("5月销售");
    expect(group[50]).toBe("5月折扣");
  });

  it("formats display rows while keeping export rows numeric for Excel", () => {
    const sample = {
      season: "26Q1",
      sku: "SKU-1",
      tag_price: "299",
      inv_huotong_qty: "1.4",
      sales_outlet_qty: "2.6",
      discount_outlet: "0.123456",
    };

    const display = outlet.toOutletAssortmentRow(sample);
    const raw = outlet.toOutletAssortmentExportObject(sample);
    const keys = outlet.OUTLET_ASSORTMENT_COLUMNS.map((column) => column.key);

    expect(display[keys.indexOf("tag_price")]).toBe(299);
    expect(display[keys.indexOf("inv_huotong_qty")]).toBe(1);
    expect(display[keys.indexOf("sales_outlet_qty")]).toBe(3);
    expect(display[keys.indexOf("discount_outlet")]).toBe("12.35%");
    expect(raw.discount_outlet).toBeCloseTo(0.123456, 6);
  });
});

describe("outletAssortmentWorkbook helpers", () => {
  it("converts 1-based column numbers to Excel letters", () => {
    expect(workbook.columnLetter(1)).toBe("A");
    expect(workbook.columnLetter(26)).toBe("Z");
    expect(workbook.columnLetter(27)).toBe("AA");
    expect(workbook.columnLetter(68)).toBe("BP");
  });
});
