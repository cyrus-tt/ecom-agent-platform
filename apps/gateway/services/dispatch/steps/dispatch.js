const { WAREHOUSE_MAPPING, TARGET_LOCK_POOL, DEMAND_CHANNEL_MAP, CHANNEL_SUPPLIERS, FIXED_FIELDS } = require("../constants");

// ── E3 数据索引构建 ─────────────────────────────────────────

/**
 * 构建虚仓索引
 * @param {Array<Object>} rows - E3 分配池库存导出 (json rows)
 * @returns {{ skuSizeToBarcode: Map, poolsByBarcode: Map }}
 */
function buildVirtualIndex(rows) {
  const skuSizeToBarcode = new Map();
  const poolsByBarcode = new Map();
  const warnings = [];

  for (const row of rows) {
    const sku = str(row["货号"]);
    const size = str(row["尺码"]);
    const barcode = str(row["条码"]);
    const poolName = str(row["分配池名称"]);
    const poolCode = str(row["分配池代码"]);
    const available = num(row["可用数"]);
    if (!sku || !size || !barcode) continue;

    const key = `${sku}||${size}`;
    if (!skuSizeToBarcode.has(key)) {
      skuSizeToBarcode.set(key, barcode);
    }

    const poolMap = poolsByBarcode.get(barcode) || new Map();
    const cur = poolMap.get(poolCode) || { name: poolName, code: poolCode, available: 0 };
    cur.available += available;
    poolMap.set(poolCode, cur);
    poolsByBarcode.set(barcode, poolMap);
  }

  return { skuSizeToBarcode, poolsByBarcode, warnings };
}

/**
 * 构建实仓索引
 * @param {Array<Object>} rows - E3 实仓库存导出 (json rows)
 * @returns {{ warehousesByBarcode: Map }}
 */
function buildPhysicalIndex(rows) {
  const warehousesByBarcode = new Map();

  for (const row of rows) {
    const barcode = str(row["条码"]);
    const name = str(row["仓库名称"]);
    const code = str(row["仓库代码"]) || WAREHOUSE_MAPPING.get(name) || "";
    const available = num(row["可用数/POS共享库存"]);
    if (!barcode || !name) continue;

    const list = warehousesByBarcode.get(barcode) || [];
    list.push({ name, code, available });
    warehousesByBarcode.set(barcode, list);
  }

  return { warehousesByBarcode };
}

/**
 * 构建可用尺码索引 (用于报告可替换尺码)
 */
function buildSkuSizeOptions(rows) {
  const skuSizes = new Map();
  for (const row of rows) {
    const sku = str(row["货号"]);
    const size = str(row["尺码"]);
    const available = num(row["可用数"]);
    if (!sku || !size || available <= 0) continue;
    const set = skuSizes.get(sku) || new Set();
    set.add(size);
    skuSizes.set(sku, set);
  }
  return skuSizes;
}

// ── 实仓优先级（最大覆盖 + 高库存 + 安全性） ────────────────────

/**
 * 计算实仓优先级
 * 核心逻辑:
 *  - count: 该仓库能满足（available >= 2）的条码数量 → 覆盖率
 *  - total: 该仓库所有条码的总库存 → 安全性（不容易被卖完）
 *  - 排序: count desc, total desc
 *
 * 额外规则: 如果某条码在所有仓库只有 1 件且只在一个仓有，
 *           优先从库存大的仓出（减少被卖完风险）
 */
function buildWarehousePriority(barcodes, warehousesByBarcode) {
  const stats = new Map();
  const uniqueBarcodes = [...new Set(barcodes)];

  for (const barcode of uniqueBarcodes) {
    const list = warehousesByBarcode.get(barcode) || [];
    for (const w of list) {
      const stat = stats.get(w.name) || {
        name: w.name,
        code: w.code || WAREHOUSE_MAPPING.get(w.name) || "",
        count: 0,
        total: 0,
      };
      if (w.available >= 2) stat.count += 1;
      stat.total += Math.max(0, w.available || 0);
      if (!stat.code && w.code) stat.code = w.code;
      stats.set(w.name, stat);
    }
  }

  const order = [...stats.values()].sort(
    (a, b) => b.count - a.count || b.total - a.total || a.name.localeCompare(b.name, "zh")
  );
  const rank = new Map();
  order.forEach((item, idx) => rank.set(item.name, idx));

  return { order, rank };
}

/**
 * 为单个条码分配实仓
 * 优先选能单仓满足的 + 库存最大的仓
 */
function allocatePhysicalWarehouse(barcode, qty, warehousesByBarcode, warehouseRank) {
  const warehouses = (warehousesByBarcode.get(barcode) || [])
    .filter(w => w.available > 0)
    .map(w => ({
      ...w,
      code: w.code || WAREHOUSE_MAPPING.get(w.name) || "",
      rank: warehouseRank.has(w.name) ? warehouseRank.get(w.name) : 9999,
    }))
    .sort((a, b) => a.rank - b.rank || b.available - a.available);

  if (!warehouses.length) return { allocations: [], remaining: qty };

  // 优先找能一次满足的仓（减少拆分）
  const single = warehouses.find(w => w.available >= qty);
  if (single) {
    return { allocations: [{ name: single.name, code: single.code, qty }], remaining: 0 };
  }

  // 否则从多个仓凑
  const allocations = [];
  let remaining = qty;
  for (const wh of warehouses) {
    if (remaining <= 0) break;
    const take = Math.min(wh.available, remaining);
    allocations.push({ name: wh.name, code: wh.code, qty: take });
    remaining -= take;
  }

  return { allocations, remaining };
}

// ── 虚仓移仓分配 ─────────────────────────────────────────

/**
 * 为单个条码分配虚仓移仓来源
 * 从各分配池凑够数量，移入 TARGET_LOCK_POOL
 */
function allocateVirtualPools(barcode, qty, poolsByBarcode) {
  const poolMap = poolsByBarcode.get(barcode);
  if (!poolMap) return { allocations: [], remaining: qty };

  // 跳过目标池自身（已经在锁仓里的不用移）
  const pools = [...poolMap.entries()]
    .filter(([code]) => code !== TARGET_LOCK_POOL.code)
    .map(([code, info]) => ({ code, name: info.name, available: info.available }))
    .sort((a, b) => b.available - a.available);

  const allocations = [];
  let remaining = qty;

  // 先看目标池自身有多少（不需要移仓）
  const selfPool = poolMap.get(TARGET_LOCK_POOL.code);
  const selfAvailable = selfPool ? selfPool.available : 0;
  if (selfAvailable > 0) {
    const take = Math.min(selfAvailable, remaining);
    remaining -= take;
    // 不需要生成移仓行，自身已在目标池
  }

  for (const pool of pools) {
    if (remaining <= 0) break;
    if (pool.available <= 0) continue;
    const take = Math.min(pool.available, remaining);
    allocations.push({
      sourceCode: pool.code,
      sourceName: pool.name,
      targetCode: TARGET_LOCK_POOL.code,
      barcode,
      qty: take,
    });
    remaining -= take;
  }

  return { allocations, remaining };
}

// ── 主调拨逻辑 ─────────────────────────────────────────

/**
 * 执行调拨计算
 * @param {Array} demandRows - 清洗后的需求行 (数组格式)
 * @param {Object} colMap - 列索引映射
 * @param {Object} virtualIndex - buildVirtualIndex 结果
 * @param {Object} physicalIndex - buildPhysicalIndex 结果
 * @param {string} transportMode - 运输方式
 * @param {string} remarkPrefix - 备注前缀（通常是文件名）
 * @returns {{ dispatchRows, moveRows, report }}
 */
function computeDispatch(demandRows, colMap, virtualIndex, physicalIndex, transportMode, remarkPrefix) {
  const { skuSizeToBarcode, poolsByBarcode } = virtualIndex;
  const { warehousesByBarcode } = physicalIndex;

  // 收集所有需要的条码
  const allBarcodes = [];
  const demandItems = [];

  const report = {
    ok: [],
    noBarcode: [],
    noStock: [],
    noVirtualStock: [],
    partialStock: [],
    duplicateConfirm: [],
    addressIssues: [],
  };

  for (const row of demandRows) {
    const sku = str(row[colMap.sku]);
    const size = str(row[colMap.size]);
    const qty = parseInt(row[colMap.qty], 10) || 0;
    const supplier = str(row[colMap.supplier]);
    const requester = str(row[colMap.requester]);
    const contact = str(row[colMap.contact]);
    const phone = str(row[colMap.phone]);
    const province = colMap.province >= 0 ? str(row[colMap.province]) : "";
    const city = str(row[colMap.city]);
    const district = str(row[colMap.district]);
    const detail = str(row[colMap.detail]);

    if (!sku || qty <= 0) continue;

    // 匹配条码
    const key = `${sku}||${size}`;
    const barcode = skuSizeToBarcode.get(key);

    if (!barcode) {
      report.noBarcode.push({ sku, size, qty, reason: "分配池库存中未找到该货号+尺码" });
      continue;
    }

    allBarcodes.push(barcode);
    demandItems.push({
      sku, size, qty, barcode, supplier, requester, contact, phone,
      province, city, district, detail,
    });
  }

  // 计算实仓优先级
  const { rank: warehouseRank } = buildWarehousePriority(allBarcodes, warehousesByBarcode);

  // 为每个需求行分配实仓和虚仓
  const dispatchLines = [];
  const moveLines = [];

  for (const item of demandItems) {
    // 分配实仓
    const phys = allocatePhysicalWarehouse(item.barcode, item.qty, warehousesByBarcode, warehouseRank);

    if (phys.allocations.length === 0) {
      report.noStock.push({ ...item, reason: "所有实仓均无库存" });
      continue;
    }

    const fulfilledQty = item.qty - phys.remaining;
    if (fulfilledQty <= 0) {
      report.noStock.push({ ...item, reason: "实仓可发数量为 0" });
      continue;
    }

    // 严格阻断：虚仓不足时不允许生成调拨
    const virt = allocateVirtualPools(item.barcode, fulfilledQty, poolsByBarcode);
    if (virt.remaining > 0) {
      report.noVirtualStock.push({
        ...item,
        physicalFulfilled: fulfilledQty,
        virtualMissing: virt.remaining,
        reason: `虚仓可用不足，需${fulfilledQty}件，虚仓缺${virt.remaining}件，已阻断`,
      });
      continue;
    }

    if (phys.remaining > 0) {
      report.partialStock.push({
        ...item,
        fulfilled: fulfilledQty,
        missing: phys.remaining,
        reason: `实仓库存不足，需要${item.qty}件，实际可发${fulfilledQty}件`,
      });
    }

    for (const alloc of virt.allocations) {
      moveLines.push(alloc);
    }

    // 生成调拨行（每个实仓一行）
    const channel = DEMAND_CHANNEL_MAP[item.requester] || "";

    for (const alloc of phys.allocations) {
      dispatchLines.push({
        warehouse: alloc.code,
        warehouseName: alloc.name,
        barcode: item.barcode,
        sku: item.sku,
        size: item.size,
        qty: alloc.qty,
        requester: item.requester,
        channel,
        supplier: item.supplier,
        transportMode,
        contact: item.contact,
        phone: item.phone,
        province: item.province,
        city: item.city,
        district: item.district,
        detail: item.detail,
        remark: remarkPrefix,
      });
    }

    report.ok.push({
      sku: item.sku,
      size: item.size,
      qtyRequested: item.qty,
      qtyDispatched: fulfilledQty,
      barcode: item.barcode,
    });
  }

  // 单据分组：实仓 + 供应商 + 完整地址 → 编码
  const groupKeyMap = new Map();
  let nextDocId = 1;

  for (const line of dispatchLines) {
    const groupKey = [
      line.warehouse,
      line.supplier,
      line.province,
      line.city,
      line.district,
      line.detail,
    ].join("||");

    if (!groupKeyMap.has(groupKey)) {
      groupKeyMap.set(groupKey, nextDocId++);
    }
    line.docId = groupKeyMap.get(groupKey);
  }

  // 同一单据内不允许重复条码：发现后阻断，等待人工确认
  const docBarcodeMap = new Map();
  for (const line of dispatchLines) {
    const key = `${line.docId}||${line.barcode}`;
    const list = docBarcodeMap.get(key) || [];
    list.push(line);
    docBarcodeMap.set(key, list);
  }

  const conflictKeys = new Set();
  const blockedQtyByBarcode = new Map();
  for (const [key, list] of docBarcodeMap.entries()) {
    if (list.length <= 1) continue;
    conflictKeys.add(key);

    const totalQty = list.reduce((s, l) => s + l.qty, 0);
    const [docId, barcode] = key.split("||");
    report.duplicateConfirm.push({
      docId,
      barcode,
      sku: list[0].sku,
      size: list[0].size,
      supplier: list[0].supplier,
      lineCount: list.length,
      totalQty,
      reason: `同一单据(${docId})内条码重复，需与需求人确认后再处理`,
    });

    blockedQtyByBarcode.set(barcode, (blockedQtyByBarcode.get(barcode) || 0) + totalQty);
  }

  let finalDispatchLines = dispatchLines;
  let finalMoveLines = moveLines;
  if (conflictKeys.size > 0) {
    finalDispatchLines = dispatchLines.filter(
      (line) => !conflictKeys.has(`${line.docId}||${line.barcode}`)
    );
    finalMoveLines = deductMoveLinesByBarcode(moveLines, blockedQtyByBarcode);
  }

  return {
    dispatchLines: finalDispatchLines,
    moveLines: finalMoveLines,
    report,
    docCount: nextDocId - 1,
  };
}

// ── 工具函数 ──────────────────────────────────────────────

function str(v) {
  if (v == null) return "";
  return String(v).trim();
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function deductMoveLinesByBarcode(moveLines, blockedQtyByBarcode) {
  const remaining = new Map(blockedQtyByBarcode);
  const result = [];

  for (const line of moveLines) {
    const blocked = remaining.get(line.barcode) || 0;
    if (blocked <= 0) {
      result.push(line);
      continue;
    }

    if (line.qty <= blocked) {
      remaining.set(line.barcode, blocked - line.qty);
      continue;
    }

    const kept = { ...line, qty: line.qty - blocked };
    remaining.set(line.barcode, 0);
    result.push(kept);
  }

  return result;
}

module.exports = {
  buildVirtualIndex,
  buildPhysicalIndex,
  buildSkuSizeOptions,
  buildWarehousePriority,
  computeDispatch,
};
