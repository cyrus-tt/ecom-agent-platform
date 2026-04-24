"use strict";

/**
 * Sentry client — initialized only when SENTRY_DSN is set.
 *
 * Without SENTRY_DSN the module exports no-op stubs so the rest of the
 * codebase can call Sentry.captureException / Sentry.requestHandler /
 * Sentry.errorHandler unconditionally.
 *
 * This keeps the feature flagged by environment, not by code branches.
 *
 * Relevant envs:
 *   SENTRY_DSN                — the DSN from sentry.io or self-hosted
 *   SENTRY_ENVIRONMENT        — defaults to NODE_ENV
 *   SENTRY_TRACES_SAMPLE_RATE — 0..1, defaults to 0 (disabled)
 *   SENTRY_RELEASE            — optional release identifier
 *
 * Safe to import at server.js top-level; uses lazy side-effect free init.
 */

const { childLogger } = require("./logger");

const log = childLogger("sentry");

let Sentry = null;
let initialized = false;

function initSentry() {
  if (initialized) return;
  initialized = true;

  const dsn = String(process.env.SENTRY_DSN || "").trim();
  if (!dsn) {
    log.debug("SENTRY_DSN not set; Sentry SDK disabled (no-op handlers)");
    return;
  }

  try {
    Sentry = require("@sentry/node");
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
      release: process.env.SENTRY_RELEASE || undefined,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    });
    log.info({ environment: process.env.NODE_ENV || "development" }, "Sentry SDK initialized");
  } catch (err) {
    Sentry = null;
    log.warn(
      { err: err && err.message },
      `Sentry SDK init failed: ${err && err.message}. Falling back to no-op.`
    );
  }
}

function captureException(err, context) {
  if (!initialized) initSentry();
  if (!Sentry) return;
  try {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  } catch (_e) {
    /* swallow */
  }
}

function expressRequestHandler() {
  if (!initialized) initSentry();
  if (!Sentry || !Sentry.Handlers) return (_req, _res, next) => next();
  return Sentry.Handlers.requestHandler();
}

function expressErrorHandler() {
  if (!initialized) initSentry();
  if (!Sentry || !Sentry.Handlers) return (err, _req, _res, next) => next(err);
  return Sentry.Handlers.errorHandler();
}

function isEnabled() {
  if (!initialized) initSentry();
  return Sentry != null;
}

module.exports = {
  initSentry,
  captureException,
  expressRequestHandler,
  expressErrorHandler,
  isEnabled,
};
