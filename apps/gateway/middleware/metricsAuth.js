"use strict";

/**
 * /api/metrics 访问控制（V2）。
 *
 * 两条通道任一满足即放行：
 *   1. Authorization: Bearer <token>，token === process.env.METRICS_TOKEN
 *      （且 METRICS_TOKEN 非空，长度合理）
 *   2. 原有 admin session（requireAdmin）
 *
 * 目的：让 Prometheus 能用无 cookie 的方式 scrape，同时不破坏老的
 * 「浏览器带 cookie 手动 curl」路径。
 *
 * 第一性原理自检（见 /Volumes/tyj/Cyrus/CLAUDE.md）：
 *   1. 为什么存在？—— Prometheus scrape 不支持 cookie 登录；要么 IP 白名单，要么 token。
 *   2. 失败会怎样？—— token 错 / 缺 / 超长 → 直接走原 requireAdmin，不泄露。
 *   3. 真跑过吗？—— 见 tests/smoke/metrics-auth.smoke.test.js（4 条失败路径 + 2 条 happy）。
 *   4. 3 个月后能看懂吗？—— 注释解释 token 比较为何用 timingSafeEqual + 长度上限原因。
 */

const crypto = require("crypto");

// token 长度上限：防止攻击者用超大 header 做 CPU/内存放大。
// Prometheus 官方推荐 32+ 字节，64 字节 hex 也才 64 chars，256 已是绰绰有余。
const MAX_TOKEN_LEN = 256;

function extractBearerToken(req) {
  const raw = req.headers && req.headers.authorization;
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return "";
  return trimmed.slice(7).trim();
}

function hasValidMetricsToken(req) {
  const configured = String(process.env.METRICS_TOKEN || "").trim();
  // METRICS_TOKEN 未配置 → Bearer 通道彻底关闭（不降级为公开）。
  if (!configured) return false;

  const provided = extractBearerToken(req);
  if (!provided) return false;

  // 先做长度过滤：超过上限直接拒，避免构造超长 header 消耗 CPU。
  if (provided.length > MAX_TOKEN_LEN) return false;

  // 常量时间比较前必须先确保 buffer 等长，否则 timingSafeEqual 会抛异常。
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(configured, "utf8");
  if (a.length !== b.length) return false;

  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * 返回一个 express 中间件：Bearer token 通过则直接 next()，
 * 否则 fallback 到传入的 requireAdmin。
 */
function buildMetricsAuth(requireAdmin) {
  if (typeof requireAdmin !== "function") {
    throw new TypeError("buildMetricsAuth: requireAdmin must be a function");
  }
  return function metricsAuth(req, res, next) {
    if (hasValidMetricsToken(req)) {
      return next();
    }
    return requireAdmin(req, res, next);
  };
}

module.exports = {
  buildMetricsAuth,
  // Exported for unit tests.
  _internal: { extractBearerToken, hasValidMetricsToken, MAX_TOKEN_LEN },
};
