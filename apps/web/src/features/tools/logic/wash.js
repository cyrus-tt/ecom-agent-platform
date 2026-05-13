import { toNumber, toText } from "../shared/normalize.js";
import { collectPoolsFromInventory, createPoolCodeLookup } from "./inventory.js";
import { toTransferCsvRow } from "./transfer.js";

export function createWashPlan({ inventoryRows, selectedPools, sku, remark }) {
  const poolLookup = createPoolCodeLookup(inventoryRows);
  const chosenPools = selectedPools.filter((pool) => poolLookup.has(pool));
  if (chosenPools.length < 2 || chosenPools.length > 4) {
    throw new Error("请先选择 2-4 个分配池以生成洗码预览");
  }
  if (!sku) throw new Error("请先选择货号");

  const poolMap = collectPoolsFromInventory(inventoryRows);
  const rowsByBarcode = new Map();
  const poolTotals = Object.fromEntries(chosenPools.map((pool) => [pool, 0]));

  chosenPools.forEach((poolName) => {
    const list = poolMap.get(poolName) || [];
    list.forEach((row) => {
      if (row.sku !== sku) return;
      const key = row.barcode || `${row.sku}||${row.size}`;
      const entry = rowsByBarcode.get(key) || { sku: row.sku, size: row.size, barcode: row.barcode, pools: {} };
      const available = Math.max(0, Math.round(toNumber(row.available)));
      entry.pools[poolName] = (entry.pools[poolName] || 0) + available;
      rowsByBarcode.set(key, entry);
      poolTotals[poolName] += available;
    });
  });

  const totalAll = Object.values(poolTotals).reduce((sum, value) => sum + value, 0);
  if (totalAll <= 0) throw new Error("可用库存为 0");

  const previewRows = [];
  const outputRows = [];
  rowsByBarcode.forEach((entry) => {
    const totalSize = chosenPools.reduce((sum, pool) => sum + (entry.pools[pool] || 0), 0);
    if (!totalSize) return;

    const targets = {};
    let targetSum = 0;
    chosenPools.forEach((pool) => {
      const target = Math.round((totalSize * (poolTotals[pool] || 0)) / totalAll);
      targets[pool] = target;
      targetSum += target;
    });

    let adjust = totalSize - targetSum;
    const sortedPools = chosenPools.slice().sort((a, b) => (poolTotals[b] || 0) - (poolTotals[a] || 0));
    let adjustIndex = 0;
    while (adjust !== 0 && sortedPools.length) {
      const pool = sortedPools[adjustIndex % sortedPools.length];
      targets[pool] += adjust > 0 ? 1 : -1;
      adjust += adjust > 0 ? -1 : 1;
      adjustIndex += 1;
    }

    const surplus = [];
    const deficit = [];
    chosenPools.forEach((pool) => {
      const diff = (entry.pools[pool] || 0) - (targets[pool] || 0);
      if (diff > 0) surplus.push({ pool, qty: diff });
      if (diff < 0) deficit.push({ pool, qty: -diff });
    });

    surplus.forEach((from) => {
      let remaining = from.qty;
      deficit.forEach((to) => {
        if (remaining <= 0 || to.qty <= 0) return;
        const take = Math.min(remaining, to.qty);
        if (take <= 0) return;
        previewRows.push({
          source: from.pool,
          target: to.pool,
          sku: entry.sku,
          size: entry.size,
          barcode: entry.barcode,
          qty: take,
        });
        outputRows.push(toTransferCsvRow(from.pool, to.pool, entry.barcode, take, entry.size, remark || "洗码", poolLookup));
        remaining -= take;
        to.qty -= take;
      });
    });
  });

  if (!previewRows.length) throw new Error("未生成可用洗码数据，请检查库存与选择的分配池");
  return { previewRows, outputRows, poolTotals };
}

export function getWashCandidateSkus(inventoryRows, selectedPools) {
  const poolSet = new Set(selectedPools);
  const skuSet = new Set();
  inventoryRows.forEach((row) => {
    if (poolSet.has(toText(row["分配池名称"]))) {
      const sku = toText(row["货号"]);
      if (sku) skuSet.add(sku);
    }
  });
  return Array.from(skuSet).sort((a, b) => a.localeCompare(b, "zh"));
}
