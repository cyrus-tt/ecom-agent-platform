import {
  CHANNEL_SUPPLIERS,
  DEMAND_CHANNEL_MAP,
  DISPATCH_DEFAULT_TRANSPORT_MODE,
  DISPATCH_DEMAND_COLUMNS,
  DISPATCH_PHYSICAL_COLUMNS,
  DISPATCH_SETTLEMENT_MODE,
  DISPATCH_VIRTUAL_COLUMNS,
  FIXED_FIELDS,
  SUPPLIER_MATCH_THRESHOLD,
} from "../config/toolsConfig.js";
import { workbookFromSheets } from "../shared/excel.js";
import { compareSize, levenshtein, normalizeText, sanitizePhone, sanitizeText, toNumber, toText } from "../shared/normalize.js";
import { allocateVirtualStocks } from "./allocation.js";
import { buildSkuSizeOptions, createPoolCodeLookup, createWarehouseCodeLookup } from "./inventory.js";

export { DISPATCH_DEMAND_COLUMNS, DISPATCH_PHYSICAL_COLUMNS, DISPATCH_VIRTUAL_COLUMNS };

export function createDispatchPlan({ demandRows, virtualRows, physicalRows, transportMode, fileName, sizeOverrides = new Map() }) {
  const poolLookup = createPoolCodeLookup(virtualRows);
  const warehouseLookup = createWarehouseCodeLookup(physicalRows);
  const virtualIndex = buildVirtualIndex(virtualRows, poolLookup);
  const physicalIndex = buildPhysicalIndex(physicalRows, warehouseLookup);
  const skuSizeOptions = buildSkuSizeOptions(virtualRows);
  const barcodes = Array.from(virtualIndex.poolsByBarcode.keys());
  const { rank } = buildWarehousePriority(barcodes, physicalIndex.warehousesByBarcode);

  const previewRows = [];
  const dispatchLines = [];
  const warnings = [...virtualIndex.warnings];
  let codeSeed = 1;

  demandRows.forEach((row, index) => {
    const sku = toText(row[DISPATCH_DEMAND_COLUMNS[0]]);
    const originalSize = toText(row[DISPATCH_DEMAND_COLUMNS[1]]);
    const size = sizeOverrides.get(index) || originalSize;
    const qty = Math.round(toNumber(row[DISPATCH_DEMAND_COLUMNS[2]]));
    const rawSupplier = toText(row[DISPATCH_DEMAND_COLUMNS[3]]);
    const requester = toText(row[DISPATCH_DEMAND_COLUMNS[4]]);
    const contact = toText(row[DISPATCH_DEMAND_COLUMNS[5]]);
    const phone = toText(row[DISPATCH_DEMAND_COLUMNS[6]]);
    const province = toText(row[DISPATCH_DEMAND_COLUMNS[7]]);
    const city = toText(row[DISPATCH_DEMAND_COLUMNS[8]]);
    const district = toText(row[DISPATCH_DEMAND_COLUMNS[9]]);
    const address = toText(row[DISPATCH_DEMAND_COLUMNS[10]]);
    const rowWarnings = [];

    if (!sku || !size || qty <= 0) {
      rowWarnings.push("需求行缺少货号/尺码/数量");
    }
    const channel = resolveChannel(requester);
    const supplierInfo = resolveSupplier(rawSupplier, channel);
    if (supplierInfo.checked && !supplierInfo.inList) {
      rowWarnings.push("供应商不在渠道清单");
    }

    const barcode = virtualIndex.skuSizeToBarcode.get(`${sku}||${size}`) || "";
    if (!barcode) {
      rowWarnings.push("未找到匹配条码");
    }

    const poolMap = barcode ? virtualIndex.poolsByBarcode.get(barcode) || new Map() : new Map();
    const { allocations, remaining } = allocateVirtualStocks(poolMap, qty, poolLookup);
    if (remaining > 0) rowWarnings.push(`库存不足 ${remaining}`);

    const warehouses = barcode
      ? (physicalIndex.warehousesByBarcode.get(barcode) || []).map((warehouse) => ({
          ...warehouse,
          rank: rank.get(warehouse.name) ?? 9999,
        }))
      : [];
    warehouses.sort((a, b) => a.rank - b.rank || b.available - a.available);
    const bestWarehouse = warehouses.find((warehouse) => warehouse.available > 0) || { name: "", code: "" };
    if (!bestWarehouse.name) rowWarnings.push("未找到实仓库存");

    previewRows.push({
      index,
      status: rowWarnings.length ? "warn" : "ok",
      statusLabel: rowWarnings.length ? "警示" : "OK",
      statusNote: rowWarnings.join("；"),
      sku,
      size,
      qty,
      supplier: supplierInfo.supplier || rawSupplier,
      supplierChanged: supplierInfo.changed,
      transportMode: transportMode || DISPATCH_DEFAULT_TRANSPORT_MODE,
      requester,
      contact,
      phone,
      province,
      city,
      district,
      address,
      sizeOptions: skuSizeOptions.get(sku) || [],
    });

    allocations.forEach((allocation) => {
      dispatchLines.push({
        code: codeSeed,
        whCode: bestWarehouse.code,
        whName: bestWarehouse.name,
        barcode,
        sku,
        size,
        qty: allocation.qty,
        poolCode: allocation.poolCode,
        poolName: allocation.poolName,
        requester,
        channel,
        supplier: supplierInfo.supplier || rawSupplier,
        transportMode: transportMode || DISPATCH_DEFAULT_TRANSPORT_MODE,
        contact,
        phone,
        province,
        city,
        district,
        address,
        fileName,
      });
      codeSeed += 1;
    });

    if (rowWarnings.length) {
      warnings.push(...rowWarnings.map((warning) => `${sku} ${size}: ${warning}`));
    }
  });

  return { previewRows, dispatchLines, warnings };
}

export function buildDispatchWorkbook(lines, fileName) {
  const detailHeader = [
    "编码",
    "调出仓库",
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
    "调样渠道",
    "调样供应商",
    "运输方式",
    "运输结算方式",
    "备注",
  ];
  const addressHeader = ["编码", "联系人", "联系电话", "省", "市", "区", "详细地址", "", ""];

  const detailRows = lines.map((line) => [
    line.code,
    line.whCode,
    FIXED_FIELDS.defaultOutLocation,
    FIXED_FIELDS.inWarehouse,
    FIXED_FIELDS.defaultInLocation,
    FIXED_FIELDS.businessType,
    FIXED_FIELDS.brand,
    line.barcode,
    line.sku,
    line.size,
    "",
    "",
    line.qty,
    line.poolCode,
    FIXED_FIELDS.allowSplit,
    FIXED_FIELDS.strategyCode,
    FIXED_FIELDS.org,
    FIXED_FIELDS.reason,
    FIXED_FIELDS.logistics,
    sanitizeText(line.requester),
    sanitizeText(line.channel),
    sanitizeText(line.supplier),
    sanitizeText(line.transportMode || DISPATCH_DEFAULT_TRANSPORT_MODE),
    DISPATCH_SETTLEMENT_MODE,
    sanitizeText(fileName),
  ]);
  const addressRows = lines.map((line) => [
    line.code,
    sanitizeText(line.contact),
    sanitizePhone(line.phone),
    sanitizeText(line.province),
    sanitizeText(line.city),
    sanitizeText(line.district),
    sanitizeText(line.address),
    "",
    "",
  ]);

  return workbookFromSheets([
    { name: "单据明细", rows: [detailHeader, ...detailRows] },
    { name: "单据地址", rows: [addressHeader, ...addressRows] },
  ]);
}

function buildVirtualIndex(rows, poolLookup) {
  const skuSizeToBarcode = new Map();
  const poolsByBarcode = new Map();
  const warnings = [];
  rows.forEach((row) => {
    const sku = toText(row["货号"]);
    const size = toText(row["尺码"]);
    const barcode = toText(row["条码"]);
    const poolName = toText(row["分配池名称"]);
    const poolCode = toText(row["分配池代码"]) || poolLookup.get(poolName) || "";
    const available = Math.round(toNumber(row["可用数"]));
    if (!sku || !size || !barcode || !poolName) return;
    const key = `${sku}||${size}`;
    if (!skuSizeToBarcode.has(key)) {
      skuSizeToBarcode.set(key, barcode);
    } else if (skuSizeToBarcode.get(key) !== barcode) {
      warnings.push(`货号+尺码存在多个条码：${sku} ${size}`);
    }
    const poolMap = poolsByBarcode.get(barcode) || new Map();
    const current = poolMap.get(poolName) || { code: poolCode, available: 0 };
    current.available += available;
    if (!current.code && poolCode) current.code = poolCode;
    poolMap.set(poolName, current);
    poolsByBarcode.set(barcode, poolMap);
  });
  return { skuSizeToBarcode, poolsByBarcode, warnings };
}

function buildPhysicalIndex(rows, warehouseLookup) {
  const warehousesByBarcode = new Map();
  rows.forEach((row) => {
    const barcode = toText(row["条码"]);
    const name = toText(row["仓库名称"]);
    const code = toText(row["仓库代码"]) || warehouseLookup.get(name) || "";
    const available = Math.round(toNumber(row["可用数/POS共享库存"]));
    if (!barcode || !name) return;
    const list = warehousesByBarcode.get(barcode) || [];
    list.push({ name, code, available });
    warehousesByBarcode.set(barcode, list);
  });
  return { warehousesByBarcode };
}

function buildWarehousePriority(barcodes, warehousesByBarcode) {
  const stats = new Map();
  const uniqueBarcodes = Array.from(new Set(barcodes));
  uniqueBarcodes.forEach((barcode) => {
    const list = warehousesByBarcode.get(barcode) || [];
    list.forEach((warehouse) => {
      const stat = stats.get(warehouse.name) || { name: warehouse.name, total: 0, hit: 0, priority: 9999 };
      stat.total += Math.max(0, warehouse.available);
      if (warehouse.available > 0) stat.hit += 1;
      stats.set(warehouse.name, stat);
    });
  });
  const order = Array.from(stats.values()).sort((a, b) => b.hit - a.hit || b.total - a.total || a.name.localeCompare(b.name, "zh"));
  const rank = new Map();
  order.forEach((item, index) => {
    rank.set(item.name, index);
  });
  return { order, rank };
}

function resolveChannel(requester) {
  return DEMAND_CHANNEL_MAP[requester] || "";
}

function resolveSupplier(rawSupplier, channel) {
  if (!rawSupplier) return { supplier: "", changed: false, checked: false, inList: true };
  if (!channel) return { supplier: rawSupplier, changed: false, checked: false, inList: true };

  const list = CHANNEL_SUPPLIERS[channel];
  if (!Array.isArray(list) || list.length === 0) {
    return { supplier: rawSupplier, changed: false, checked: false, inList: true };
  }
  if (list.includes(rawSupplier)) {
    return { supplier: rawSupplier, changed: false, checked: true, inList: true };
  }

  let best = list[0];
  let bestScore = Number.POSITIVE_INFINITY;
  list.forEach((item) => {
    const score = levenshtein(rawSupplier, item);
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  });
  const maxLen = Math.max(normalizeText(rawSupplier).length, normalizeText(best).length, 1);
  const similarity = 1 - bestScore / maxLen;
  if (similarity >= SUPPLIER_MATCH_THRESHOLD) {
    return {
      supplier: best,
      changed: normalizeText(best) !== normalizeText(rawSupplier),
      checked: true,
      inList: true,
    };
  }
  return { supplier: rawSupplier, changed: false, checked: true, inList: false };
}

export function sortDispatchSizeOptions(options) {
  return options.slice().sort(compareSize);
}
