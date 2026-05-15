"use strict";

const { toText } = require("./numberUtils");

function filterObjectRowsByKeyword(rows, keyword, fuzzy) {
  const kw = String(keyword || "").trim();
  if (!kw) {
    return rows;
  }
  const kwUpper = kw.toUpperCase();
  const prefixRows = rows.filter((row) => {
    const sku = toText(row.sku).toUpperCase();
    const style = toText(row.style).toUpperCase();
    return sku === kwUpper || style === kwUpper || sku.startsWith(kwUpper) || style.startsWith(kwUpper);
  });

  if (prefixRows.length > 0 || !fuzzy || kwUpper.length < 3) {
    prefixRows.sort((a, b) => {
      const asku = toText(a.sku).toUpperCase();
      const bsku = toText(b.sku).toUpperCase();
      const astyle = toText(a.style).toUpperCase();
      const bstyle = toText(b.style).toUpperCase();
      const aRank = asku === kwUpper ? 0 : astyle === kwUpper ? 1 : 2;
      const bRank = bsku === kwUpper ? 0 : bstyle === kwUpper ? 1 : 2;
      if (aRank !== bRank) {
        return aRank - bRank;
      }
      return asku.localeCompare(bsku, "zh-CN");
    });
    return prefixRows;
  }

  return rows
    .filter((row) => {
      const sku = toText(row.sku).toUpperCase();
      const style = toText(row.style).toUpperCase();
      return sku.includes(kwUpper) || style.includes(kwUpper);
    })
    .sort((a, b) => toText(a.sku).localeCompare(toText(b.sku), "zh-CN"));
}

function paginateRows(rows, page, pageSize) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(500, Math.max(1, Number(pageSize) || 100));
  const offset = (safePage - 1) * safePageSize;
  return {
    items: rows.slice(offset, offset + safePageSize),
    total: rows.length,
    page: safePage,
    pageSize: safePageSize,
  };
}

module.exports = {
  filterObjectRowsByKeyword,
  paginateRows,
};
