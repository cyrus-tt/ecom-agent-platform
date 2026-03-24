import { formatInteger, formatPercent as formatRatioPercent } from "./numbers";

export const DRILL_MODE_OPTIONS = [
  { label: "按产品季展开", value: "season" },
  { label: "按中类展开", value: "category" },
];

export const DRILL_LEVELS_BY_MODE = {
  season: [
    { key: "season", label: "产品季" },
    { key: "gender", label: "性别" },
    { key: "category", label: "中类" },
    { key: "style", label: "款号" },
    { key: "sku", label: "货号" },
  ],
  category: [
    { key: "category", label: "中类" },
    { key: "season", label: "产品季" },
    { key: "gender", label: "性别" },
    { key: "style", label: "款号" },
    { key: "sku", label: "货号" },
  ],
};

export const DEFAULT_DRILL_MODE = DRILL_MODE_OPTIONS[0].value;
export const DRILL_LEVELS = DRILL_LEVELS_BY_MODE[DEFAULT_DRILL_MODE];

export const NOTES_USER_STORAGE_KEY = "arrival_notes_user_id";
export const EMPTY_LABEL = "未填写";

export function getDrillLevels(mode = DEFAULT_DRILL_MODE) {
  return DRILL_LEVELS_BY_MODE[mode] || DRILL_LEVELS;
}

export function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function toText(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

export function formatNumber(value) {
  return formatInteger(value);
}

export function formatPercent(value) {
  return formatRatioPercent(Math.max(0, toNumber(value)));
}

export function normalizeToken(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "zh-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

export function getFieldValue(record, key) {
  const text = toText(record?.[key]);
  return text || EMPTY_LABEL;
}

export function pickEarlierDate(current, candidate) {
  const left = toText(current);
  const right = toText(candidate);
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return rightTime < leftTime ? right : left;
  }
  return right < left ? right : left;
}

export function computeSummary(records) {
  const styleSet = new Set();
  let arrivedSku = 0;
  let stockQtyTotal = 0;
  let unexecQtyTotal = 0;
  let planQtyTotal = 0;

  records.forEach((record) => {
    if (toText(record.style)) {
      styleSet.add(toText(record.style));
    }
    if (record.arrived !== undefined ? !!record.arrived : toNumber(record.stock_qty) > 0) {
      arrivedSku += 1;
    }
    stockQtyTotal += toNumber(record.stock_qty);
    unexecQtyTotal += toNumber(record.unexec_qty);
    planQtyTotal += toNumber(record.plan_qty);
  });

  return {
    total_sku: records.length,
    total_style: styleSet.size,
    arrived_sku: arrivedSku,
    arrival_rate: records.length ? arrivedSku / records.length : 0,
    stock_qty_total: stockQtyTotal,
    unexec_qty_total: unexecQtyTotal,
    plan_qty_total: planQtyTotal,
  };
}

export function groupRecords(records, levelKey) {
  const groups = new Map();

  records.forEach((record) => {
    const value = getFieldValue(record, levelKey);
    if (!groups.has(value)) {
      groups.set(value, {
        key: value,
        value,
        total_sku: 0,
        arrived_sku: 0,
        stock_qty: 0,
        unexec_qty: 0,
        plan_qty: 0,
        plan_date: "",
      });
    }
    const group = groups.get(value);
    group.total_sku += 1;
    if (record.arrived !== undefined ? !!record.arrived : toNumber(record.stock_qty) > 0) {
      group.arrived_sku += 1;
    }
    group.stock_qty += toNumber(record.stock_qty);
    group.unexec_qty += toNumber(record.unexec_qty);
    group.plan_qty += toNumber(record.plan_qty);
    group.plan_date = pickEarlierDate(group.plan_date, record.plan_date);
  });

  return Array.from(groups.values()).map((group) => ({
    ...group,
    arrival_rate: group.total_sku ? group.arrived_sku / group.total_sku : 0,
  }));
}

export function parseSearchTokens(text) {
  return String(text || "")
    .split(/[\s,;\uFF0C\u3001\uFF1B]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function sanitizeApiBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function getStoredValue(key) {
  try {
    return window.localStorage.getItem(key) || "";
  } catch (_err) {
    return "";
  }
}

export function setStoredValue(key, value) {
  try {
    window.localStorage.setItem(key, String(value || ""));
  } catch (_err) {
    return;
  }
}

export function normalizeNote(item) {
  return {
    sku: toText(item?.sku),
    user_id: toText(item?.user_id),
    tag: toText(item?.tag),
    remark: toText(item?.remark),
    is_following:
      item?.is_following === true ||
      String(item?.is_following || "").toLowerCase() === "true" ||
      Number(item?.is_following) === 1,
    updated_at: toText(item?.updated_at),
    updated_by: toText(item?.updated_by),
  };
}

export function hasNoteContent(note) {
  return Boolean(note && (note.is_following || note.tag || note.remark));
}

export function formatNoteSummary(note) {
  if (!note) {
    return "-";
  }
  const parts = [];
  if (note.is_following) {
    parts.push("跟进");
  }
  if (note.tag) {
    parts.push(note.tag);
  }
  if (note.remark) {
    parts.push(note.remark.length > 12 ? `${note.remark.slice(0, 12)}...` : note.remark);
  }
  return parts.length ? parts.join(" | ") : "已备注";
}
