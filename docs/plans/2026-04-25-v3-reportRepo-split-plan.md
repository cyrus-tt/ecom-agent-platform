# V3 reportRepo 拆分 Plan（2026-04-25）

> **状态**：架构 Plan（仅 markdown，未动代码）
> **作者**：Plan Agent（Opus 4.7）
> **目标 PR**：V3-PR-reportRepo-split（独立提交，含 ADR-0014）
> **执行人**：E1 Execute Agent（按本 Plan §8 顺序逐步迁移）
>
> **第一性原理自检（Plan 层）**：
> 1. 这一步为什么存在？—— `services/reportRepo.js` 单文件 3273 行，承担 pg pool / 缓存 / 5 大类报表 / 看板 / 钻取 / 分析报告 6 个职责，再加新报表必须先理解全局，违反"加新报表只改 1 个新文件"。**消除"全局耦合"**这一步无法被绕过。
> 2. 如果这一步失败，会怎么表现？—— routes 调用 `ctx.reportRepo.xxx` 会 `undefined is not a function`；server.js 启动时即崩；smoke 全红 → 立即可见。
> 3. 这东西在真实环境跑过吗？—— Plan 本身不跑代码；E1 Execute 在每一步后必须 `npm test`（48 条 smoke + unit 全绿），并 `node -e "require('./services/reportRepo')"` 冒烟 require。
> 4. 3 个月后我自己打开能一眼看懂吗？—— 本文 §3 文件结构 + §4 100 行函数迁移表 + §6 依赖图 + §8 拆分顺序，构成"傻瓜式照搬清单"。

---

## 1. 当前状态调研（事实记录）

### 1.1 文件
- 路径：`apps/gateway/services/reportRepo.js`
- 总行数：**3273 行**
- worktree：`/Volumes/tyj/Cyrus/GitHub/ecom-agent-platform-worktrees/pr12-zod-expand/`

### 1.2 顶层 const / let（按行号顺序，共约 38 项）

| 行 | 名称 | 类型 |
|---|---|---|
| 8 | `log` | logger 实例 |
| 10 | `BASE_DIR` | path |
| 11 | `CONFIG_PATH` | path |
| 13 | `SLOW_SQL_THRESHOLD_MS` = 300 | number |
| 14 | `DAILY_UNION_CACHE_TTL_MS` = 30s | number |
| 15 | `DATE_CHOICES_CACHE_TTL_MS` = 45s | number |
| 16 | `DASHBOARD_CACHE_TTL_MS` = 45s | number |
| 17 | `CHANNEL_DASHBOARD_CACHE_TTL_MS` = 30s | number |
| 19 | `SALES_HISTORY_TABLE` | string |
| 20 | `SALES_DAILY_TABLE` | string |
| 21 | `INVENTORY_LATEST_TABLE` | string |
| 22 | `SKU_FILTER_SQL` | string |
| 23-27 | `DASHBOARD_*_LABEL` (5 个未标记/未分类标签) | string |
| 28-32 | `DASHBOARD_*_SQL` (5 个 coalesce 表达式) | string |
| 34 | `BASIC_KEYS` | string[] |
| 46 | `INVENTORY_KEYS` | string[] |
| 71 | `SALES_QTY_KEYS` | string[] |
| 96 | `DASHBOARD_NET_SALES_QTY_KEYS` = `SALES_QTY_KEYS.filter(...)` | **派生** |
| 98 | `DASHBOARD_NET_QTY_EXPR` = 由 NET_SALES_QTY_KEYS 拼接 | **派生** |
| 100 | `SKU_DISCOUNT_KEYS` | string[] |
| 126 | `STYLE_DISCOUNT_KEYS` | string[] |
| 152 | `CHANNEL_DASHBOARD_MAX_CHANNELS` = 4 | number |
| 153 | `CHANNEL_DASHBOARD_OPTIONS` | object[] |
| 353 | `CHANNEL_DASHBOARD_OPTION_MAP` = `new Map(OPTIONS.map(...))` | **派生** |
| 354 | `CHANNEL_DASHBOARD_DEFAULT_CODES` = `OPTIONS.slice(0, MAX).map(...)` | **派生** |
| 357 | `DASHBOARD_COMPARE_MAX_CHANNELS` = 2 | number |
| 358 | `DASHBOARD_COMPARE_DEFAULT_CODES` = `OPTIONS.slice(0, 2).map(...)` | **派生** |
| 362 | `WEEK_COLUMN_HEADERS` | string[]（中文表头） |
| 466 | `DAILY_COLUMN_HEADERS` = `["库存快照日期", ...WEEK_COLUMN_HEADERS.slice(1)]` | **派生** |
| 468-475 | `SALES_SUM_SQL`, `SKU_DISCOUNT_AVG_SQL`, `STYLE_DISCOUNT_AVG_SQL`, `INVENTORY_PICK_SQL`, `INVENTORY_MERGE_SQL`, `SALES_MERGE_SQL`, `SKU_DISCOUNT_MERGE_SQL`, `STYLE_DISCOUNT_MERGE_SQL` | **派生 SQL 模板** |
| 477 | `DAILY_UNION_SQL` = 大模板字符串 | **派生** |
| 543 | `let poolPromise` | mutable singleton |
| 544 | `let analysisTableReadyPromise` | mutable singleton |
| 545 | `DAILY_UNION_CACHE` = `new Map()` | mutable map |
| 546 | `DASHBOARD_OVERVIEW_CACHE` = `new Map()` | mutable map |
| 547 | `DASHBOARD_OVERVIEW_IN_FLIGHT` = `new Map()` | mutable map |
| 548 | `CHANNEL_DASHBOARD_CACHE` = `new Map()` | mutable map |
| 549 | `let dateChoicesPromise` | mutable singleton |
| 550 | `let dashboardDatesPromise` | mutable singleton |
| 551 | `let dateChoicesCache` | mutable record |
| 555 | `let dashboardDatesCache` | mutable record |

> **关键派生关系（必须保留）**：
> - `DASHBOARD_NET_*` 派生自 `SALES_QTY_KEYS` → 必须同文件
> - `CHANNEL_DASHBOARD_OPTION_MAP/DEFAULT_CODES/COMPARE_DEFAULT_CODES` 派生自 `CHANNEL_DASHBOARD_OPTIONS` → 必须同文件
> - `SALES_SUM_SQL` 等 8 个派生 SQL 派生自 `*_KEYS` 数组 → 必须同文件
> - `DAILY_UNION_SQL` 引用 `SALES_DAILY_TABLE` / `INVENTORY_LATEST_TABLE` / `SKU_FILTER_SQL` / `SALES_SUM_SQL` / `SKU_DISCOUNT_AVG_SQL` / `STYLE_DISCOUNT_AVG_SQL` / `INVENTORY_PICK_SQL` 7 个常量 → 集中放置
> - `DAILY_COLUMN_HEADERS` 派生自 `WEEK_COLUMN_HEADERS` → 必须同文件

### 1.3 函数清单（按行号 + 主题分块，共 100 函数）

#### A. PG pool / 配置 / SQL 计时（行 560-635，共 6 函数）
| 行 | 函数 | async |
|---|---|---|
| 560 | `readConfig` | sync |
| 565 | `toBool` | sync |
| 582 | `buildPgConfig` | sync |
| 598 | `compactSqlText` | sync |
| 602 | `timedQuery` | async |
| 615 | `getPool` | async |

#### B. 日期 / 数值 / 文本 utils（行 637-836，共 18 函数）
| 行 | 函数 |
|---|---|
| 637 | `normalizeDateInput` |
| 645 | `normalizeDailyRangeInput` |
| 665 | `buildDefaultDateRangeFromChoices` |
| 681 | `buildAnchorDateRange` |
| 693 | `toDateText` |
| 707 | `dateTimeText` |
| 724 | `toText` |
| 731 | `toNumber` |
| 739 | `toIntValue` |
| 743 | `toPercentText` |
| 751 | `roundNumber` |
| 760 | `percentChange` |
| 772 | `parseDateTextUtc` |
| 784 | `daysBetweenInclusive` |
| 794 | `formatDateUtc` |
| 805 | `shiftDateText` |
| 815 | `buildWeekGroupHeaders` |
| 826 | `buildDailyGroupHeaders` |

#### C. 行 transform（837-874，共 2 函数）
| 行 | 函数 |
|---|---|
| 837 | `toWeekRow` |
| 856 | `toDailyRow` |

#### D. cache（875-924，共 6 函数）
| 行 | 函数 |
|---|---|
| 875 | `makeDailyUnionCacheKey` |
| 879 | `getDailyUnionCache` |
| 892 | `setDailyUnionCache` |
| 900 | `makeChannelDashboardCacheKey` |
| 904 | `getChannelDashboardCache` |
| 917 | `setChannelDashboardCache` |

#### E. dashboard date choices（925-1095，共 5 函数）
| 行 | 函数 | async |
|---|---|---|
| 925 | `getDateChoices` | async |
| 983 | `getDashboardDateChoices` | async |
| 1015 | `resolveDashboardAnchorDate` | async |
| 1032 | `resolveDashboardRange` | async |
| 1071 | `resolveOptionalDashboardRange` | async |

#### F. dashboard drilldown（1096-1376，共 9 函数）
| 行 | 函数 | async |
|---|---|---|
| 1096 | `normalizeDashboardDrilldownLevel` | sync |
| 1101 | `buildDashboardDrilldownBaseSql` | sync |
| 1157 | `buildDashboardDrilldownEmptyPayload` | sync |
| 1180 | `toDashboardSummary` | sync |
| 1189 | `toDashboardStyleDrilldownRow` | sync |
| 1202 | `toDashboardSkuDrilldownRow` | sync |
| 1218 | `queryDashboardStyleDrilldown` | async |
| 1280 | `queryDashboardSkuDrilldown` | async |
| 1325 | `getDashboardDrilldown` | async |

#### G. channel dashboard（1377-2070，共 18 函数）
| 行 | 函数 | async |
|---|---|---|
| 1377 | `getChannelDashboardAvailableChannels` | sync |
| 1385 | `normalizeChannelCodes` | sync |
| 1406 | `normalizeChannelDashboardCodes` | sync |
| 1410 | `normalizeDashboardCompareCodes` | sync |
| 1414 | `buildChannelDashboardInventoryExpr` | sync |
| 1422 | `buildChannelDashboardSql` | sync |
| 1511 | `toMainColorText` | sync |
| 1520 | `toChannelDashboardItem` | sync |
| 1541 | `summarizeChannelDashboardRows` | sync |
| 1558 | `buildChannelDashboardPanel` | sync |
| 1576 | `buildChannelDashboardPanels` | sync |
| 1583 | `buildChannelDashboardCombinedSql` | sync |
| 1719 | `buildChannelDashboardStyleDrilldownBaseSql` | sync |
| 1786 | `buildChannelDashboardStyleDrilldownEmptyPayload` | sync |
| 1822 | `toChannelDashboardStyleSummary` | sync |
| 1847 | `toChannelDashboardStyleDrilldownItem` | sync |
| 1868 | `getChannelDashboardStyleDrilldown` | async |
| 1963 | `queryChannelDashboardPanel` | async |
| 1975 | `getChannelDashboard` | async |

#### H. dashboard channel compare（2071-2331，共 9 函数）
| 行 | 函数 | async |
|---|---|---|
| 2071 | `normalizeDashboardCompareChange` | sync |
| 2076 | `computePiecePrice` | sync |
| 2084 | `getDashboardCompareLabelFallback` | sync |
| 2094 | `buildDashboardCompareDimensionSql` | sync |
| 2191 | `toDashboardCompareSummary` | sync |
| 2215 | `toDashboardCompareRows` | sync |
| 2263 | `queryDashboardCompareSection` | async |
| 2277 | `buildDashboardCompareChannel` | async |
| 2296 | `getDashboardChannelCompare` | async |

#### I. dashboard overview（2332-2762，共 10 函数）
| 行 | 函数 | async |
|---|---|---|
| 2332 | `queryDashboardOverviewMetrics` | async |
| 2394 | `queryDashboardDailyTrend` | async |
| 2433 | `queryDashboardWeeklyTrend` | async |
| 2498 | `queryDashboardCategoryStructure` | async |
| 2551 | `queryDashboardCategoryMovement` | async |
| 2622 | `makeDashboardOverviewCacheKey` | sync |
| 2626 | `getDashboardOverviewCache` | sync |
| 2642 | `setDashboardOverviewCache` | sync |
| 2653 | `buildDashboardKpiNode` | sync |
| 2664 | `getDashboardOverview` | async |

#### J. shared util + weekly + daily（2764-3032，共 17 函数）
| 行 | 函数 | async |
|---|---|---|
| 2764 | `filterObjectRowsByKeyword` | sync |
| 2801 | `paginateRows` | sync |
| 2813 | `queryDailyUnionBaseRows` | async |
| 2825 | `summarizeDailyRows` | sync |
| 2845 | `getWeekChoices` | async |
| 2853 | `resolveWeek` | async |
| 2865 | `getReportMeta` | async |
| 2886 | `getReportRows` | async |
| 2898 | `getReportExportRows` | async |
| 2903 | `getDailyDateChoices` | async |
| 2911 | `resolveDailyDate` | async |
| 2923 | `resolveDailyRange` | async |
| 2949 | `resolveDashboardCompareRange` | async |
| 2958 | `getDailyMeta` | async |
| 2978 | `getDailyRangeMeta` | async |
| 2999 | `getDailyRows` | async |
| 3011 | `getDailyRowsRange` | async |
| 3023 | `getDailyExportRows` | async |
| 3028 | `getDailyExportRowsRange` | async |

> J 块实际 19 函数（清点表）。

#### K. analysis reports（3033-3194，共 4 函数）
| 行 | 函数 | async |
|---|---|---|
| 3033 | `ensureAnalysisReportsTable` | async |
| 3091 | `createAnalysisReport` | async |
| 3139 | `listAnalysisReports` | async |
| 3194 | `getAnalysisReportById` | async |

> 函数总数：6 + 18 + 2 + 6 + 5 + 9 + 19 + 9 + 10 + 19 + 4 = **107**（按上面分块累加，实际函数数比 100 略多，因 J 块多两个函数）。

### 1.4 module.exports（26 个公共 API，行 3246）
```js
module.exports = {
  getPool,
  ensureAnalysisReportsTable, createAnalysisReport, listAnalysisReports, getAnalysisReportById,
  getDashboardDateChoices, resolveDashboardAnchorDate, getDashboardOverview,
  getDashboardChannelCompare, getDashboardDrilldown,
  getChannelDashboard, getChannelDashboardStyleDrilldown,
  getWeekChoices, resolveWeek, getReportMeta, getReportRows, getReportExportRows,
  getDailyDateChoices, resolveDailyDate, resolveDailyRange,
  getDailyMeta, getDailyRangeMeta, getDailyRows, getDailyRowsRange,
  getDailyExportRows, getDailyExportRowsRange,
};
```

### 1.5 Consumer 调用清单（5 处 require + 1 处 ctx 注入）

| 文件 | 行 | 用法 | 接触面 |
|---|---|---|---|
| `apps/gateway/server.js` | 10 | `const reportRepo = require("./services/reportRepo")` | 全对象注入 ctx（行 1609/1617/1629），boot 自检调用 7 个方法（行 1018/1684/1688/1689/1697/1702 等） |
| `apps/gateway/server.js` | 1526 | `getPool: () => reportRepo.getPool()` | metrics 暴露 pool |
| `apps/gateway/server.js` | 1588 | 同上 | health 检查 |
| `apps/gateway/routes/report.js` | 各处 | `reportRepo.xxx`（24 处调用） | weekly + daily 系列共 14 个方法 |
| `apps/gateway/routes/dashboard.js` | 13 | `const { reportRepo } = ctx` 后 `.xxx`（6 处） | dashboard + channel 系列共 6 个方法 |
| `apps/gateway/routes/agent.js` | 各处 | `reportRepo.xxx`（3 处） | analysis reports 3 个方法 |
| `apps/gateway/services/metricsService.js` | 3, 83, 388 | 直接 require，**只用 `getPool()`** | 1 个方法 |
| `apps/gateway/services/analysisContextProvider.js` | 7, 70 | 直接 require，**只用 `listAnalysisReports`** | 1 个方法 |

### 1.6 现有 smoke 守门（实际 9 文件，含 unit）

`apps/gateway/tests/`
```
smoke/
  admin.test.js
  agent.test.js          ← 守 analysisReports 路径
  auth.test.js
  dispatch.test.js
  health.test.js         ← 守 server.js 启动 + getPool
  report.test.js         ← 守 weekly + daily（含中文文件名）
  validation.test.js
unit/
  auditLogger.test.js
  passwordHasher.test.js
```

> **重要修正**：调研时被告知存在 `dashboard.test.js`，实际**不存在**。dashboard / channel / drilldown 路径目前**无 smoke 守门**。Plan §9 会就此提出建议。

### 1.7 已存在的 lib/ 目录
`apps/gateway/lib/` 已存在 4 文件：
```
logger.js
metrics.js
passwordHasher.js
sentryClient.js
```
新增 `lib/db.js` 顺势放入即可，**不需要新建目录**。

---

## 2. 拆分目标

| 目标 | 度量 |
|---|---|
| 单文件 ≤ 600 行 | 全部新文件行数 ≤ 600 |
| 公共 API 兼容 | `require("./services/reportRepo")` 返回对象与现状 100% 一致（28 字段不少不变名） |
| pg pool / 缓存单例语义保持 | 跨文件 require 必须命中 Node `require` 缓存，仍是同一 Pool 实例、同一 Map 实例（E1 须验证：连续调 2 次 `getPool` 返回相同 promise；连续 2 次 daily union 第二次走缓存） |
| 加新报表只改 1 个新文件 | 新报表落在 `services/report/<domain>/<feature>.js`，并在 `services/report/index.js` 加一行 re-export |
| 不破坏 routes 现有 import 路径 | `services/reportRepo.js` 保留为 facade，**不动 routes/server** |
| smoke 全绿 | `cd apps/gateway && npm test` 当前 9 文件全绿，拆分后仍全绿 |

**非目标（V4 留口）**：见 §11。

---

## 3. 拟定新文件结构

```
apps/gateway/
├── lib/
│   ├── db.js                                  ← 新增（A 块，约 100 行）
│   └── (logger.js / metrics.js / ...已有)
└── services/
    ├── reportRepo.js                          ← 改为 1 行 facade
    └── report/                                ← 新增目录
        ├── index.js                           ← 聚合 re-export 26 个公共 API（约 80 行）
        ├── constants.js                       ← 顶层 SQL 模板 / 表名 / 标签 / KEYS / 派生 SQL（约 250 行）
        ├── cache.js                           ← D 块 cache + I 块 dashboard overview cache（约 140 行）
        ├── shared/
        │   ├── dateUtils.js                   ← B 块日期 utils（约 180 行）
        │   ├── numberUtils.js                 ← B 块数值/文本 utils（约 100 行）
        │   ├── rowTransforms.js               ← C 块 toWeekRow / toDailyRow（约 60 行）
        │   └── pagination.js                  ← filterObjectRowsByKeyword + paginateRows（约 60 行）
        ├── dashboard/
        │   ├── dateChoices.js                 ← E 块（约 200 行）
        │   ├── drilldown.js                   ← F 块（约 290 行）
        │   ├── overview.js                    ← I 块（约 440 行）
        │   ├── channelCompare.js              ← H 块（约 270 行）
        │   └── index.js                       ← 聚合 dashboard 子域（约 30 行）
        ├── channel/
        │   ├── options.js                     ← G 块前段：CHANNEL_DASHBOARD_OPTIONS + 派生 + normalize（约 230 行）
        │   ├── panel.js                       ← G 块中段：buildChannelDashboardSql / queryChannelDashboardPanel / getChannelDashboard（约 320 行）
        │   ├── styleDrilldown.js              ← G 块后段：channelDashboardStyleDrilldown 系列（约 260 行）
        │   └── index.js                       ← 聚合 channel 子域（约 20 行）
        ├── weekly.js                          ← J 块的 week 部分 + WEEK_COLUMN_HEADERS（约 110 行）
        ├── daily.js                           ← J 块的 daily 部分 + DAILY_COLUMN_HEADERS + DAILY_UNION_SQL（约 350 行）
        └── analysisReports.js                 ← K 块（约 200 行）
```

> **行数估算依据**：原文件 3273 行 / 28 个目标文件，结合每块函数密度做逐文件估算。`daily.js` / `overview.js` / `panel.js` 偏大但仍 < 600。

---

## 4. 函数迁移映射表（执行 Agent 最关键的输入）

> 列说明：
> - **目标文件**：相对 `apps/gateway/`
> - **是否 export**：模块对外导出（无论是否在最终 facade re-export）
> - **routes 直用**：是否在 routes/*.js 中通过 `reportRepo.xxx` 直接调用

| # | 函数 | 当前行 | 目标文件 | 是否 export | routes 直用 |
|---|---|---|---|---|---|
| 1 | readConfig | 560 | lib/db.js | no | no |
| 2 | toBool | 565 | lib/db.js | no | no |
| 3 | buildPgConfig | 582 | lib/db.js | no | no |
| 4 | compactSqlText | 598 | lib/db.js | no | no |
| 5 | timedQuery | 602 | lib/db.js | yes | no |
| 6 | getPool | 615 | lib/db.js | yes | no（**server.js 直 require**） |
| 7 | normalizeDateInput | 637 | services/report/shared/dateUtils.js | yes | no |
| 8 | normalizeDailyRangeInput | 645 | services/report/shared/dateUtils.js | yes | no |
| 9 | buildDefaultDateRangeFromChoices | 665 | services/report/shared/dateUtils.js | yes | no |
| 10 | buildAnchorDateRange | 681 | services/report/shared/dateUtils.js | yes | no |
| 11 | toDateText | 693 | services/report/shared/dateUtils.js | yes | no |
| 12 | dateTimeText | 707 | services/report/shared/dateUtils.js | yes | no |
| 13 | toText | 724 | services/report/shared/numberUtils.js | yes | no |
| 14 | toNumber | 731 | services/report/shared/numberUtils.js | yes | no |
| 15 | toIntValue | 739 | services/report/shared/numberUtils.js | yes | no |
| 16 | toPercentText | 743 | services/report/shared/numberUtils.js | yes | no |
| 17 | roundNumber | 751 | services/report/shared/numberUtils.js | yes | no |
| 18 | percentChange | 760 | services/report/shared/numberUtils.js | yes | no |
| 19 | parseDateTextUtc | 772 | services/report/shared/dateUtils.js | yes | no |
| 20 | daysBetweenInclusive | 784 | services/report/shared/dateUtils.js | yes | no |
| 21 | formatDateUtc | 794 | services/report/shared/dateUtils.js | yes | no |
| 22 | shiftDateText | 805 | services/report/shared/dateUtils.js | yes | no |
| 23 | buildWeekGroupHeaders | 815 | services/report/weekly.js | yes | no |
| 24 | buildDailyGroupHeaders | 826 | services/report/daily.js | yes | no |
| 25 | toWeekRow | 837 | services/report/shared/rowTransforms.js | yes | no |
| 26 | toDailyRow | 856 | services/report/shared/rowTransforms.js | yes | no |
| 27 | makeDailyUnionCacheKey | 875 | services/report/cache.js | yes | no |
| 28 | getDailyUnionCache | 879 | services/report/cache.js | yes | no |
| 29 | setDailyUnionCache | 892 | services/report/cache.js | yes | no |
| 30 | makeChannelDashboardCacheKey | 900 | services/report/cache.js | yes | no |
| 31 | getChannelDashboardCache | 904 | services/report/cache.js | yes | no |
| 32 | setChannelDashboardCache | 917 | services/report/cache.js | yes | no |
| 33 | getDateChoices | 925 | services/report/dashboard/dateChoices.js | yes | no |
| 34 | getDashboardDateChoices | 983 | services/report/dashboard/dateChoices.js | **yes（公共 API）** | **yes** |
| 35 | resolveDashboardAnchorDate | 1015 | services/report/dashboard/dateChoices.js | **yes（公共 API）** | no（仅内部 + server boot） |
| 36 | resolveDashboardRange | 1032 | services/report/dashboard/dateChoices.js | yes | no |
| 37 | resolveOptionalDashboardRange | 1071 | services/report/dashboard/dateChoices.js | yes | no |
| 38 | normalizeDashboardDrilldownLevel | 1096 | services/report/dashboard/drilldown.js | yes | no |
| 39 | buildDashboardDrilldownBaseSql | 1101 | services/report/dashboard/drilldown.js | yes | no |
| 40 | buildDashboardDrilldownEmptyPayload | 1157 | services/report/dashboard/drilldown.js | yes | no |
| 41 | toDashboardSummary | 1180 | services/report/dashboard/drilldown.js | yes | no |
| 42 | toDashboardStyleDrilldownRow | 1189 | services/report/dashboard/drilldown.js | yes | no |
| 43 | toDashboardSkuDrilldownRow | 1202 | services/report/dashboard/drilldown.js | yes | no |
| 44 | queryDashboardStyleDrilldown | 1218 | services/report/dashboard/drilldown.js | yes | no |
| 45 | queryDashboardSkuDrilldown | 1280 | services/report/dashboard/drilldown.js | yes | no |
| 46 | getDashboardDrilldown | 1325 | services/report/dashboard/drilldown.js | **yes（公共 API）** | **yes** |
| 47 | getChannelDashboardAvailableChannels | 1377 | services/report/channel/options.js | yes | no |
| 48 | normalizeChannelCodes | 1385 | services/report/channel/options.js | yes | no |
| 49 | normalizeChannelDashboardCodes | 1406 | services/report/channel/options.js | yes | no |
| 50 | normalizeDashboardCompareCodes | 1410 | services/report/channel/options.js | yes | no |
| 51 | buildChannelDashboardInventoryExpr | 1414 | services/report/channel/panel.js | yes | no |
| 52 | buildChannelDashboardSql | 1422 | services/report/channel/panel.js | yes | no |
| 53 | toMainColorText | 1511 | services/report/channel/panel.js | yes | no |
| 54 | toChannelDashboardItem | 1520 | services/report/channel/panel.js | yes | no |
| 55 | summarizeChannelDashboardRows | 1541 | services/report/channel/panel.js | yes | no |
| 56 | buildChannelDashboardPanel | 1558 | services/report/channel/panel.js | yes | no |
| 57 | buildChannelDashboardPanels | 1576 | services/report/channel/panel.js | yes | no |
| 58 | buildChannelDashboardCombinedSql | 1583 | services/report/channel/panel.js | yes | no |
| 59 | buildChannelDashboardStyleDrilldownBaseSql | 1719 | services/report/channel/styleDrilldown.js | yes | no |
| 60 | buildChannelDashboardStyleDrilldownEmptyPayload | 1786 | services/report/channel/styleDrilldown.js | yes | no |
| 61 | toChannelDashboardStyleSummary | 1822 | services/report/channel/styleDrilldown.js | yes | no |
| 62 | toChannelDashboardStyleDrilldownItem | 1847 | services/report/channel/styleDrilldown.js | yes | no |
| 63 | getChannelDashboardStyleDrilldown | 1868 | services/report/channel/styleDrilldown.js | **yes（公共 API）** | **yes** |
| 64 | queryChannelDashboardPanel | 1963 | services/report/channel/panel.js | yes | no |
| 65 | getChannelDashboard | 1975 | services/report/channel/panel.js | **yes（公共 API）** | **yes** |
| 66 | normalizeDashboardCompareChange | 2071 | services/report/dashboard/channelCompare.js | yes | no |
| 67 | computePiecePrice | 2076 | services/report/dashboard/channelCompare.js | yes | no |
| 68 | getDashboardCompareLabelFallback | 2084 | services/report/dashboard/channelCompare.js | yes | no |
| 69 | buildDashboardCompareDimensionSql | 2094 | services/report/dashboard/channelCompare.js | yes | no |
| 70 | toDashboardCompareSummary | 2191 | services/report/dashboard/channelCompare.js | yes | no |
| 71 | toDashboardCompareRows | 2215 | services/report/dashboard/channelCompare.js | yes | no |
| 72 | queryDashboardCompareSection | 2263 | services/report/dashboard/channelCompare.js | yes | no |
| 73 | buildDashboardCompareChannel | 2277 | services/report/dashboard/channelCompare.js | yes | no |
| 74 | getDashboardChannelCompare | 2296 | services/report/dashboard/channelCompare.js | **yes（公共 API）** | **yes** |
| 75 | queryDashboardOverviewMetrics | 2332 | services/report/dashboard/overview.js | yes | no |
| 76 | queryDashboardDailyTrend | 2394 | services/report/dashboard/overview.js | yes | no |
| 77 | queryDashboardWeeklyTrend | 2433 | services/report/dashboard/overview.js | yes | no |
| 78 | queryDashboardCategoryStructure | 2498 | services/report/dashboard/overview.js | yes | no |
| 79 | queryDashboardCategoryMovement | 2551 | services/report/dashboard/overview.js | yes | no |
| 80 | makeDashboardOverviewCacheKey | 2622 | services/report/cache.js | yes | no |
| 81 | getDashboardOverviewCache | 2626 | services/report/cache.js | yes | no |
| 82 | setDashboardOverviewCache | 2642 | services/report/cache.js | yes | no |
| 83 | buildDashboardKpiNode | 2653 | services/report/dashboard/overview.js | yes | no |
| 84 | getDashboardOverview | 2664 | services/report/dashboard/overview.js | **yes（公共 API）** | **yes** |
| 85 | filterObjectRowsByKeyword | 2764 | services/report/shared/pagination.js | yes | no |
| 86 | paginateRows | 2801 | services/report/shared/pagination.js | yes | no |
| 87 | queryDailyUnionBaseRows | 2813 | services/report/daily.js | yes | no |
| 88 | summarizeDailyRows | 2825 | services/report/daily.js | yes | no |
| 89 | getWeekChoices | 2845 | services/report/weekly.js | **yes（公共 API）** | **yes** |
| 90 | resolveWeek | 2853 | services/report/weekly.js | **yes（公共 API）** | **yes** |
| 91 | getReportMeta | 2865 | services/report/weekly.js | **yes（公共 API）** | **yes** |
| 92 | getReportRows | 2886 | services/report/weekly.js | **yes（公共 API）** | **yes** |
| 93 | getReportExportRows | 2898 | services/report/weekly.js | **yes（公共 API）** | **yes** |
| 94 | getDailyDateChoices | 2903 | services/report/daily.js | **yes（公共 API）** | **yes** |
| 95 | resolveDailyDate | 2911 | services/report/daily.js | **yes（公共 API）** | **yes** |
| 96 | resolveDailyRange | 2923 | services/report/daily.js | **yes（公共 API）** | **yes** |
| 97 | resolveDashboardCompareRange | 2949 | services/report/dashboard/channelCompare.js | yes | no |
| 98 | getDailyMeta | 2958 | services/report/daily.js | **yes（公共 API）** | **yes** |
| 99 | getDailyRangeMeta | 2978 | services/report/daily.js | **yes（公共 API）** | **yes** |
| 100 | getDailyRows | 2999 | services/report/daily.js | **yes（公共 API）** | **yes** |
| 101 | getDailyRowsRange | 3011 | services/report/daily.js | **yes（公共 API）** | **yes** |
| 102 | getDailyExportRows | 3023 | services/report/daily.js | **yes（公共 API）** | **yes** |
| 103 | getDailyExportRowsRange | 3028 | services/report/daily.js | **yes（公共 API）** | **yes** |
| 104 | ensureAnalysisReportsTable | 3033 | services/report/analysisReports.js | **yes（公共 API）** | **yes** |
| 105 | createAnalysisReport | 3091 | services/report/analysisReports.js | **yes（公共 API）** | **yes** |
| 106 | listAnalysisReports | 3139 | services/report/analysisReports.js | **yes（公共 API）** | **yes（agent.js + analysisContextProvider.js）** |
| 107 | getAnalysisReportById | 3194 | services/report/analysisReports.js | **yes（公共 API）** | **yes** |

**条目总数：107**（>100，原调研 100 是估算，实际清点 107 函数）。

---

## 5. 顶层 const 迁移表

| const | 当前行 | 目标文件 | 备注 |
|---|---|---|---|
| `BASE_DIR` | 10 | lib/db.js | 配合 readConfig |
| `CONFIG_PATH` | 11 | lib/db.js | 配合 readConfig |
| `SLOW_SQL_THRESHOLD_MS` | 13 | lib/db.js | 配合 timedQuery |
| `DAILY_UNION_CACHE_TTL_MS` | 14 | services/report/cache.js | |
| `DATE_CHOICES_CACHE_TTL_MS` | 15 | services/report/cache.js | |
| `DASHBOARD_CACHE_TTL_MS` | 16 | services/report/cache.js | |
| `CHANNEL_DASHBOARD_CACHE_TTL_MS` | 17 | services/report/cache.js | |
| `SALES_HISTORY_TABLE` | 19 | services/report/constants.js | |
| `SALES_DAILY_TABLE` | 20 | services/report/constants.js | |
| `INVENTORY_LATEST_TABLE` | 21 | services/report/constants.js | |
| `SKU_FILTER_SQL` | 22 | services/report/constants.js | |
| `DASHBOARD_UNCATEGORIZED_LABEL` 等 5 个标签 | 23-27 | services/report/constants.js | |
| `DASHBOARD_*_SQL` 5 个 | 28-32 | services/report/constants.js | 派生于上面标签 |
| `BASIC_KEYS` | 34 | services/report/constants.js | |
| `INVENTORY_KEYS` | 46 | services/report/constants.js | |
| `SALES_QTY_KEYS` | 71 | services/report/constants.js | |
| `DASHBOARD_NET_SALES_QTY_KEYS` | 96 | services/report/constants.js | 派生 |
| `DASHBOARD_NET_QTY_EXPR` | 98 | services/report/constants.js | 派生 |
| `SKU_DISCOUNT_KEYS` | 100 | services/report/constants.js | |
| `STYLE_DISCOUNT_KEYS` | 126 | services/report/constants.js | |
| `CHANNEL_DASHBOARD_MAX_CHANNELS` | 152 | services/report/channel/options.js | |
| `CHANNEL_DASHBOARD_OPTIONS` | 153 | services/report/channel/options.js | |
| `CHANNEL_DASHBOARD_OPTION_MAP` | 353 | services/report/channel/options.js | 派生 |
| `CHANNEL_DASHBOARD_DEFAULT_CODES` | 354 | services/report/channel/options.js | 派生 |
| `DASHBOARD_COMPARE_MAX_CHANNELS` | 357 | services/report/channel/options.js | |
| `DASHBOARD_COMPARE_DEFAULT_CODES` | 358 | services/report/channel/options.js | 派生 |
| `WEEK_COLUMN_HEADERS` | 362 | services/report/weekly.js | |
| `DAILY_COLUMN_HEADERS` | 466 | services/report/daily.js | 派生于 WEEK；**daily.js 必须 import weekly 中 WEEK_COLUMN_HEADERS**（或重复声明，建议前者） |
| `SALES_SUM_SQL` | 468 | services/report/constants.js | 派生于 SALES_QTY_KEYS |
| `SKU_DISCOUNT_AVG_SQL` | 469 | services/report/constants.js | 派生 |
| `STYLE_DISCOUNT_AVG_SQL` | 470 | services/report/constants.js | 派生 |
| `INVENTORY_PICK_SQL` | 471 | services/report/constants.js | 派生 |
| `INVENTORY_MERGE_SQL` | 472 | services/report/constants.js | 派生 |
| `SALES_MERGE_SQL` | 473 | services/report/constants.js | 派生 |
| `SKU_DISCOUNT_MERGE_SQL` | 474 | services/report/constants.js | 派生 |
| `STYLE_DISCOUNT_MERGE_SQL` | 475 | services/report/constants.js | 派生 |
| `DAILY_UNION_SQL` | 477 | services/report/daily.js | 引用 constants.js 中 7 个常量；放 daily 因为只 daily 用（panel/drilldown 不用） |
| `let poolPromise` | 543 | lib/db.js | 模块级 mutable singleton |
| `let analysisTableReadyPromise` | 544 | services/report/analysisReports.js | 模块级 |
| `DAILY_UNION_CACHE` | 545 | services/report/cache.js | Map |
| `DASHBOARD_OVERVIEW_CACHE` | 546 | services/report/cache.js | Map |
| `DASHBOARD_OVERVIEW_IN_FLIGHT` | 547 | services/report/cache.js | Map |
| `CHANNEL_DASHBOARD_CACHE` | 548 | services/report/cache.js | Map |
| `let dateChoicesPromise` / `dateChoicesCache` | 549, 551 | services/report/dashboard/dateChoices.js | 模块级 |
| `let dashboardDatesPromise` / `dashboardDatesCache` | 550, 555 | services/report/dashboard/dateChoices.js | 模块级 |
| `log` | 8 | 各文件按需 `childLogger("xxx")`（建议每文件用自己的 child logger） |

---

## 6. import 依赖图（无循环）

```
lib/db.js
  └─ require: fs, path, pg, lib/logger
     无内部依赖（叶子）

services/report/constants.js
  └─ require: 无（纯字符串/数组）

services/report/shared/dateUtils.js
services/report/shared/numberUtils.js
services/report/shared/pagination.js
  └─ 无内部依赖（叶子）

services/report/shared/rowTransforms.js
  └─ require: ../constants（KEYS）, ./numberUtils

services/report/cache.js
  └─ 无内部依赖（仅 Date.now / Map）
  注：TTL 常量内联，IN_FLIGHT Map 暴露给 overview.js 直接用

services/report/dashboard/dateChoices.js
  └─ require: ../../lib/db (getPool, timedQuery)
              ../shared/dateUtils
              ../constants

services/report/dashboard/drilldown.js
  └─ require: ../../lib/db (getPool, timedQuery)
              ../shared/dateUtils
              ../shared/numberUtils
              ../constants
              ./dateChoices (resolveDashboardRange)

services/report/dashboard/overview.js
  └─ require: ../../lib/db (getPool, timedQuery)
              ../shared/dateUtils
              ../shared/numberUtils
              ../constants
              ../cache (DASHBOARD_OVERVIEW_*)
              ./dateChoices (resolveDashboardRange)

services/report/dashboard/channelCompare.js
  └─ require: ../../lib/db
              ../shared/dateUtils, numberUtils
              ../constants
              ../channel/options (OPTIONS, normalizeDashboardCompareCodes)
              ./dateChoices

services/report/channel/options.js
  └─ require: 无（纯常量 + 纯函数 normalize）

services/report/channel/panel.js
  └─ require: ../../lib/db
              ../shared/dateUtils, numberUtils
              ../constants
              ../cache (CHANNEL_DASHBOARD_CACHE 通过 cache.js 暴露的 get/set)
              ./options

services/report/channel/styleDrilldown.js
  └─ require: ../../lib/db
              ../shared/numberUtils
              ../constants
              ./options
              ./panel (复用部分 sql 拼装)  ← 检查具体引用，若无则去掉

services/report/weekly.js
  └─ require: ../../lib/db
              ./shared/dateUtils, numberUtils, rowTransforms, pagination
              ./constants

services/report/daily.js
  └─ require: ../../lib/db
              ./shared/dateUtils, numberUtils, rowTransforms, pagination
              ./constants
              ./cache (DAILY_UNION_CACHE 通过 get/set)
              ./weekly (WEEK_COLUMN_HEADERS)  ← 仅为 DAILY_COLUMN_HEADERS 派生

services/report/analysisReports.js
  └─ require: ../../lib/db (getPool)
              ./shared/dateUtils

services/report/dashboard/index.js
  └─ require: ./dateChoices, ./drilldown, ./overview, ./channelCompare
     re-export 4 文件公共函数

services/report/channel/index.js
  └─ require: ./options, ./panel, ./styleDrilldown
     re-export 3 文件公共函数

services/report/index.js
  └─ require: ../../lib/db (getPool)
              ./weekly, ./daily, ./analysisReports
              ./dashboard, ./channel
     聚合 26 个公共 API export 为对象

services/reportRepo.js
  └─ module.exports = require("./report");
```

**循环依赖检查**：
- daily → weekly（仅取 WEEK_COLUMN_HEADERS 常量），weekly 不反向依赖 daily ✅
- channelCompare → channel/options（仅取常量），options 不反向依赖 ✅
- styleDrilldown → panel：**待 E1 在迁移时核实**，若 styleDrilldown 仅用 panel 的某 helper（如 `toMainColorText`），考虑把该 helper 提到 channel 子目录的 shared 文件，避免双向耦合 ✅
- 其他叶子：lib/db、constants、shared/* 全部单向被引用 ✅

---

## 7. 兼容期策略

### 推荐方案：facade 单文件
```js
// apps/gateway/services/reportRepo.js（拆分后剩 1 行）
"use strict";
module.exports = require("./report");
```

**优点**：
- routes/server/metricsService/analysisContextProvider 5 个 consumer **零改动**
- diff 评审清晰：删旧 reportRepo.js 内容 → 新增 report/* → 重写 reportRepo.js
- 即使后续有人误 `require("./services/reportRepo")` 也仍能工作

**风险与缓解**：
| 风险 | 缓解 |
|---|---|
| `module.exports` 形状不一致 | E1 在 PR 落地前跑一次 `node -e "console.log(Object.keys(require('./services/reportRepo')).sort().join('\n'))"` 对比拆分前后输出，diff 必须为空 |
| 缓存 / pool 单例失效（跨文件 Map 不一致） | Node `require` 内置单例缓存，只要 `require("./report/cache")` 字符串路径一致就同一实例。E1 写完后用 `node -e "const a = require('./report/cache'); const b = require('./report/cache'); console.log(a === b)"` 验证 |
| facade 引入额外一次 require 解析 | 性能可忽略（启动期一次） |

### 不推荐方案
- **直接改 routes 的 require 路径** → diff 面太大，PR 难审，且必须同时改 ctx 注入逻辑
- **每个 routes 各自从 report/<domain> 直 require** → V4 优化方向，本轮先不动

---

## 8. 拆分顺序（Execute Agent 必须按此序，每步后 `npm test`）

> **原则**：从无依赖的叶子开始，逐层往上。每步是一次小提交（或一次 commit-amend 前的工作单元），跑 `cd apps/gateway && npm test`，红了立即停手 debug，不进入下一步。

### Step 1 — 抽 lib/db.js（A 块 + db 相关 const）
- 创建 `apps/gateway/lib/db.js`
- 迁入：`BASE_DIR`、`CONFIG_PATH`、`SLOW_SQL_THRESHOLD_MS`、`let poolPromise`、`readConfig`、`toBool`、`buildPgConfig`、`compactSqlText`、`timedQuery`、`getPool`
- export：`{ getPool, timedQuery }`
- **暂不删** reportRepo.js 中对应代码，先在 reportRepo 顶部加 `const { getPool, timedQuery } = require("../lib/db")` 并删除局部声明，确保 routes 仍能 `reportRepo.getPool()`
- 测试：`npm test`（health smoke 验 getPool 路径）

### Step 2 — 抽 services/report/shared/dateUtils.js + numberUtils.js（B 块）
- export 全部 18 函数
- reportRepo.js 顶部 require 后删局部声明
- 测试：`npm test`

### Step 3 — 抽 services/report/shared/rowTransforms.js（C 块） + shared/pagination.js（J 块部分）
- rowTransforms.js export `toWeekRow`, `toDailyRow`
- pagination.js export `filterObjectRowsByKeyword`, `paginateRows`
- 测试：`npm test`

### Step 4 — 抽 services/report/constants.js（顶层 SQL/KEYS/标签 + 派生）
- 包含 §5 表中所有归 constants.js 的 25+ 项（含 8 个派生 SQL 模板，**整块按行号顺序整体挪过去**，保留派生顺序避免引用未定义）
- export 全部 const（const 即 export，方便其他文件按需 named import）
- 测试：`npm test`

### Step 5 — 抽 services/report/cache.js（D 块 + I 块缓存 + TTL 常量）
- 包含 4 个 Map、4 个 TTL 常量、6 个 D 块函数 + 3 个 I 块缓存函数（makeDashboardOverviewCacheKey / get / set），以及暴露 `DASHBOARD_OVERVIEW_IN_FLIGHT` Map（让 overview.js 直接用）
- 测试：`npm test`

### Step 6 — 抽 services/report/dashboard/dateChoices.js（E 块）
- 包含 5 函数 + `let dateChoicesPromise` / `dateChoicesCache` / `dashboardDatesPromise` / `dashboardDatesCache`
- export 5 函数
- 测试：`npm test`（health 路径会 boot 时调 `getDashboardDateChoices`）

### Step 7 — 抽 services/report/dashboard/drilldown.js（F 块）
- 9 函数全迁
- 测试：`npm test`

### Step 8 — 抽 services/report/dashboard/overview.js（I 块剩余 7 函数）
- 5 个 query* + buildDashboardKpiNode + getDashboardOverview
- 引用 cache.js 的 IN_FLIGHT Map
- 测试：`npm test`

### Step 9 — 抽 services/report/channel/options.js（G 块前 4 函数 + 6 个 channel 常量）
- 包含 `CHANNEL_DASHBOARD_MAX_CHANNELS` / `OPTIONS` / `OPTION_MAP` / `DEFAULT_CODES` / `DASHBOARD_COMPARE_MAX_CHANNELS` / `DASHBOARD_COMPARE_DEFAULT_CODES`
- 4 函数：`getChannelDashboardAvailableChannels`, `normalizeChannelCodes`, `normalizeChannelDashboardCodes`, `normalizeDashboardCompareCodes`
- 测试：`npm test`

### Step 10 — 抽 services/report/channel/panel.js（G 块中段，10 函数）
- 包含 `buildChannelDashboardSql` / `queryChannelDashboardPanel` / `getChannelDashboard` 等
- 测试：`npm test`

### Step 11 — 抽 services/report/channel/styleDrilldown.js（G 块后段 5 函数）
- 包含 `getChannelDashboardStyleDrilldown` 等
- 测试：`npm test`

### Step 12 — 抽 services/report/dashboard/channelCompare.js（H 块 + J 块 `resolveDashboardCompareRange`）
- 9 函数 + 1 函数（resolveDashboardCompareRange 行 2949 归此）
- 测试：`npm test`

### Step 13 — 抽 services/report/weekly.js（J 块 week 部分 + WEEK_COLUMN_HEADERS + buildWeekGroupHeaders）
- 函数：`buildWeekGroupHeaders` + `getWeekChoices` + `resolveWeek` + `getReportMeta` + `getReportRows` + `getReportExportRows`
- 常量：`WEEK_COLUMN_HEADERS`
- 测试：`npm test`（report.test.js 覆盖）

### Step 14 — 抽 services/report/daily.js（J 块 daily 部分 + DAILY_COLUMN_HEADERS + DAILY_UNION_SQL + buildDailyGroupHeaders + queryDailyUnionBaseRows + summarizeDailyRows）
- 函数：`buildDailyGroupHeaders` + `queryDailyUnionBaseRows` + `summarizeDailyRows` + `getDailyDateChoices` + `resolveDailyDate` + `resolveDailyRange` + `getDailyMeta` + `getDailyRangeMeta` + `getDailyRows` + `getDailyRowsRange` + `getDailyExportRows` + `getDailyExportRowsRange`
- 常量：`DAILY_UNION_SQL` + `DAILY_COLUMN_HEADERS`（后者从 weekly.js import WEEK_COLUMN_HEADERS）
- 测试：`npm test`

### Step 15 — 抽 services/report/analysisReports.js（K 块）
- 4 函数 + `let analysisTableReadyPromise`
- 测试：`npm test`（agent.test.js 覆盖）

### Step 16 — 写 services/report/dashboard/index.js + channel/index.js（子聚合）
- 仅 re-export，方便上层 import 减少路径噪声
- 测试：`npm test`

### Step 17 — 写 services/report/index.js（顶聚合，re-export 26 公共 API）
- 包含 `getPool`（从 lib/db 转出）+ 25 个业务方法
- 顺序与现有 module.exports 完全对齐（便于 `Object.keys` diff 校验）
- 测试：`npm test`

### Step 18 — services/reportRepo.js 改为 facade（1 行）
```js
"use strict";
module.exports = require("./report");
```
- 此时原 reportRepo.js 文件**只剩 2 行**（含 "use strict"）
- 测试：`npm test`，9 文件全绿

### Step 19 — 验证清单（不写代码，跑命令）
```bash
cd apps/gateway

# 1. 完整测试
npm test

# 2. 公共 API 兼容性 diff
node -e "console.log(Object.keys(require('./services/reportRepo')).sort().join('\n'))" > /tmp/keys-after.txt
# E1 在 Step 1 之前先跑同命令 → /tmp/keys-before.txt
diff /tmp/keys-before.txt /tmp/keys-after.txt   # 必须无输出

# 3. 缓存单例验证
node -e "const a=require('./services/report/cache');const b=require('./services/report/cache');console.log('cache singleton:', a===b)"

# 4. pool 单例验证
node -e "const a=require('./lib/db');const b=require('./services/reportRepo');console.log('pool singleton:', a.getPool === b.getPool)"

# 5. require 全文 grep 确认 5 个 consumer 仍可用
grep -rn "require.*reportRepo" apps/gateway --include='*.js'
# 期望：server.js / metricsService.js / analysisContextProvider.js 三处仍 require("./services/reportRepo") 或 require("./reportRepo")

# 6. 文件行数自检
wc -l apps/gateway/services/report/**/*.js apps/gateway/lib/db.js
# 期望：每文件 ≤ 600
```

### Step 20 — 写 ADR-0014 + commit
- ADR-0014：reportRepo 拆分决策（背景 / 方案 / 不做什么 / 验证清单）
- commit message 模板（中文）：
  ```
  refactor(gateway): 拆分 reportRepo.js（3273→27 文件，单文件 ≤ 600）
  
  - lib/db.js 抽 pg pool / timedQuery
  - services/report/* 拆 5 大领域 + 共享 utils + 缓存 + 常量
  - services/reportRepo.js 改为 facade，5 个 consumer 零改动
  - 公共 API 28 字段保持兼容，缓存/pool 单例验证通过
  - smoke 9 文件全绿
  
  详见 docs/adr/ADR-0014-reportRepo-split.md 与
       docs/plans/2026-04-25-v3-reportRepo-split-plan.md
  ```

> **每步失败处理**：如 `npm test` 红，立即 `git stash` 该步改动，单步 debug；不连跑两步否则定位困难。

---

## 9. 测试矩阵

### 现有 smoke 守门
| 文件 | 守哪些函数路径 | 风险盲区 |
|---|---|---|
| smoke/health.test.js | server.js 启动 + getPool + boot 自检（行 1684/1697 调 getDashboardDateChoices/Overview） | 间接覆盖 dashboard 路径少量 |
| smoke/report.test.js | weekly + daily（含中文文件名导出） | weekly 5 + daily 7 函数全覆盖 |
| smoke/agent.test.js | analysisReports（create / list / get） | analysisContextProvider 路径未直接覆盖 |
| smoke/auth.test.js | 与 reportRepo 无关 | — |
| smoke/admin.test.js | 与 reportRepo 无关 | — |
| smoke/dispatch.test.js | 与 reportRepo 无关 | — |
| smoke/validation.test.js | reportSchema / reportDailySchema | — |
| unit/auditLogger.test.js / passwordHasher.test.js | 与 reportRepo 无关 | — |

### 关键盲区与建议
**盲区**：`getDashboardChannelCompare` / `getDashboardDrilldown` / `getChannelDashboard` / `getChannelDashboardStyleDrilldown` 4 个公共 API **无 smoke 守门**。

**E1 可选加固（不强制本 PR 做）**：
- 新增 `tests/smoke/dashboard.test.js`，复用 fixtures 调 4 个端点 200/JSON 形状校验
- 新增 `tests/unit/report-shared.test.js`，纯单元测 `toDateText` / `parseDateTextUtc` / `daysBetweenInclusive` / `percentChange` / `roundNumber`，确保 utils 行为锁定

**最低守门标准**：本 PR 只要不破坏现有 9 文件即视为通过。dashboard 增量 smoke 留 V3-PR-dashboard-smoke 单独提交，避免本 PR 范围爆炸。

---

## 10. 风险点 & 缓解

### 高风险（≥ 4 项）
1. **缓存 Map 单例**：4 个 Map (`DAILY_UNION_CACHE` / `DASHBOARD_OVERVIEW_CACHE` / `DASHBOARD_OVERVIEW_IN_FLIGHT` / `CHANNEL_DASHBOARD_CACHE`) 当前是模块顶层 `const`，跨文件 require 必须仍指向同一对象。
   - **缓解**：依赖 Node `require` 缓存机制（同一字符串路径 = 同一实例）。E1 在 Step 19 用 `node -e` 验证 `a === b`。
   - **失败兜底**：若验证失败，把 4 个 Map 提到 `services/report/cache.js` 并通过 export 函数访问（不直接 export Map），可彻底消除引用问题。

2. **pg pool 单例**：`getPool` 是 lazy，跨文件 require 必须返回同一 promise / pool。
   - **缓解**：与上同理，靠 Node require 缓存。Step 19 验证 `a.getPool === b.getPool`。

3. **顶层 const 派生链**：`DASHBOARD_NET_*` / `SALES_SUM_SQL` / `CHANNEL_DASHBOARD_*_CODES` 等多个 const 派生自其他 const，必须保持声明顺序、且**整块迁移**。
   - **缓解**：Step 4 把 constants.js 一次性整块挪过去（按原行号顺序），不分两次提交。

4. **server.js ctx 注入**：reportRepo 是整对象注入到 ctx（行 1609/1617/1629），facade 必须 export 一致的对象（不是 default export）。
   - **缓解**：facade 用 `module.exports = require("./report")`，report/index.js 用 `module.exports = { getPool, ... }`（CommonJS 标准）。Step 19 用 `Object.keys` diff 验证 28 字段一致。

5. **派生 SQL 模板内的常量插值**：`DAILY_UNION_SQL`（行 477）模板字符串引用 7 个外部 const（`SALES_DAILY_TABLE` / `INVENTORY_LATEST_TABLE` / `SKU_FILTER_SQL` / `SALES_SUM_SQL` / `SKU_DISCOUNT_AVG_SQL` / `STYLE_DISCOUNT_AVG_SQL` / `INVENTORY_PICK_SQL`），跨文件 import 时必须保持模板字符串字节级相同。
   - **缓解**：把 `DAILY_UNION_SQL` 放在 daily.js 顶部、import 7 个常量后立即拼接。E1 在 Step 14 完成后用 `console.log(DAILY_UNION_SQL.length)` 比对前后字符长度。

### 中风险
6. **routes/dashboard.js 通过 ctx 拿**：import 路径不变，但要确保 ctx 传的还是整对象。**缓解**：server.js 注入逻辑零改动，本 Plan 不动 server.js。

7. **metricsService 只用 getPool**：metricsService 当前 `require("./reportRepo")`，拆完后通过 facade 仍能 `.getPool()`。优化空间是改为 `require("../lib/db")`，绕开 facade。
   - **缓解（可选）**：本 PR **不做**；V4 优化（见 §11）。

8. **WEEK_COLUMN_HEADERS 跨 weekly→daily**：daily.js 的 `DAILY_COLUMN_HEADERS` 派生于 weekly.js 的 `WEEK_COLUMN_HEADERS`。
   - **缓解**：daily.js 顶部 `const { WEEK_COLUMN_HEADERS } = require("./weekly")`，无循环风险（weekly 不依赖 daily）。

### 低风险
9. **命名冲突**：抽出去后函数名不变，按需 named import 不冲突。
10. **logger child name**：原来全文用 `childLogger("reportRepo")`，拆分后建议每个文件用自己的 child name（如 `childLogger("report:weekly")`），便于日志检索。**E1 决定**，不影响功能。

---

## 11. 不做什么（V4 留口）

- 不重写 SQL（包括 `DAILY_UNION_SQL` 大模板）
- 不改缓存策略（TTL / Map 数据结构）
- 不引入 ORM / query builder（pg 原生保留）
- 不改 routes 的 import 路径（保留 facade）
- 不重命名公共 API（28 字段名锁定）
- 不改 metricsService / analysisContextProvider 的 require 路径（V4-PR-untangle-direct-imports）
- 不补 dashboard / channel 的 smoke（V3-PR-dashboard-smoke 单独提交）
- 不引入 TypeScript（V5 议题）
- 不做 SQL 参数化检查（已都用 $1/$2，但全量审计留 V4 安全审）
- 不动 `services/dispatch/` 等其他 services

---

## 12. ADR 占位

**ADR-0014**：reportRepo 拆分决策。
- 路径：`docs/adr/ADR-0014-reportRepo-split.md`
- **由 E1 Execute Agent 在 Step 20 写**，本 Plan 不写正文。
- 必含章节：Context（3273 行单文件痛点）/ Decision（28 文件 facade 模式）/ Consequences（routes 零改动 + 加新报表只改 1 文件）/ Rejected Alternatives（直接改 routes 路径 / 引入 ORM）。

---

## 附录 A：执行 Agent 一页 cheat sheet

> 把这一页复制到 E1 的 prompt 即可。

1. **不读 reportRepo.js 全文**。本 Plan §4 已有 107 行函数迁移表，按表执行。
2. 进 worktree：`/Volumes/tyj/Cyrus/GitHub/ecom-agent-platform-worktrees/pr12-zod-expand/`
3. 严格按 §8 的 Step 1-20 顺序，每步后 `cd apps/gateway && npm test`，红了停。
4. 跨文件常量派生：see §5 / §10 风险 3 / 风险 5。
5. 验证清单：§8 Step 19 的 6 个 `node -e` 命令必须全过。
6. PR 提交前查表：§4 共 107 函数，每个都有归属；§5 共 38 const/let，每个都有归属。
7. ADR-0014：见 §12 章节模板。
8. **commit 单 PR**，不要拆 20 个小 commit；本地可用 stash 单步验证，最终 squash 成一个 commit。
9. 不动 routes / server / metricsService / analysisContextProvider 的 require 路径。
10. 红线：跑 `node -e "Object.keys(require('./services/reportRepo'))"` 必须返回 28 字段（含 `getPool`），少一个就是 P0 bug。

---

**Plan 完。** 总行数约 720 行 markdown，覆盖 §1-§12 + 附录 A。
