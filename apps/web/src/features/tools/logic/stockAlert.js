import {
  ALERT_BREAK_THRESHOLD,
  ALERT_EDGE_OVERALL_SHARE,
  ALERT_EDGE_SOON_ABS_MAX,
  ALERT_EDGE_SOON_SHARE_FACTOR,
  ALERT_POOL_MIN_TOTAL,
  ALERT_SOON_ABS_MAX,
  ALERT_SOON_SHARE_FACTOR,
  MIN_TOTAL_FOR_WARNING,
  REQUIRED_INPUT_COLUMNS,
} from "../config/toolsConfig.js";
import { workbookFromSheets } from "../shared/excel.js";
import { compareSize, toNumber, toText } from "../shared/normalize.js";

export function computeStockAlerts(rows) {
  const [poolNameKey, poolCodeKey, skuKey, , sizeKey, availableKey] = REQUIRED_INPUT_COLUMNS;
  const skuIndex = new Map();

  rows.forEach((row) => {
    const sku = toText(row[skuKey]);
    const poolName = toText(row[poolNameKey]);
    const poolCode = toText(row[poolCodeKey]);
    const size = toText(row[sizeKey]);
    const available = Math.round(toNumber(row[availableKey]));
    if (!sku || !poolName || !size) return;

    const skuEntry = skuIndex.get(sku) || { pools: new Map() };
    const poolEntry = skuEntry.pools.get(poolName) || {
      name: poolName,
      code: poolCode,
      total: 0,
      sizes: new Map(),
    };
    poolEntry.total += Math.max(0, available);
    poolEntry.sizes.set(size, (poolEntry.sizes.get(size) || 0) + Math.max(0, available));
    skuEntry.pools.set(poolName, poolEntry);
    skuIndex.set(sku, skuEntry);
  });

  const sizeRows = [];
  const poolRows = [];
  const skuRows = [];

  skuIndex.forEach((skuEntry, sku) => {
    const pools = Array.from(skuEntry.pools.values());
    const eligiblePools = pools.filter((pool) => pool.total >= ALERT_POOL_MIN_TOTAL);
    if (!eligiblePools.length) return;

    const totalAll = eligiblePools.reduce((sum, pool) => sum + pool.total, 0);
    const sizeTotals = new Map();
    eligiblePools.forEach((pool) => {
      pool.sizes.forEach((value, size) => {
        sizeTotals.set(size, (sizeTotals.get(size) || 0) + value);
      });
    });

    const sizeList = Array.from(sizeTotals.keys()).sort(compareSize);
    const edgeSizes = new Set();
    if (sizeList.length) {
      edgeSizes.add(sizeList[0]);
      edgeSizes.add(sizeList[sizeList.length - 1]);
    }

    let breakCount = 0;
    let soonCount = 0;
    const warningPools = new Set();

    eligiblePools.forEach((pool) => {
      const poolTotal = pool.total;
      const poolShareOfSku = totalAll ? poolTotal / totalAll : 0;
      const breakItems = [];
      const soonItems = [];

      sizeList.forEach((size) => {
        const available = pool.sizes.get(size) || 0;
        const poolShare = poolTotal ? available / poolTotal : 0;
        const baseShare = totalAll ? (sizeTotals.get(size) || 0) / totalAll : 0;
        let level = "OK";

        if (available < ALERT_BREAK_THRESHOLD) {
          level = "已断码";
        } else if ((sizeTotals.get(size) || 0) >= MIN_TOTAL_FOR_WARNING) {
          const isEdge = edgeSizes.has(size) && baseShare < ALERT_EDGE_OVERALL_SHARE;
          const shareFactor = isEdge ? ALERT_EDGE_SOON_SHARE_FACTOR : ALERT_SOON_SHARE_FACTOR;
          const absMax = isEdge ? ALERT_EDGE_SOON_ABS_MAX : ALERT_SOON_ABS_MAX;
          if (available <= absMax && poolShare < baseShare * shareFactor) {
            level = "即将断码";
          }
        }

        if (level !== "OK") {
          sizeRows.push({
            sku,
            poolName: pool.name,
            poolCode: pool.code,
            size,
            available,
            poolTotal,
            poolShare,
            baseShare,
            level,
          });
        }
        if (level === "已断码") {
          breakCount += 1;
          breakItems.push({ size, available });
          warningPools.add(pool.name);
        } else if (level === "即将断码") {
          soonCount += 1;
          soonItems.push({ size, available });
          warningPools.add(pool.name);
        }
      });

      poolRows.push({
        sku,
        poolName: pool.name,
        poolCode: pool.code,
        poolTotal,
        poolShare: poolShareOfSku,
        breakItems,
        soonItems,
        breakCount: breakItems.length,
        soonCount: soonItems.length,
        level: breakItems.length ? "已断码" : soonItems.length ? "即将断码" : "OK",
      });
    });

    const warningLines = breakCount + soonCount;
    skuRows.push({
      sku,
      eligiblePools: eligiblePools.length,
      totalAvailable: totalAll,
      warningPools: warningPools.size,
      breakCount,
      soonCount,
      warningLines,
      level: breakCount ? "已断码" : soonCount ? "即将断码" : "OK",
      warningPoolNames: Array.from(warningPools).sort((a, b) => a.localeCompare(b, "zh")).join("、"),
    });
  });

  sizeRows.sort((a, b) => {
    const skuCmp = a.sku.localeCompare(b.sku, "zh");
    if (skuCmp !== 0) return skuCmp;
    const poolCmp = a.poolName.localeCompare(b.poolName, "zh");
    if (poolCmp !== 0) return poolCmp;
    return compareSize(a.size, b.size);
  });
  poolRows.sort((a, b) => {
    const skuCmp = a.sku.localeCompare(b.sku, "zh");
    if (skuCmp !== 0) return skuCmp;
    return b.poolTotal - a.poolTotal || a.poolName.localeCompare(b.poolName, "zh");
  });
  skuRows.sort((a, b) => {
    if (a.level !== b.level) {
      const order = { 已断码: 0, 即将断码: 1, OK: 2 };
      return (order[a.level] ?? 3) - (order[b.level] ?? 3);
    }
    return b.warningLines - a.warningLines || b.totalAvailable - a.totalAvailable || a.sku.localeCompare(b.sku, "zh");
  });

  return { sizeRows, poolRows, skuRows, skuCount: skuIndex.size };
}

export function buildStockAlertWorkbook(sizeRows, skuRows, poolRows) {
  const rules = [
    ["断码预警规则说明", ""],
    ["参与分配池门槛", `仅统计该货号在分配池总可用数 >= ${ALERT_POOL_MIN_TOTAL} 的分配池`],
    ["已断码", `某尺码在该分配池可用数 < ${ALERT_BREAK_THRESHOLD}`],
    ["即将断码(占比)", "尺码占比显著低于其他分配池平均占比（基准占比），且满足绝对数阈值；边码更严格"],
    ["尺码占比", "该池该尺码可用数 / 该池总可用数"],
    ["基准占比", "其他分配池该尺码总可用数 / 其他分配池总可用数（仅参与分配池）"],
    ["即将断码阈值(常规)", `占比 < 基准占比 * ${ALERT_SOON_SHARE_FACTOR} 且 可用数 <= ${ALERT_SOON_ABS_MAX}`],
    ["即将断码阈值(边码)", `占比 < 基准占比 * ${ALERT_EDGE_SOON_SHARE_FACTOR} 且 可用数 <= ${ALERT_EDGE_SOON_ABS_MAX}`],
    ["边码判断(豁免)", `该货号该尺码在全部参与分配池整体占比 < ${(ALERT_EDGE_OVERALL_SHARE * 100).toFixed(1)}%`],
    ["绝对数下限", `仅当该尺码在全部参与分配池总量 >= ${MIN_TOTAL_FOR_WARNING} 才计算“即将断码”`],
  ];

  const skuHeader = [
    "预警等级",
    "货号",
    `参与分配池数(总量>=${ALERT_POOL_MIN_TOTAL})`,
    "参与分配池总可用数",
    "预警分配池数",
    "已断码尺码数",
    "即将断码尺码数",
    "预警尺码合计",
    "预警分配池(去重)",
  ];
  const skuRowsOut = skuRows.map((row) => [
    row.level,
    row.sku,
    row.eligiblePools,
    row.totalAvailable,
    row.warningPools,
    row.breakCount,
    row.soonCount,
    row.warningLines,
    row.warningPoolNames || "",
  ]);

  const poolHeader = [
    "预警等级",
    "货号",
    "分配池名称",
    "分配池代码",
    "分配池总可用数",
    "分配池占比(%)",
    "已断码尺码数",
    "已断码尺码(尺码=可用)",
    "即将断码尺码数",
    "即将断码尺码(尺码=可用)",
  ];
  const poolRowsOut = poolRows.map((row) => [
    row.level,
    row.sku,
    row.poolName,
    row.poolCode,
    row.poolTotal,
    Number(((row.poolShare || 0) * 100).toFixed(2)),
    row.breakCount || 0,
    (row.breakItems || []).map((item) => `${item.size}=${item.available}`).join("、"),
    row.soonCount || 0,
    (row.soonItems || []).map((item) => `${item.size}=${item.available}`).join("、"),
  ]);

  const detailHeader = ["预警类型", "货号", "分配池名称", "分配池代码", "尺码", "可用数", "分配池总量", "尺码占比(%)", "基准占比(%)"];
  const sizeRowsOut = sizeRows.map((row) => [
    row.level,
    row.sku,
    row.poolName,
    row.poolCode,
    row.size,
    row.available,
    row.poolTotal,
    Number(((row.poolShare || 0) * 100).toFixed(2)),
    Number(((row.baseShare || 0) * 100).toFixed(2)),
  ]);

  return workbookFromSheets([
    { name: "规则说明", rows: rules },
    { name: "货号汇总", rows: [skuHeader, ...skuRowsOut] },
    { name: "分配池汇总", rows: [poolHeader, ...poolRowsOut] },
    { name: "尺码明细", rows: [detailHeader, ...sizeRowsOut] },
  ]);
}
