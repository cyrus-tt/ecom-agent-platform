# Cookbook · 加新报表

> **目标**：在 `apps/gateway/services/report/<domain>/*.js` 加一个新的报表查询，挂缓存、加单测、加 smoke。**新报表只改 1 个新文件 + `report/index.js` 加 1 行 re-export**（ADR-0014）。
>
> 注意：本 cookbook 描述的是"PostgreSQL 报表查询 + 内存缓存"模式。如果你要加的是"调拨"那种带 LLM / 子进程 / 状态机的服务，去看 `services/dispatch/*` 而不是这里。

---

## 0. 前置阅读

- ADR-0014 `docs/adr/0014-reportRepo-split.md`：3273 行 reportRepo 拆 28 文件的来由 + 关键策略（lazy require / 派生 SQL 整块迁移 / 缓存单例）
- Plan：`docs/plans/2026-04-25-v3-reportRepo-split-plan.md`（893 行，含每一步迁移命令）
- 样板代码：
  - `apps/gateway/services/report/index.js` —— 26 个公共 API 聚合
  - `apps/gateway/services/report/dashboard/overview.js` —— domain service 完整样板（含 cache + in-flight + multiple SQL）
  - `apps/gateway/services/report/dashboard/dateChoices.js` —— 含 module-level promise + cache pattern
  - `apps/gateway/services/report/cache.js` —— 4 个 Map + TTL 的统一注册处
  - `apps/gateway/services/report/constants.js` —— 表名 / KEYS 数组 / 派生 SQL 模板
  - `apps/gateway/services/report/shared/dateUtils.js` `numberUtils.js` —— 纯函数 utils
  - `apps/gateway/lib/db.js` —— `getPool` + `timedQuery`
  - `apps/gateway/tests/smoke/dashboard.test.js` —— 首次 smoke 守门样板

---

## 1. 决策树：你的报表落在哪个子域？

| 报表性质 | 子域 | 文件 |
|---|---|---|
| dashboard 综合看板（KPI + trend + 钻取） | `report/dashboard/` | 新建 `<your-name>.js` |
| 渠道看板（按 channel_code 切片） | `report/channel/` | 新建 `<your-name>.js` |
| 周报（rpt_sales_weekly） | `report/weekly.js` 加方法 | 单文件 |
| 日报（rpt_sales_daily union） | `report/daily.js` 加方法 | 单文件 |
| 分析报告（CRUD analysis_reports 表） | `report/analysisReports.js` | 单文件 |
| **全新业务域**（如 forecast / inventory_audit） | `report/<new-domain>/` | 新建目录 |

新业务域的目录结构（参考 `report/dashboard/`）：

```
services/report/<new-domain>/
├── index.js              ← 子聚合，re-export 域内所有公共 API
├── <feature1>.js         ← 1 个 domain feature 1 个文件
├── <feature2>.js
└── (可选) shared.js      ← 域内私有 helpers
```

---

## 2. 步骤

### Step 1 · 写 SQL 常量（如果用了新表 / 新派生表达式）

文件：`apps/gateway/services/report/constants.js`

```js
// 新表加这里
const FORECAST_DAILY_TABLE = "anta_daily.rpt_forecast_sku_daily";

// 新派生 SQL 表达式
const FORECAST_NET_QTY_EXPR = "(coalesce(forecast_qty, 0) - coalesce(returned_qty, 0))";

module.exports = {
  // ...
  FORECAST_DAILY_TABLE,
  FORECAST_NET_QTY_EXPR,
};
```

**关键约束**：派生常量（依赖其他 const 的字符串拼接）**必须**与被依赖的 const 同文件（ADR-0014 §关键策略 §3）。例如 `FORECAST_NET_QTY_EXPR` 如果引用 `FORECAST_KEYS`，两者必须都在 `constants.js`。**不要拆到 domain 子目录**，否则下次 import 顺序变化会让派生模板炸。

### Step 2 · 加缓存条目（如果数据有可缓存性）

文件：`apps/gateway/services/report/cache.js`

```js
const FORECAST_CACHE_TTL_MS = 60 * 1000;     // 1 min
const FORECAST_CACHE = new Map();

function makeForecastCacheKey(skuKeyword, dateFrom, dateTo) {
  return `${skuKeyword}|${dateFrom}|${dateTo}`;
}

function getForecastCache(skuKeyword, dateFrom, dateTo) {
  const key = makeForecastCacheKey(skuKeyword, dateFrom, dateTo);
  const cached = FORECAST_CACHE.get(key);
  if (!cached) return null;
  if (Date.now() - Number(cached.savedAt || 0) > FORECAST_CACHE_TTL_MS) {
    FORECAST_CACHE.delete(key);
    return null;
  }
  return cached.payload || null;
}

function setForecastCache(skuKeyword, dateFrom, dateTo, payload) {
  const key = makeForecastCacheKey(skuKeyword, dateFrom, dateTo);
  FORECAST_CACHE.set(key, {
    savedAt: Date.now(),
    payload,
  });
}

// 如果可能并发同 key（避免 thundering herd）：
const FORECAST_IN_FLIGHT = new Map();

module.exports = {
  // ...
  FORECAST_CACHE_TTL_MS,
  FORECAST_CACHE,
  FORECAST_IN_FLIGHT,
  makeForecastCacheKey,
  getForecastCache,
  setForecastCache,
};
```

**单例语义**：`new Map()` 在 module top-level，靠 Node `require` 缓存机制在不同 require 路径间唯一。**不要在 cache.js 里同时 export `getForecastCache` 和重复定义 Map**，否则两份实例。

> 不需要缓存的报表跳过这一步。

### Step 3 · 写 domain service

文件：`apps/gateway/services/report/<domain>/<feature>.js`

完整样板（仿 `dashboard/overview.js`）：

```js
"use strict";

const { getPool, timedQuery } = require("../../../lib/db");
const { toNumber, roundNumber } = require("../shared/numberUtils");
const { normalizeDateInput, daysBetweenInclusive } = require("../shared/dateUtils");
const {
  FORECAST_DAILY_TABLE,
  SKU_FILTER_SQL,
  FORECAST_NET_QTY_EXPR,
} = require("../constants");
const {
  FORECAST_IN_FLIGHT,
  makeForecastCacheKey,
  getForecastCache,
  setForecastCache,
} = require("../cache");

async function queryForecastTotals(pool, dateFrom, dateTo, skuKeyword) {
  const result = await timedQuery(
    pool,
    `
      select
        coalesce(sum(${FORECAST_NET_QTY_EXPR}), 0)::numeric as net_qty,
        coalesce(sum(coalesce(forecast_revenue, 0)), 0)::numeric as revenue
      from ${FORECAST_DAILY_TABLE}
      where forecast_date between $1 and $2
        and ${SKU_FILTER_SQL}
        and ($3 = '' or sku ilike '%' || $3 || '%')
    `,
    [dateFrom, dateTo, skuKeyword || ""],
    "queryForecastTotals"   // tag 进慢 SQL 日志
  );
  const row = result.rows[0] || {};
  return {
    net_qty: toNumber(row.net_qty),
    revenue: toNumber(row.revenue),
  };
}

async function getForecastOverview({ dateFromText, dateToText, skuKeyword = "" }) {
  const dateFrom = normalizeDateInput(dateFromText);
  const dateTo = normalizeDateInput(dateToText);
  if (!dateFrom || !dateTo) {
    return { meta: { date_from: "", date_to: "" }, totals: {} };
  }

  // 1. cache 命中先走
  const cached = getForecastCache(skuKeyword, dateFrom, dateTo);
  if (cached) return cached;

  // 2. in-flight 防并发（同 key 多请求合一）
  const cacheKey = makeForecastCacheKey(skuKeyword, dateFrom, dateTo);
  const inFlight = FORECAST_IN_FLIGHT.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async () => {
    const pool = await getPool();
    const totals = await queryForecastTotals(pool, dateFrom, dateTo, skuKeyword);
    const payload = {
      meta: {
        date_from: dateFrom,
        date_to: dateTo,
        period_days: daysBetweenInclusive(dateFrom, dateTo),
        sku_keyword: skuKeyword,
      },
      totals: {
        net_qty: roundNumber(totals.net_qty, 2),
        revenue: roundNumber(totals.revenue, 2),
      },
      updated_at: new Date().toISOString(),
    };
    setForecastCache(skuKeyword, dateFrom, dateTo, payload);
    return payload;
  })();

  FORECAST_IN_FLIGHT.set(cacheKey, request);
  try {
    return await request;
  } finally {
    FORECAST_IN_FLIGHT.delete(cacheKey);
  }
}

module.exports = {
  queryForecastTotals,    // export 内部 query 函数有助于单测
  getForecastOverview,
};
```

**关键模式**：

1. `getPool` / `timedQuery` 从 `../../../lib/db` 取（domain 文件深 3 层）
2. SQL 必须用 `timedQuery` 而不是 `pool.query`，慢 SQL 自动进 `[slow-sql]` 日志（300ms 阈值，`lib/db.js`）
3. SQL 模板里**所有外部输入**走 `$1 / $2 / $3` 参数化，**绝不**字符串拼接（防注入）
4. 表名 / 派生 SQL 表达式从 `constants.js` import，**不要内联**
5. cache + in-flight 模式仅当数据可缓存时启用；纯实时查询（如 export）不要套 cache
6. 返回结构里 `meta` + 实际数据分层，便于前端 normalize

### Step 4 · 子域 index.js（如果是新建子目录）

文件：`apps/gateway/services/report/<domain>/index.js`

```js
"use strict";

const overview = require("./overview");
const detail = require("./detail");

module.exports = {
  ...overview,
  ...detail,
};
```

### Step 5 · 顶层 facade re-export

文件：`apps/gateway/services/report/index.js`

```js
const {
  // ...
  getForecastOverview,
  queryForecastTotals,
} = require("./forecast");

module.exports = {
  // ...
  getForecastOverview,
  queryForecastTotals,    // 公共 API 才 export，私有 query 不要
};
```

> `services/reportRepo.js` 仍是 5 行 facade，**不需要改**：
> ```js
> module.exports = require("./report");
> ```

### Step 6 · 加 routes 端点

文件：`apps/gateway/routes/<domain>.js`（新建）或现有 `routes/dashboard.js` / `routes/report.js`

```js
"use strict";
const { requirePermission } = require("../middleware/requirePermission");

function register(app, ctx) {
  const { reportRepo } = ctx;

  app.get("/api/forecast/overview", requirePermission("forecast"), async (req, res, next) => {
    try {
      const dateFrom = String(req.query.date_from || "").trim();
      const dateTo = String(req.query.date_to || "").trim();
      const skuKeyword = String(req.query.sku || "").trim();
      const payload = await reportRepo.getForecastOverview({
        dateFromText: dateFrom,
        dateToText: dateTo,
        skuKeyword,
      });
      res.json({ ok: true, ...payload });
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { register };
```

注意 `reportRepo` 从 ctx 注入（dashboard / report routes 现在都这样），`getForecastOverview` 通过 facade `services/reportRepo` 自动可用。

> 详细的 routes / zod / smoke 流程见 [`add-new-route.md`](./add-new-route.md)。
> 新权限 `forecast` 见 [`add-new-permission.md`](./add-new-permission.md)。

### Step 7 · 加 smoke（强制）

文件：`apps/gateway/tests/smoke/forecast.test.js`

```js
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { getApp, login } from "../helpers/app.js";

describe("smoke: forecast endpoints", () => {
  let agent;
  beforeAll(() => { agent = request(getApp()); });

  it("GET /api/forecast/overview without cookie returns 401", async () => {
    const res = await agent.get("/api/forecast/overview");
    expect(res.status).toBe(401);
  });

  it("GET /api/forecast/overview with no-perm user returns 403", async () => {
    const { cookie } = await login(agent, "smoke-user", "smoke-user-pass");
    const res = await agent.get("/api/forecast/overview").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  // CI 没 PostgreSQL，5xx 也算"路由挂上了"
  it("GET /api/forecast/overview with admin reaches handler (NOT 403/404)", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .get("/api/forecast/overview?date_from=2026-01-01&date_to=2026-01-07")
      .set("Cookie", cookie);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
    expect([200, 500, 502, 503]).toContain(res.status);
  });
});
```

### Step 8 · 加单测（强烈建议给纯函数 / SQL 拼装函数）

文件：`apps/gateway/tests/unit/forecast.test.js`

仿 `tests/unit/report-shared.test.js`，给 `dateUtils` / `numberUtils` 加的纯函数 / 派生表达式做 assertion。SQL 函数本身不要单测（CI 没 PG），但 SQL 字符串拼装函数（如 buildXxxSql）可以测出来字符串 diff。

### Step 9 · 跑测试 + 验证 facade

```bash
cd apps/gateway

# 1. 全测试
npm test

# 2. 公共 API 形状验证（确保没破 26 + N 个公共 API）
node -e "console.log(Object.keys(require('./services/reportRepo')).sort().join('\n'))"

# 3. 缓存单例验证
node -e "
const a = require('./services/report/cache');
const b = require('./services/report/cache');
console.log('cache singleton:', a === b);   // 必须 true
"

# 4. pool 单例验证
node -e "
const dbA = require('./lib/db');
const repo = require('./services/reportRepo');
console.log('pool singleton:', dbA.getPool === repo.getPool);   // 必须 true
"

# 5. 单文件行数自检（守住 ADR-0014 的 ≤ 600）
find apps/gateway/services/report -name '*.js' | xargs wc -l | sort -n
```

---

## 3. 测试要求

- [ ] `npm test --prefix apps/gateway` 全绿（含原 78 + 你新加的）
- [ ] 新加 smoke 至少 3 条：401 / 403 / admin-reaches-handler
- [ ] 新加单测：纯函数（dateUtils / numberUtils / SQL 拼装）每个 ≥ 2 条
- [ ] facade 公共 API 数量增加（grep `module.exports = {` in `report/index.js`）
- [ ] cache singleton 验证 true
- [ ] 单文件 ≤ 600 行（最大现状是 `channel/panel.js` 455）

---

## 4. 示例 PR / commit

| 场景 | 参考 |
|---|---|
| 加 dashboard 子模块（含 cache + in-flight） | `services/report/dashboard/overview.js`（428 行，全套样板） |
| 加 channel 子模块 | `services/report/channel/panel.js`（455 行，最大单文件） |
| 加 simple CRUD 报表 | `services/report/analysisReports.js`（4 个方法 + ensureTable） |
| reportRepo 拆分大 PR 本体 | ADR-0014 + plan |

---

## 5. 常见踩坑

1. **派生 SQL 模板拆到 domain 文件** —— `FORECAST_NET_QTY_EXPR` 引用 `FORECAST_KEYS`，两者一旦异文件，require 顺序变化时模板字符串拼接结果不同（ADR-0014 §关键策略 §3）。**所有派生 const 整块放 constants.js**。
2. **跨 domain 直接 require domain 子模块** —— `dashboard/channelCompare.js` require `channel/options.js` 是已知偏离纯树状结构的耦合。新加 domain 时**应该先抽到 shared/**，再让两个 domain 都从 shared/ 取。
3. **lazy require 漏写** —— `weekly.js ↔ daily.js` 之间用 lazy require 化解循环。新建 domain 如果发现循环，先想"这俩职责能不能各自抽个 helper 到 shared/"，再考虑 lazy require。
4. **缓存 Map 在 domain 文件 module-level 定义** —— `cache.js` 是单一注册处，新缓存 Map **必须**加在 `cache.js` 顶部，否则 cache invalidation / 监控时找不全。
5. **没用 `timedQuery`** —— 直接 `pool.query`，慢 SQL 不进日志，运营时谁也看不到 dashboard 怎么慢的。
6. **SQL 字符串拼接外部输入** —— `where sku ilike '%${userInput}%'` 直接挂——SQL 注入。**永远 `$N` 参数化**，看上面样板的 `$3` 写法。
7. **`reportRepo.js` facade 多写一行** —— facade 现在是 5 行，**不要**修改。新公共 API 加在 `report/index.js`，会自动透传到 facade。
8. **Pool 多次创建** —— 如果你写 `new Pool(...)` 而不是 `getPool()`，会无缓存连接耗尽。**永远 `getPool` 拿单例**。
9. **smoke 期望 200** —— CI 没 PG，5xx 才是常态。期望 `[200, 500, 502, 503]` 包含。
10. **加新报表却不加文件** —— 在 `weekly.js` 末尾追加 100 行。**不要**这样。新报表新文件，文件名 = 业务名（如 `forecastTrend.js`）。

---

## 6. 完成检查清单

- [ ] 新表名 / 派生 SQL 加在 `services/report/constants.js`（不在 domain 文件）
- [ ] 缓存 TTL + Map + getter/setter 加在 `services/report/cache.js`
- [ ] domain service 文件 ≤ 600 行，所有 SQL 走 `timedQuery` + `$N` 参数化
- [ ] `services/report/<domain>/index.js`（如果是新子目录）已 spread re-export
- [ ] `services/report/index.js` 顶层 facade re-export 新公共 API
- [ ] `services/reportRepo.js` 仍是 5 行（不要动）
- [ ] `routes/<domain>.js` 用 `requirePermission(...)` + try/catch，handler 通过 ctx.reportRepo 调用
- [ ] `tests/smoke/<domain>.test.js` 覆盖 401/403/admin-reaches-handler
- [ ] `tests/unit/<feature>.test.js` 覆盖纯函数 / 派生表达式
- [ ] 验证：facade `Object.keys` 包含新 API
- [ ] 验证：`cache.js` / `lib/db.js` 单例校验 true
- [ ] `npm test --prefix apps/gateway` 全绿
- [ ] grep `pool.query\b` —— 应该只在 `lib/db.js` 出现，其他文件全走 `timedQuery`
