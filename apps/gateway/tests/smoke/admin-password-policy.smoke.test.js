import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import request from "supertest";
import { getApp, login } from "../helpers/app.js";

/**
 * V2 password policy smoke.
 *
 * 验证 admin 路径上「创建账号」和「重置密码」两个端点确实调用了 passwordPolicy。
 * 关注的是端到端：zod superRefine → 400 响应中带中文 reason。
 *
 * 注意：成功创建账号会 persist 到 AUTH_CONFIG_LOCAL_PATH（tests/fixtures/auth-local.fixture.json）。
 * afterAll 里恢复到 `{}`，避免下次 run 冲突。
 */
describe("smoke: admin password policy", () => {
  let agent;
  const localFixturePath = process.env.AUTH_CONFIG_LOCAL_PATH;

  beforeAll(() => {
    // vitest.config.js 没有强制 ENABLE_PASSWORD_POLICY，但显式置 true 以免 CI 环境外溢
    process.env.ENABLE_PASSWORD_POLICY = "true";
    agent = request(getApp());
  });

  afterAll(() => {
    // 将 local fixture 清回空对象，让下次 run 干净重来
    if (localFixturePath && fs.existsSync(localFixturePath)) {
      try {
        fs.writeFileSync(localFixturePath, "{}\n");
      } catch (_err) {
        // ignore — 测试环境没写权限不是致命
      }
    }
  });

  it("创建账号：强密码 Abcdef12 → 201", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    // 名字用时间戳避免和上次遗留数据冲突
    const uniqueName = `policy-user-${Date.now()}`;
    const res = await agent
      .post("/api/admin/accounts")
      .set("Cookie", cookie)
      .send({ name: uniqueName, password: "Abcdef12" });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it("创建账号：weakpwd（无大写无数字）→ 400 带中文提示", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .post("/api/admin/accounts")
      .set("Cookie", cookie)
      .send({ name: "policy-user-2", password: "weakpwd" });
    expect(res.status).toBe(400);
    const messages = (res.body.issues || []).map((i) => i.message).join(" | ");
    // weakpwd 缺大写 + 缺数字 + 长度不足（7 < 8）
    expect(messages).toMatch(/大写/);
    expect(messages).toMatch(/数字/);
  });

  it("创建账号：password（命中黑名单）→ 400", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .post("/api/admin/accounts")
      .set("Cookie", cookie)
      .send({ name: "policy-user-3", password: "password" });
    expect(res.status).toBe(400);
    const messages = (res.body.issues || []).map((i) => i.message).join(" | ");
    expect(messages).toMatch(/弱口令/);
  });

  it("PATCH 密码：Short1 → 400（长度不足）", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .patch("/api/admin/accounts/acct_smoke_user/password")
      .set("Cookie", cookie)
      .send({ password: "Short1" });
    expect(res.status).toBe(400);
    const messages = (res.body.issues || []).map((i) => i.message).join(" | ");
    expect(messages).toMatch(/至少 8 位/);
  });
});
