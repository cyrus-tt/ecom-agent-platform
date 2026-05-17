-- 13_agent_effect_tracking.sql
-- Purpose: track outcomes of executed proposals — did the Agent's suggestions help?
-- Safety: CREATE IF NOT EXISTS — idempotent, only adds.
-- Rollback:
--   DROP TABLE IF EXISTS anta_daily.agent_effects;

CREATE TABLE IF NOT EXISTS anta_daily.agent_effects (
  id              serial PRIMARY KEY,
  proposal_id     integer REFERENCES anta_daily.agent_proposals(id),
  anomaly_id      integer REFERENCES anta_daily.agent_anomalies(id),
  metric_type     varchar(50) NOT NULL,
  baseline_value  numeric,
  baseline_date   date NOT NULL,
  followup_value  numeric,
  followup_date   date,
  change_pct      numeric,
  outcome         varchar(20) DEFAULT 'pending',
  evaluated_at    timestamptz,
  created_at      timestamptz DEFAULT now()
);

COMMENT ON COLUMN anta_daily.agent_effects.outcome IS 'pending|improved|unchanged|worsened';
COMMENT ON COLUMN anta_daily.agent_effects.metric_type IS 'channel_gmv_dod|channel_gmv_wow|zero_sales_count|new_product_sales';

CREATE INDEX IF NOT EXISTS idx_effects_proposal
  ON anta_daily.agent_effects(proposal_id);

CREATE INDEX IF NOT EXISTS idx_effects_outcome
  ON anta_daily.agent_effects(outcome);

CREATE INDEX IF NOT EXISTS idx_effects_followup_date
  ON anta_daily.agent_effects(followup_date);
