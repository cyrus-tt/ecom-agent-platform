import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { getApp, login } from "../helpers/app.js";

/**
 * Smoke tests for report endpoints verify routing + auth + permission wiring.
 * Actual data retrieval depends on PostgreSQL which is NOT available during
 * unit/CI runs — in that case the endpoint returns 5xx. The test therefore
 * asserts that the endpoint is reachable for authorised users (not 404, not 403)
 * and rejects unauthorised ones. PR4 (server.js split) uses this to prove
 * route/middleware layering is preserved.
 */
describe("smoke: report endpoints routing + auth", () => {
  let agent;

  beforeAll(() => {
    agent = request(getApp());
  });

  it("GET /api/report-daily/dates without cookie returns 401", async () => {
    const res = await agent.get("/api/report-daily/dates");
    expect(res.status).toBe(401);
  });

  it("GET /api/report-daily/dates with permitted user reaches handler (2xx or 5xx, NOT 404/403)", async () => {
    const { cookie } = await login(agent, "smoke-user", "smoke-user-pass");
    const res = await agent.get("/api/report-daily/dates").set("Cookie", cookie);
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(403);
    expect([200, 500, 502, 503]).toContain(res.status);
  });

  it("GET /api/report-daily/meta without cookie returns 401", async () => {
    const res = await agent.get("/api/report-daily/meta?date_from=2026-01-01&date_to=2026-01-02");
    expect(res.status).toBe(401);
  });

  it("Admin can reach report-daily meta (2xx or 5xx, NOT 403/404)", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .get("/api/report-daily/meta?date_from=2026-01-01&date_to=2026-01-02")
      .set("Cookie", cookie);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });

  it("GET /api/outlet-assortment/dates without cookie returns 401", async () => {
    const res = await agent.get("/api/outlet-assortment/dates");
    expect(res.status).toBe(401);
  });

  it("GET /api/outlet-assortment/dates with permitted user reaches handler (2xx or 5xx, NOT 404/403)", async () => {
    const { cookie } = await login(agent, "smoke-user", "smoke-user-pass");
    const res = await agent.get("/api/outlet-assortment/dates").set("Cookie", cookie);
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(403);
    expect([200, 500, 502, 503]).toContain(res.status);
  });
});
