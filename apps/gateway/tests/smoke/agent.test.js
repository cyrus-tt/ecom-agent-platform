import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { getApp, login } from "../helpers/app.js";

/**
 * Smoke tests for analysis Agent endpoints.
 *
 * Runs against AGENT_DATA_MODE=fixture (set in vitest.config.js), which avoids
 * hitting the real PostgreSQL when agent context assembly is requested.
 */
describe("smoke: analysis agent endpoints", () => {
  let agent;

  beforeAll(() => {
    agent = request(getApp());
  });

  it("GET /api/agent/skills without cookie returns 401", async () => {
    const res = await agent.get("/api/agent/skills");
    expect(res.status).toBe(401);
  });

  it("GET /api/agent/skills with admin cookie returns skill catalog", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent.get("/api/agent/skills").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.default_skill_id).toBe("string");
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
    res.body.items.forEach((s) => {
      expect(typeof s.id).toBe("string");
    });
  });

  it("GET /api/agent/skills with user lacking analysis permission returns 403", async () => {
    const { cookie } = await login(agent, "smoke-user", "smoke-user-pass");
    const res = await agent.get("/api/agent/skills").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });
});
