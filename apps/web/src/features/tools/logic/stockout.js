import {
  FIXED_FIELDS,
  STOCKOUT_DEMAND_COLUMNS,
  STOCKOUT_MERGE_GROUPS,
  STOCKOUT_POOL_PRIORITY,
  STOCKOUT_STORE_MAP,
  STOCKOUT_STRATEGY_CODE,
  STOCKOUT_STOCK_COLUMNS,
  TEMPLATE_COLUMNS,
  VMI_MAPPING,
} from "../config/toolsConfig.js";
import { workbookFromSheets } from "../shared/excel.js";
import { compareSize, sanitizePhone, sanitizeText, toNumber, toText } from "../shared/normalize.js";
import { createPoolCodeLookup } from "./inventory.js";

export { STOCKOUT_DEMAND_COLUMNS, STOCKOUT_MERGE_GROUPS, STOCKOUT_STOCK_COLUMNS };

export function computeStockout({ demandRows, stockRows, merge }) {
  const warnings = [];
  const strategyCode = STOCKOUT_STRATEGY_CODE[merge] || "";
  if (!strategyCode && merge !== "其他") {
    warnings.push(`归并 ${merge} 未配置分配策略代码`);
  }

  const candidatePools = getStockoutCandidatePools(merge);
  if (!candidatePools.length) {
    warnings.push(`未找到可用来源池：${merge}`);
  }

  const stockIndex = buildStockoutStockIndex(stockRows);
  const vmiLookup = buildVmiLookup();
  const shortageMap = new Map();
  const demandByBarcode = new Map();
  const storeMissing = new Set();
  const [storeKey, skuKey, barcodeKey, sizeKey, qtyKey] = STOCKOUT_DEMAND_COLUMNS;

  demandRows.forEach((row, index) => {
    const store = toText(row[storeKey]);
    const sku = toText(row[skuKey]);
    const barcode = toText(row[barcodeKey]);
    const size = toText(row[sizeKey]);
    const qty = Math.round(toNumber(row[qtyKey]));
    if (!store || !sku || !barcode || !size || qty <= 0) return;
    const storeMerge = resolveStoreMerge(store);
    if (!STOCKOUT_STORE_MAP[store]) storeMissing.add(store);
    if (storeMerge !== merge) return;

    const current = shortageMap.get(barcode) || { sku, size, barcode, qty: 0 };
    current.qty += qty;
    shortageMap.set(barcode, current);
    const list = demandByBarcode.get(barcode) || [];
    list.push({ index, qty });
    demandByBarcode.set(barcode, list);
  });

  if (storeMissing.size) {
    warnings.push(`缺少店铺归并映射 ${storeMissing.size} 条，默认归为“其他”`);
  }

  const moves = [];
  const vmiLines = [];
  const details = new Map();
  const summaryMap = new Map();
  const resultByRowIndex = new Map();

  shortageMap.forEach((item) => {
    const poolMap = stockIndex.get(item.barcode) || new Map();
    const poolsWithAvail = candidatePools.map((pool) => ({
      ...pool,
      available: (poolMap.get(pool.code) || {}).available || 0,
    }));
    poolsWithAvail.sort((a, b) => a.priority - b.priority || b.available - a.available || a.name.localeCompare(b.name, "zh"));

    const poolValues = {};
    candidatePools.forEach((pool) => {
      poolValues[pool.code] = (poolMap.get(pool.code) || {}).available || 0;
    });

    let remaining = item.qty;
    const allocations = [];
    let hasVmi = false;
    poolsWithAvail.forEach((pool) => {
      if (remaining <= 0 || pool.available <= 0) return;
      const take = Math.min(pool.available, remaining);
      if (take <= 0) return;
      const vmiInfo = vmiLookup.get(pool.code) || vmiLookup.get(pool.name);
      const isVmi = Boolean(vmiInfo);
      if (isVmi) hasVmi = true;
      allocations.push({ poolName: pool.name, poolCode: pool.code, qty: take, isVmi, priority: pool.priority });
      moves.push({
        sku: item.sku,
        size: item.size,
        barcode: item.barcode,
        qty: take,
        sourceName: pool.name,
        sourceCode: pool.code,
        targetName: merge,
        targetCode: strategyCode,
        isVmi,
      });
      if (isVmi) {
        vmiLines.push({
          sku: item.sku,
          size: item.size,
          barcode: item.barcode,
          qty: take,
          poolName: pool.name,
          poolCode: pool.code,
        });
      }
      remaining -= take;
    });

    const resultLabel = remaining <= 0 ? "已挪可审" : "超时按缺";
    const orderLines = demandByBarcode.get(item.barcode) || [];
    let allocLeft = Math.max(0, item.qty - remaining);
    orderLines.forEach((line) => {
      if (allocLeft >= line.qty) {
        resultByRowIndex.set(line.index, "已挪可审");
        allocLeft -= line.qty;
      } else {
        resultByRowIndex.set(line.index, "超时按缺");
      }
    });

    const detailRow = {
      sku: item.sku,
      size: item.size,
      barcode: item.barcode,
      qty: item.qty,
      remaining,
      allocText: allocations.length ? allocations.map((a) => `${a.poolName}${a.isVmi ? "(VMI)" : ""} ${a.qty}`).join("、") : "-",
      poolValues,
      hasVmi,
      resultLabel,
    };
    const skuDetail = details.get(item.sku) || { rows: [] };
    skuDetail.rows.push(detailRow);
    details.set(item.sku, skuDetail);

    const summary = summaryMap.get(item.sku) || {
      sku: item.sku,
      totalQty: 0,
      shortageQty: 0,
      sizeMap: new Map(),
      notes: [],
      vmiNeeded: false,
    };
    summary.totalQty += item.qty;
    summary.shortageQty += remaining;
    summary.sizeMap.set(item.size, (summary.sizeMap.get(item.size) || 0) + item.qty);
    if (remaining > 0) summary.notes.push(`${item.size} 缺口 ${remaining}`);
    summary.vmiNeeded = summary.vmiNeeded || hasVmi;
    summaryMap.set(item.sku, summary);
  });

  const summaryRows = Array.from(summaryMap.values()).map((summary) => {
    const sizes = Array.from(summary.sizeMap.entries()).sort((a, b) => compareSize(a[0], b[0]));
    const status = summary.shortageQty > 0 ? "warn" : "ok";
    return {
      sku: summary.sku,
      totalQty: summary.totalQty,
      shortageQty: summary.shortageQty,
      sizeText: sizes.map(([size, qty]) => `${size}(${qty})`).join("、"),
      sizeItems: sizes.map(([size, qty]) => ({ size, qty })),
      vmiNeeded: summary.vmiNeeded,
      status,
      statusLabel: status === "ok" ? "OK" : "警示",
      statusNote: summary.notes.join("、"),
    };
  });
  summaryRows.sort((a, b) => b.totalQty - a.totalQty || a.sku.localeCompare(b.sku, "zh"));
  details.forEach((detail) => {
    detail.rows.sort((a, b) => compareSize(a.size, b.size));
  });

  return { summaryRows, details, pools: candidatePools, moves, vmiLines, warnings, resultByRowIndex };
}

export function buildStockoutMoveCsvRows(moves, remark = "缺货支持") {
  return [
    TEMPLATE_COLUMNS,
    ...moves.map((line) => [
      line.sourceCode,
      line.sourceName,
      line.targetCode,
      line.targetName,
      "",
      "",
      line.barcode,
      String(line.qty),
      "",
      remark,
      "",
      line.size,
      "",
    ]),
  ];
}

export function buildStockoutDemandWorkbook(demandRows, resultByRowIndex) {
  if (!demandRows.length) {
    return workbookFromSheets([{ name: "缺货明细", rows: [["处理结果"]] }]);
  }
  const header = Object.keys(demandRows[0]);
  const rows = demandRows.map((row, index) => {
    const line = header.map((key) => (row[key] === undefined ? "" : row[key]));
    line.push(resultByRowIndex?.get(index) || "");
    return line;
  });
  return workbookFromSheets([{ name: "缺货明细", rows: [[...header, "处理结果"], ...rows] }]);
}

export function buildVmiWorkbook(lines, merge, remark = "缺货支持") {
  const detailHeader = [
    "编码",
    "调出仓库",
    "",
    "默认调出库位",
    "调入仓库",
    "默认调入库位",
    "业务类型",
    "品牌",
    "条码",
    "货号",
    "尺码",
    "调出含税单价",
    "调入含税单价",
    "数量",
    "调出仓库-虚仓",
    "缺货自动拆分",
    "分配策略代码",
    "调拨组织",
    "调拨原因",
    "物流类型",
    "需求人",
    "调拨渠道",
    "调拨供应商",
    "京东采购|退货单号",
    "备注",
  ];
  const addressHeader = ["编码", "联系人", "联系电话", "省", "市", "区", "详细地址"];
  const vmiLookup = buildVmiLookup();
  const strategyCode = STOCKOUT_STRATEGY_CODE[merge] || "";
  const missing = new Set();

  const enriched = [];
  lines.forEach((line) => {
    const vmiInfo = vmiLookup.get(line.poolCode) || vmiLookup.get(line.poolName);
    if (!vmiInfo) {
      missing.add(line.poolName || line.poolCode || "未知分配池");
      return;
    }
    enriched.push({ ...line, vmi: vmiInfo });
  });

  const codeMap = new Map();
  enriched.forEach((line) => {
    const key = [line.vmi.outCode, line.vmi.inCode, strategyCode, line.poolCode].join("|");
    if (!codeMap.has(key)) codeMap.set(key, codeMap.size + 1);
    line.code = codeMap.get(key);
  });

  const detailRows = enriched.map((line) => [
    line.code,
    line.vmi.outCode,
    "",
    FIXED_FIELDS.defaultOutLocation,
    line.vmi.inCode,
    FIXED_FIELDS.defaultInLocation,
    100,
    1001,
    line.barcode,
    line.sku,
    line.size,
    "",
    "",
    line.qty,
    line.poolCode,
    line.poolName,
    strategyCode,
    FIXED_FIELDS.org,
    "货品整合",
    "其他",
    "",
    "",
    "",
    "",
    remark,
  ]);
  const addressRows = enriched.map((line) => [line.code, "", "", "", "", "", ""]);

  return {
    workbook: workbookFromSheets([
      { name: "单据明细", rows: [detailHeader, ...detailRows] },
      { name: "单据地址", rows: [addressHeader, ...addressRows] },
    ]),
    missing: Array.from(missing),
  };
}

function resolveStoreMerge(store) {
  return STOCKOUT_STORE_MAP[store] || "其他";
}

function resolveStockoutGroup(merge) {
  if (merge === "天猫专卖") return "专卖";
  if (merge === "品类奥莱") return "品类";
  return merge;
}

function buildStockoutStockIndex(rows) {
  const poolLookup = createPoolCodeLookup(rows);
  const stockIndex = new Map();
  rows.forEach((row) => {
    const barcode = toText(row["条码"]);
    if (!barcode) return;
    const poolName = toText(row["分配池名称"]);
    const poolCode = toText(row["分配池代码"]) || poolLookup.get(poolName) || "";
    const available = Math.round(toNumber(row["可用数"]));
    if (!poolName || !poolCode) return;
    const poolMap = stockIndex.get(barcode) || new Map();
    const current = poolMap.get(poolCode) || { name: poolName, code: poolCode, available: 0 };
    current.available += available;
    if (!current.name && poolName) current.name = poolName;
    poolMap.set(poolCode, current);
    stockIndex.set(barcode, poolMap);
  });
  return stockIndex;
}

function getStockoutCandidatePools(merge) {
  const groupKey = resolveStockoutGroup(merge);
  const poolMap = new Map();
  STOCKOUT_POOL_PRIORITY.forEach((pool) => {
    if (!pool?.code || !pool.priority || pool.priority <= 0) return;
    if (pool.group !== groupKey && pool.group !== "共享") return;
    const existing = poolMap.get(pool.code);
    if (!existing || pool.priority < existing.priority) {
      poolMap.set(pool.code, { ...pool });
    }
  });
  return Array.from(poolMap.values()).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, "zh"));
}

function buildVmiLookup() {
  const map = new Map();
  VMI_MAPPING.forEach((item) => {
    if (item.poolCode) map.set(item.poolCode, item);
    if (item.poolName) map.set(item.poolName, item);
  });
  return map;
}

export function sanitizeStockoutContactLine(line) {
  return {
    ...line,
    contact: sanitizeText(line.contact),
    phone: sanitizePhone(line.phone),
  };
}
