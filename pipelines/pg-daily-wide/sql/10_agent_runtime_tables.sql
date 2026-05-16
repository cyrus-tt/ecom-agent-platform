-- 10_agent_runtime_tables.sql
-- Purpose: runtime trace tables for the streaming ReAct analysis Agent.
-- Rollback: drop tables in reverse dependency order:
--   drop table if exists anta_daily.agent_artifacts;
--   drop table if exists anta_daily.agent_tool_calls;
--   drop table if exists anta_daily.agent_task_steps;
--   drop table if exists anta_daily.agent_runs;

create schema if not exists anta_daily;

create table if not exists anta_daily.agent_runs (
  id bigserial primary key,
  task_name text not null,
  status text not null default 'running'
    check (status in ('pending', 'running', 'success', 'failed', 'timeout', 'aborted')),
  requested_by text not null default 'anonymous',
  model_name text,
  input_snapshot jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_runs_created_at
on anta_daily.agent_runs (created_at desc);

create index if not exists idx_agent_runs_status
on anta_daily.agent_runs (status);

create table if not exists anta_daily.agent_task_steps (
  id bigserial primary key,
  run_id bigint not null references anta_daily.agent_runs(id) on delete cascade,
  step_name text not null,
  step_order integer not null default 0,
  status text not null default 'running'
    check (status in ('pending', 'running', 'success', 'failed', 'timeout', 'aborted')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_task_steps_run_order
on anta_daily.agent_task_steps (run_id, step_order, id);

create table if not exists anta_daily.agent_tool_calls (
  id bigserial primary key,
  run_id bigint not null references anta_daily.agent_runs(id) on delete cascade,
  step_id bigint references anta_daily.agent_task_steps(id) on delete set null,
  tool_name text not null,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  status text not null default 'success'
    check (status in ('pending', 'running', 'success', 'failed', 'timeout', 'aborted')),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_tool_calls_run_created_at
on anta_daily.agent_tool_calls (run_id, created_at, id);

create index if not exists idx_agent_tool_calls_tool_name
on anta_daily.agent_tool_calls (tool_name);

create table if not exists anta_daily.agent_artifacts (
  id bigserial primary key,
  run_id bigint not null references anta_daily.agent_runs(id) on delete cascade,
  artifact_type text not null,
  content_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_artifacts_run_created_at
on anta_daily.agent_artifacts (run_id, created_at, id);
