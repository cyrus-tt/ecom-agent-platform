import { describe, it, expect } from "vitest";

describe("smoke: inspection engine", () => {
  it("engine module exports runInspection function", async () => {
    const engine = await import("../../services/inspection/engine.js");
    expect(typeof engine.runInspection).toBe("function");
  });

  it("scheduler module exports start/stop/runNow", async () => {
    const scheduler = await import("../../services/inspection/scheduler.js");
    expect(typeof scheduler.start).toBe("function");
    expect(typeof scheduler.stop).toBe("function");
    expect(typeof scheduler.runNow).toBe("function");
  });

  it("engine.runInspection returns graceful degradation when pool is null", async () => {
    const engine = await import("../../services/inspection/engine.js");
    const result = await engine.runInspection(null);
    expect(result).toHaveProperty("status", "skipped");
    expect(result).toHaveProperty("reason", "database_unavailable");
    expect(Array.isArray(result.anomalies)).toBe(true);
    expect(result.anomalies).toHaveLength(0);
  });
});
