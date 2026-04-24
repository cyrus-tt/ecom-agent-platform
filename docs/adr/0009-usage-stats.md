# ADR 0009: 用量统计页（audit_log 聚合 + 管理员页面）

- 日期：2026-04-24
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：PR9
- 关联设计：`docs/plans/2026-04-23-uplift-to-9-design.md`
- 依赖：PR7（audit_log 表）

## 背景

PR7 已经把审计数据写进了 `anta_daily.audit_log`。但运维或产品想看"谁在用，用什么频繁，哪里慢"时，只能手写 SQL。40 人推广后，每天催运维写 SQL 是反模式。

## 决策

### 后端 `GET /api/admin/usage?interval=<window>`

新增 `services/usageRepo.js`，用 3 条并行 SQL 聚合：

1. **按路径**：每个 `method+path` 的请求数 / 独立用户 / avg 耗时 / p95 耗时 / 错误数
2. **按用户**：每个 `account_id` 的请求数 / 独立路径数 / 错误数 / 最后活跃时间
3. **汇总**：总请求数 / 独立用户 / 4xx / 5xx / 平均耗时

时间窗口**白名单**（防 SQL 注入）：`1 hour`, `6 hours`, `24 hours`, `7 days`, `30 days`

### 错误优雅降级

若 `audit_log` 表尚未创建（PR7 SQL 未执行），返回 503 + 友好消息：
```json
{
  "ok": false,
  "message": "audit_log 表尚未创建，请先在数据库执行 pipelines/pg-daily-wide/sql/90_audit_log.sql"
}
```

前端据此展示红色 Alert，不会空白崩溃。

### 前端 `AdminUsagePage.jsx`

- 路由：`/admin/usage`（admin-only）
- 菜单：管理员侧导航"用量统计"（在"账号权限"下方）
- 组件：
  - 时间窗口 Segmented 切换
  - 4 个 Statistic 卡片（请求/用户/4xx/5xx/延迟）
  - 两个 Table：按路径 Top 200 / 按用户 Top 200
  - 刷新按钮
- 错误路径：503 → Alert 提示未建表，不弹 message（避免管理员一打开就被 toast 骚扰）

### SQL 性能考虑

`audit_log` 在 PR7 已经为 `(created_at DESC)` / `(account_id, created_at DESC)` / `(path, created_at DESC)` 建了索引。三条聚合查询都走 `created_at > now() - interval '...'` 的 index range scan，对 40 人/每天 ~10k 行的数据量跑 < 500ms。

p95 用 `PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ...)` 实现，PostgreSQL 原生支持，不需额外扩展。

## 不做什么

- ❌ 不做图表（折线/柱状）—— Statistic + Table 已足够，加 ECharts 会放大复杂度
- ❌ 不做实时自动刷新（手动点刷新按钮，避免无人看着的时候打 DB）
- ❌ 不做下钻（看单用户某天做了什么）—— V2 根据使用频率判断是否补
- ❌ 不做导出 CSV —— Swagger UI 下载 OpenAPI + 用户自己查 DB，或 V2 补
- ❌ 不暴露给非管理员

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| 直接 Grafana 看板 | 管理员需要额外登 Grafana，不如内嵌页一键 |
| 自己写看板组件 | AntD Table + Statistic 已到位，别造轮子 |
| 不做，让运维写 SQL | 40 人推广后成本太高 |
| 全量导出 | 数据量 7 天可能 >100k 行，导出 UI 体验差 |
| Materialized view 做预聚合 | 过度优化，目前查询延迟可接受 |

## 验证

- 后端单元：直接打 `GET /api/admin/usage` 无表时返回 503 + 友好消息（通过错误分支的 `CATCH` 逻辑，模式匹配 `relation does not exist`）
- 后端集成：42 smoke 测试 × 3 次稳定全绿（新路由不破坏既有）
- 前端编译：用 esbuild 直接编译 `src/main.jsx` 全 bundle 无语法错误（6.7MB 合理）
- 前端渲染：Mac 端 `npm run dev:web` 视觉走查 V2（当前 Mac 环境 esbuild/Node v25 兼容问题，CI Ubuntu 端无此问题）

## 生产部署步骤

1. 合并 PR9 → `feature/dispatch-agent`（必须已合并 PR7）
2. Windows 生产机 `git pull` + `npm --prefix apps/gateway ci`（usageRepo 无新依赖，但可能有 audit_log 相关调整）
3. `npm --prefix apps/web ci && npm --prefix apps/web run build`
4. 按双端口方案起新版
5. 管理员登录后访问 `/admin/usage` → 看到数据
6. 若看到 "audit_log 表尚未创建" → 去执行 `psql -f pipelines/pg-daily-wide/sql/90_audit_log.sql`
7. 刷新页面

## 后续（V2）

- 加单用户下钻页（点"张三"看他最近 50 条审计记录）
- 加错误集中分析页（某路径 5xx 激增 → 展开看 stack trace from Sentry + audit metadata）
- 对接 Grafana（Prometheus 指标 + audit_log 聚合 = 运维大盘）
- 定时归档 audit_log（180+ 天数据归档到冷表，保持热表扫描速度）
