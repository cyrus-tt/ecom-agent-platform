import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { getApp, login } from "../helpers/app.js";

describe("smoke: auth flow", () => {
  let agent;

  beforeAll(() => {
    agent = request(getApp());
  });

  it("POST /api/auth/login with wrong password returns 401", async () => {
    const res = await agent
      .post("/api/auth/login")
      .send({ username: "smoke-admin", password: "wrong-pass" });
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  it("POST /api/auth/login with unknown user returns 401", async () => {
    const res = await agent
      .post("/api/auth/login")
      .send({ username: "ghost", password: "whatever" });
    expect(res.status).toBe(401);
  });

  it("POST /api/auth/login with correct credentials returns 200 + set-cookie", async () => {
    const res = await agent
      .post("/api/auth/login")
      .send({ username: "smoke-admin", password: "smoke-pass" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.username).toBe("smoke-admin");
    expect(res.body.is_admin).toBe(true);
    expect(Array.isArray(res.body.permissions)).toBe(true);
    expect(res.body.permissions).toContain("portal");
    expect(res.headers["set-cookie"]).toBeTruthy();
  });

  it("GET /api/auth/me without cookie returns unauthenticated payload", async () => {
    const res = await agent.get("/api/auth/me");
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.ok).toBe(false);
    }
  });

  it("GET /api/auth/me with valid session cookie returns account", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent.get("/api/auth/me").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.username).toBe("smoke-admin");
    expect(res.body.is_admin).toBe(true);
  });

  it("POST /api/auth/logout invalidates session", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const out = await agent.post("/api/auth/logout").set("Cookie", cookie);
    expect([200, 204]).toContain(out.status);
    const after = await agent.get("/api/auth/me").set("Cookie", cookie);
    if (after.status === 200) {
      expect(after.body.ok).toBe(false);
    } else {
      expect(after.status).toBe(401);
    }
  });

  it("Non-admin user only sees their permitted modules", async () => {
    const { response: res } = await login(agent, "smoke-user", "smoke-user-pass");
    expect(res.body.is_admin).toBe(false);
    expect(res.body.permissions).toContain("portal");
    expect(res.body.permissions).toContain("report_daily");
    expect(res.body.permissions).not.toContain("dispatch");
  });
});
