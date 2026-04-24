-- 90_audit_log.sql
--
-- Operational audit trail for the ecom-agent-platform gateway.
-- One row per authenticated (or attempted) HTTP request.
--
-- Added: 2026-04-23 (PR7 of 7→9 分加固)
-- Target schema: anta_daily
--
-- Idempotent: safe to run multiple times.
-- Additive only: does NOT drop or alter existing tables.

BEGIN;

CREATE TABLE IF NOT EXISTS anta_daily.audit_log (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_id   TEXT,
  username     TEXT,
  is_admin     BOOLEAN,
  method       TEXT NOT NULL,
  path         TEXT NOT NULL,
  status_code  INT,
  duration_ms  INT,
  ip           TEXT,
  user_agent   TEXT,
  metadata     JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON anta_daily.audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_account_created
  ON anta_daily.audit_log (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_path_created
  ON anta_daily.audit_log (path, created_at DESC);

-- Optional: retention helper (call manually via cron/pipeline, not automatic).
-- DELETE FROM anta_daily.audit_log WHERE created_at < now() - interval '180 days';

COMMIT;
