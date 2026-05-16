-- 11_agent_inspection_tables.sql
-- Purpose: storage for daily automated inspection results and detected anomalies.
-- Safety: CREATE IF NOT EXISTS — idempotent, only adds, never alters existing columns.
-- Rollback:
--   DROP TABLE IF EXISTS anta_daily.agent_anomalies;
--   DROP TABLE IF EXISTS anta_daily.agent_inspections;

CREATE TABLE IF NOT EXISTS anta_daily.agent_inspections (
  id            serial PRIMARY KEY,
  run_date      date NOT NULL,
  anomaly_count integer DEFAULT 0,
  summary       text,
  findings      jsonb,
  status        varchar(20) DEFAULT 'completed',
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspections_run_date
  ON anta_daily.agent_inspections(run_date DESC);

CREATE TABLE IF NOT EXISTS anta_daily.agent_anomalies (
  id              serial PRIMARY KEY,
  inspection_id   integer REFERENCES anta_daily.agent_inspections(id),
  type            varchar(50) NOT NULL,
  severity        varchar(20) NOT NULL,
  title           varchar(200) NOT NULL,
  description     text,
  metric_current  numeric,
  metric_previous numeric,
  change_pct      numeric,
  suggested_action text,
  status          varchar(20) DEFAULT 'open',
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anomalies_inspection
  ON anta_daily.agent_anomalies(inspection_id);

CREATE INDEX IF NOT EXISTS idx_anomalies_severity
  ON anta_daily.agent_anomalies(severity);
