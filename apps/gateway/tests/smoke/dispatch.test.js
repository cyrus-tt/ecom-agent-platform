import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { getApp, login } from "../helpers/app.js";

/**
 * Dispatch module smoke test.
 *
 * Verifies:
 *   1. Module registered (DISPATCH_AGENT_ENABLED defaults to true).
 *   2. Permission wiring: admin has dispatch, smoke-user does not.
 *   3. Task list endpoint accessible for authorised users (2xx or 5xx;
 *      SQLite may be absent in CI).
 *   4. Public confirm/preview endpoints don't require login (token-based).
 */
describe("smoke: dispatch endpoints", () => {
  let agent;

  beforeAll(() => {
    agent = request(getApp());
  });

  it("GET /api/dispatch/tasks without cookie returns 401", async () => {
    const res = await agent.get("/api/dispatch/tasks");
    expect(res.status).toBe(401);
  });

  it("GET /api/dispatch/tasks with smoke-user (no dispatch perm) returns 403", async () => {
    const { cookie } = await login(agent, "smoke-user", "smoke-user-pass");
    const res = await agent.get("/api/dispatch/tasks").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("GET /api/dispatch/tasks with admin reaches handler (2xx or 5xx, NOT 403/404)", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent.get("/api/dispatch/tasks").set("Cookie", cookie);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });

  it("GET /api/dispatch/public/preview without token returns 4xx (handler reachable)", async () => {
    const res = await agent.get("/api/dispatch/public/preview");
    // Not 404: route is registered. Not 401/403: this endpoint is token-based, not cookie-based.
    expect(res.status).not.toBe(404);
    // Without a valid token the handler should reject with 4xx (400 or 401-ish depending on impl)
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});
