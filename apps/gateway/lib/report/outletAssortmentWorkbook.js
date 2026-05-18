"use strict";

const ExcelJS = require("exceljs");

const FONT_FAMILY = "微软雅黑";

const COLORS = {
  headerFill: "D9EAD3",
  groupFill: "FCE4D6",
  inventoryFill: "E2F0D9",
  salesFill: "DDEBF7",
  discountFill: "FFF2CC",
  manualFill: "F4CCCC",
  border: "B7B7B7",
  white: "FFFFFF",
};

function columnLetter(indexOneBased) {
  let n = indexOneBased;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function sectionFill(columnNumber) {
  if (columnNumber >= 10 && columnNumber <= 13) return COLORS.manualFill;
  if (columnNumber >= 14 && columnNumber <= 31) return COLORS.inventoryFill;
  if (columnNumber >= 32 && columnNumber <= 50) return COLORS.salesFill;
  if (columnNumber >= 51) return COLORS.discountFill;
  return COLORS.headerFill;
}

function styleHeaderCell(cell, columnNumber, isGroupRow) {
  cell.font = { name: FONT_FAMILY, size: 11, bold: true };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: isGroupRow ? COLORS.groupFill : sectionFill(columnNumber) },
  };
  cell.border = {
    top: { style: "thin", color: { argb: COLORS.border } },
    left: { style: "thin", color: { argb: COLORS.border } },
    bottom: { style: "thin", color: { argb: COLORS.border } },
    right: { style: "thin", color: { argb: COLORS.border } },
  };
}

function styleDataCell(cell, column, columnNumber) {
  cell.font = { name: FONT_FAMILY, size: 10 };
  cell.alignment = {
    horizontal: column.type === "text" ? "left" : "right",
    vertical: "middle",
  };
  cell.border = {
    bottom: { style: "hair", color: { argb: COLORS.border } },
    right: { style: "hair", color: { argb: COLORS.border } },
  };
  if (column.type === "number") {
    cell.numFmt = "#,##0";
  } else if (column.type === "percent") {
    cell.numFmt = "0.00%";
  }
  if (columnNumber >= 10 && columnNumber <= 13) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF8F8" },
    };
  }
}

function applyMerges(ws) {
  ws.mergeCells("J1:K1");
  ws.mergeCells("P1:Q1");
  ws.mergeCells("S1:AA1");
}

async function buildOutletAssortmentWorkbook({ columns, groupHeaders, rows }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ecom-agent-platform";
  workbook.created = new Date();

  const ws = workbook.addWorksheet("明细");
  ws.properties.defaultRowHeight = 18;
  ws.views = [
    {
      state: "frozen",
      ySplit: 2,
      topLeftCell: "A3",
      activeCell: "A3",
    },
  ];

  for (let i = 0; i < columns.length; i += 1) {
    ws.getColumn(i + 1).width = columns[i].width || 12;
  }

  const groupRow = ws.addRow(groupHeaders);
  const headerRow = ws.addRow(columns.map((column) => column.header));
  groupRow.height = 24;
  headerRow.height = 30;

  applyMerges(ws);

  groupRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => styleHeaderCell(cell, columnNumber, true));
  headerRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => styleHeaderCell(cell, columnNumber, false));

  ws.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2, column: columns.length },
  };

  for (const row of rows || []) {
    const values = columns.map((column) => row[column.key]);
    const excelRow = ws.addRow(values);
    excelRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const column = columns[columnNumber - 1];
      if (column) {
        styleDataCell(cell, column, columnNumber);
      }
    });
  }

  ws.getRow(1).outlineLevel = 0;
  ws.getRow(2).outlineLevel = 0;
  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };

  const lastColumn = columnLetter(columns.length);
  ws.pageSetup.printArea = `A1:${lastColumn}${Math.max(2, 2 + (rows || []).length)}`;

  return workbook;
}

async function buildOutletAssortmentBuffer(input) {
  const workbook = await buildOutletAssortmentWorkbook(input);
  return workbook.xlsx.writeBuffer();
}

module.exports = {
  buildOutletAssortmentWorkbook,
  buildOutletAssortmentBuffer,
  columnLetter,
};
