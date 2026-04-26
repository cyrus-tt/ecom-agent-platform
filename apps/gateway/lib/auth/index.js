"use strict";

/**
 * Aggregated re-export for `lib/auth/*`.
 *
 * Consumers may either:
 *   const auth = require("../lib/auth");           // grab everything
 *   const { createSession } = require("../lib/auth/session");  // narrow
 *
 * Both forms hit the same module instances thanks to Node's per-absolute-path
 * require cache.
 */

module.exports = {
  ...require("./permissions"),
  ...require("./accounts"),
  ...require("./config"),
  ...require("./store"),
  ...require("./credentials"),
  ...require("./session"),
  ...require("./redirects"),
};
