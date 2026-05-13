import { POOL_CODE_BY_NAME, REQUIRED_INPUT_COLUMNS, WAREHOUSE_CODE_BY_NAME } from "../config/toolsConfig.js";
import { compareSize, toNumber, toText } from "../shared/normalize.js";

export function createPoolCodeLookup(rows = []) {
  const lookup = new Map(POOL_CODE_BY_NAME);
  rows.forEach((row) => {
    const name = toText(row["分配池名称"]);
    const code = toText(row["分配池代码"]);
    if (name && code) lookup.set(name, code);
  });
  return lookup;
}

export function createWarehouseCodeLookup(rows = []) {
  const lookup = new Map(WAREHOUSE_CODE_BY_NAME);
  rows.forEach((row) => {
    const name = toText(row["仓库名称"]);
    const code = toText(row["仓库代码"]);
    if (name && code) lookup.set(name, code);
  });
  return lookup;
}

export function collectPoolsFromInventory(rows) {
  const [poolNameKey, poolCodeKey, skuKey, barcodeKey, sizeKey, availableKey] = REQUIRED_INPUT_COLUMNS;
  const poolMap = new Map();
  rows.forEach((row) => {
    const poolName = toText(row[poolNameKey]);
    if (!poolName) return;
    const item = {
      poolName,
      poolCode: toText(row[poolCodeKey]),
      sku: toText(row[skuKey]),
      size: toText(row[sizeKey]),
      barcode: toText(row[barcodeKey]),
      available: Math.round(toNumber(row[availableKey])),
    };
    const list = poolMap.get(poolName) || [];
    list.push(item);
    poolMap.set(poolName, list);
  });
  return poolMap;
}

export function buildAvailableMap(rows) {
  const [, , , barcodeKey, sizeKey, availableKey] = REQUIRED_INPUT_COLUMNS;
  const map = new Map();
  rows.forEach((row) => {
    const barcode = toText(row[barcodeKey]);
    const size = toText(row[sizeKey]);
    const available = Math.round(toNumber(row[availableKey]));
    if (!barcode || !size) return;
    const current = map.get(barcode) || { size, barcode, available: 0 };
    current.available += available;
    map.set(barcode, current);
  });
  return map;
}

export function getInventoryMeta(rows) {
  const poolLookup = createPoolCodeLookup(rows);
  const poolNames = Array.from(new Set([...poolLookup.keys(), ...rows.map((row) => toText(row["分配池名称"])).filter(Boolean)])).sort(
    (a, b) => a.localeCompare(b, "zh")
  );
  const skuSet = new Set(rows.map((row) => toText(row["货号"])).filter(Boolean));
  const skus = Array.from(skuSet).sort((a, b) => a.localeCompare(b, "zh"));
  return {
    rowCount: rows.length,
    poolNames,
    poolLookup,
    skus,
    singleSku: skus.length === 1 ? skus[0] : "",
  };
}

export function getSkusForSource(rows, sourceName) {
  const skuSet = new Set();
  rows.forEach((row) => {
    if (toText(row["分配池名称"]) === sourceName) {
      const sku = toText(row["货号"]);
      if (sku) skuSet.add(sku);
    }
  });
  return Array.from(skuSet).sort((a, b) => a.localeCompare(b, "zh"));
}

export function getSkusForPools(rows, poolNames) {
  const poolSet = new Set(poolNames);
  const skuSet = new Set();
  rows.forEach((row) => {
    if (poolSet.has(toText(row["分配池名称"]))) {
      const sku = toText(row["货号"]);
      if (sku) skuSet.add(sku);
    }
  });
  return Array.from(skuSet).sort((a, b) => a.localeCompare(b, "zh"));
}

export function buildSkuSizeOptions(rows) {
  const skuSizes = new Map();
  rows.forEach((row) => {
    const sku = toText(row["货号"]);
    const size = toText(row["尺码"]);
    if (!sku || !size) return;
    const set = skuSizes.get(sku) || new Set();
    set.add(size);
    skuSizes.set(sku, set);
  });
  const result = new Map();
  skuSizes.forEach((set, sku) => {
    result.set(sku, Array.from(set).sort(compareSize));
  });
  return result;
}
