# 加新功能 Cookbook 索引

> 适用范围：`ecom-agent-platform` 经过 PR1-12 + V2(grafana / metrics-auth / password-policy) + V3(reportRepo split / server auth extract / frontend api layer) 三轮加固后的稳定结构。
>
> 阅读顺序：先看本 README 的"整体架构地图" → 再按需要查具体 cookbook。

---

## 1. 我要做什么？请对号入座

| 我想…… | 看这本 cookbook |
|---|---|
| 在后端加一个新的 `/api/...` 端点（含 zod 校验 + 权限闸 + smoke） | [`add-new-route.md`](./add-new-route.md) |
| 在前端加一个新页面（菜单项 + 路由 + GuardedElement + api/hooks/components） | [`add-new-page.md`](./add-new-page.md) |
| 加一个新的"模块权限"（既影响后端 requirePermission 也影响前端菜单/守门） | [`add-new-permission.md`](./add-new-permission.md) |
| 加一类新的报表/看板查询（services/report/&lt;domain&gt;/* + 缓存 + smoke） | [`add-new-report.md`](./add-new-report.md) |
| 我需要快速理解某个目录是干什么的 | [`module-map.md`](./module-map.md) |

如果你的需求跨多本（典型：一个新的"调拨报表 + 新页面 + 新权限"），按 **add-new-permission → add-new-report → add-new-route → add-new-page** 的顺序串起来做即可。每本 cookbook 独立可执行，互不依赖。

---

## 2. 整体架构地图

```
ecom-agent-platform/
├── apps/
│   ├── gateway/                 ← Node 网关（Express + PostgreSQL）
│   │   ├── server.js            ← 启动 + 全局 middleware + register 各 routes
│   │   ├── lib/                 ← 横切关注点（无业务）
│   │   │   ├── auth/            ← 鉴权 / 权限 / Session（V3 新拆）
│   │   │   ├── db.js            ← pg Pool + timedQuery（V3 新拆）
│   │   │   ├── logger.js        ← pino childLogger 工厂
│   │   │   ├── metrics.js       ← prom-client registry
│   │   │   ├── passwordHasher.js
│   │   │   └── sentryClient.js
│   │   ├── middleware/          ← Express 中间件（V3 新拆）
│   │   │   ├── sessionEnrichment.js
│   │   │   ├── requireAdmin.js
│   │   │   ├── requirePermission.js
│   │   │   ├── requireAgentContextAccess.js
│   │   │   ├── validateBody.js  ← zod safeParse → 400 issues
│   │   │   ├── auditRequest.js
│   │   │   └── metrics.js
│   │   ├── schemas/             ← zod schema（按 routes 域分组）
│   │   │   ├── admin.js
│   │   │   ├── agent.js
│   │   │   ├── auth.js
│   │   │   └── dispatch.js
│   │   ├── routes/              ← 一个 routes 文件 = 一个业务域
│   │   │   ├── admin.js / agent.js / arrival.js / auth-public.js
│   │   │   ├── auth-session.js / dashboard.js / docs.js / health.js
│   │   │   ├── metrics.js / report.js / spa.js
│   │   ├── services/            ← 业务服务层（外部依赖 / 数据访问）
│   │   │   ├── report/          ← V3 把 reportRepo 3273 行按域拆成 28 文件
│   │   │   │   ├── index.js     ← 聚合 26 公共 API
│   │   │   │   ├── constants.js / cache.js
│   │   │   │   ├── shared/      ← dateUtils / numberUtils / pagination / rowTransforms
│   │   │   │   ├── dashboard/   ← overview / drilldown / channelCompare / dateChoices
│   │   │   │   ├── channel/     ← panel / styleDrilldown / options
│   │   │   │   ├── weekly.js / daily.js / analysisReports.js
│   │   │   ├── reportRepo.js    ← 5 行 facade，re-export ./report
│   │   │   ├── usageRepo.js     ← audit_log 聚合
│   │   │   ├── auditLogger.js
│   │   │   ├── dispatch/        ← 调拨 Agent 模块
│   │   │   ├── agentService.js / agentSkills.js
│   │   │   ├── analysisContextProvider.js / metricsService.js
│   │   │   └── appConfig.js / runtimeSecrets.js
│   │   ├── tests/
│   │   │   ├── helpers/app.js   ← getApp() + login()
│   │   │   ├── fixtures/auth.fixture.json
│   │   │   ├── smoke/           ← 整 app 端到端：admin/agent/auth/dashboard/dispatch/health/report/validation
│   │   │   └── unit/            ← report-shared/auditLogger/passwordHasher
│   │   ├── public/              ← legacy 静态页（login.html）
│   │   ├── openapi.yaml
│   │   ├── config.json          ← pg / arrival / notes 端点
│   │   └── vitest.config.js
│   │
│   ├── web/                     ← React 前端（Vite + AntD 5）
│   │   └── src/
│   │       ├── api/             ← V3 三层之一：一个文件 = 一个后端模块
│   │       │   ├── http.js      ← axios 实例 + 401 拦截 + errorMessage()
│   │       │   ├── index.js     ← 聚合 export
│   │       │   ├── admin.js / agent.js / arrival.js / auth.js
│   │       │   ├── dispatch.js / notes.js / reports.js
│   │       ├── hooks/           ← V3 三层之二：5 个通用 hook
│   │       │   ├── useApi.js useTableQuery.js useDateRange.js
│   │       │   ├── useJobPolling.js useToast.js
│   │       ├── components/      ← V3 三层之三：4 个共享 UI 包装
│   │       │   ├── HeroCard.jsx PageHeader.jsx
│   │       │   ├── DateRangePicker.jsx DataTable.jsx
│   │       │   ├── SkuPreview.jsx ChannelCompareSection.jsx
│   │       ├── pages/           ← 业务页（只组合 api+hooks+components）
│   │       ├── auth/            ← AuthContext + modules.js（前端 APP_MODULES）
│   │       ├── App.jsx          ← 顶层 Layout + 菜单 + Routes + GuardedElement
│   │       └── main.jsx         ← <AntdApp> 包层 + 公开页旁路
│   │
│   └── runtime/                 ← 调拨产物存档目录
│
├── docs/
│   ├── recipes/                 ← 你现在在的位置
│   ├── adr/                     ← 架构决策记录
│   ├── plans/                   ← Plan 文档（每个 PR 一份）
│   ├── ENGINEERING_STANDARD.md
│   ├── PROJECT_STRUCTURE.md
│   └── ...
│
├── ops/                         ← 启停脚本
├── pipelines/                   ← PostgreSQL ETL
└── data/                        ← 输入 / 中间产物
```

---

## 3. V3 三轮加固带来的"新规矩"

如果你最近一次接触是 PR12 之前，下面 3 条变化你需要知道：

### 3.1 后端 routes/* 不再走 ctx 注入 auth/permission

```js
// V2 写法（已过时）
register(app, ctx) {
  const { requirePermission } = ctx;  // ❌ 不再这样
}

// V3 写法（当前）
const { requirePermission } = require("../middleware/requirePermission");
const { getAuthStore } = require("../lib/auth/store");
function register(app, ctx) { ... }
```

理由：ADR-0015。`server.js register(app, ctx)` 时 ctx 平均要传 9-15 个回调，加新 admin 端点要改 2 个文件。直接 require 后 ctx 字段降到 0-12 个。

### 3.2 后端 reportRepo 改 facade，加新报表必须放 `services/report/<domain>/`

```js
// services/reportRepo.js 现在只有 5 行
"use strict";
module.exports = require("./report");
```

理由：ADR-0014。原 3273 行单文件按域拆 28 文件后，**加新报表只改 1 个新文件 + `services/report/index.js` 加 1 行 re-export**。详见 [`add-new-report.md`](./add-new-report.md)。

### 3.3 前端 page 不再 `import http`

```jsx
// V2 写法（已过时）
import http from "../api/http";
const resp = await http.get("/api/foo", { params: { _t: Date.now() } });

// V3 写法（当前）
import { reportsApi } from "../api";
import { useApi } from "../hooks";
const { data, loading, refetch } = useApi(() => reportsApi.getXxx(params), [params]);
```

理由：ADR-0016。38 处裸 axios + 38 处复制粘贴的 error 拼装 + 4 份 hand-roll 防竞态收敛到 `api/hooks/components` 三层。详见 [`add-new-page.md`](./add-new-page.md)。

---

## 4. 必读上下文（按文件类型）

| 你要改…… | 必读 plan/ADR |
|---|---|
| `apps/gateway/routes/*` | ADR-0004（routes 抽取）+ ADR-0006（zod）+ ADR-0015（auth extract） |
| `apps/gateway/services/report/*` | ADR-0014 + `docs/plans/2026-04-25-v3-reportRepo-split-plan.md`（893 行） |
| `apps/gateway/lib/auth/*` 或权限矩阵 | ADR-0015 + `docs/plans/2026-04-25-v3-server-auth-extract-plan.md`（599 行） |
| `apps/web/src/{api,hooks,components,pages}/*` | ADR-0016 + `docs/plans/2026-04-25-v3-frontend-api-layer-plan.md`（694 行） |
| 加权限模块 | ADR-0009（usage stats 同时改了 admin perm）+ ADR-0015 |
| 加测试 | ADR-0002（testing strategy）+ `apps/gateway/tests/helpers/app.js` 样板 |

---

## 5. 共通的"做完没"自检（每本 cookbook 都会再单列一份）

- [ ] 我看了对应的 ADR 和最相关的 plan，没靠脑补 API 形状
- [ ] 我跑了 `npm test --prefix apps/gateway`，全绿
- [ ] 我跑了 `npm run build --prefix apps/web`，bundle 通过
- [ ] 至少跑过一次"失败路径"（401 / 403 / 400）确认行为符合预期
- [ ] 改动范围在 1 个 PR 能 review 完（V3 三大 PR 都明确写了"不做什么"）
- [ ] 我新增的代码 3 个月后能让另一个人按 cookbook 一遍走通

---

## 6. 维护本 Cookbook

- 任何后续 ADR / 重要重构（V4 lib/jobs.js / lib/proxy.js / lib/arrival.js / TypeScript 迁移……）落地时，回来更新对应的 cookbook + 本 README 的"整体架构地图"。
- 不需要每个 PR 都改 cookbook；只在"加新页面 / 端点 / 权限 / 报表"流程发生**结构性**变化时改。
- Cookbook **只描述当前 main 上的真实代码**，不写 V4/V5 计划。计划在 `docs/plans/`。
