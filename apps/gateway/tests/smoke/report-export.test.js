import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { getApp, login } from "../helpers/app.js";

const VALID_SCHEMA = {
  title: "测试报告 2026-05-16",
  sheets: [
    {
      name: "渠道汇总",
      columns: [
        { header: "渠道", key: "channel", width: 15, type: "text" },
        { header: "销售额", key: "sales", width: 18, type: "currency" },
        {
          header: "同比",
          key: "yoy",
          width: 12,
          type: "percent",
          conditional: { negative: "red", positive: "green" },
        },
      ],
      data: [
        { channel: "天猫旗舰", sales: 1234567.89, yoy: 0.156 },
        { channel: "京东自营", sales: 987654.32, yoy: -0.082 },
      ],
      options: { freezeRow: 1, autoFilter: true, sortBy: { key: "sales", order: "desc" } },
    },
  ],
};

const EMPTY_DATA_SCHEMA = {
  title: "空数据报告",
  sheets: [
    {
      name: "Sheet1",
      columns: [
        { header: "名称", key: "name", type: "text" },
        { header: "数量", key: "qty", type: "number" },
      ],
      data: [],
    },
  ],
};

describe("smoke: POST /api/report/export", () => {
  let agent;

  beforeAll(() => {
    agent = request(getApp());
  });

  it("returns 401 without auth cookie", async () => {
    const res = await agent.post("/api/report/export").send(VALID_SCHEMA);
    expect(res.status).toBe(401);
  });

  it("returns 403 for user without analysis permission", async () => {
    const { cookie } = await login(agent, "smoke-user", "smoke-user-pass");
    const res = await agent
      .post("/api/report/export")
      .set("Cookie", cookie)
      .send(VALID_SCHEMA);
    expect(res.status).toBe(403);
  });

  it("returns 400 for invalid schema (missing title)", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .post("/api/report/export")
      .set("Cookie", cookie)
      .send({ sheets: [] });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it("returns 400 for invalid schema (empty sheets)", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .post("/api/report/export")
      .set("Cookie", cookie)
      .send({ title: "test", sheets: [] });
    expect(res.status).toBe(400);
  });

  it("returns valid XLSX buffer for valid schema", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .post("/api/report/export")
      .set("Cookie", cookie)
      .responseType("arraybuffer")
      .send(VALID_SCHEMA);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    expect(res.headers["content-disposition"]).toContain("attachment");

    const buf = Buffer.from(res.body);
    expect(buf.length).toBeGreaterThan(0);
    // XLSX files are ZIP archives: PK header = 0x50 0x4B
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it("returns valid XLSX for empty data array (headers only)", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .post("/api/report/export")
      .set("Cookie", cookie)
      .responseType("arraybuffer")
      .send(EMPTY_DATA_SCHEMA);
    expect(res.status).toBe(200);
    const buf = Buffer.from(res.body);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });
});
