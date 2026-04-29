-- 06_postgres_post_etl_analyze.sql
-- F-PERF-40C: 数据刷新结束后 ANALYZE 主报表表，让 PG 查询计划基于最新统计信息
-- 幂等：多次运行无副作用
-- 风险：无（ANALYZE 不修改数据，只更新 pg_statistic）
-- 回滚：直接删除本文件 + run_pg_pipeline.ps1 里相应调用块即可
\echo '=== Post-ETL ANALYZE: refreshing query planner statistics ==='

ANALYZE anta_daily.rpt_sales_sku_daily;
\echo 'ANALYZE rpt_sales_sku_daily done'

ANALYZE anta_daily.rpt_inventory_sku_latest;
\echo 'ANALYZE rpt_inventory_sku_latest done'

\echo '=== Post-ETL ANALYZE complete ==='
