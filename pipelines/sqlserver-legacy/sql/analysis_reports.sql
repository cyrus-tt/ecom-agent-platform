begin;

create schema if not exists anta_daily;

create table if not exists anta_daily.analysis_reports (
  id serial primary key,
  period_type text not null,
  period_start date not null,
  period_end date not null,
  metrics_json jsonb,
  report_md text not null,
  status text not null,
  error_msg text,
  created_at timestamptz not null default now()
);

create index if not exists idx_analysis_reports_created_at
on anta_daily.analysis_reports (created_at desc);

commit;
