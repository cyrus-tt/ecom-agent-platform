const { PROVINCE_DEFS, MUNICIPALITY_SET } = require("../constants");

// ── 尺码标准化 ──────────────────────────────────────────────
const SIZE_NORMALIZE_MAP = {
  "xxs": "XS", "xs": "XS",
  "s": "S", "m": "M", "l": "L",
  "xl": "XL",
  "xxl": "2XL", "xxxl": "3XL", "xxxxl": "4XL", "xxxxxl": "5XL",
  "2xl": "2XL", "3xl": "3XL", "4xl": "4XL", "5xl": "5XL",
  "均码": "000", "均": "000", "free": "000", "f": "000",
};

// 已知尺码模式（用于检测互换）
const KNOWN_SIZE_PATTERN = /^(XS|S|M|L|XL|2XL|3XL|4XL|5XL|000|\d+\.?\d*)$/i;
const PURE_INT_PATTERN = /^\d+$/;

function normalizeSize(raw) {
  if (raw == null) return "";
  const s = String(raw).trim();
  const lower = s.toLowerCase();
  if (SIZE_NORMALIZE_MAP[lower]) return SIZE_NORMALIZE_MAP[lower];
  // 已经是标准格式或数字尺码（鞋码）
  if (/^\d+\.?\d*$/.test(s)) return s;
  // 大写化
  return s.toUpperCase();
}

// ── 地址解析 ──────────────────────────────────────────────

// 从详细地址中提取省市区
const provinceAliases = PROVINCE_DEFS
  .flatMap(p => p.aliases.map(a => ({ alias: a, def: p })))
  .sort((a, b) => b.alias.length - a.alias.length);

const cityRegex = /^(.{2,}?(?:自治州|地区|盟|市))/;
const districtRegex = /^(.{2,}?(?:自治县|自治旗|矿区|林区|新区|郊区|城区|区|县|旗|市))/;

function parseAddressFromDetail(detail) {
  if (!detail) return { province: "", city: "", district: "" };

  let rest = detail.replace(/\s+/g, "");
  let province = "", city = "", district = "";

  // 匹配省
  for (const { alias, def } of provinceAliases) {
    if (rest.startsWith(alias)) {
      province = def.name;
      rest = rest.slice(alias.length);
      break;
    }
  }

  // 直辖市: 省=市
  const isMunicipality = MUNICIPALITY_SET.has(province);
  if (isMunicipality) {
    // 跳过 "市辖区" 等占位词
    rest = rest.replace(/^(市辖区|市辖县|县|城区|郊区)/, "");
    city = province;
  } else {
    const cm = rest.match(cityRegex);
    if (cm) {
      city = cm[1];
      rest = rest.slice(city.length);
    }
  }

  // 区
  const dm = rest.match(districtRegex);
  if (dm) {
    district = dm[1];
  }

  return { province, city, district };
}

// 省份名称标准化到 E3 格式（全称）
function normalizeProvince(raw) {
  if (!raw) return "";
  const s = raw.trim();
  for (const def of PROVINCE_DEFS) {
    for (const alias of def.aliases) {
      if (s === alias || s === alias.replace(/[省市]$/, "")) {
        return def.full;
      }
    }
  }
  return s;
}

// 市名标准化（确保带"市"后缀，直辖市特殊处理）
function normalizeCity(raw, province) {
  if (!raw) return "";
  const s = raw.trim();
  if (MUNICIPALITY_SET.has(province)) return province;
  if (s.endsWith("市") || s.endsWith("州") || s.endsWith("盟") || s.endsWith("地区")) return s;
  return s + "市";
}

// ── 主清洗函数 ──────────────────────────────────────────────

function cleanDemandRows(rows, headers) {
  const fixes = [];
  const warnings = [];
  const duplicateMap = new Map();
  const cleaned = [];
  const cleanedRowNums = [];

  // 找到关键列索引
  const colMap = findColumns(headers);

  for (let i = 0; i < rows.length; i++) {
    const row = [...rows[i]]; // 浅拷贝
    const rowNum = i + 2; // Excel 行号（1-based + header）
    const rowFixes = [];

    // 1. 货号 trim
    let sku = String(row[colMap.sku] || "").trim();
    if (sku !== String(row[colMap.sku] || "")) {
      rowFixes.push(`货号去空格: "${row[colMap.sku]}" → "${sku}"`);
    }
    row[colMap.sku] = sku;

    // 2. 尺码/数量互换检测
    let size = String(row[colMap.size] || "").trim();
    let qty = String(row[colMap.qty] || "").trim();

    if (PURE_INT_PATTERN.test(size) && KNOWN_SIZE_PATTERN.test(qty) && !PURE_INT_PATTERN.test(qty)) {
      // 尺码列是纯整数，数量列是字母尺码 → 互换
      rowFixes.push(`尺码/数量互换: 尺码="${size}" 数量="${qty}" → 尺码="${qty}" 数量="${size}"`);
      const tmp = size;
      size = qty;
      qty = tmp;
    }
    row[colMap.size] = size;
    row[colMap.qty] = qty;

    // 3. 尺码标准化
    const normalizedSize = normalizeSize(size);
    if (normalizedSize !== size) {
      rowFixes.push(`尺码标准化: "${size}" → "${normalizedSize}"`);
    }
    row[colMap.size] = normalizedSize;

    // 4. 数量转整数
    const numQty = parseInt(qty, 10);
    if (isNaN(numQty) || numQty <= 0) {
      warnings.push(`第${rowNum}行: 数量无效 "${qty}"，跳过`);
      continue;
    }
    row[colMap.qty] = numQty;

    // 5. 地址处理
    const detail = String(row[colMap.detail] || "").trim();
    const rawProvince = colMap.province >= 0 ? String(row[colMap.province] || "").trim() : "";
    const rawCity = String(row[colMap.city] || "").trim();
    const rawDistrict = String(row[colMap.district] || "").trim();

    // 从详细地址解析省市区
    const parsed = parseAddressFromDetail(detail);

    // 补全/校验省
    let province = rawProvince || parsed.province;
    let city = rawCity || parsed.city;
    let district = rawDistrict || parsed.district;

    // 检测矛盾：填写的省/市/区 和 详细地址解析的不一致
    if (parsed.province) {
      // 用填写的所有地址字段检测矛盾
      const filledAddr = (rawProvince + rawCity + rawDistrict).replace(/[省市区县]/g, "");
      const parsedAddr = (parsed.province + (parsed.city || "")).replace(/[省市区县自治壮族回族维吾尔特别行政]/g, "");
      // 如果填写的市/区字段和详细地址里的省不是同一个地方
      const filled = rawProvince || rawCity;
      if (filled) {
        const filledNorm = filled.replace(/[省市]/g, "");
        const parsedNorm = parsed.province.replace(/[省市]/g, "");
        const parsedCityNorm = (parsed.city || "").replace(/[省市]/g, "");
        if (filledNorm !== parsedNorm && filledNorm !== parsedCityNorm
            && !parsed.province.includes(filledNorm) && !filledNorm.includes(parsedNorm)) {
          warnings.push(`第${rowNum}行: 地址矛盾 - 填写="${filled}" vs 详细地址含="${parsed.province} ${parsed.city || ""}"，需确认`);
        }
      }
    }

    // 如果没有省列，从详细地址补全
    if (!province && parsed.province) {
      province = parsed.province;
      rowFixes.push(`补全省: 从详细地址解析得到 "${province}"`);
    }

    // 标准化省市
    province = normalizeProvince(province);
    if (MUNICIPALITY_SET.has(province + "市") || MUNICIPALITY_SET.has(province)) {
      // 直辖市：省去掉"市"
      const muni = PROVINCE_DEFS.find(p => p.name === province || p.aliases.includes(province));
      if (muni) {
        province = muni.full; // "上海" not "上海市"
        city = muni.name; // "上海市"
      }
    }
    city = normalizeCity(city, province ? province + "市" : "");

    // 写回
    if (colMap.province >= 0) row[colMap.province] = province;
    row[colMap.city] = city;
    row[colMap.district] = district;
    row[colMap.detail] = detail;

    // 6. 重复检测
    const dupKey = `${sku}||${normalizedSize}||${numQty}`;
    if (duplicateMap.has(dupKey)) {
      const prevIdx = duplicateMap.get(dupKey);
      warnings.push(`第${rowNum}行: 疑似重复 - 与第${prevIdx}行完全相同 (${sku} ${normalizedSize} x${numQty})，需确认是否要两倍数量`);
    } else {
      duplicateMap.set(dupKey, rowNum);
    }

    if (rowFixes.length > 0) {
      fixes.push({ row: rowNum, fixes: rowFixes });
    }

    cleaned.push(row);
    cleanedRowNums.push(rowNum);
  }

  return { cleaned, fixes, warnings, cleanedRowNums };
}

// 智能识别列
function findColumns(headers) {
  const h = headers.map(s => String(s || "").trim());
  return {
    id: findCol(h, ["编码", "序号", "编号", "No"]),
    sku: findCol(h, ["货号", "商品货号", "SKU"]),
    size: findCol(h, ["尺码", "规格", "尺寸"]),
    qty: findCol(h, ["数量", "数", "需求数量"]),
    supplier: findCol(h, ["调样供应商", "供应商"]),
    requester: findCol(h, ["需求人"]),
    contact: findCol(h, ["联系人"]),
    phone: findCol(h, ["联系电话", "电话", "手机"]),
    province: findCol(h, ["省", "省份"]),
    city: findCol(h, ["市", "城市"]),
    district: findCol(h, ["区", "区县"]),
    detail: findCol(h, ["详细地址", "地址", "收货地址"]),
    remark: findCol(h, ["需求备注", "备注"]),
  };
}

function findCol(headers, candidates) {
  for (const c of candidates) {
    const idx = headers.findIndex(h => h === c || h.includes(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

// 提取去重货号列表（用于 E3 查询）
function extractUniqueSkus(rows, colMap) {
  const skus = new Set();
  for (const row of rows) {
    const sku = String(row[colMap.sku] || "").trim();
    if (sku) skus.add(sku);
  }
  return Array.from(skus).sort();
}

module.exports = {
  cleanDemandRows,
  findColumns,
  extractUniqueSkus,
  normalizeSize,
  normalizeProvince,
  parseAddressFromDetail,
};
