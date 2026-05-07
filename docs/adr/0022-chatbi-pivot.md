# ADR-0022: 内置 ChatBI 透视表

**日期**: 2026-05-07
**状态**: Accepted
**关联 PLAN**: docs/plans/2026-05-07-chatbi-pivot.md

## 背景

用户需要灵活的数据分析能力（类似 Excel 透视表），但不想部署独立 BI 平台。

## 决策

自建轻量 ChatBI：AI 生成 SQL + react-pivottable 前端渲染。

### 安全沙箱

- PG 只读用户 `bi_readonly`（仅 SELECT 权限）
- 独立连接池（max 5）
- SQL 正则前置校验（拒绝 INSERT/UPDATE/DELETE/DROP 等）
- statement_timeout 30s
- 自动追加 LIMIT 5000

### 不引入外部 BI 平台

Metabase/Superset 需要额外服务进程 + 维护成本。当前需求用 react-pivottable（~50KB）即可满足。

### AI 层

复用现有 DeepSeek 集成，system prompt 包含完整表结构。输出 JSON 格式 `{ sql, pivotConfig, title }`。

## 新增依赖

- `react-pivottable` ^0.11.0（唯一新增前端依赖）

## 影响

- 新文件：biQueryService.js、BiPage.jsx、07_bi_readonly_user.sql
- server.js：3 个新 endpoint + bi 权限 module
- config.json：postgres_bi_readonly 连接配置
- 需要 Cyrus 在 Windows PG 执行 07_bi_readonly_user.sql 创建只读用户（一次性）
