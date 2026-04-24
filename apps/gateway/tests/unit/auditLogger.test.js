import { describe, it, expect, beforeEach, afterEach } from "vitest";

// eslint-disable-next-line import/first
const { createAuditLogger } = require("../../services/auditLogger");

describe("auditLogger", () => {
  let calls;
  let pool;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    calls = [];
    pool = {
      query: async (sql, values) => {
        calls.push({ sql, values });
        return { rowCount: (values || []).length / 10 };
      },
    };
    process.env.ENABLE_AUDIT_DB = "true";
    process.env.AUDIT_FLUSH_INTERVAL_MS = "20";
    process.env.AUDIT_FLUSH_BATCH_SIZE = "2";
  });

  afterEach(() => {
    // Restore env so smoke tests in other files are not affected.
    process.env.ENABLE_AUDIT_DB = savedEnv.ENABLE_AUDIT_DB || "false";
    delete process.env.AUDIT_FLUSH_INTERVAL_MS;
    delete process.env.AUDIT_FLUSH_BATCH_SIZE;
  });

  it("queues records and flushes as batch to DB", async () => {
    const logger = createAuditLogger({ getPool: async () => pool });
    logger.record({
      account_id: "a1",
      username: "u1",
      is_admin: true,
      method: "GET",
      path: "/api/foo",
      status_code: 200,
      duration_ms: 10,
      ip: "1.2.3.4",
      user_agent: "test",
    });
    logger.record({
      account_id: "a2",
      username: "u2",
      is_admin: false,
      method: "POST",
      path: "/api/bar",
      status_code: 401,
      duration_ms: 5,
      ip: "5.6.7.8",
      user_agent: "test",
    });
    // batch size 2, should flush immediately
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.length).toBe(1);
    expect(calls[0].values.length).toBe(20); // 2 rows × 10 columns
  });

  it("respects ENABLE_AUDIT_DB=false and skips DB", async () => {
    process.env.ENABLE_AUDIT_DB = "false";
    const logger = createAuditLogger({ getPool: async () => pool });
    logger.record({
      method: "GET",
      path: "/api/foo",
      status_code: 200,
      duration_ms: 10,
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.length).toBe(0);
  });

  it("does not throw when pool query rejects", async () => {
    const brokenPool = {
      query: async () => {
        throw new Error("connection refused");
      },
    };
    const logger = createAuditLogger({ getPool: async () => brokenPool });
    for (let i = 0; i < 3; i += 1) {
      logger.record({
        method: "GET",
        path: `/api/foo/${i}`,
        status_code: 200,
        duration_ms: 1,
      });
    }
    // Wait long enough for all flushes + circuit breaker to kick in.
    await new Promise((r) => setTimeout(r, 100));
    // Test passes simply by not throwing — the audit logger promises fire-and-forget.
    expect(true).toBe(true);
  });
});
