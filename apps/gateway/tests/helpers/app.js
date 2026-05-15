/**
 * Shared test helper: load the gateway Express app without starting the HTTP listener.
 *
 * server.js exports { app, startServer } and only calls startServer() when loaded
 * as the main module (require.main === module). Requiring it from a test file
 * therefore yields a fully-configured app with zero network side effects.
 */
let cachedApp = null;

function getApp() {
  if (cachedApp) return cachedApp;
  // Resolved lazily so vitest env (AUTH_CONFIG_PATH etc.) is honored.
  const mod = require("../../server.js");
  cachedApp = mod.app;
  return cachedApp;
}

async function login(request, username, password) {
  const res = await request.post("/api/auth/login").send({ username, password });
  if (res.status !== 200) {
    throw new Error(`login failed: status=${res.status} body=${JSON.stringify(res.body)}`);
  }
  const cookies = res.headers["set-cookie"] || [];
  const sid = cookies.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  return { response: res, cookie: sid };
}

module.exports = { getApp, login };
