# PROJECT_STRUCTURE

## Root
- `apps`: 业务应用代码
- `pipelines`: 数据处理与ETL
- `data`: 数据输入与中间产物
- `docs`: 规划、规范、运行文档
- `ops`: 启停与运维脚本
- `config`: 配置模板（不放真实密钥）
- `scripts`: 通用工具脚本
- `tests`: 自动化测试

## Apps
- `apps/gateway`: Express 网关与后端 API
  - `server.js`
  - `services/`
  - `public/`（legacy 页面兼容）
  - `config/`（鉴权配置）
- `apps/web`: React + Vite 前端
  - `src/pages`：门户、看板、分析页
  - `src/api`：请求封装

## Pipelines
- `pipelines/pg-daily-wide`: PostgreSQL 主数据链路（当前唯一建议生产链路）
  - `sql/01~05`
  - `prepare_pg_sources.py`
- `pipelines/sqlserver-legacy`: 旧链路归档，保留用于回溯，不作为主链路

## Data
- `data/inbox`: 原始 CSV/XLSX 输入（按天/月放入）
- `data/prepared`: 预处理后 CSV（可复现）
- `data/archive`: 历史归档压缩文件

## Document Source of Truth
- 规划主文档：`docs/ECOMMERCE_AGENT_CODEX_GUIDE.md`
- 迁移记录：`MIGRATION_MANIFEST.md`