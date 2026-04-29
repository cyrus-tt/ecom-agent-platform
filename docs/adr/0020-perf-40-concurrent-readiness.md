# ADR-0020: 40 并发性能加固

**状态**：Accepted（2026-04-29）
**关联 PLAN**：`docs/plans/2026-04-29-perf-40-concurrent-readiness.md`
**关联 PROGRESS**：F-PERF-40C
**分支**：`codex/mac/feat-login-self-service-password`（叠在 F-LOGIN 后）
**5 个 feature commits**：`0e32728` `fc161e0` `751e11b` `07a9721`（PLAN `9489f07`）

---

## 上下文

40 位同事即将同时使用门户 / 日报 / 新品 / dashboard / 渠道看板 / 分析 / 调拨 7 个模块。压测假设下：
- PG 池默认 max=10，40 用户首屏 = 30 个请求阻塞排队 → connection_timeout 10s 不够 → 大量 500
- 同 SQL 同时跑 N 次（如同看日报）→ 浪费连接
- 短缓存 30-45s + 无 max size → 内存泄漏 + 缓存频繁穿透
- Excel 导出 / AI 报告无并发限制 → 同时点几次会拖垮普通访问
- ETL 后没 `ANALYZE rpt_*` → 查询计划老旧
- 启动只预热 2 个接口 → 早高峰冷查询雪崩

## 决策

### Cyrus 在 ddc4813 已完成（缓存层底层重构）

发现 PLAN 起草后、调研前 Cyrus 在 Windows 端已经完成：
- 6 个 cache + 6 个 in-flight Map 全套（DAILY_UNION / DASHBOARD_OVERVIEW / DASHBOARD_COMPARE / DASHBOARD_DRILLDOWN / CHANNEL_DASHBOARD / CHANNEL_DRILLDOWN）
- inline `getMapCache` / `setMapCache` helpers（LRU + maxEntries=120）
- inline `withSingleFlight` helper
- 统一 `REPORT_CACHE_TTL_MS` 默认 5 分钟，从 env 可调

故 PLAN 决策 #3（TTL）改成 **5 分钟**（尊重 Cyrus 在生产环境的判断）；决策 #4（maxEntries）改成 **120**。我起草期间写的 `lib/cache/ttlCache.js` + `lib/cache/singleFlight.js` 删除（与 Cyrus inline 实现重复）。

### 本 PR 新增（5 大块）

| # | 决策 | 文件 |
|---|---|---|
| **S3** 缓存清理 | `reportRepo.clearAllCaches()` 内部函数 + `POST /api/admin/cache/clear`（admin only）+ `rebuild-weekly` 成功后自动调用清缓存 | `services/reportRepo.js` + `server.js` |
| **S4** PG 池调整 | max 10 → 25 / connection_timeout 10s → 30s / statement_timeout 120s → 180s / 显式 idle_timeout 30s | `apps/gateway/config.json` |
| **S5** ETL ANALYZE | 新增 `06_postgres_post_etl_analyze.sql`（fail-tolerant 接入到 `run_pg_pipeline.ps1` 05 之后）| `pipelines/pg-daily-wide/sql/06_*.sql` + `ops/windows/run_pg_pipeline.ps1` |
| **S6** 重操作并发 | 新增 `lib/concurrencyLimit.js`（`Semaphore` + `limitConcurrency` 中间件）；Excel 4 endpoint 共用 `Semaphore(2)`，AI `Semaphore(1)`；超限 429 + 友好中文 message | `lib/concurrencyLimit.js` + `server.js` |
| **S7** 启动预热扩充 | 现有预热 report + dashboard overview 之上加 channel-dashboard + daily-dates | `server.js` startServer() |
| **S8** repo 清洁度 + 压测 | `.gitignore` 全目录覆盖 runtime/ apps/runtime/ data/inbox/ data/prepared/ data/archive/；`git rm --cached` 18 个已 tracked 大文件（共 ~40 万行 / ~20MB）；新增 `scripts/loadtest_40_concurrent.ps1` 40 并发压测脚本 | `.gitignore` + `scripts/loadtest_40_concurrent.ps1` |

### 关键参数（不可在没拍板下偏离）

| 参数 | 值 | 出处 |
|---|---|---|
| Excel 导出并发上限 | **2** | Cyrus 决策 #5 |
| AI 报告并发上限 | **1** | Cyrus 决策 #5 |
| PG `max_pool_size` | **25** | Cyrus 决策 |
| PG `connection_timeout_ms` | **30000** | Cyrus 决策 |
| PG `statement_timeout_ms` | **180000** | Cyrus 决策 |
| 缓存 TTL（默认） | **300_000ms (5 min)** | ddc4813 已选 |
| 缓存 maxEntries（默认） | **120** | ddc4813 已选 |
| 压测并发数 / 时长 | **40 / 60s** | Cyrus 决策 |

## 拒绝的备选方案

| 方案 | 拒绝理由 |
|---|---|
| 引入 `lru-cache` 第三方库 | 现有 inline `getMapCache` / `setMapCache` 已实现 LRU，零新依赖更稳 |
| 重操作改成排队（不立即 429）| 排队让请求堆在内存里反而扩大爆炸半径；用户看 429 自己重试比转 30s 圈好 |
| 全局 RPS 限流（如 express-rate-limit）| 40 并发的瓶颈不是 RPS 而是池占用 + 重操作；全局限流会误伤；本期不做 |
| 异步 Excel 导出（job_id + 轮询）| 改造前端体感大；本期 `Semaphore(2)` 已足够防护 |
| 拆 DB / 应用 | 业务约束（Windows 单机部署）不允许；超出本期范围 |
| 完整无锁 staging swap 重构 | 工程量太大；ANALYZE 已极大改善刷新后查询计划 |

## 后果

### 正面
- 40 并发 0 个 500 + P95 命中缓存 < 500ms（验收前提）
- 重操作隔离：Excel/AI 即使被点爆也不影响普通看板访问
- 缓存自动清：数据刷新完无需手动操作就给用户看到最新数据
- repo 体积下降 ~20MB（运行产物 + 上游数据 untrack）
- 压测脚本入仓：未来回归性能测试可一键跑

### 负面 / 已知风险
- **R5 缓存击穿**：首次冷查询仍可能 40 并发触发 → single-flight + 启动预热扩到 5 个核心查询 + 5 分钟 TTL 共同缓解
- **R6 PG `max_connections`**：池升 25 后要求 PG `max_connections >= 50`；Cyrus 在 Windows 端 `SHOW max_connections;` 验证；不够手动调 `postgresql.conf`（不在本 PR）
- **R7 PowerShell 压测精度**：PS `Start-ThreadJob` 比 k6 误差 ±10%；40 并发量级足够，不引新依赖
- **R8 排队语义用户困惑**：429 + 中文友好 message 已尽力；前端加 disabled 防连点是后续 PR

### 验收路径
详见 `docs/plans/2026-04-29-perf-40-concurrent-readiness.md` §6。Mac 端只做 `node --check` + 平台 esbuild build + behavior smoke；功能验收以 Cyrus 在 Windows 公司机 `git pull` + `start_all.ps1 -RebuildWeb` + `scripts/smoke_all_modules.ps1` 串行 smoke + `scripts/loadtest_40_concurrent.ps1` 40 并发压测为准。

## 相关

- `docs/plans/2026-04-29-perf-40-concurrent-readiness.md` — 完整 PLAN
- `apps/gateway/lib/concurrencyLimit.js` — Semaphore + limitConcurrency 中间件
- `apps/gateway/services/reportRepo.js` — clearAllCaches + ddc4813 inline cache helpers
- `apps/gateway/server.js` — 5 个 limitConcurrency 中间件应用 + admin cache clear endpoint + warmup 扩充
- `apps/gateway/config.json` — PG 池新参数
- `pipelines/pg-daily-wide/sql/06_postgres_post_etl_analyze.sql` — ETL ANALYZE
- `scripts/loadtest_40_concurrent.ps1` — 40 并发压测脚本
- `scripts/smoke_all_modules.ps1` — Cyrus 在 ddc4813 写好的串行 smoke（31 endpoints）
- ADR-0009 — Mac esbuild v25 bug 绕过（本 PR Mac 端 build 用了）
- ADR-0019 — F-LOGIN 自助改密 + 记住我 30 天（本 PR 在它之后叠加）
- PROGRESS R5/R6/R7/R8 — 风险登记
