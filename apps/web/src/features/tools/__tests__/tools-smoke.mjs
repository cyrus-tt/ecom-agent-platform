import assert from "node:assert/strict";
import { escapeCsvCell } from "../shared/excel.js";
import { allocateByRatio } from "../logic/allocation.js";
import { createRuleTransferPlan, createSingleTransferPlan } from "../logic/transfer.js";
import { computeStockAlerts } from "../logic/stockAlert.js";
import { computeStockout } from "../logic/stockout.js";

const allocated = allocateByRatio(
  [
    { size: "S", barcode: "b1", available: 10 },
    { size: "M", barcode: "b2", available: 30 },
  ],
  8
);
assert.equal(allocated.remaining, 0);
assert.deepEqual(
  allocated.list.map((row) => row.alloc),
  [2, 6]
);

assert.equal(escapeCsvCell("=1+1"), "'=1+1");
assert.equal(escapeCsvCell("hello,world"), '"hello,world"');

const inventoryRows = [
  { 分配池名称: "源池", 分配池代码: "SRC", 货号: "SKU1", 条码: "B40", 尺码: "40", 可用数: "10" },
  { 分配池名称: "源池", 分配池代码: "SRC", 货号: "SKU1", 条码: "B41", 尺码: "41", 可用数: "30" },
  { 分配池名称: "目标池", 分配池代码: "DST", 货号: "SKU1", 条码: "B40", 尺码: "40", 可用数: "0" },
];
const transfer = createSingleTransferPlan({
  inventoryRows,
  sourceName: "源池",
  targetName: "目标池",
  sku: "SKU1",
  moveMode: "qty",
  qty: 8,
  remark: "测试",
});
assert.equal(transfer.outputRows.length, 2);
assert.equal(transfer.outputRows[0][0], "SRC");
assert.equal(transfer.outputRows[0][2], "DST");

const ruleTransfer = createRuleTransferPlan({
  inventoryRows: [
    { 分配池名称: "源池", 分配池代码: "SRC", 货号: "SKU1", 条码: "B40", 尺码: "40", 可用数: "5" },
    { 分配池名称: "目标池A", 分配池代码: "DSTA", 货号: "SKU1", 条码: "B40", 尺码: "40", 可用数: "0" },
    { 分配池名称: "目标池B", 分配池代码: "DSTB", 货号: "SKU1", 条码: "B40", 尺码: "40", 可用数: "0" },
  ],
  rules: [
    { source: "源池", target: "目标池A", sku: "SKU1", mode: "qty", qty: 4, ratio: 0, remark: "" },
    { source: "源池", target: "目标池B", sku: "SKU1", mode: "qty", qty: 4, ratio: 0, remark: "" },
  ],
  remark: "",
});
assert.equal(
  ruleTransfer.outputRows.reduce((sum, row) => sum + Number(row[7]), 0),
  5
);
assert.ok(ruleTransfer.warnings.some((warning) => warning.includes("缺口 3")));

const alerts = computeStockAlerts([
  { 分配池名称: "池A", 分配池代码: "A", 货号: "SKU1", 条码: "A40", 尺码: "40", 可用数: "1" },
  { 分配池名称: "池A", 分配池代码: "A", 货号: "SKU1", 条码: "A41", 尺码: "41", 可用数: "60" },
  { 分配池名称: "池B", 分配池代码: "B", 货号: "SKU1", 条码: "B40", 尺码: "40", 可用数: "30" },
  { 分配池名称: "池B", 分配池代码: "B", 货号: "SKU1", 条码: "B41", 尺码: "41", 可用数: "30" },
]);
assert.equal(alerts.skuRows[0].level, "已断码");
assert.ok(alerts.sizeRows.some((row) => row.poolName === "池A" && row.size === "40"));

const stockout = computeStockout({
  merge: "天旗",
  demandRows: [{ 订单所属商店: "天猫-安踏官方网店", 货号: "SKU1", 条码: "BC1", 规格: "40", 数量: "3" }],
  stockRows: [{ 分配池名称: "天猫旗舰店独享仓", 分配池代码: "CK_GXDXXC", 货号: "SKU1", 条码: "BC1", 尺码: "40", 可用数: "5" }],
});
assert.equal(stockout.summaryRows.length, 1);
assert.equal(stockout.summaryRows[0].shortageQty, 0);
assert.equal(stockout.moves.length, 1);

console.log("tools smoke tests passed");
