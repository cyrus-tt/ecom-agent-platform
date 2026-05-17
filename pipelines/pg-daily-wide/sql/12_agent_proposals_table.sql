-- 12_agent_proposals_table.sql
-- Purpose: approval queue — Agent proposes actions, user approves/rejects before execution.
-- Safety: CREATE IF NOT EXISTS — idempotent, only adds, never alters existing columns.
-- Rollback:
--   DROP TABLE IF EXISTS anta_daily.agent_proposals;

CREATE TABLE IF NOT EXISTS anta_daily.agent_proposals (
  id              serial PRIMARY KEY,
  anomaly_id      integer REFERENCES anta_daily.agent_anomalies(id),
  inspection_id   integer REFERENCES anta_daily.agent_inspections(id),
  risk_level      varchar(10) NOT NULL DEFAULT 'high',
  action_type     varchar(50) NOT NULL,
  title           varchar(200) NOT NULL,
  description     text,
  proposed_action jsonb NOT NULL,
  status          varchar(20) NOT NULL DEFAULT 'pending',
  decided_at      timestamptz,
  decided_by      varchar(100),
  reject_reason   text,
  execution_result jsonb,
  created_at      timestamptz DEFAULT now()
);

COMMENT ON COLUMN anta_daily.agent_proposals.risk_level IS 'low=auto-execute, medium=execute+record, high=needs approval';
COMMENT ON COLUMN anta_daily.agent_proposals.status IS 'pending|approved|rejected|executed|failed';
COMMENT ON COLUMN anta_daily.agent_proposals.action_type IS 'notify|acknowledge|investigate|adjust_inventory|create_promotion';

CREATE INDEX IF NOT EXISTS idx_proposals_status
  ON anta_daily.agent_proposals(status);

CREATE INDEX IF NOT EXISTS idx_proposals_anomaly
  ON anta_daily.agent_proposals(anomaly_id);

CREATE INDEX IF NOT EXISTS idx_proposals_created
  ON anta_daily.agent_proposals(created_at DESC);
