"use strict";

/**
 * Central gateway logger.
 *
 * Design goals:
 *   - Replace the 15 scattered console.* calls with a single pino instance.
 *   - Development: colorized pretty output on stdout.
 *   - Production: JSON on stdout AND rolling files under runtime/logs/.
 *   - Tests: silent (no stdout flood, no disk writes).
 *
 * Log level defaults:
 *   NODE_ENV=production → info   (stdout + file)
 *   NODE_ENV=test       → silent (no transports)
 *   otherwise (dev)     → debug  (pretty stdout + file)
 *
 * Override with LOG_LEVEL env var.
 *
 * Files roll daily OR at 100 MB, whichever comes first. LOG_DIR overrides
 * the default runtime/logs/ location (useful for Windows dual-port setups
 * where old and new gateway should write to separate files).
 */

const path = require("path");
const fs = require("fs");
const pino = require("pino");

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_TEST = NODE_ENV === "test";
const IS_PRODUCTION = NODE_ENV === "production";

const LOG_LEVEL = (process.env.LOG_LEVEL || (IS_TEST ? "silent" : IS_PRODUCTION ? "info" : "debug")).toLowerCase();

const LOG_DIR = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.resolve(__dirname, "..", "..", "..", "runtime", "logs");

function buildTransport() {
  if (IS_TEST) {
    // Tests are silent by default; pino with level:"silent" discards.
    return undefined;
  }

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (err) {
    // Best-effort; if we can't create LOG_DIR, fall back to stdout-only.
    process.stderr.write(`[logger] cannot create ${LOG_DIR}: ${err.message}\n`);
  }

  const targets = [];

  if (!IS_PRODUCTION) {
    targets.push({
      target: "pino-pretty",
      level: LOG_LEVEL,
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    });
  } else {
    // Production: JSON on stdout (captured by systemd / pm2 / tee).
    targets.push({
      target: "pino/file",
      level: LOG_LEVEL,
      options: { destination: 1 },
    });
  }

  // File transport: daily rotation, max 100 MB, keep 7 days of archives.
  targets.push({
    target: "pino-roll",
    level: LOG_LEVEL,
    options: {
      file: path.join(LOG_DIR, "gateway.log"),
      frequency: "daily",
      size: "100m",
      mkdir: true,
      dateFormat: "yyyy-MM-dd",
      limit: { count: 7 },
    },
  });

  return { targets };
}

const transport = buildTransport();

const logger = pino({
  level: LOG_LEVEL,
  base: {
    service: "ecom-gateway",
    pid: process.pid,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(transport ? { transport } : {}),
});

function childLogger(module, extra = {}) {
  return logger.child({ module, ...extra });
}

module.exports = { logger, childLogger, LOG_DIR };
