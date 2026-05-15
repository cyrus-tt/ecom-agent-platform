const path = require("path");

/**
 * Vitest config for gateway smoke tests.
 *
 * Forces test-friendly env vars before any require() of server.js.
 * Every smoke test does `await import('../../server.js')` inside beforeAll,
 * so these vars must be in place before that dynamic import.
 */
module.exports = {
  test: {
    include: ["tests/**/*.test.js", "lib/**/__tests__/*.test.js"],
    environment: "node",
    globals: false,
    testTimeout: 10000,
    hookTimeout: 10000,
    env: {
      NODE_ENV: "test",
      AUTH_CONFIG_PATH: path.resolve(__dirname, "tests/fixtures/auth.fixture.json"),
      AUTH_CONFIG_LOCAL_PATH: path.resolve(__dirname, "tests/fixtures/auth-local.fixture.json"),
      AGENT_DATA_MODE: "fixture",
      DISPATCH_AGENT_ENABLED: "true",
      PORT: "0",
      // Disable bcrypt auto-upgrade during tests: avoids slow bcrypt.hashSync
      // on each fixture login and prevents writeJsonAtomic mutating the fixture.
      ENABLE_BCRYPT: "false",
      // Keep audit in pino-only mode during tests (no PostgreSQL pool).
      ENABLE_AUDIT_DB: "false",
    },
    reporters: ["verbose"],
  },
};
