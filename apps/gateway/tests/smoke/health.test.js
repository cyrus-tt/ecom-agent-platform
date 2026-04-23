import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { getApp } from "../helpers/app.js";

describe("smoke: health endpoints", () => {
  let agent;

  beforeAll(() => {
    agent = request(getApp());
  });

  it("GET /healthz returns 200 with ok=true", async () => {
    const res = await agent.get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.service).toBe("string");
  });

  it("GET /readyz responds (200 or 503 depending on deps)", async () => {
    const res = await agent.get("/readyz");
    // readyz probes real services; in tests it may be 503 without arrival/notes,
    // but the endpoint itself must exist and return JSON, not 404.
    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty("ok");
  });

  it("Unauthenticated /api/ping returns 401", async () => {
    const res = await agent.get("/api/ping");
    expect(res.status).toBe(401);
  });
});
