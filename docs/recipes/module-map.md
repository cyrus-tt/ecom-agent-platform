# 模块地图

> **目标**：每个核心目录 / 关键文件配一句话职责，3 个月后接手的人能 30 秒定位。
>
> 仅覆盖 V3 三轮加固后的稳定结构（`apps/gateway/` + `apps/web/src/`）和 docs/。`pipelines/` `data/` `ops/` 不在本仓 cookbook 范围（看 `docs/PROJECT_STRUCTURE.md`）。

---

## 1. apps/gateway/ —— Node 网关

### 1.1 顶层

| 文件 | 一句话职责 |
|---|---|
| `server.js` | 启动入口：装全局 middleware（sessionEnrichment / metrics / audit / sentry）→ register 所有 routes/* → warmup 缓存 → listen |
| `package.json` | npm scripts：`dev` / `start` / `test` / `web:build`；deps 含 express / pg / pino / prom-client / zod / vitest |
| `vitest.config.js` | 测试配置：`env.DISPATCH_AGENT_ENABLED = "true"`（permissions 矩阵在 module load 时读），`AUTH_CONFIG_PATH` 指向 fixture |
| `config.json` | 运行时配置：postgres / arrival / notes URL，**不放进 git 真实密钥** |
| `openapi.yaml` | OpenAPI 3.0 描述（V3 后仍手维护，V4 留口自动生成） |
| `README.md` | 网关本体说明 |

### 1.2 lib/ —— 横切关注点（无业务）

| 文件 / 目录 | 一句话职责 |
|---|---|
| `lib/db.js` | pg Pool 单例（`getPool()`）+ `timedQuery(pool, sql, values, tag)`：慢 SQL > 300ms 自动 warn |
| `lib/logger.js` | `childLogger(name)` 返回 pino 子 logger，结构化 JSON 日志 |
| `lib/metrics.js` | prom-client registry：HTTP duration histogram + 各种业务 counter |
| `lib/passwordHasher.js` | sha256 + bcrypt 双轨：legacy sha256 兼容；`ENABLE_BCRYPT=true` 时自动升级（PR5） |
| `lib/sentryClient.js` | Sentry init + `expressRequestHandler()` / `expressErrorHandler()`；DSN 缺失时 no-op |
| `lib/auth/` | **V3 新拆**的鉴权子系统（见下） |

#### 1.2.1 lib/auth/ —— 鉴权子系统（V3 ADR-0015）

| 文件 | 一句话职责 |
|---|---|
| `auth/index.js` | 聚合 re-export：`require("../lib/auth")` 一站式取所有 helpers |
| `auth/permissions.js` | **权限矩阵单一来源** `AUTH_PERMISSION_MODULES`（含 dispatch 条件项）+ `accountHasPermission` / `isRouteAllowedForAccount` |
| `auth/accounts.js` | normalize / sanitize / validate + `createManagedAccount` / `updateManagedAccountPermissions` / `updateManagedAccountPassword`（CRUD） |
| `auth/config.js` | 读写 auth-config.json + `buildAuthStore` + `persistAuthStore`（写盘顺序：backup → atomic → 替换内存） |
| `auth/store.js` | `AUTH_STORE` 内存单例（mutable）+ `getAuthStore()` / `replaceAuthStore()` / `getAuthAccountById()` |
| `auth/credentials.js` | 凭据匹配 + bcrypt 自动升级（旧 sha256 通过的同时回写 bcrypt） |
| `auth/session.js` | `SESSION_STORE` Map 单例（in-memory）+ `createSession` / `getSessionByRequest` / `revokeSession` + cookie 解析 |
| `auth/redirects.js` | `normalizeNext` / `isPublicPath` / `resolvePostLoginRoute`（公开页白名单 + login next 安全化） |
| `auth/__tests__/*.test.js` | 7 套单测，95 个 assertion |

### 1.3 middleware/ —— Express 中间件（V3 ADR-0015）

| 文件 | 一句话职责 |
|---|---|
| `middleware/sessionEnrichment.js` | 把 cookie session 解出来挂到 `req.authSession` + 4 个 flat alias（每个请求第一个跑） |
| `middleware/auditRequest.js` | 把请求元信息（method / path / status / duration / account_id）写 `audit_log` 表（PR7） |
| `middleware/metrics.js` | prom-client middleware：记录 HTTP duration histogram，标签 method/route/status_class（PR8） |
| `middleware/validateBody.js` | `validateBody(zodSchema)`：safeParse → 400 JSON `{ ok, message, issues[] }`（PR6） |
| `middleware/requireAdmin.js` | 单纯 admin 闸：API 路径 → 403 JSON；HTML → 302 到 preferred_route 或 /no-access |
| `middleware/requirePermission.js` | `requirePermission("key")` + `requireAnyPermission(["k1","k2"])`：deny 行为同上 |
| `middleware/requireAgentContextAccess.js` | analysis 权限 OR Bearer token（agent context 公开端点专用） |

### 1.4 schemas/ —— zod schema（按 routes 域分组）

| 文件 | 一句话职责 |
|---|---|
| `schemas/admin.js` | `createAccountBodySchema` / `updatePermissionsBodySchema` / `updatePasswordBodySchema` / `deepseekKeyBodySchema` |
| `schemas/agent.js` | agent skills / agent context 端点的 body 形状 |
| `schemas/auth.js` | login body |
| `schemas/dispatch.js` | 调拨任务公开端点（preview / confirm）的 body |

### 1.5 routes/ —— 一个文件 = 一个业务域

| 文件 | 一句话职责 |
|---|---|
| `routes/admin.js` | 管理域：账号 CRUD / AI 设置 / 数据刷新 / 异步 job 状态 / **PR9 用量统计** |
| `routes/agent.js` | AI 经营分析：skills / run / 历史报告 / context provider |
| `routes/arrival.js` | 新品看板代理（转发 arrival python 服务）+ notes 服务代理 |
| `routes/auth-public.js` | `/login` `/api/auth/login` 公开页 + `/logout` |
| `routes/auth-session.js` | `/api/auth/me`（已登录） |
| `routes/dashboard.js` | dashboard / channel-dashboard 5 个端点（dates / overview / drilldown / channel-compare / channel-dashboard） |
| `routes/docs.js` | swagger-ui-express + `/openapi.yaml` |
| `routes/health.js` | `/healthz` `/readyz` `/api/health` `/api/ping` |
| `routes/metrics.js` | `/api/metrics` Prometheus scrape（admin only，V2-PR-metrics-auth） |
| `routes/report.js` | 周报 + 日报：dates / weeks / meta / rows / export.xlsx / export.xlsb |
| `routes/spa.js` | React SPA fallback（catch-all，**必须最后 register**） |

### 1.6 services/ —— 业务服务层

| 文件 / 目录 | 一句话职责 |
|---|---|
| `services/reportRepo.js` | **5 行 facade**：`module.exports = require("./report")`（V3 ADR-0014） |
| `services/report/` | 拆分后的 26 公共 API（见下） |
| `services/usageRepo.js` | audit_log 聚合：listByPath / listByUser / summary（PR9 admin 用量统计） |
| `services/auditLogger.js` | 写 audit_log 表（被 middleware/auditRequest.js 调用） |
| `services/appConfig.js` | 读 config.json + env：arrival / notes URL 来源、project dir 配置态 |
| `services/runtimeSecrets.js` | DeepSeek API key 内存存储 + env fallback（重启失效，admin UI 可临时设置） |
| `services/agentService.js` | LLM 调用层：用 OpenAI SDK 走 DeepSeek base_url + 系统/用户 prompt 拼装 |
| `services/agentSkills.js` | agent skills 注册表（哪个 skill_id 跑哪段 prompt） |
| `services/analysisContextProvider.js` | 给 agent 喂数据上下文：跨周/月聚合 + KPI |
| `services/metricsService.js` | 业务指标聚合（被 metrics middleware 用） |
| `services/reportSchema.js` `services/reportDailySchema.js` | 周报 / 日报列定义元数据（前端展示分组用） |
| `services/dispatch/` | 调拨 Agent 子系统：router / agentRunner / context / templates / publisher |

#### 1.6.1 services/report/ —— V3 reportRepo 拆分（ADR-0014）

| 文件 / 目录 | 一句话职责 |
|---|---|
| `report/index.js` | 顶层聚合：26 公共 API（getDashboard*, getChannel*, getReport*, getDaily*, AnalysisReport CRUD） |
| `report/constants.js` | 表名 + 5 个 KEYS 数组（INVENTORY/SALES/SKU_DISCOUNT/STYLE_DISCOUNT/...）+ 8 个派生 SQL 模板（**派生与基础同文件锁定**） |
| `report/cache.js` | 4 个 TTL Map（DAILY_UNION / DASHBOARD_OVERVIEW / DASHBOARD_OVERVIEW_IN_FLIGHT / CHANNEL_DASHBOARD）+ get/set 工具 |
| `report/shared/dateUtils.js` | 日期 utils：normalizeDateInput / buildAnchorDateRange / shiftDateText 等 10 个纯函数 |
| `report/shared/numberUtils.js` | 数值 utils：toNumber / roundNumber / percentChange |
| `report/shared/pagination.js` | 分页参数 normalize |
| `report/shared/rowTransforms.js` | 行级 transform helpers |
| `report/dashboard/overview.js` | 综合看板 KPI + trend + category（含 cache + in-flight） |
| `report/dashboard/dateChoices.js` | 可选日期 + 默认日期（含 module-level promise 防并发） |
| `report/dashboard/drilldown.js` | 钻取明细（style / sku 两层） |
| `report/dashboard/channelCompare.js` | 渠道对比（dashboard 子集） |
| `report/dashboard/index.js` | 子聚合，spread 4 个 dashboard 文件 |
| `report/channel/panel.js` | 渠道看板主面板（最大文件 455 行，包含 buildChannelDashboardSql） |
| `report/channel/styleDrilldown.js` | 渠道维度的款号钻取 |
| `report/channel/options.js` | 22 个渠道选项 + normalize（被 dashboard/channelCompare 跨域 require） |
| `report/channel/index.js` | 子聚合 |
| `report/weekly.js` | 周报全流程：getWeekChoices / getReportMeta / getReportRows / getReportExportRows |
| `report/daily.js` | 日报全流程：getDailyDateChoices / getDailyMeta / getDailyRows + DAILY_UNION_SQL 大模板（与 weekly.js 互相 lazy require 破循环） |
| `report/analysisReports.js` | analysis_reports 表 CRUD + ensureAnalysisReportsTable |

### 1.7 services/dispatch/ —— 调拨 Agent

| 文件 | 一句话职责 |
|---|---|
| `dispatch/index.js` | 模块开关：`isEnabled()` 读 `DISPATCH_AGENT_ENABLED` env，`tryRegister(app)` 挂路由，`PERMISSION_MODULE` 暴露给 lib/auth/permissions |
| `dispatch/router.js` | 调拨任务 routes：列表 / 详情 / SSE / 上传 / 公开 preview / 公开 confirm |
| `dispatch/agentRunner.js` | 运行调拨 LLM 任务（OpenAI SDK） |
| `dispatch/contextLoader.js` | 数据上下文（库存 / 销售 / 渠道映射） |
| `dispatch/publisher.js` | 推 SSE 事件给前端 |
| `dispatch/templates/` | LLM prompt 模板 |

### 1.8 tests/

| 目录 / 文件 | 一句话职责 |
|---|---|
| `tests/helpers/app.js` | `getApp()` 拿 Express app（不 listen）+ `login(agent, user, pass)` 拿 cookie |
| `tests/fixtures/auth.fixture.json` | 测试账号：smoke-admin（全权 admin）/ smoke-user（portal+report_daily）。**密码 hash 已固化，不要改** |
| `tests/fixtures/auth-local.fixture.json` | 本地测试用 fixture（覆盖 vitest env） |
| `tests/smoke/admin.test.js` | admin 端到端：401 / 403 / 200 + 不泄露 password_hash |
| `tests/smoke/auth.test.js` | login / logout / me / session 过期 |
| `tests/smoke/agent.test.js` | agent 端点鉴权 |
| `tests/smoke/dashboard.test.js` | dashboard 5 端点鉴权（V3 reportRepo split 时新增） |
| `tests/smoke/dispatch.test.js` | 调拨公开端点 + 鉴权端点 |
| `tests/smoke/health.test.js` | healthz / readyz / api/health / api/ping + boot warmup |
| `tests/smoke/report.test.js` | 周报 + 日报端点鉴权 |
| `tests/smoke/validation.test.js` | zod schema 失败路径 → 400 + issues |
| `tests/unit/passwordHasher.test.js` | sha256 + bcrypt 双轨纯函数 |
| `tests/unit/auditLogger.test.js` | audit_log 写入逻辑 |
| `tests/unit/report-shared.test.js` | dateUtils + numberUtils 纯函数 22 条 |

### 1.9 public/

| 文件 | 一句话职责 |
|---|---|
| `public/login.html` `login.js` `login.css` | legacy 登录页（前后端分离前的产物，仍用于公开页路径） |
| `public/static/*` | 一些静态资源 |

---

## 2. apps/web/src/ —— React 前端

### 2.1 顶层

| 文件 | 一句话职责 |
|---|---|
| `main.jsx` | 入口：StyleProvider + AntdApp + BrowserRouter + AuthProvider，公开页 `/dispatch/confirm/*` 走旁路 |
| `App.jsx` | Layout / Header / Menu / Routes / GuardedElement / AI 设置 Modal |
| `styles.css` | 全局样式 |

### 2.2 api/ —— V3 三层之一（ADR-0016）

| 文件 | 一句话职责 |
|---|---|
| `api/http.js` | axios 实例：withCredentials + 401 拦截跳 `/login?next=...` + `errorMessage(err, fallback)` 工具 |
| `api/index.js` | 聚合 export 所有 namespace + http + errorMessage |
| `api/auth.js` | `/api/auth/me`、`/api/settings/ai/*` 4 个 fetcher |
| `api/admin.js` | `/api/admin/{accounts,usage,rebuild-weekly,refresh-arrival,jobs/:id}` |
| `api/reports.js` | `/api/{report-daily,dashboard,channel-dashboard}/*` 共 9 个 fetcher |
| `api/arrival.js` | `/api/arrival/*` |
| `api/notes.js` | `/notes-api/*` |
| `api/agent.js` | `/api/agent/*` 经营分析 |
| `api/dispatch.js` | `/api/dispatch/*` + `/api/dispatch/public/*` |

### 2.3 hooks/ —— V3 三层之二

| 文件 | 一句话职责 |
|---|---|
| `hooks/index.js` | 聚合 export 5 个 hook |
| `hooks/useApi.js` | 通用请求：loading + error + 内置防竞态 reqIdRef + 默认 message.error；支持 silentError + onError |
| `hooks/useTableQuery.js` | 分页 + pageSize + filters + 自动 deps refetch；fetcher 必须返 `{ items, total }` |
| `hooks/useDateRange.js` | 销售日期窗口：拉 dates → maintain draft/applied → disabledDate → apply/reset |
| `hooks/useJobPolling.js` | 后端异步 job 轮询（替代 PortalPage / ArrivalPage 各自 hand-roll while-sleep） |
| `hooks/useToast.js` | 拿 AntD `App.useApp()` 的 message 实例 + 统一 error 拼装（避免静态 import warning） |

### 2.4 components/ —— V3 三层之三

| 文件 | 一句话职责 |
|---|---|
| `components/index.js` | 聚合 export 6 个组件 |
| `components/HeroCard.jsx` | `<Card className="hero-card" size="small">` 样板包装 |
| `components/PageHeader.jsx` | 标题 + 描述 + 右侧 actions + tags |
| `components/DateRangePicker.jsx` | 受 useDateRange 驱动的 RangePicker |
| `components/DataTable.jsx` | AntD Table 样板，可一行接 `query={tableQuery}` |
| `components/ChannelCompareSection.jsx` | 渠道对比专用组件（V3 前已有） |
| `components/SkuPreview.jsx` | 货号悬浮图片预览（V3 前已有） |

### 2.5 pages/ —— 业务页

| 文件 | 一句话职责 |
|---|---|
| `pages/PortalPage.jsx` | 门户首页：health 检查 + 模块入口 + 报表同步 |
| `pages/AdminAccountsPage.jsx` | admin：账号 CRUD + 权限矩阵 |
| `pages/AdminUsagePage.jsx` | **V3 样板**（127 行）：admin 用量统计（汇总 + by_path + by_user） |
| `pages/AnalysisPage.jsx` | AI 经营分析：skills + run + 历史报告 + markdown |
| `pages/ArrivalPage.jsx` | 新品看板（最大 page，1272 行，V4 拟拆） |
| `pages/ChannelDashboardPage.jsx` | 渠道 Top20 + 双 RangePicker |
| `pages/DailyReportPage.jsx` | **V3 样板**（204 行）：日报主表（dates+meta+rows+分页+搜索+导出） |
| `pages/DashboardPage.jsx` | 综合看板：dates / overview / channel-compare / drilldown |
| `pages/DispatchPage.jsx` | 调拨任务：列表 + SSE + 上传 + 产物 |
| `pages/DispatchConfirmPage.jsx` | 公开确认页（无 AuthProvider）：preview + confirm |
| `pages/NoAccessPage.jsx` | 静态：无权限提示 |

### 2.6 auth/

| 文件 | 一句话职责 |
|---|---|
| `auth/AuthContext.jsx` | `<AuthProvider>` + `useAuth()`：从 `/api/auth/me` 拉账号信息，提供 `isAdmin` / `hasPermission` / `refreshAuth` |
| `auth/modules.js` | 前端模块定义：`APP_MODULES`（菜单顺序 + path/key/label/description）+ `hasModulePermission` / `getPreferredRoute` / `isRouteAllowed`（前端镜像后端） |

### 2.7 utils/

| 文件 | 一句话职责 |
|---|---|
| `utils/numbers.js` | formatInteger / formatSmartNumber + TABLE_NUMBER_ALIGN |

---

## 3. docs/

| 文件 / 目录 | 一句话职责 |
|---|---|
| `docs/recipes/` | 本 Cookbook（你在这） |
| `docs/adr/` | 架构决策记录：0001 CI / 0002 testing / 0003 logging / 0004 routes 抽取 / 0005 bcrypt / 0006 zod / 0007 audit / 0008 metrics+sentry / 0009 usage / 0010 openapi+runbook / 0011 grafana / 0012 metrics auth / 0013 password policy / 0014 reportRepo split / 0015 server auth / 0016 frontend api / 0018 openapi gen |
| `docs/plans/` | Plan 文档（每个大 PR 一份）：uplift-to-9 design+plan、reportRepo split plan、server auth plan、frontend api plan、夜间报告 |
| `docs/ENGINEERING_STANDARD.md` | 工程标准（命名 / 测试 / commit 风格） |
| `docs/PROJECT_STRUCTURE.md` | 顶层目录定义（与本 module-map.md 互补：本文档更细，PROJECT_STRUCTURE 更宏观） |
| `docs/PROJECT_BOUNDARY.md` | 项目边界（什么算本仓 / 什么不算） |
| `docs/DISPATCH_AGENT_SETUP.md` | 调拨 Agent 上线 checklist |
| `docs/ECOMMERCE_AGENT_CODEX_GUIDE.md` | Codex agent 指南（早期产物） |
| `docs/ENTERPRISE_AGENT_REFERENCE.md` | 企业级 agent 参考 |

---

## 4. 顶层（apps/ 之外）

| 路径 | 一句话职责 |
|---|---|
| `runtime/` | 调拨产物存档（运行时生成） |
| `pipelines/pg-daily-wide/` | PostgreSQL ETL 主链路（`prepare_pg_sources.py` + 5 个 SQL 阶段） |
| `pipelines/sqlserver-legacy/` | 旧 SQLServer 链路归档 |
| `data/inbox/` | 原始 CSV/XLSX 输入 |
| `data/prepared/` | 预处理 CSV |
| `data/archive/` | 历史归档压缩 |
| `ops/windows/` | Windows 启停脚本（PG pipeline / start_all） |
| `query/` | 临时 SQL 查询脚本 |
| `MIGRATION_MANIFEST.md` | 迁移记录 |
| `README.md` | 仓库概览 |

---

## 5. 跟着 grep 自查

**Q1：要找一个权限 key 出现的所有地方** → `grep -rn '"<key>"' apps/`，应该 ≥ 5 个文件（permissions.js、isRouteAllowedForAccount、modules.js、App.jsx、fixture）。

**Q2：要找谁在调用某个公共报表 API** → `grep -rn 'reportRepo\.<methodName>' apps/gateway/`。consumer 限于 `server.js` / `routes/dashboard.js` / `routes/report.js` / `routes/agent.js` / `metricsService.js` / `analysisContextProvider.js`。

**Q3：要找前端某个 fetcher 在哪几个 page 用** → `grep -rn '<methodName>' apps/web/src/pages/`。

**Q4：检查 page 是否还在裸 axios** → `grep -rn 'import http' apps/web/src/pages/`。**期望为空**（V3 后所有 page 走 api/* fetcher）。

**Q5：检查谁还在 ctx 取 require** → `grep -rn 'ctx\.\(require\|getAuthStore\)' apps/gateway/routes/`。**期望为空**（V3 ADR-0015 一刀切）。

**Q6：找慢 SQL** → `grep -rn 'pool\.query\b' apps/gateway/services/`。**期望只在 lib/db.js**（其他全走 timedQuery）。
