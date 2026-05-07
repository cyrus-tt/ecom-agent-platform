-- 07_bi_readonly_user.sql
-- ChatBI 只读用户：用于 AI 生成的 SQL 查询，仅 SELECT 权限
-- 幂等：可重复执行
-- 回滚：DROP USER IF EXISTS bi_readonly;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_readonly') THEN
    CREATE USER bi_readonly WITH PASSWORD 'bi_readonly_2026' LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA anta_daily TO bi_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA anta_daily TO bi_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA anta_daily GRANT SELECT ON TABLES TO bi_readonly;
