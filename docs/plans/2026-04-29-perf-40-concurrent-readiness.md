# PLAN · 40 并发性能加固（缓存 / 连接池 / 重任务隔离 / 验收脚本）

**PROGRESS 编号**：F-PERF-40C
**创建于**：2026-04-29
**Deadline**：2026-05-03（≤ 4 个工作日）
**状态**：✅ done（2026-05-07 Windows 验收通过 + Codex 修 2 commit，Mac 已 pull 同步）

---

## 1. 一句话任务

让 40 位同事同时使用门户 / 日报 / 新品 / dashboard / 渠道看板 / 分析 / 调拨这 7 个模块时不出现 500、不卡死、重操作（Excel 导出 / AI 报告 / 数据刷新）不互相拖垮普通访问。

## 2. 为什么做（Why）

Cyrus（2026-04-29）提出。当前压测在 40 并发下：
- PG 池 max=10 → 30 个请求排队、`connection_timeout_ms=10000` 不够长 → 大量 500
- 同 SQL 同时跑 N 次（如 40 人同看日报）→ 浪费 40 个连接干一件事
- 短缓存 TTL 30-45s + 无 max size → 内存泄漏 + 缓存频繁穿透
- Excel 导出 / AI 报告无并发限制 → 一旦同时点几次，普通看板访问全卡
- ETL 跑完没 ANALYZE rpt_ 表 → 查询计划老旧
- 启动只预热 2 个接口 → 早上第一批用户共同冷查询

## 3. 边界（不做什么）

- ❌ 不动认证安全（密码 / 权限 / bcrypt 升级）—— 那是另一个独立 PR
- ❌ 不拆分 DB / 应用（仍 Windows 单机部署）
- ❌ 不做完整无锁 staging swap 重构（数据刷新仍可能短暂影响读，但加 ANALYZE 已能极大改善）
- ❌ 不动底层 DB schema（`rpt_*` / `src_*` 表结构 / 列名都不动）
- ❌ 不引入新的第三方依赖（缓存用自写 `lib/cache/ttlCache.js`，不引 `lru-cache`）
- ❌ 不改业务 API URL（保持现有 `/api/report-daily/rows` 等路径）

## 4. 方案步骤

### S1 single-flight 扩展（基于现有 `DASHBOARD_OVERVIEW_IN_FLIGHT` 模式）

抽 `apps/gateway/lib/cache/singleFlight.js`：
```js
const inFlight = new Map();
async function singleFlight(key, producer) {
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = Promise.resolve().then(producer).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
```

套用到：
- `getDailyUnionBaseRows(dateFrom, dateTo)`（现有 30s TTL 但无 single-flight）
- `getChannelDashboard(...)`（现有 30s TTL 但无 single-flight）
- `getChannelDashboardDrilldown(...)`（无缓存无 single-flight，至少加 single-flight）

### S2 TTL + Max Size 缓存框架

新建 `apps/gateway/lib/cache/ttlCache.js`：
- `class TTLCache { constructor({ ttlMs, maxSize, name }) }`
- `get(key)` / `set(key, value)` / `delete(key)` / `clear()`
- 超过 `maxSize` 按 **LRU 淘汰**（用 `Map` 的插入顺序天然 FIFO/LRU 实现：每次 `get` 命中删后重 set，最旧的 entry 在 Map 头）
- 过期 entry 在 `get` 时被动清理；`size` 返回当前条目数

替换 `reportRepo.js` 4 处 `new Map()` + `dateChoicesCache` / `dashboardDatesCache`（共 6 处）为 `TTLCache` 实例：
- 全部 `ttlMs = 180_000`（3 分钟，决策 #3）
- 全部 `maxSize = 200`（决策 #4）

### S3 缓存清理 admin 入口 + 自动清

- 加 `reportRepo.clearAllCaches()` 内部函数 → 一次清光所有 6 个 cache 的 `clear()`
- 加 `POST /api/admin/cache/clear`（`requireAdmin`）→ 调 `reportRepo.clearAllCaches()`，返 `{ ok: true, cleared: 6 }`
- 在 `startManagedJob('rebuild-weekly')` 成功结束的 hook 里自动调用 `clearAllCaches()`（看现有 job lifecycle，应该有 `onSuccess` 之类）

### S4 PG 池配置调整

改 `apps/gateway/config.json`（或 `config.local.json`）默认值：
- `max_pool_size`: 10 → **25**
- `connection_timeout_ms`: 10000 → **30000**
- `statement_timeout_ms`: 120000 → **180000**（3 分钟，给 dashboard 复杂查询一点余量）
- 新加 `idle_timeout_ms`: **30000**（pg.Pool 默认 30s，显式写出来）

ADR-0020 里说明：要求 PG `max_connections >= 50`（25 池 + 25 余量）；需 Cyrus 在 Windows 端 `SHOW max_connections;` 验证 → 不够则在 `postgresql.conf` 调（这步是 Cyrus 操作，不在代码里）。

### S5 ETL 加 ANALYZE（subagent A 做）

- 新加 `pipelines/pg-daily-wide/sql/06_postgres_post_etl_analyze.sql`：
  ```sql
  ANALYZE anta_daily.rpt_sales_sku_daily;
  ANALYZE anta_daily.rpt_inventory_sku_latest;
  ```
- 改 `ops/windows/run_pg_pipeline.ps1`：05 之后加一步调用 06；保持 idempotent

### S6 重操作并发保护

新建 `apps/gateway/lib/concurrencyLimit.js`：
- `class Semaphore { constructor(permits, name) }`
- `acquire(): Promise<release>` / `tryAcquire(): boolean | release`
- 超限 `tryAcquire` 返 false → handler 返 `429 { ok: false, busy: true, queued_count, message: "系统正在处理大量同类请求，请稍后再试" }`

应用：
- **Excel 导出**：`/api/report/export.xlsx`、`/api/report/gap-template.xlsx`、`/api/report-daily/export.xlsx`、`/api/report-daily/export.xlsb` 4 个 endpoint 共用一个 `Semaphore(2)`（决策 #5）
- **AI 报告**：`/api/agent/run` 用 `Semaphore(1)`（决策 #5）
- **数据刷新**：现有 `RUNNING_JOB_BY_TYPE` 锁已是 ≤1，不动

### S7 启动预热扩充

改 `server.js:2473-2509` 的 `startServer()` 后预热：
1. 拿 `getDashboardDateChoices()` 的 max date 当默认日期（决策 #8）
2. 预热（每个独立 try/catch，失败只 warn）：
   - `getReportMeta(defaultWeek)` + `getReportRows(page=1, size=50)` （现有保留）
   - `getDashboardOverview(maxDate, dateFrom, dateTo)` （现有保留）
   - **新加** `getChannelDashboard(maxDate, ...)` 默认参数
   - **新加** `getChannelDashboardDates()` （日期选项缓存）
   - **新加** agent context（`agentService.getContext({ data_mode })` 之类，看现有签名）

### S8 Repo 清洁度 + 40 并发压测脚本（subagent B 做压测脚本）

**Repo 清洁度**（我自己做）：
- `.gitignore` 加：
  ```
  runtime/
  data/inbox/
  data/prepared/
  data/archive/
  ```
- `git rm --cached` 移除已 tracked 的：
  - `runtime/esbuild-main.js`、`apps/runtime/app.debug.js`
  - `runtime/*.png`（4 张截图）
  - `runtime/pg_pipeline_summary.json`、`runtime/*.sql` 调试文件
  - `data/prepared/*.csv`、`data/prepared/*.json`
  - `data/inbox/*.csv`、`data/inbox/*.xlsx`
  - 注意：**保留 `data/inbox/.gitkeep`** 之类占位（要不要看现有结构）
- 不删磁盘文件，仅 untrack

**40 并发压测脚本**（subagent B 做）：
- `scripts/loadtest_40_concurrent.ps1`
- 用 PowerShell 7 `Start-ThreadJob` 跑 40 线程
- 每线程随机选 12 核心 endpoint 之一（`/api/auth/login`, `/api/report-daily/rows`, `/api/dashboard/overview`, `/api/dashboard/dates`, `/api/dashboard/channel-compare`, `/api/channel-dashboard`, `/api/channel-dashboard/drilldown`, `/api/arrival/...`, `/api/notes-api/notes`, `/api/dispatch/tasks`, `/api/agent/context`, `/api/agent/reports`）
- 跑 60 秒，每线程循环发请求
- 输出 JSON 报告：每 endpoint 总请求数 / 成功数 / 500 数 / P50 / P95 / P99 / 最慢请求 ms
- 验收：**0 个 500，缓存命中 P95 < 500ms，冷缓存重查询 P95 < 5s**

## 5. 涉及文件 / 资源

### 新建（4 个）
- `apps/gateway/lib/cache/ttlCache.js`
- `apps/gateway/lib/cache/singleFlight.js`
- `apps/gateway/lib/concurrencyLimit.js`
- `pipelines/pg-daily-wide/sql/06_postgres_post_etl_analyze.sql`
- `scripts/loadtest_40_concurrent.ps1`
- `docs/adr/0020-perf-40-concurrent.md`

### 改动（~10 个）
- `apps/gateway/server.js`（导出/AI/admin cache clear endpoint + warmup 扩充）
- `apps/gateway/services/reportRepo.js`（替换 6 处 cache + 加 single-flight + clearAllCaches）
- `apps/gateway/config.json`（PG 池参数）
- `ops/windows/run_pg_pipeline.ps1`（加调用 06）
- `.gitignore`（4 行新增）
- `PROGRESS.md`（F-PERF-40C 行 + R5/R6/R7/R8 风险登记）
- 本 PLAN 文件（执行日志）

### 删除（git rm --cached，~25 个文件）
- `runtime/*.js`、`runtime/*.png`、`runtime/*.json`、`runtime/*.sql`（已 tracked 的）
- `apps/runtime/app.debug.js`
- `data/prepared/*.csv`、`data/prepared/*.json`
- `data/inbox/*.csv`、`data/inbox/*.xlsx`

### 外部依赖
- 无新增 npm 包
- ADR-0020 决策记录

## 6. 验收标准（全 ✅ 才算完成）

### 工程验收（Mac 端）
- [ ] `node --check apps/gateway/server.js`、`node --check apps/gateway/services/reportRepo.js`、`node --check apps/gateway/lib/cache/ttlCache.js`、`node --check apps/gateway/lib/cache/singleFlight.js`、`node --check apps/gateway/lib/concurrencyLimit.js` 全过
- [ ] 平台 esbuild 二进制 build web 通过（ADR-0009 workaround）
- [ ] `node apps/gateway/server.js` 启动不崩（PG 不可用也能起，PG 错误进 reportRepo log）
- [ ] `git rm --cached` 后 `git status` 显示 ~25 个 deleted（不是 modified），磁盘文件还在
- [ ] push origin 成功

### Cyrus Windows 端验收
- [ ] `git pull` + `ops/windows/start_all.ps1 -RebuildWeb` 启动不崩
- [ ] **scripts/smoke_all_modules.ps1 全 31 endpoints 串行 smoke 全过**（普通账号 + admin 分两轮跑）
- [ ] **`scripts/loadtest_40_concurrent.ps1` 40 并发压测**：
  - 0 个 500
  - 12 个 endpoint P95 < 5s（冷缓存）/ < 500ms（缓存命中第二轮）
  - 输出 JSON 报告 commit 进 `runtime/loadtest_<timestamp>.json`（在 .gitignore 内不入提交）
- [ ] **重操作保护测试**：4 个用户同时点 Excel 导出 → 前 2 秒立即响应、后 2 个返 429 busy；普通日报访问不受影响、不出 500
- [ ] **数据刷新 + 缓存清测试**：跑 `/api/admin/rebuild-weekly` → 完成 → 再访问日报，数据是新的（缓存被清）
- [ ] **PG `SHOW max_connections;` ≥ 50** 已确认（不够则 Cyrus 调 `postgresql.conf`，不在本 PR 代码里）
- [ ] ADR-0020 已 commit
- [ ] PROGRESS.md F-PERF-40C 状态切到 ✅ done

## 7. 风险 / 阻塞

### 风险（登记到 PROGRESS）
- **R5 缓存击穿**：首次冷查询（启动后第一次 / TTL 过期后第一次）仍可能 40 并发触发 → single-flight 兜底（同 key 并发只 1 个 SQL）；启动预热缓解早高峰
- **R6 PG `max_connections` 不够**：池 25 但 PG 默认 100，应该够；Cyrus 在 Windows 端 `SHOW max_connections;` 验证 → 不够手动调 `postgresql.conf`
- **R7 PowerShell 压测精度有限**：PS `Start-ThreadJob` 的高并发精度不如 k6，但 40 并发量级足够；P99 测出来误差 ±10% 可接受
- **R8 排队语义用户困惑**：429 + 中文 message "系统正在处理大量同类请求，请稍后再试" 已尽量友好，但如果用户连点 5 次 Excel 导出会困惑；前端可以加 disabled 防连点（不在本 PR）

### 阻塞
- ❌ 无阻塞。所有改动可在 Mac 端独立完成。Cyrus Windows 端验收前提是已 push origin（已经在 plan 内）。

## 8. 回滚方案

- **分支策略**：所有 commit 在 `codex/mac/feat-login-self-service-password`（决策 #1，叠在 F-LOGIN 分支后）
- **整体回滚**：`git revert <commit-range>` 或 Cyrus 在 Windows 端 `git checkout codex/mac/uplift-design && start_all.ps1 -RebuildWeb`
- **PG 配置回滚**：`config.json` 改回 `max_pool_size: 10` / `connection_timeout_ms: 10000` / `statement_timeout_ms: 120000`
- **ETL 06_post_etl_analyze.sql 是新增可独立删**（手工 / git revert）
- **`.gitignore` + `git rm --cached`**：磁盘文件还在；`git checkout HEAD -- <file>` 即可重新 track
- **DB**：无 schema 变更，零回滚成本（ANALYZE 不改 schema 只更新统计信息）
- **配置 / 数据**：无新环境变量；无新数据写入

---

## 执行日志（动手后追加）

- 2026-04-29 — PLAN 创建，状态 ⚪ draft → 🟡 approved（Cyrus 一次性 OK 全部 9 个决策点）
- 2026-04-29 — 状态切 🔵 in-progress（agent team 模式启动）
- 2026-04-29 — Phase 1 并行：subagent A 做完 S5 ETL ANALYZE（06.sql 14 行 + ps1 +9 行）；subagent B 做完 S8 压测脚本（loadtest_40_concurrent.ps1 353 行）；主线写完 lib/cache/ttlCache + singleFlight + concurrencyLimit
- 2026-04-29 — **关键转折**：诊断 ddc4813 发现 Cyrus 已在 Windows 端实现 §S1 + §S2（inline `getMapCache` / `setMapCache` / `withSingleFlight` helpers，TTL=5min/maxEntries=120）。决策修订：删 lib/cache/ttlCache.js + singleFlight.js 避免重复造轮子；保留 lib/concurrencyLimit.js 给 §S6
- 2026-04-29 — Commit `0e32728`：lib/concurrencyLimit.js + scripts/loadtest_40_concurrent.ps1（工具层）
- 2026-04-29 — Commit `fc161e0`：06_postgres_post_etl_analyze.sql + run_pg_pipeline.ps1（§S5 ETL）
- 2026-04-29 — Commit `751e11b`：config.json PG 池调整 + .gitignore + git rm --cached 18 个文件（§S4 + §S8 repo 清理；删 ~40 万行）
- 2026-04-29 — Commit `07a9721`：reportRepo.clearAllCaches + admin /cache/clear endpoint + rebuild 自动清 hook + 5 个 limitConcurrency 中间件应用 + startServer warmup 扩充（§S3 + §S6 + §S7，共改 server.js +58 / reportRepo.js +33）
- 2026-04-29 — Commit `<本 commit>`：ADR-0020 + 状态同步
- 2026-04-29 — Mac 端验证全过：node --check 双绿 + behavior smoke（clearAllCaches / Semaphore / limitConcurrency / passwordPolicy）+ 平台 esbuild web build 6.1mb / 523ms
- _（待 Cyrus）_ — Windows 端 git pull + start_all.ps1 -RebuildWeb + smoke_all_modules.ps1 + loadtest_40_concurrent.ps1 40 并发压测全过 → 状态切 ✅ done
