const XLSX = require("xlsx");
const { FIXED_FIELDS, TARGET_LOCK_POOL, DISPATCH_DETAIL_COLUMNS, DISPATCH_ADDRESS_COLUMNS, MOVE_TIP_ROW, MOVE_TEMPLATE_COLUMNS } = require("../constants");

// ── 调拨批量导入模板 (xlsx, 两个 sheet) ─────────────────────

function buildDispatchWorkbook(dispatchLines) {
  const detailRows = [];
  const addressRows = [];

  for (const line of dispatchLines) {
    detailRows.push([
      line.docId,                       // 编码
      line.warehouse,                   // 调出仓库
      FIXED_FIELDS.defaultOutLocation,  // 默认调出库位
      FIXED_FIELDS.inWarehouse,         // 调入仓库
      FIXED_FIELDS.defaultInLocation,   // 默认调入库位
      FIXED_FIELDS.businessType,        // 业务类型
      FIXED_FIELDS.brand,               // 品牌
      line.barcode,                     // 条码
      line.sku,                         // 货号
      line.size,                        // 尺码
      "",                               // 调出含税单价
      "",                               // 调入含税单价
      line.qty,                         // 数量
      TARGET_LOCK_POOL.code,            // 调出仓库-虚仓
      FIXED_FIELDS.allowSplit,          // 缺货自动拆分
      FIXED_FIELDS.strategyCode,        // 分配策略代码
      FIXED_FIELDS.org,                 // 调拨组织
      FIXED_FIELDS.reason,              // 调拨原因
      FIXED_FIELDS.logistics,           // 物流类型
      line.requester,                   // 需求人
      line.channel,                     // 调样渠道
      line.supplier,                    // 调样供应商
      line.transportMode,               // 运输方式
      FIXED_FIELDS.settlementMode,      // 运输结算方式
      line.remark,                      // 备注
    ]);

    addressRows.push([
      line.docId,                       // 编码
      line.contact,                     // 联系人
      line.phone,                       // 联系电话
      line.province,                    // 省
      line.city,                        // 市
      line.district,                    // 区
      line.detail,                      // 详细地址
    ]);
  }

  const wb = XLSX.utils.book_new();

  // Sheet 1: 单据明细
  const detailData = [DISPATCH_DETAIL_COLUMNS, ...detailRows];
  const ws1 = XLSX.utils.aoa_to_sheet(detailData);
  XLSX.utils.book_append_sheet(wb, ws1, "单据明细");

  // Sheet 2: 单据地址
  const addrData = [DISPATCH_ADDRESS_COLUMNS, ...addressRows];
  const ws2 = XLSX.utils.aoa_to_sheet(addrData);
  XLSX.utils.book_append_sheet(wb, ws2, "单据地址");

  return wb;
}

// ── 移仓 CSV ─────────────────────────────────────────────

function buildMoveCsv(moveLines, remark = "市场调样") {
  const rows = [];
  const colCount = MOVE_TEMPLATE_COLUMNS.length;

  // 第一行: 提示
  rows.push(toCsvRow([MOVE_TIP_ROW, ...new Array(colCount - 1).fill("")]));

  // 第二行: 列头
  rows.push(toCsvRow(MOVE_TEMPLATE_COLUMNS));

  // 数据行
  for (const line of moveLines) {
    rows.push(toCsvRow([
      line.sourceCode,            // 源分配池代码
      "",                         // 源分配池名称
      line.targetCode,            // 目标分配池代码
      "",                         // 目标分配池名称
      "",                         // 货号
      "",                         // 单品代码
      line.barcode,               // 69码
      line.qty,                   // 数量
      "",                         // 比例
      remark,                     // 备注
      "",                         // 来源单据编号
      "",                         // 尺码
      "",                         // 国别代码
    ]));
  }

  // 加 BOM 头，确保 Excel 打开不乱码
  return "\ufeff" + rows.join("\n");
}

function toCsvRow(fields) {
  return fields.map(csvEscape).join(",");
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

// ── 清洗后的需求 Excel ────────────────────────────────────

function buildCleanedDemandWorkbook(headers, cleanedRows) {
  const data = [headers, ...cleanedRows];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return wb;
}

module.exports = {
  buildDispatchWorkbook,
  buildMoveCsv,
  buildCleanedDemandWorkbook,
};
