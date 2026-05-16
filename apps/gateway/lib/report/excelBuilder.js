"use strict";

const ExcelJS = require("exceljs");
const { z } = require("zod");

const conditionalSchema = z
  .object({
    negative: z.string().optional(),
    positive: z.string().optional(),
  })
  .optional();

const columnSchema = z.object({
  header: z.string(),
  key: z.string(),
  width: z.number().positive().optional(),
  type: z.enum(["text", "number", "currency", "percent", "date"]).default("text"),
  conditional: conditionalSchema,
});

const sheetOptionsSchema = z
  .object({
    freezeRow: z.number().int().min(0).default(1),
    autoFilter: z.boolean().default(true),
    sortBy: z
      .object({
        key: z.string(),
        order: z.enum(["asc", "desc"]).default("desc"),
      })
      .optional(),
  })
  .default({});

const sheetSchema = z.object({
  name: z.string().min(1).max(31),
  columns: z.array(columnSchema).min(1),
  data: z.array(z.record(z.unknown())).default([]),
  options: sheetOptionsSchema,
});

const reportSchema = z.object({
  title: z.string().min(1),
  sheets: z.array(sheetSchema).min(1),
});

const COLORS = {
  titleFill: "1F4E79",
  headerFill: "4472C4",
  white: "FFFFFF",
  zebraGray: "F2F2F2",
  borderGray: "E0E0E0",
  red: "FF0000",
  green: "00B050",
};

const FONT_FAMILY = "微软雅黑";

const NUM_FORMATS = {
  text: undefined,
  number: "#,##0",
  currency: "¥#,##0.00",
  percent: "0.0%",
  date: "yyyy-mm-dd",
};

const MAX_AUTO_WIDTH = 40;

function estimateWidth(value) {
  const str = String(value ?? "");
  let width = 0;
  for (const ch of str) {
    width += ch.charCodeAt(0) > 0x7f ? 2.2 : 1.1;
  }
  return Math.ceil(width);
}

function resolveColumnWidths(columns, data) {
  return columns.map((col) => {
    if (col.width) return col.width;
    let maxLen = estimateWidth(col.header);
    for (const row of data) {
      const val = row[col.key];
      if (val !== undefined && val !== null) {
        maxLen = Math.max(maxLen, estimateWidth(val));
      }
    }
    return Math.min(maxLen + 2, MAX_AUTO_WIDTH);
  });
}

function sortData(data, sortBy) {
  if (!sortBy) return data;
  const { key, order } = sortBy;
  const sorted = [...data];
  sorted.sort((a, b) => {
    const va = a[key] ?? "";
    const vb = b[key] ?? "";
    if (typeof va === "number" && typeof vb === "number") {
      return order === "asc" ? va - vb : vb - va;
    }
    const sa = String(va);
    const sb = String(vb);
    return order === "asc" ? sa.localeCompare(sb) : sb.localeCompare(sa);
  });
  return sorted;
}

function isNumericType(type) {
  return type === "number" || type === "currency" || type === "percent";
}

function buildSheet(workbook, sheetDef) {
  const { name, columns, options } = sheetDef;
  const data = sortData(sheetDef.data, options.sortBy);
  const colCount = columns.length;
  const widths = resolveColumnWidths(columns, data);

  const ws = workbook.addWorksheet(name);

  for (let i = 0; i < colCount; i++) {
    ws.getColumn(i + 1).width = widths[i];
  }

  // Row 1: title
  const titleRow = ws.addRow([sheetDef._title || ""]);
  if (colCount > 1) {
    ws.mergeCells(1, 1, 1, colCount);
  }
  titleRow.height = 30;
  const titleCell = titleRow.getCell(1);
  titleCell.font = { name: FONT_FAMILY, size: 14, bold: true, color: { argb: COLORS.white } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.titleFill } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };

  // Row 2: headers
  const headerValues = columns.map((c) => c.header);
  const headerRow = ws.addRow(headerValues);
  headerRow.eachCell((cell) => {
    cell.font = { name: FONT_FAMILY, size: 11, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerFill } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: COLORS.borderGray } } };
  });

  if (options.autoFilter) {
    ws.autoFilter = {
      from: { row: 2, column: 1 },
      to: { row: 2, column: colCount },
    };
  }

  // Data rows (Row 3+)
  for (let ri = 0; ri < data.length; ri++) {
    const rowData = data[ri];
    const values = columns.map((col) => {
      const v = rowData[col.key];
      return v !== undefined && v !== null ? v : "";
    });
    const row = ws.addRow(values);
    const isEven = ri % 2 === 1;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const colDef = columns[colNumber - 1];
      if (!colDef) return;

      cell.font = { name: FONT_FAMILY, size: 11 };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: isEven ? COLORS.zebraGray : COLORS.white },
      };
      cell.border = { bottom: { style: "thin", color: { argb: COLORS.borderGray } } };

      const isNum = isNumericType(colDef.type) || colDef.type === "date";
      cell.alignment = {
        horizontal: isNum ? "right" : "left",
        vertical: "middle",
      };

      const fmt = NUM_FORMATS[colDef.type];
      if (fmt) {
        cell.numFmt = fmt;
      }
    });
  }

  // Conditional formatting via addConditionalFormatting
  for (let ci = 0; ci < colCount; ci++) {
    const col = columns[ci];
    if (!col.conditional) continue;
    const colLetter = ws.getColumn(ci + 1).letter;
    const lastDataRow = 2 + data.length;
    if (lastDataRow < 3) continue;
    const ref = `${colLetter}3:${colLetter}${lastDataRow}`;

    if (col.conditional.negative === "red") {
      ws.addConditionalFormatting({
        ref,
        rules: [
          {
            type: "cellIs",
            operator: "lessThan",
            formulae: [0],
            priority: 1,
            style: { font: { color: { argb: COLORS.red } } },
          },
        ],
      });
    }
    if (col.conditional.positive === "green") {
      ws.addConditionalFormatting({
        ref,
        rules: [
          {
            type: "cellIs",
            operator: "greaterThan",
            formulae: [0],
            priority: 2,
            style: { font: { color: { argb: COLORS.green } } },
          },
        ],
      });
    }
  }

  // Freeze panes: account for title row offset
  const freezeAfterRow = (options.freezeRow ?? 1) + 1;
  ws.views = [
    {
      state: "frozen",
      ySplit: freezeAfterRow,
      topLeftCell: `A${freezeAfterRow + 1}`,
      activeCell: `A${freezeAfterRow + 1}`,
    },
  ];
}

async function buildWorkbook(input) {
  const parsed = reportSchema.parse(input);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ecom-agent-platform";
  workbook.created = new Date();

  for (const sheet of parsed.sheets) {
    sheet._title = parsed.title;
    buildSheet(workbook, sheet);
  }

  return workbook;
}

async function buildBuffer(input) {
  const workbook = await buildWorkbook(input);
  return workbook.xlsx.writeBuffer();
}

module.exports = { buildWorkbook, buildBuffer, reportSchema };
