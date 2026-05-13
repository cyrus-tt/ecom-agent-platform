import { REQUIRED_INPUT_COLUMNS, RULE_COLUMNS } from "../config/toolsConfig.js";
import { toNumber, toText } from "../shared/normalize.js";
import { allocateFromAvailableMap, allocateByRatio } from "./allocation.js";
import { buildAvailableMap, createPoolCodeLookup } from "./inventory.js";

function findColumnKey(sample, candidates) {
  return candidates.find((key) => key in sample) || "";
}

export function parseTransferRuleRows(rows) {
  if (!rows.length) throw new Error("移仓规则表为空或无法读取");
  const sample = rows[0];
  const sourceKey = findColumnKey(sample, RULE_COLUMNS.source);
  const targetKey = findColumnKey(sample, RULE_COLUMNS.target);
  const skuKey = findColumnKey(sample, RULE_COLUMNS.sku);
  const ratioKey = findColumnKey(sample, RULE_COLUMNS.ratio);
  const qtyKey = findColumnKey(sample, RULE_COLUMNS.qty);
  const remarkKey = findColumnKey(sample, RULE_COLUMNS.remark);

  if (!sourceKey || !targetKey || !skuKey) {
    throw new Error("移仓规则表缺少必要字段（源分配池/目标分配池/货号）");
  }
  if (!ratioKey && !qtyKey) {
    throw new Error("移仓规则表缺少比例或数量字段");
  }

  const rules = [];
  const warnings = [];
  rows.forEach((row, index) => {
    const source = toText(row[sourceKey]);
    const target = toText(row[targetKey]);
    const sku = toText(row[skuKey]);
    const ratio = ratioKey ? toNumber(row[ratioKey]) : 0;
    const qty = qtyKey ? toNumber(row[qtyKey]) : 0;
    const remark = remarkKey ? toText(row[remarkKey]) : "";

    if (!source || !target || !sku) {
      warnings.push(`第 ${index + 1} 行缺少源/目标/货号`);
      return;
    }
    if (qty > 0) {
      rules.push({ source, target, sku, mode: "qty", qty: Math.round(qty), ratio: 0, remark });
      return;
    }
    if (ratio > 0) {
      rules.push({ source, target, sku, mode: "ratio", qty: 0, ratio, remark });
      return;
    }
    warnings.push(`第 ${index + 1} 行缺少有效比例或数量`);
  });

  return { rules, warnings };
}

export function createSingleTransferPlan({ inventoryRows, sourceName, targetName, sku, moveMode, qty, ratio, remark }) {
  const poolLookup = createPoolCodeLookup(inventoryRows);
  const source = toText(sourceName);
  const target = toText(targetName);
  const targetSku = toText(sku);

  if (!source || !target) throw new Error("请输入源/目标分配池名称");
  if (!poolLookup.has(source)) throw new Error("源分配池名称不存在，请从候选项中选择");
  if (!poolLookup.has(target)) throw new Error("目标分配池名称不存在，请从候选项中选择");
  if (source === target) throw new Error("源分配池与目标分配池不能相同");
  if (!targetSku) throw new Error("请输入货号");

  const filteredRows = inventoryRows.filter(
    (row) => toText(row[REQUIRED_INPUT_COLUMNS[0]]) === source && toText(row[REQUIRED_INPUT_COLUMNS[2]]) === targetSku
  );
  if (!filteredRows.length) throw new Error("未找到匹配的库存");

  const totalAvailable = filteredRows.reduce((sum, row) => sum + toNumber(row[REQUIRED_INPUT_COLUMNS[5]]), 0);
  if (totalAvailable <= 0) throw new Error("可用数合计为 0");

  let targetQty = 0;
  if (moveMode === "ratio") {
    const ratioValue = Number(ratio);
    if (!Number.isFinite(ratioValue) || ratioValue <= 0 || ratioValue > 100) {
      throw new Error("请输入有效的移仓比例 (0-100)");
    }
    targetQty = Math.round((totalAvailable * ratioValue) / 100);
    if (targetQty < 1) throw new Error("移仓比例过小，计算数量为 0");
  } else {
    targetQty = Number(qty);
    if (!Number.isFinite(targetQty) || targetQty <= 0) throw new Error("请输入有效的移仓数量");
    if (targetQty > totalAvailable) throw new Error(`移仓数量 ${targetQty} 大于可用数合计 ${totalAvailable}`);
  }

  const rows = filteredRows.map((row) => ({
    size: toText(row[REQUIRED_INPUT_COLUMNS[4]]),
    barcode: toText(row[REQUIRED_INPUT_COLUMNS[3]]),
    available: Math.round(toNumber(row[REQUIRED_INPUT_COLUMNS[5]])),
  }));
  const { list } = allocateByRatio(rows, targetQty);
  const outputRows = buildTransferCsvRows(list, source, target, remark, poolLookup);
  const previewRows = list.map((row) => ({
    source,
    target,
    sku: targetSku,
    size: row.size,
    barcode: row.barcode,
    available: row.available,
    alloc: row.alloc || 0,
    ratioPct: totalAvailable ? Number((((row.alloc || 0) / totalAvailable) * 100).toFixed(2)) : 0,
  }));
  return { previewRows, outputRows, warnings: [], totalAvailable, targetQty };
}

export function createRuleTransferPlan({ inventoryRows, rules, remark }) {
  const poolLookup = createPoolCodeLookup(inventoryRows);
  const previewRows = [];
  const outputRows = [];
  const warnings = [];
  const ruleGroups = new Map();

  rules.forEach((rule) => {
    const key = `${rule.source}||${rule.sku}`;
    const list = ruleGroups.get(key) || [];
    list.push(rule);
    ruleGroups.set(key, list);
  });

  ruleGroups.forEach((groupedRules, key) => {
    const [sourceName, sku] = key.split("||");
    if (!poolLookup.has(sourceName)) {
      warnings.push(`源分配池不存在：${sourceName}`);
      return;
    }

    const sourceRows = inventoryRows.filter(
      (row) => toText(row[REQUIRED_INPUT_COLUMNS[0]]) === sourceName && toText(row[REQUIRED_INPUT_COLUMNS[2]]) === sku
    );
    if (!sourceRows.length) {
      warnings.push(`未找到库存：${sourceName} / ${sku}`);
      return;
    }

    const availableMap = buildAvailableMap(sourceRows);
    const totalAvailable = Array.from(availableMap.values()).reduce((sum, item) => sum + item.available, 0);
    if (totalAvailable <= 0) {
      warnings.push(`可用数合计为 0：${sourceName} / ${sku}`);
      return;
    }

    groupedRules.forEach((rule) => {
      if (!poolLookup.has(rule.target)) {
        warnings.push(`目标分配池不存在：${rule.target}`);
        return;
      }
      const ruleQty = rule.mode === "qty" ? Math.round(rule.qty) : Math.round((totalAvailable * rule.ratio) / 100);
      if (!ruleQty || ruleQty <= 0) {
        warnings.push(`规则数量为 0：${rule.source} / ${rule.sku} → ${rule.target}`);
        return;
      }

      const availableNow = Array.from(availableMap.values()).reduce((sum, item) => sum + item.available, 0);
      if (availableNow <= 0) {
        warnings.push(`库存不足：${rule.source} / ${rule.sku}`);
        return;
      }

      const actualQty = Math.min(ruleQty, availableNow);
      if (actualQty < ruleQty) {
        warnings.push(`库存不足：${rule.source} / ${rule.sku} → ${rule.target} 缺口 ${ruleQty - actualQty}`);
      }

      const { list } = allocateFromAvailableMap(availableMap, actualQty);
      consumeAvailable(availableMap, list);
      const ratioPct = rule.mode === "ratio" ? Number(rule.ratio.toFixed(2)) : Number(((ruleQty / totalAvailable) * 100).toFixed(2));
      const rowRemark = rule.remark || remark;
      list.forEach((item) => {
        if (item.alloc <= 0) return;
        previewRows.push({
          source: rule.source,
          target: rule.target,
          sku: rule.sku,
          size: item.size,
          barcode: item.barcode,
          available: item.available,
          ratioPct,
          alloc: item.alloc,
        });
        outputRows.push(toTransferCsvRow(rule.source, rule.target, item.barcode, item.alloc, item.size, rowRemark, poolLookup));
      });
    });
  });

  previewRows.sort((a, b) => {
    const sourceCmp = a.source.localeCompare(b.source, "zh");
    if (sourceCmp !== 0) return sourceCmp;
    const targetCmp = a.target.localeCompare(b.target, "zh");
    if (targetCmp !== 0) return targetCmp;
    const skuCmp = a.sku.localeCompare(b.sku, "zh");
    if (skuCmp !== 0) return skuCmp;
    return a.size.localeCompare(b.size, "zh");
  });

  if (!outputRows.length) {
    throw new Error("未生成可用移仓数据，请检查规则与库存");
  }
  return { previewRows, outputRows, warnings };
}

function buildTransferCsvRows(rows, sourceName, targetName, remark, poolLookup) {
  return rows
    .filter((row) => row.alloc > 0)
    .map((row) => toTransferCsvRow(sourceName, targetName, row.barcode, row.alloc, row.size, remark, poolLookup));
}

export function toTransferCsvRow(sourceName, targetName, barcode, qty, size, remark, poolLookup) {
  return [
    poolLookup.get(sourceName) || "",
    sourceName,
    poolLookup.get(targetName) || "",
    targetName,
    "",
    "",
    barcode,
    String(qty),
    "",
    remark || "",
    "",
    size,
    "",
  ];
}

function consumeAvailable(availableMap, allocatedRows) {
  allocatedRows.forEach((row) => {
    if (!row.barcode || !row.alloc) return;
    const current = availableMap.get(row.barcode);
    if (!current) return;
    current.available = Math.max(0, current.available - row.alloc);
    availableMap.set(row.barcode, current);
  });
}
