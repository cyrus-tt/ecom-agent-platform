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

  // ── /api/admin/accounts POST (PR12) ────────────────────────────────

  it("admin/accounts POST with missing password → 400", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .post("/api/admin/accounts")
      .set("Cookie", cookie)
      .send({ name: "new user" });
    expect(res.status).toBe(400);
    const paths = res.body.issues.map((i) => i.path);
    expect(paths).toContain("password");
  });

  it("admin/accounts POST with empty name → 400", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .post("/api/admin/accounts")
      .set("Cookie", cookie)
      .send({ name: "", password: "pw" });
    expect(res.status).toBe(400);
    const paths = res.body.issues.map((i) => i.path);
    expect(paths).toContain("name");
  });

  it("admin/accounts POST with non-admin cookie → 403 (auth before zod)", async () => {
    const { cookie } = await login(agent, "smoke-user", "smoke-user-pass");
    const res = await agent
      .post("/api/admin/accounts")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(403);
  });

  // ── /api/admin/accounts/:id/permissions PATCH (PR12) ───────────────

  it("PATCH permissions without permissions field → 400", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .patch("/api/admin/accounts/acct_smoke_user/permissions")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(400);
    const paths = res.body.issues.map((i) => i.path);
    expect(paths).toContain("permissions");
  });

  it("PATCH permissions with non-array → 400", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .patch("/api/admin/accounts/acct_smoke_user/permissions")
      .set("Cookie", cookie)
      .send({ permissions: "not-an-array" });
    expect(res.status).toBe(400);
  });

  // ── /api/dispatch/public/confirm (PR12) ────────────────────────────

  it("dispatch/public/confirm with responses as string → 400", async () => {
    const res = await agent
      .post("/api/dispatch/public/confirm")
      .send({ responses: "not-an-object" });
    expect(res.status).toBe(400);
  });
});
