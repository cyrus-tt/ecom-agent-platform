export function toText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return String(value).trim();
}

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

export function sanitizeText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\uFEFF]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizePhone(value) {
  return sanitizeText(value).replace(/[^\d+]/g, "");
}

export function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（）()\-—_]/g, "");
}

export function compareSize(a, b) {
  const normalize = (value) => String(value || "").trim().toUpperCase();
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 0;

  const order = ["XXXS", "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "XXXXL", "5XL", "6XL"];
  const ia = order.indexOf(na);
  const ib = order.indexOf(nb);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;

  const numA = Number.parseFloat(na);
  const numB = Number.parseFloat(nb);
  if (Number.isFinite(numA) && Number.isFinite(numB)) return numA - numB;
  return na.localeCompare(nb, "zh");
}

export function levenshtein(a, b) {
  const s = normalizeText(a);
  const t = normalizeText(b);
  const m = s.length;
  const n = t.length;
  if (!m) return n;
  if (!n) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

