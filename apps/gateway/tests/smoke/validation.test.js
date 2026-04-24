import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { getApp, login } from "../helpers/app.js";

/**
 * Input validation smoke.
 *
 * Proves that:
 *   1. Malformed login / agent/run bodies return HTTP 400 (not 500).
 *   2. The 400 payload has { ok:false, message, issues: [...] } shape so
 *      the frontend can surface field-specific errors.
 *   3. Valid bodies still flow through to the original handler (regression).
 */
describe("smoke: input validation (zod)", () => {
  let agent;

  beforeAll(() => {
    agent = request(getApp());
  });

  // ── /api/auth/login ─────────────────────────────────────────────────

  it("login with empty body → 400 with issues array", async () => {
    const res = await agent.post("/api/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("login with non-string password → 400", async () => {
    const res = await agent
      .post("/api/auth/login")
      .send({ username: "smoke-admin", password: 12345 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/password/i);
  });

  it("login with missing username → 400 with 'username' in issues", async () => {
    const res = await agent
      .post("/api/auth/login")
      .send({ password: "whatever" });
    expect(res.status).toBe(400);
    const paths = res.body.issues.map((i) => i.path);
    expect(paths).toContain("username");
  });

  it("login with valid body still works (regression)", async () => {
    const res = await agent
      .post("/api/auth/login")
      .send({ username: "smoke-admin", password: "smoke-pass" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  // ── /api/agent/run ──────────────────────────────────────────────────

  it("agent/run without auth cookie → 401 (auth layer before validation)", async () => {
    const res = await agent.post("/api/agent/run").send({});
    expect(res.status).toBe(401);
  });

  it("agent/run with empty body but auth cookie → 400", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent.post("/api/agent/run").set("Cookie", cookie).send({});
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    const paths = res.body.issues.map((i) => i.path);
    expect(paths).toContain("period_type");
  });

  it("agent/run with malformed start_date → 400", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .post("/api/agent/run")
      .set("Cookie", cookie)
      .send({ period_type: "daily", start_date: "not-a-date" });
    expect(res.status).toBe(400);
    const paths = res.body.issues.map((i) => i.path);
    expect(paths).toContain("start_date");
  });
});
