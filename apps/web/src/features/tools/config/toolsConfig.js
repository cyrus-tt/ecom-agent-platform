import {
  BUILT_IN_MAPPING,
  BUILT_IN_WAREHOUSE_MAPPING,
  CHANNEL_SUPPLIERS,
  DEMAND_CHANNEL_MAP,
  FIXED_FIELDS,
  STOCKOUT_MERGE_GROUPS,
  STOCKOUT_POOL_PRIORITY,
  STOCKOUT_STORE_MAP,
  STOCKOUT_STRATEGY_CODE,
  VMI_MAPPING,
} from "./businessData.generated.js";

export {
  BUILT_IN_MAPPING,
  BUILT_IN_WAREHOUSE_MAPPING,
  CHANNEL_SUPPLIERS,
  DEMAND_CHANNEL_MAP,
  FIXED_FIELDS,
  STOCKOUT_MERGE_GROUPS,
  STOCKOUT_POOL_PRIORITY,
  STOCKOUT_STORE_MAP,
  STOCKOUT_STRATEGY_CODE,
  VMI_MAPPING,
};

export const REQUIRED_INPUT_COLUMNS = ["分配池名称", "分配池代码", "货号", "条码", "尺码", "可用数"];
export const STOCKOUT_DEMAND_COLUMNS = ["订单所属商店", "货号", "条码", "规格", "数量"];
export const STOCKOUT_STOCK_COLUMNS = REQUIRED_INPUT_COLUMNS;

export const TEMPLATE_COLUMNS = [
  "源分配池代码(必填)",
  "源分配池名称(可选)",
  "目标分配池代码(必填)",
  "目标分配池名称(可选)",
  "货号(与69码、单品代码三选一)",
  "单品代码(与货号、69码三选一)",
  "69码(与货号、单品代码三选一)",
  "数量",
  "比例(%)",
  "备注(可选)",
  "来源单据编号(可选)",
  "尺码(可选)",
  "国别代码(配合货号使用不填默认CN)",
];

export const DISPATCH_DEMAND_COLUMNS = [
  "货号",
  "尺码",
  "数量",
  "调样供应商",
  "需求人",
  "联系人",
  "联系电话",
  "省",
  "市",
  "区",
  "详细地址",
];
export const DISPATCH_VIRTUAL_COLUMNS = ["分配池名称", "分配池代码", "货号", "尺码", "条码", "可用数"];
export const DISPATCH_PHYSICAL_COLUMNS = ["仓库名称", "仓库代码", "条码", "可用数/POS共享库存"];

export const RULE_COLUMNS = {
  source: ["源分配池名称", "源分配池", "源分配池名"],
  target: ["目标分配池名称", "目标分配池", "目标分配池名"],
  sku: ["货号", "商品货号"],
  ratio: ["比例(%)", "比例", "移仓比例", "占比(%)"],
  qty: ["数量", "移仓数量", "移仓数"],
  remark: ["备注", "移仓备注"],
};

export const DISPATCH_DEFAULT_TRANSPORT_MODE = "陆运快递";
export const DISPATCH_SETTLEMENT_MODE = "寄付";
export const SUPPLIER_MATCH_THRESHOLD = 0.8;

export const ALERT_POOL_MIN_TOTAL = 50;
export const ALERT_BREAK_THRESHOLD = 2;
export const ALERT_SOON_ABS_MAX = 5;
export const ALERT_SOON_SHARE_FACTOR = 0.6;
export const ALERT_EDGE_OVERALL_SHARE = 0.05;
export const ALERT_EDGE_SOON_ABS_MAX = 3;
export const ALERT_EDGE_SOON_SHARE_FACTOR = 0.3;
export const MIN_TOTAL_FOR_WARNING = 5;

export const POOL_CODE_BY_NAME = new Map(BUILT_IN_MAPPING);
export const WAREHOUSE_CODE_BY_NAME = new Map(BUILT_IN_WAREHOUSE_MAPPING);
