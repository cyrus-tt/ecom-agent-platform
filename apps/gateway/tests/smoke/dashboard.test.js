import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { getApp, login } from "../helpers/app.js";

/**
 * Smoke tests for dashboard / channel-dashboard endpoints.
 *
 * Coverage rationale:
 * - Routes added/exposed by reportRepo split (V3) — dashboard / drilldown / channel
 *   panels were previously only indirectly exercised by health.test.js boot warmup.
 * - Without these tests, a wrong import path in services/report/* would only fail
 *   when a real user hit the page, not in CI.
 *
 * Same as report.test.js: PostgreSQL is NOT available in CI, so 5xx is acceptable;
 * we only assert the route is mounted (NOT 404) and auth/permission gate works.
 */
describe("smoke: dashboard / channel-dashboard endpoints", () => {
  let agent;

  beforeAll(() => {
    agent = request(getApp());
  });

  // --- /api/dashboard/dates ---
  it("GET /api/dashboard/dates without cookie returns 401", async () => {
    const res = await agent.get("/api/dashboard/dates");
    expect(res.status).toBe(401);
  });

  it("GET /api/dashboard/dates with smoke-user (no dashboard perm) returns 403", async () => {
    const { cookie } = await login(agent, "smoke-user", "smoke-user-pass");
    const res = await agent.get("/api/dashboard/dates").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("GET /api/dashboard/dates with admin reaches handler (NOT 403/404)", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent.get("/api/dashboard/dates").set("Cookie", cookie);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
    expect([200, 500, 502, 503]).toContain(res.status);
  });

  // --- /api/dashboard/overview ---
  it("GET /api/dashboard/overview with admin reaches handler (NOT 403/404)", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .get("/api/dashboard/overview?date_from=2026-01-01&date_to=2026-01-02")
      .set("Cookie", cookie);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });

  // --- /api/dashboard/drilldown ---
  it("GET /api/dashboard/drilldown with admin reaches handler (NOT 403/404)", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .get("/api/dashboard/drilldown?level=style&category=测试&date_from=2026-01-01&date_to=2026-01-02")
      .set("Cookie", cookie);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });

  // --- /api/dashboard/channel-compare ---
  it("GET /api/dashboard/channel-compare with admin reaches handler (NOT 403/404)", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .get("/api/dashboard/channel-compare?date_from=2026-01-01&date_to=2026-01-02")
      .set("Cookie", cookie);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });

  // --- /api/channel-dashboard ---
  it("GET /api/channel-dashboard without cookie returns 401", async () => {
    const res = await agent.get("/api/channel-dashboard");
    expect(res.status).toBe(401);
  });

  it("GET /api/channel-dashboard with admin reaches handler (NOT 403/404)", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent.get("/api/channel-dashboard").set("Cookie", cookie);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });
});
