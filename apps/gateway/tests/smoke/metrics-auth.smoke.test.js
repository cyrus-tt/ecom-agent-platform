import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { getApp, login } from "../helpers/app.js";

/**
 * V2 /api/metrics 双通道认证覆盖（ADR 0012）：
 *   1. 无 session + 无 token → 401/403
 *   2. Bearer token 匹配（METRICS_TOKEN 已设置）→ 200 + text/plain; version=0.0.4
 *   3. Bearer token 不匹配 → 401/403
 *   4. METRICS_TOKEN 未设置，只发 Bearer → 401/403（Bearer 通道关闭）
 *   5. admin session + 任何 token/无 token → 200（兼容老路径）
 *   6. 超长 token（>256 字节）→ 401/403（防 header 放大攻击）
 *
 * 关键前提：middleware/metricsAuth.js 在每次请求时读 process.env.METRICS_TOKEN，
 * 所以可以在 test 内部原地切换环境变量。
 */

const GOOD_TOKEN = "test-token-xyz-ABC-123456789";

describe("smoke: /api/metrics auth (Bearer + admin session)", () => {
  let agent;
  const originalToken = process.env.METRICS_TOKEN;

  beforeAll(() => {
    agent = request(getApp());
  });

  beforeEach(() => {
    // 默认每条用例开始时设置 token；特定用例再清掉。
    process.env.METRICS_TOKEN = GOOD_TOKEN;
  });

  afterAll(() => {
    if (originalToken === undefined) {
      delete process.env.METRICS_TOKEN;
    } else {
      process.env.METRICS_TOKEN = originalToken;
    }
  });

  it("无 cookie + 无 Bearer → 401/403", async () => {
    const res = await agent.get("/api/metrics");
    expect([401, 403]).toContain(res.status);
  });

  it("Bearer 匹配 METRICS_TOKEN → 200 + Prometheus content-type", async () => {
    const res = await agent
      .get("/api/metrics")
      .set("Authorization", `Bearer ${GOOD_TOKEN}`);
    expect(res.status).toBe(200);
    const ct = String(res.headers["content-type"] || "");
    expect(ct).toContain("text/plain");
    expect(ct).toContain("version=0.0.4");
    // 必须包含至少一条指标（process_* 是 prom-client 默认指标）。
    expect(res.text).toMatch(/^#\s*HELP/m);
  });

  it("Bearer 不匹配 → 401/403", async () => {
    const res = await agent
      .get("/api/metrics")
      .set("Authorization", "Bearer wrong-token");
    expect([401, 403]).toContain(res.status);
  });

  it("METRICS_TOKEN 未设置时，任何 Bearer 都应被拒绝 → 401/403", async () => {
    delete process.env.METRICS_TOKEN;
    const res = await agent
      .get("/api/metrics")
      .set("Authorization", `Bearer ${GOOD_TOKEN}`);
    expect([401, 403]).toContain(res.status);
  });

  it("METRICS_TOKEN 为空串也视为未设置 → Bearer 被拒", async () => {
    process.env.METRICS_TOKEN = "   ";
    const res = await agent
      .get("/api/metrics")
      .set("Authorization", `Bearer anything`);
    expect([401, 403]).toContain(res.status);
  });

  it("超长 Bearer token (>256 字节) → 401/403，不应被接受即使前缀匹配", async () => {
    const huge = GOOD_TOKEN + "x".repeat(512);
    const res = await agent
      .get("/api/metrics")
      .set("Authorization", `Bearer ${huge}`);
    expect([401, 403]).toContain(res.status);
  });

  it("admin session cookie 单独也能通过（不依赖 token）→ 200", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent.get("/api/metrics").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"] || "")).toContain("text/plain");
  });

  it("admin session + 错误 Bearer 仍然通过（Bearer 失败后走 session fallback）", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .get("/api/metrics")
      .set("Cookie", cookie)
      .set("Authorization", "Bearer totally-wrong");
    expect(res.status).toBe(200);
  });

  it("非 admin session + 无 Bearer → 403", async () => {
    const { cookie } = await login(agent, "smoke-user", "smoke-user-pass");
    const res = await agent.get("/api/metrics").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });
});
