# ADR 0014: services/reportRepo.js 按域拆分（3273 行 → 28 模块 + facade）

- 日期：2026-04-25
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：V3-PR-reportRepo-split（基线 PR12 1355cb9）
- 关联设计：`docs/plans/2026-04-25-v3-reportRepo-split-plan.md`

## 背景

`apps/gateway/services/reportRepo.js` 拆前 **3273 行**，单文件承担 6 个职责：

1. PG pool / 连接配置 / SQL 计时 + 慢查询日志
2. 4 个内存缓存 Map（daily union / dashboard overview / overview in-flight / channel dashboard）
3. 5 大类报表的 SQL 拼装 + 业务聚合：
   - dashboard date choices / overview / drilldown / channel compare
   - channel dashboard panels + style drilldown
   - weekly + daily union 视图
   - analysis reports CRUD
4. 38 个顶层 const / let / Map（包含 8 个相互派生的 SQL 模板）
5. 18 个日期 / 数值 / 文本 utils
6. 26 个公共 API 通过 `module.exports` 暴露

**具体症状**：
- IDE 单屏 ~ 1/27 视野；完整阅读需要前后跳跃
- 加新报表必须先理解全文；任何新增方法都改同一个文件 → git 冲突
- 5 个 consumer（server.js / metricsService / analysisContextProvider / routes/{report,dashboard,agent}.js）通过 `reportRepo.xxx` 直接调用，深耦合
- 4 个 dashboard / channel 公共 API（drilldown / channelCompare / channel / styleDrilldown）**没有 smoke 守门**，只 health.test.js 启动 warmup 间接覆盖
- 顶层 const 派生链（如 `DASHBOARD_NET_QTY_EXPR` 派生于 `SALES_QTY_KEYS`，`SALES_SUM_SQL` 派生于 `SALES_QTY_KEYS`，`DAILY_UNION_SQL` 模板字符串引用 7 个外部 const）使重构风险高

## 决策

**按"领域 + 共享 utils + 缓存 + 常量"四类拆分为 28 个文件，原 `services/reportRepo.js` 改为 1 行 facade**。

### 拆分目标结构

```
apps/gateway/
├── lib/
│   └── db.js                            ← 新增（pg pool / timedQuery / config）
└── services/
    ├── reportRepo.js                    ← 保留为 5 行 facade
    └── report/                          ← 新增目录
        ├── index.js                     ← 顶层聚合 26 个公共 API
        ├── constants.js                 ← 表名 / 标签 / KEYS / 派生 SQL（整块）
        ├── cache.js                     ← 4 个 Map + TTL + cache get/set
        ├── shared/
        │   ├── dateUtils.js
        │   ├── numberUtils.js
        │   ├── rowTransforms.js
        │   └── pagination.js
        ├── dashboard/
        │   ├── index.js                 ← 子聚合
        │   ├── dateChoices.js           ← E 块（含模块级 promise / cache）
        │   ├── drilldown.js             ← F 块
        │   ├── overview.js              ← I 块（含 in-flight 防并发）
        │   └── channelCompare.js        ← H 块（含 resolveDashboardCompareRange）
        ├── channel/
        │   ├── index.js                 ← 子聚合
        │   ├── options.js               ← 22 个渠道选项 + normalize
        │   ├── panel.js                 ← buildChannelDashboardSql + getChannelDashboard
        │   └── styleDrilldown.js
        ├── weekly.js                    ← WEEK_COLUMN_HEADERS + 5 周报方法
        ├── daily.js                     ← DAILY_UNION_SQL + 7 日报方法
        └── analysisReports.js           ← K 块 4 方法
```

**Facade 单文件**（`apps/gateway/services/reportRepo.js`）：

```js
"use strict";
module.exports = require("./report");
```

### 关键策略

1. **5 个 consumer 零改动**：facade 保留原 require 路径与 26 个字段名完全一致
2. **缓存 / pool 单例**：依赖 Node `require` 缓存机制，跨文件 `require("./report/cache")` 始终命中同一 Map / Pool 实例
3. **派生 const 整块迁移**：`SALES_SUM_SQL` 等 8 个派生 SQL 模板与其依赖的 `SALES_QTY_KEYS` 等数组**必须同文件**，constants.js 一次性整体移走
4. **`DAILY_UNION_SQL` 大模板**：模板字符串引用 7 个外部 const，迁到 `daily.js` 后立即在 require 之后拼接（同文件）
5. **`weekly.js ↔ daily.js` 部分循环**：daily 顶部 `require("./weekly")` 取 `WEEK_COLUMN_HEADERS` 常量；weekly 反向需要 daily 的 `queryDailyUnionBaseRows`/`summarizeDailyRows` 函数 → 用 lazy require（`function getDailyModule() { return require("./daily"); }`）破除循环

## 不做什么（本 PR 划清边界）

- ❌ 不重写 SQL（包括 `DAILY_UNION_SQL` 200 行模板）
- ❌ 不改缓存策略（TTL / Map 数据结构 / in-flight 防并发逻辑）
- ❌ 不引入 ORM / query builder（pg 原生保留）
- ❌ 不动 routes 的 import 路径（保留 facade，5 个 consumer 一处不改）
- ❌ 不重命名 26 个公共 API
- ❌ 不改 metricsService / analysisContextProvider 的 require 路径（V4 留口）
- ❌ 不引入 TypeScript（V5 议题）

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| 直接改 routes 的 require 路径，每个 routes 各自 require 子域 | diff 面太大（6 个 routes × 多个 require），PR 难审；ctx 注入逻辑也要同时改 |
| 一次性 commit 拆 28 文件 | 风险太高，单步失败定位困难。Plan §8 规定 20 个 step，每步 npm test |
| 不拆，加注释 + 目录索引 | 不解决"加新报表必须改同一个文件"的根本耦合 |
| 先 TypeScript 重写再拆 | 范围爆炸，违反"单 PR 单议题"。TS 留 V5 |

## 后果

### 收益
- ✅ `services/reportRepo.js` 由 3273 行 → 5 行 facade（-99.85%）
- ✅ 单文件最大 455 行（`channel/panel.js`），全部 ≤ 600
- ✅ 加新报表只改 1 个新文件 + `report/index.js` 加一行 re-export
- ✅ 26 个公共 API 形状 100% 不变，`Object.keys` diff 为空
- ✅ pool 单例验证通过（`a.getPool === b.getPool` true）
- ✅ 缓存 Map 单例验证通过（`require('./report/cache')` 双次同实例）
- ✅ 5 个 consumer 一处不改
- ✅ 新增 `tests/smoke/dashboard.test.js`（8 条），dashboard / drilldown / channel / channelCompare / channel-dashboard 5 个公共 API 首次有 smoke 守门
- ✅ 新增 `tests/unit/report-shared.test.js`（22 条），dateUtils + numberUtils 纯函数行为锁定
- ✅ 测试基线由 9 文件 / 48 条 → 11 文件 / 78 条
- ✅ 5 次 `npm test` 全绿稳定

### 代价
- ⚠️ 总代码行数轻微增加（28 模块的 import / export 样板），不可避免
- ⚠️ `weekly.js ↔ daily.js` 用了 lazy require，未来读代码时需注意（已在文件头注释说明）
- ⚠️ `dashboard/channelCompare.js` 与 `channel/options.js` 跨子域 require（前者要 normalize 后者要 OPTIONS），耦合可接受但偏离纯树状结构

## 验证

```bash
cd apps/gateway

# 1. 全测试 5 次稳定
npm test               # 11 files / 78 tests passing

# 2. 公共 API 形状一致
node -e "console.log(Object.keys(require('./services/reportRepo')).sort().join('\n'))"
# 输出 26 行（与拆分前完全一致）

# 3. pool / 缓存单例
node -e "const a=require('./lib/db');const b=require('./services/reportRepo');console.log(a.getPool===b.getPool)"           # true
node -e "const a=require('./services/report/cache');const b=require('./services/report/cache');console.log(a===b)"   # true

# 4. 5 个 consumer 仍可 require
grep -rn 'require.*reportRepo' apps/gateway --include='*.js' | grep -v node_modules
# server.js / metricsService.js / analysisContextProvider.js 三处 require("./services/reportRepo")
# routes/dashboard.js 通过 ctx 注入 reportRepo

# 5. 文件行数自检
find apps/gateway/services/report -name '*.js' | xargs wc -l | sort -n
# 全部 ≤ 600（最大 455 panel.js）
```

## 不能跑的验证（第一性原理 第 3 问）

> "这东西在真实环境跑过吗？"

**部分跑过**：
- ✅ Node 启动时 `services/reportRepo` require 不再抛错
- ✅ Express app 加载完整（health.test.js boot warmup 调 `getDashboardDateChoices` / `getDashboardOverview` 两个公共 API，命中 `services/report/dashboard/dateChoices.js` 与 `overview.js`）
- ✅ smoke / unit 78 条用例全过

**没跑过**（CI 环境无 PostgreSQL）：
- ❌ 真实 SQL 行为是否字节级一致 → 通过 grep 比对 SQL 模板字符串、保留派生 const 整块迁移、`DAILY_UNION_SQL` 模板由原来的 SQL 字符串拷贝而来，没有手工改写
- ❌ 缓存 TTL 触发后端到端表现 → 单文件移到 cache.js，逻辑 100% 复制，无修改

**生产环境观察建议**：上线后第一周关注：
1. `[slow-sql]` 日志里 dashboard / channel / drilldown 系列 SQL 的 elapsedMs 分布，应与上线前对齐
2. dashboard overview cache 命中率（45s TTL），通过新增 metrics 或日志观察
3. `getChannelDashboard` 的 in-flight 防并发逻辑（DASHBOARD_OVERVIEW_IN_FLIGHT Map）是否仍生效

## 后续

- **V4-PR-untangle-direct-imports**：metricsService / analysisContextProvider 改为 `require("../lib/db")` / `require("./report/analysisReports")` 直接引用子域，绕开 facade
- **V4-PR-dashboard-extra-smoke**：补 `getChannelDashboardStyleDrilldown` smoke + 多组 query 参数边界
- **V5-PR-typescript**：把 `services/report/*` 整体迁 TS，给 SQL 模板加类型
