import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { getApp, login } from "../helpers/app.js";

describe("smoke: admin account management", () => {
  let agent;

  beforeAll(() => {
    agent = request(getApp());
  });

  it("GET /api/admin/accounts without cookie returns 401", async () => {
    const res = await agent.get("/api/admin/accounts");
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/accounts with non-admin cookie returns 403", async () => {
    const { cookie } = await login(agent, "smoke-user", "smoke-user-pass");
    const res = await agent.get("/api/admin/accounts").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("GET /api/admin/accounts with admin cookie returns 200 + account list", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent.get("/api/admin/accounts").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.accounts)).toBe(true);
    expect(res.body.accounts.length).toBeGreaterThanOrEqual(2);
    const usernames = res.body.accounts.map((a) => a.username);
    expect(usernames).toContain("smoke-admin");
    expect(usernames).toContain("smoke-user");
  });

  it("Admin account list does not leak password_hash", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent.get("/api/admin/accounts").set("Cookie", cookie);
    expect(res.status).toBe(200);
    res.body.accounts.forEach((a) => {
      expect(a.password_hash).toBeUndefined();
    });
  });
});
