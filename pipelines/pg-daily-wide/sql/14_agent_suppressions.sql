-- 14_agent_suppressions.sql
-- Purpose: suppression rules learned from user acknowledgments.
-- When a user acknowledges an anomaly, the system can learn to suppress
-- similar anomalies in future inspections (reducing noise over time).
-- Safety: CREATE IF NOT EXISTS — idempotent, only adds.
-- Rollback:
--   DROP TABLE IF EXISTS anta_daily.agent_suppressions;

CREATE TABLE IF NOT EXISTS anta_daily.agent_suppressions (
  id              serial PRIMARY KEY,
  anomaly_type    varchar(50) NOT NULL,
  pattern         jsonb NOT NULL,
  reason          text,
  expires_at      timestamptz,
  created_by      varchar(100),
  created_at      timestamptz DEFAULT now()
);

COMMENT ON COLUMN anta_daily.agent_suppressions.pattern IS 'Match criteria: {"channel": "women", "min_change_pct": -15} etc.';
COMMENT ON COLUMN anta_daily.agent_suppressions.expires_at IS 'NULL = permanent suppression; date = auto-expires';

CREATE INDEX IF NOT EXISTS idx_suppressions_type
  ON anta_daily.agent_suppressions(anomaly_type);
