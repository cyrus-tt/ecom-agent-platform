import ExcelJS from "exceljs";

export async function readWorkbookFile(file) {
  const data = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(data);
  const firstSheet = workbook.worksheets[0];
  if (!firstSheet) {
    return [];
  }

  const headerRow = firstSheet.getRow(1);
  const headers = [];
  for (let index = 1; index <= headerRow.cellCount; index += 1) {
    headers.push(cellToText(headerRow.getCell(index)));
  }

  const rows = [];
  firstSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      if (!header) return;
      const value = cellToText(row.getCell(index + 1));
      if (value !== "") hasValue = true;
      record[header] = value;
    });
    if (hasValue) rows.push(record);
  });
  return rows;
}

export function ensureColumns(rows, requiredColumns, label) {
  if (!rows.length) {
    throw new Error(`${label}为空或无法读取`);
  }
  const sample = rows[0];
  const missing = requiredColumns.filter((column) => !(column in sample));
  if (missing.length) {
    throw new Error(`${label}缺少字段：${missing.join("、")}`);
  }
}

export function workbookFromSheets(sheets) {
  const workbook = new ExcelJS.Workbook();
  sheets.forEach((sheet) => {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.addRows(sheet.rows);
  });
  return workbook;
}

export async function downloadWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function escapeCsvCell(value) {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text.trimStart())) {
    text = `'${text}`;
  }
  if (text.includes('"') || text.includes(",") || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

export function downloadCsvRows(rows, filename) {
  const blob = new Blob([`\ufeff${toCsv(rows)}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function dateStamp(date = new Date()) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function cellToText(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text || "").join("").trim();
    }
    if ("result" in value) return String(value.result ?? "").trim();
    if ("text" in value) return String(value.text ?? "").trim();
    if ("hyperlink" in value && "text" in value) return String(value.text ?? "").trim();
  }
  return String(value).trim();
}
