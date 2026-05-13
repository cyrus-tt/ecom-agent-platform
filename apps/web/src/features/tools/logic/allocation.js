import { compareSize, toNumber } from "../shared/normalize.js";

export function allocateByRatio(rows, qty) {
  const list = rows
    .map((row) => ({
      size: row.size,
      barcode: row.barcode,
      available: Math.round(toNumber(row.available)),
    }))
    .filter((row) => row.available > 0);
  const total = list.reduce((sum, row) => sum + row.available, 0);
  if (!total || qty <= 0) return { list: [], remaining: qty };

  const target = Math.min(qty, total);
  let remaining = target;
  list.forEach((row) => {
    const raw = (row.available / total) * target;
    row.alloc = Math.floor(raw);
    row._fraction = raw - row.alloc;
    remaining -= row.alloc;
  });

  list.sort((a, b) => b._fraction - a._fraction || b.available - a.available);
  for (let i = 0; i < list.length && remaining > 0; i += 1) {
    list[i].alloc += 1;
    remaining -= 1;
  }
  list.forEach((row) => {
    delete row._fraction;
  });
  list.sort((a, b) => compareSize(a.size, b.size));
  return { list, remaining: qty - target };
}

export function allocateFromAvailableMap(availableMap, qty) {
  const rows = Array.from(availableMap.values()).map((row) => ({
    size: row.size,
    barcode: row.barcode,
    available: row.available,
  }));
  return allocateByRatio(rows, qty);
}

export function allocateVirtualStocks(poolMap, qty, poolCodeLookup = new Map()) {
  const pools = Array.from(poolMap.entries()).map(([name, info]) => ({
    name,
    code: info.code || poolCodeLookup.get(name) || "",
    available: Math.round(toNumber(info.available)),
  }));
  pools.sort((a, b) => {
    const pa = poolPriority(a.name);
    const pb = poolPriority(b.name);
    if (pa !== pb) return pa - pb;
    return b.available - a.available;
  });

  const allocations = [];
  let remaining = qty;
  for (const pool of pools) {
    if (remaining <= 0) break;
    if (pool.available <= 0) continue;
    const take = Math.min(pool.available, remaining);
    allocations.push({
      poolName: pool.name,
      poolCode: pool.code,
      qty: take,
    });
    remaining -= take;
  }
  return { allocations, remaining };
}

export function allocatePhysicalStocks(warehouses, qty) {
  const list = warehouses
    .filter((warehouse) => warehouse.available > 0)
    .map((warehouse) => ({
      ...warehouse,
      rank: Number.isFinite(warehouse.rank) ? warehouse.rank : 9999,
    }))
    .sort((a, b) => a.rank - b.rank || b.available - a.available);
  const allocations = [];
  if (!list.length) return { allocations, remaining: qty };

  const single = list.find((warehouse) => warehouse.available >= qty);
  if (single) {
    return { allocations: [{ name: single.name, code: single.code, qty }], remaining: 0 };
  }

  let remaining = qty;
  for (const warehouse of list) {
    if (remaining <= 0) break;
    const take = Math.min(warehouse.available, remaining);
    allocations.push({ name: warehouse.name, code: warehouse.code, qty: take });
    remaining -= take;
  }
  return { allocations, remaining };
}

function poolPriority(name) {
  if (name === "传统电商共享仓") return 0;
  if (name === "天猫旗舰店独享仓") return 1;
  return 2;
}
