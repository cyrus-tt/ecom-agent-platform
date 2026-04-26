# V3 前端 API/Hooks/Components 层加固 Plan

- 起草日期：2026-04-25
- 适用 worktree：`pr12-zod-expand`（路径：`/Volumes/tyj/Cyrus/GitHub/ecom-agent-platform-worktrees/pr12-zod-expand/apps/web`）
- 输出范围：仅设计 + 迁移路径，**不修改任何 .jsx/.js**
- 目标：把 11 个 page 平均行数从 ~480 → ~150，新加 page 写起来 < 200 行

> 第一性自检（写在前面，下面所有设计都对照这 4 条）
>
> 1. **这一步为什么存在？能不能消除？** — 每个 hook/组件如果不能把 ≥3 个 page 的重复代码消掉，就不要建。
> 2. **如果这一步失败，会怎么表现？** — 全部 fetcher 必须经 `http.js` 走统一 401 跳转 + 统一 message，不要让某个 page 自己 swallow error。
> 3. **真实环境跑过吗？** — Step B 必须在 `pnpm --filter ecom-dashboard-client dev` 下浏览器手工跑过 happy path，不是只看 build 通过。
> 4. **3 个月后能一眼看懂吗？** — `api/` 一个文件对应一个后端模块，签名 `(params) => Promise<data>`，不准每个 page 自己拼 axios。

---

## 1. 当前状态调研

### 1.1 11 个 page 的体量与职责

| 文件 | 行数 | 主要职责 | fetch 数 |
|---|---|---|---|
| `pages/PortalPage.jsx` | 244 | 门户首页：health 检查 + 模块入口 + 报表同步 | 3 |
| `pages/AdminAccountsPage.jsx` | 363 | admin：账号 CRUD + 权限矩阵 | 4 |
| `pages/AdminUsagePage.jsx` | 277 | admin：用量统计（汇总 + by_path + by_user） | 1 |
| `pages/AnalysisPage.jsx` | 379 | AI agent：skills + run + 历史报告 + markdown 渲染 | 5 |
| `pages/ArrivalPage.jsx` | 1272 | 新品看板：data + status + notes（多用户）+ 异步刷新 job | 9 |
| `pages/ChannelDashboardPage.jsx` | 519 | 渠道 Top20：日期 + 同期 + 渠道多选 | 1 |
| `pages/DailyReportPage.jsx` | 415 | 日报：dates + meta + rows + 分页 + 搜索 + 导出 | 3 |
| `pages/DashboardPage.jsx` | 314 | 总览：dates + overview + channel-compare + drilldown | 4 |
| `pages/DispatchPage.jsx` | 366 | 调拨任务列表 + SSE 订阅 + 上传 + 产物 | 3（已抽出到 `api/dispatch.js`） |
| `pages/DispatchConfirmPage.jsx` | 231 | 公开确认页（无 AuthProvider）：preview + confirm | 2（**还在用 axios 直接调用**） |
| `pages/NoAccessPage.jsx` | 30 | 静态页 | 0 |

加上 `App.jsx`（365 行）里的 AI 设置 Modal 也独立调了 3 次 `/api/settings/ai/*`，整站 **fetch 调用合计 38 个**（包含轮询循环）。

### 1.2 共有 antipattern（每个 page 都在重写）

1. **每个 page 自己 import http + 自己拼 axios**：除 `DispatchPage` 走了 `../api/dispatch` 之外，其余 11 个 page 全部直接 `http.get(...)`。
2. **每次请求手动加 `_t: Date.now()` 防缓存**：38 处全部重复，没有一个地方统一。
3. **error 处理 3 套写法并存**：
   - `message.error(err?.response?.data?.message || err.message || "xx 失败")`（高频）
   - `setError(...)` + `<Alert>` 局部展示（AdminUsage / Analysis）
   - swallow（DispatchConfirm 部分分支）
4. **loading state 各自维护**：`useState(false)` + try/finally 的 setLoading，38 处。
5. **time-window 选择器逻辑重复 4 次**：DailyReport / ChannelDashboard / Dashboard / Analysis 各自实现 `salesDates + draftRange + appliedRange + disabledDate + buildRangeFromTexts`。
6. **分页 state 重复 3 次**：DailyReport / Dashboard.drilldown / AdminUsage（隐式 20 行）。
7. **请求竞态保护各自 hand-roll**：DailyReport / ChannelDashboard / Dashboard.drilldown / Arrival.notes 都用 `loadRequestRef` + `requestId` 模式，4 套独立实现。
8. **轮询 job 状态重复**：PortalPage `pollManagedJob` 与 ArrivalPage `runManagedRefresh` 几乎是同一份代码（`while(true) sleep(2s) get jobs/:id`）。
9. **admin 守门写在 App.jsx 里**：`<GuardedElement adminOnly>`，OK；但 admin 模块也散在 menu 拼装里，三处零散。
10. **AntD `<Card title=... extra=...>` + `<Space direction="vertical">` 包裹一个标题组的代码模板**：每个 page 顶部都有一段 hero-card / dense-card 模板。

### 1.3 fetch 调用全清单（按后端模块归类）

> 这是 V3 后 `apps/web/src/api/*.js` 的内容来源。

#### auth / settings（3 处，目前散在 App.jsx + Auth + 多页）
- `GET /api/auth/me`
- `GET /api/settings/ai`
- `POST /api/settings/ai/deepseek-key`
- `DELETE /api/settings/ai/deepseek-key`

#### admin（5 处）
- `GET /api/admin/accounts`
- `POST /api/admin/accounts` `{name, password, permissions}`
- `PATCH /api/admin/accounts/{id}/permissions` `{permissions}`
- `PATCH /api/admin/accounts/{id}/password` `{password}`
- `GET /api/admin/usage?interval=24 hours`
- `POST /api/admin/rebuild-weekly`
- `POST /api/admin/refresh-arrival`
- `GET /api/admin/jobs/{id}`

#### reports（10 处）
- `GET /api/report-daily/dates`
- `GET /api/report-daily/meta?dateFrom=&dateTo=`
- `GET /api/report-daily/rows?dateFrom=&dateTo=&page=&pageSize=&keyword=`
- `GET /api/report-daily/export.xlsb`（直接 window.open）
- `GET /api/dashboard/dates`
- `GET /api/dashboard/overview?date_from=&date_to=`
- `GET /api/dashboard/channel-compare?date_from=&date_to=&channels=`
- `GET /api/dashboard/drilldown?anchor_date=&date_from=&date_to=&category=&level=&style=&page=&pageSize=`
- `GET /api/channel-dashboard?date_from=&date_to=&comparison_date_from=&comparison_date_to=&channels=`
- `GET /api/health`

#### arrival（5 处）
- `GET /api/arrival/status`
- `GET /api/arrival/note-users`
- `GET /api/arrival/data`
- `GET /api/arrival/review?sku=`
- `POST /api/arrival/refresh`（兜底分支）

#### notes（独立 base url，2 处）
- `GET {notesApiBase}/notes?user_id=`
- `POST {notesApiBase}/notes/upsert` `{sku, user_id, tag, remark, is_following, updated_by}`
- `POST {notesApiBase}/notes/bulk_upsert` `{skus, user_id, tag, remark, is_following, updated_by}`

#### agent / analysis（4 处）
- `GET /api/agent/skills`
- `GET /api/agent/reports?page=&pageSize=`
- `GET /api/agent/reports/{id}`
- `POST /api/agent/run` `{period_type, start_date, end_date, skill_id, prompt_text}`

#### dispatch（已抽到 api/dispatch.js，5 处）
- `POST /api/dispatch/tasks` (multipart)
- `GET /api/dispatch/tasks`
- `GET /api/dispatch/tasks/{id}`
- `EventSource /api/dispatch/tasks/{id}/events`
- 文件下载 URL 构造
- **DispatchConfirmPage 独立用 axios**：`GET /api/dispatch/public/preview?token=`、`POST /api/dispatch/public/confirm?token=`

合计 38 个独立 endpoint 调用点。

### 1.4 App.jsx + auth/modules.js 现状

- 路由：模块化（APP_MODULES 数组驱动 menu，但 Routes 里仍然手写 11 个 `<Route>`）
- guard：`GuardedElement` ✅ 已经抽好，无需改
- DispatchConfirm 走的是 main.jsx 里的旁路（不进 BrowserRouter，独立 axios），需要在 V3 里把它的 fetcher 也搬到 `api/dispatch.js`，但保留旁路渲染入口

---

## 2. 共性提取（≥5 类，实际 8 类）

| # | 模式 | 受益 page | 迁后预计省的行数 |
|---|---|---|---|
| 1 | **api fetcher 抽离**（`api/<module>.js`） | 11/11 | 总省 ~600 行（每页 -40~80） |
| 2 | **`useApi(fetcher, deps)` 通用请求 hook**（loading/error/refetch + 防缓存 _t + 竞态） | 简单读取场景 ~9 处 | 每处省 8~12 行 = ~100 行 |
| 3 | **`useTableQuery`：分页/排序/搜索/refetch** | DailyReport, Dashboard.drilldown, AdminUsage by_path/by_user | ~80 行 |
| 4 | **`useDateRange`：salesDates + draft/applied + disabledDate + 默认窗口** | DailyReport, ChannelDashboard, Dashboard, Analysis | ~120 行 |
| 5 | **`useToast` / `errorMessage(err, fallback)` 工具** | 11/11 | 微量但极大降低 typo / 不一致 |
| 6 | **`<DataTable>` 包装 AntD Table**（默认 size + className + 分页 + emptyText） | 8 处 | ~60 行 |
| 7 | **`<PageHeader>` + `<HeroCard>`** | 11/11 | ~40 行 |
| 8 | **`useJobPolling(jobId)`：轮询 `/api/admin/jobs/:id` 直到 done** | PortalPage, ArrivalPage | ~50 行 |

> **重要：admin guard 不需要新组件**。`<GuardedElement>` 已经够用，不再加 `<AdminGuard>` 重复一层。删掉任务清单里这一项。

---

## 3. 拟定新结构

```
apps/web/src/
├── api/
│   ├── http.js              ★ 已有，扩 1 处：导出 errorMessage(err, fallback) 工具
│   ├── auth.js              ★ 新建：me + ai settings
│   ├── admin.js             ★ 新建：accounts + usage + jobs + rebuild-weekly + refresh-arrival
│   ├── reports.js           ★ 新建：report-daily + dashboard + channel-dashboard + health
│   ├── arrival.js           ★ 新建：status + data + note-users + review + refresh
│   ├── notes.js             ★ 新建：list / upsert / bulk_upsert（动态 baseUrl）
│   ├── agent.js             ★ 新建：skills + reports + run
│   ├── dispatch.js          已有，扩 2 函数：getPublicPreview / postPublicConfirm（替换 DispatchConfirmPage 内的 axios）
│   └── index.js             ★ 新建：聚合 export，page 一行 import
│
├── hooks/
│   ├── useApi.js            ★ 新建
│   ├── useTableQuery.js     ★ 新建
│   ├── useDateRange.js      ★ 新建
│   ├── useJobPolling.js     ★ 新建
│   ├── useToast.js          ★ 新建（极薄）
│   └── index.js
│
├── components/
│   ├── PageHeader.jsx       ★ 新建（标题 + 描述 + 右侧 actions）
│   ├── HeroCard.jsx         ★ 新建（包 hero-card class）
│   ├── DateRangePicker.jsx  ★ 新建（受 useDateRange 驱动的 Picker + 标签）
│   ├── DataTable.jsx        ★ 新建
│   ├── ChannelCompareSection.jsx  ✋ 保留不动
│   ├── SkuPreview.jsx             ✋ 保留不动
│   └── index.js
│
├── auth/
│   ├── AuthContext.jsx     无需动（已 OK）
│   └── modules.js          无需动
│
├── pages/                   Step B 只迁 2 个，其他不动
└── utils/                   无需动
```

> **统一约定**：所有新文件用 ESM + JSDoc 类型注释，不引入 TS。

---

## 4. api client 设计规范

### 4.1 形态

每个 `api/<module>.js` 文件 export 命名函数，签名统一：

```js
/**
 * @typedef {object} DailyReportRowsParams
 * @property {string} dateFrom YYYY-MM-DD
 * @property {string} dateTo   YYYY-MM-DD
 * @property {number} [page=1]
 * @property {number} [pageSize=50]
 * @property {string} [keyword]
 */

import http from "./http";

/** @param {DailyReportRowsParams} params */
export async function getDailyReportRows(params) {
  const resp = await http.get("/api/report-daily/rows", {
    params: { ...params, _t: Date.now() },
  });
  return resp.data;            // ←【约定】只返回 data，不返回 axios resp
}
```

约定：

1. **永远只 `return resp.data`**。调用方拿不到 axios 的 status/headers，避免 page 里耦合 axios。
2. **请求级 `_t: Date.now()` 由 fetcher 自动加**；page 不再手抖。
3. **multipart / SSE / 文件下载 URL 构造** 也作为函数 export（不要让 page 自己拼 URL）。
4. **错误透传**：fetcher 不 try/catch；交给 `useApi` 或调用方统一处理。
5. **不引入 zod 校验**（V3 范围外，留 V4）；只在 JSDoc 里写明字段。

### 4.2 全模块 export 草案

```js
// api/index.js
export * as authApi from "./auth";
export * as adminApi from "./admin";
export * as reportsApi from "./reports";
export * as arrivalApi from "./arrival";
export * as notesApi from "./notes";
export * as agentApi from "./agent";
export * as dispatchApi from "./dispatch";
export { default as http, errorMessage } from "./http";
```

page 端示例：

```js
import { reportsApi, errorMessage } from "../api";
const data = await reportsApi.getDailyReportRows({ dateFrom, dateTo, page, pageSize, keyword });
```

### 4.3 errorMessage 工具

```js
// api/http.js（增量补充）
export function errorMessage(err, fallback = "请求失败") {
  return (
    err?.response?.data?.message ||
    err?.message ||
    fallback
  );
}
```

> 全站 message.error 调用替换为 `message.error(errorMessage(err, "xx 失败"))`。

### 4.4 各模块函数清单

下面把 1.3 中的 38 个 endpoint 一一映射：

```js
// api/auth.js
export function getMe();
export function getAiSettings();
export function postDeepseekKey({ apiKey });
export function deleteDeepseekKey();

// api/admin.js
export function listAccounts();
export function createAccount({ name, password, permissions });
export function patchAccountPermissions(id, { permissions });
export function patchAccountPassword(id, { password });
export function getUsage({ interval });
export function postRebuildWeekly();
export function postRefreshArrival();
export function getJob(id);

// api/reports.js
export function getDailyReportDates();
export function getDailyReportMeta({ dateFrom, dateTo });
export function getDailyReportRows({ dateFrom, dateTo, page, pageSize, keyword });
export function dailyReportExportUrl({ dateFrom, dateTo });   // ←返回 URL string，page 自己 window.open
export function getDashboardDates();
export function getDashboardOverview({ dateFrom, dateTo });
export function getDashboardChannelCompare({ dateFrom, dateTo, channels });
export function getDashboardDrilldown({ anchorDate, dateFrom, dateTo, category, level, style, page, pageSize });
export function getChannelDashboard({ dateFrom, dateTo, comparisonDateFrom, comparisonDateTo, channels });
export function getHealth();

// api/arrival.js
export function getArrivalStatus();
export function getArrivalNoteUsers();
export function getArrivalData();
export function getArrivalReview({ sku });
export function postArrivalRefresh();   // 兼容兜底

// api/notes.js
export function listNotes({ baseUrl, userId });
export function upsertNote({ baseUrl, sku, userId, tag, remark, isFollowing });
export function bulkUpsertNotes({ baseUrl, skus, userId, tag, remark, isFollowing });

// api/agent.js
export function getSkills();
export function listReports({ page, pageSize });
export function getReport(id);
export function runAnalysis({ periodType, startDate, endDate, skillId, promptText });

// api/dispatch.js（扩展）
// 已有：createTask / listTasks / getTask / subscribeEvents / artifactUrl
export function getPublicPreview({ token });
export function postPublicConfirm({ token, responses });
```

---

## 5. hooks 设计规范

### 5.1 `useApi(fetcher, deps, options)`

> 用途：替代 `useState(loading) + useState(data) + useState(error) + useEffect` 的 4 行组合。

```js
import { useCallback, useEffect, useRef, useState } from "react";
import { message } from "antd";
import { errorMessage } from "../api/http";

/**
 * @template T
 * @param {() => Promise<T>} fetcher  fetcher 函数（一般是 api/* 的某个函数 + 已绑定参数）
 * @param {any[]} deps                依赖（变化时自动 refetch）
 * @param {{ enabled?: boolean, onSuccess?: (T)=>void, onError?: (Error)=>void, fallbackMessage?: string, silentError?: boolean }} [options]
 */
export function useApi(fetcher, deps = [], options = {}) {
  const { enabled = true, onSuccess, onError, fallbackMessage, silentError = false } = options;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (reqIdRef.current !== reqId) return;
      setData(result);
      onSuccess?.(result);
      return result;
    } catch (err) {
      if (reqIdRef.current !== reqId) return;
      setError(err);
      if (onError) onError(err);
      else if (!silentError) message.error(errorMessage(err, fallbackMessage));
    } finally {
      if (reqIdRef.current === reqId) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!enabled) return;
    void refetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  return { data, loading, error, refetch, setData };
}
```

> **设计要点**：
> - 内置 `reqIdRef` 解决竞态（PR12 里 4 个 page 自己 hand-roll 的同样代码）。
> - 默认调 `message.error`；admin 那种要求"503 不弹 toast"的场景传 `silentError: true` + 自己处理 onError。
> - `setData` 暴露出去：mutation 后乐观更新（如 saveNote）。

### 5.2 `useTableQuery(fetcher, options)`

整合分页 + sort + 搜索 + onChange，输入 `fetcher({ page, pageSize, sort?, ...filters })`，返回 `{ dataSource, pagination, loading, refetch, onChange, filters, setFilters }`。

```js
/**
 * fetcher: ({ page, pageSize, ...filters }) => Promise<{ items, total }>
 * options: { initialPageSize, initialFilters, pageSizeOptions, syncWithUrl? }
 */
export function useTableQuery(fetcher, options = {}) {
  const { initialPageSize = 50, initialFilters = {}, pageSizeOptions = ["50","100","200"] } = options;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [filters, setFilters] = useState(initialFilters);

  const { data, loading, refetch } = useApi(
    () => fetcher({ page, pageSize, ...filters }),
    [page, pageSize, JSON.stringify(filters)],
  );

  const pagination = {
    current: page, pageSize, total: data?.total || 0,
    showSizeChanger: true, pageSizeOptions,
    showTotal: (n) => `共 ${n} 行`,
  };
  const onChange = (next) => {
    setPage(Number(next.current || 1));
    setPageSize(Number(next.pageSize || pageSize));
  };

  return {
    dataSource: Array.isArray(data?.items) ? data.items : [],
    pagination, loading, refetch, onChange,
    filters, setFilters,
    resetPage: () => setPage(1),
  };
}
```

### 5.3 `useDateRange({ datesEndpoint, defaultSpanDays })`

封装 `salesDates + appliedRange + draftRange + disabledDate + buildDefault`，把 4 个 page 各自的 ~50 行收敛成：

```js
const range = useDateRange({
  fetchDates: reportsApi.getDailyReportDates,
  pickDates:  (data) => data.sales_dates,
  pickDefault: (data) => data.default_sales_date,  // 可选
  defaultSpanDays: 1,                              // DailyReport=1 / Dashboard=7 / Analysis=7
});
// range.draft / range.applied / range.disabledDate / range.apply(values) / range.reset()
```

### 5.4 `useJobPolling()`

```js
/**
 * @param {{ jobApi: (id) => Promise<{job: any}>, intervalMs?: number, onProgress?: (job)=>void }} options
 * @returns {{ run: (jobId) => Promise<any>, stop: () => void, status: 'idle'|'running'|'done'|'error' }}
 */
export function useJobPolling(options) { ... }
```

替代 PortalPage 与 ArrivalPage 中的 `while(true) sleep` 块。

### 5.5 `useToast()`（极薄）

```js
import { App as AntdApp } from "antd";
export function useToast() {
  const { message, notification } = AntdApp.useApp();
  return {
    success: (text) => message.success(text),
    error:   (err, fallback) => message.error(typeof err === "string" ? err : errorMessage(err, fallback)),
    info:    (text) => message.info(text),
  };
}
```

> 顺带要求：在 `App.jsx` 顶层包一层 `<AntdApp>`（AntD 5 推荐），消除 console 中的 message 静态调用警告。

---

## 6. 共用组件设计规范

### 6.1 `<PageHeader>` + `<HeroCard>`

```jsx
<HeroCard>
  <PageHeader
    title="日报主表"
    description="按销售日期范围筛选..."
    actions={<DateRangePicker {...range} />}
  />
</HeroCard>
```

PageHeader props：`{ title, description?, tags?, actions? }`。

### 6.2 `<DateRangePicker>`

包 AntD `RangePicker` + 受 `useDateRange` 返回值驱动；同时显示"当前/草稿"标签：

```jsx
<DateRangePicker
  range={range}
  showAppliedTag
  showDraftTag
  comparison={comparisonRange}   // 可选第二段
/>
```

### 6.3 `<DataTable>`

```jsx
<DataTable
  rowKey={(row) => row.id}
  columns={columns}
  query={tableQuery}              // useTableQuery 返回值
  scroll={{ x: 720 }}
  emptyText="暂无数据"
  className="app-compact-table"
/>
```

内部固定：`size="small"`、注入 pagination/loading/onChange。

### 6.4 `<ErrorBoundary>`（可选）

裹在 `<Routes>` 外层，捕获 page 层未捕获错误显示兜底 UI。**Step A 不强求**，留 V4。

---

## 7. 迁移路径（关键）

### Step A — 框架落地（本次 Execute Agent 第一步，1.5 人天）

任务（按顺序）：

1. 在 `apps/web/src/api/` 下新建 7 个 module 文件（auth/admin/reports/arrival/notes/agent + 扩 dispatch + 写 index.js）。
2. 在 `apps/web/src/hooks/` 下新建 5 个 hook + index.js。
3. 在 `apps/web/src/components/` 下新建 4 个新组件 + 更新 index.js。
4. `App.jsx` 顶层包一层 `<AntdApp>`（AntD 5 推荐），但**不动**已有 menu/route 结构。
5. **不改任何 page**。
6. 跑 `pnpm --filter ecom-dashboard-client build` 确保 import 都通。

验收：

- [ ] `node ./scripts/build.mjs` 通过
- [ ] 旧 page 浏览器跑一遍，所有功能与之前一致（**回归无变化**，这是 Step A 最强保证）
- [ ] 在 main.jsx 顶层加 `<AntdApp>` 后，DispatchConfirm 旁路依然 OK（DispatchConfirm 不进 BrowserRouter，需单独包）

### Step B — 样板迁移（本次 Execute Agent 第二步，2 人天）

只迁 **2 个**作为样板：

| Page | 选择理由 | 预计行数变化 |
|---|---|---|
| `AdminUsagePage.jsx` | 最新写、单 endpoint、有 Segmented 切换 + 双 Table，最适合验 `useApi` + `<DataTable>` | 277 → ~140 |
| `DailyReportPage.jsx` | 代表"列表 + 分页 + 搜索 + 时间窗口 + 导出"的最常见模式，能同时验 `useTableQuery` + `useDateRange` + `<DateRangePicker>` + `<DataTable>` | 415 → ~200 |

要求：

- [ ] 两个 page diff 后，**业务行为完全一致**（手工跑 happy path + 1 个 error path：断网时 message.error 弹出）
- [ ] 在 page 头部注释里写 `// V3 migrated to api/hooks/components — see docs/plans/2026-04-25-v3-frontend-api-layer-plan.md`
- [ ] 给 DailyReport 的导出按钮改用 `reportsApi.dailyReportExportUrl(...)`

### Step C — V4（不在本轮 Execute Agent 范围）

剩余 9 个 page 一个个迁，建议次序（由易到难）：

1. PortalPage（小，且 `useJobPolling` 验证场地）
2. AdminAccountsPage（admin 域，4 endpoint）
3. AnalysisPage（多步初始化 + markdown，验 `useApi` 嵌套）
4. ChannelDashboardPage（双 RangePicker + 多渠道 select）
5. DashboardPage（最复杂的 drilldown）
6. DispatchPage（已有 api/dispatch，加 `useApi` 即可）
7. DispatchConfirmPage（公开页，把内嵌 axios 替换成 dispatchApi）
8. ArrivalPage（最大头，1272 行，建议拆分子组件 + 用 useTableQuery + useJobPolling）
9. App.jsx 内的 AI 设置 Modal 抽成 `<AiSettingsModal>` 用 authApi

每迁一个：浏览器手测 + build 通过即合并。

---

## 8. 兼容期约束（强制）

| 项 | 决策 |
|---|---|
| 旧 page 不强制立即迁 | ✅ Step A 后旧 page 完全不变 |
| App.jsx 路由/menu 结构 | ✅ 不改，只改导入路径（最小改动） |
| AntD 版本 | ✅ 不升级（保持 5.27.6） |
| react-query / SWR | ❌ 不引入。`useApi` 已经够用，避免无谓依赖 |
| TypeScript | ❌ 不引入。JSDoc + 文件名说明类型 |
| 状态管理库（zustand/redux） | ❌ 不引入 |
| 样式系统 | ✅ 保持 AntD 默认 + styles.css，不引入 tailwind / styled-components |
| 现有 ChannelCompareSection / SkuPreview | ✅ 保留不动 |
| auth/AuthContext | ✅ 保留不动（已经够薄） |
| auth/modules.js | ✅ 保留不动 |

---

## 9. 测试 / 验证

### 9.1 自动化（确认现状）

- 前端 **没有** vitest/jest/storybook（看 `package.json` 只有 `vite`/`@vitejs/plugin-react`）
- 本轮 **不新增** 单元测试框架（属于 V4 任务）

### 9.2 本轮强制验证清单

Step A 完成时：
- [ ] `pnpm --filter ecom-dashboard-client build` 通过（CI 也跑这个）
- [ ] 浏览器开 dev server，依次进入 11 个 page，确认无白屏 / 无 console error
- [ ] DispatchConfirm 公开页 `/dispatch/confirm/:id?token=` 仍可加载

Step B 完成时（额外）：
- [ ] AdminUsagePage：切 5 个 interval 时序无错乱（`useApi` 竞态保护要起效）
- [ ] DailyReportPage：换日期 → 改 pageSize → 翻页 → 搜关键字 → 重置；全程 loading 正确，无重复请求
- [ ] 故意断网（DevTools offline），两个 page 应弹出 `message.error` 而不是白屏
- [ ] `git diff --stat` 显示两个 page 行数下降 ≥ 40%

### 9.3 验证的脚本入口

```bash
cd apps/web
node ./node_modules/vite/bin/vite.js               # dev
node ./scripts/build.mjs                           # build
```

> Cyrus 第一性原理 #2：失败路径必须真测过。**断网 / 后端 503 / 401 跳转**这三条路径在 Step B 必须手工触发一次。

---

## 10. 不做什么（避免范围漂移）

1. ❌ 不引入状态管理库
2. ❌ 不引入 TypeScript / zod 前端校验
3. ❌ 不重写 ChannelCompareSection / SkuPreview / arrival 的 utils
4. ❌ 不改 styles.css 视觉效果
5. ❌ 不动 AuthContext / auth/modules.js 的逻辑
6. ❌ 不在本轮搞 Storybook / 截图回归测试
7. ❌ 不在 Step B 之外迁移其他 page
8. ❌ 不改 backend / gateway 任何接口

---

## 11. 第一性自检（最终对照）

> 用户随时可以问的 3 个监督问题，Plan 必须先答：

**Q1：如果某个 fetcher 失败了，会怎么表现？**
- 用户面：默认弹 `message.error(errorMessage(err, fallback))`，401 由 `http.js` 拦截器跳 `/login?next=`
- 开发面：`useApi` 把 err 设到 state，page 可选 `silentError: true` 自己处理（如 AdminUsagePage 对 503 的特殊处理：用 setError + Alert 而不弹 toast）
- 失败路径在 Step B 用 DevTools offline + mock 503 必须手工跑一次

**Q2：这东西真实环境跑过吗？**
- Step A 只是建框架，不改 page，回归风险接近 0；但仍需浏览器跑 11 个 page 看无 console error
- Step B 的 2 个 page 必须 dev server + build 双通过 + 手工 happy/error path 各一次

**Q3：3 个月后另一个人加新 page，能直接套吗？**
- ✅ 直接套样板：`HeroCard + PageHeader` 起头 → `useApi(reportsApi.getXxx, [...deps])` 一行拿数据 → `<DataTable>` 套结果。新 page < 200 行
- ⚠️ 仍需读已有 page 才懂的 2 个点（必须在 Plan 里写明，Execute Agent 在新建文件首部加注释）：
  1. **`_t: Date.now()` 防缓存约定** — 写在 `api/http.js` 注释里
  2. **AntD 5 `App.useApp()` 的层级要求** — 写在 `App.jsx` 顶层注释里
- ⚠️ ArrivalPage / DashboardPage 的复杂业务（drilldown、notes 多用户、SSE）目前在 V3 不迁移；V4 迁移时要先单独画状态机，不要硬塞 useApi

---

## 12. Step A/B 工时与产出汇总

| Step | 内容 | 工时 | 文件改动 |
|---|---|---|---|
| A | 7 api + 5 hooks + 4 components + App 顶层包 AntdApp | 1.5 人天 | 新增 17 个文件、改 1 个文件、page 0 改动 |
| B | 迁 AdminUsage + DailyReport | 2 人天 | 改 2 个 page，行数 -350 左右 |
| **合计** | | **3.5 人天** | |
| C（V4） | 剩余 9 个 page + 1 个 modal | 5~7 人天 | — |

---

## 附录 A：Execute Agent 任务清单（可直接拆到 PR）

> 给 Execute Agent 的 Spec：1 个 PR 等于 Step A，2 个 PR 等于 Step B 的两个 page。

### PR-V3-A（框架）
- [ ] 新建 `apps/web/src/api/auth.js`、`admin.js`、`reports.js`、`arrival.js`、`notes.js`、`agent.js`
- [ ] 扩 `apps/web/src/api/dispatch.js`：加 `getPublicPreview` / `postPublicConfirm`
- [ ] 扩 `apps/web/src/api/http.js`：加 `errorMessage` export
- [ ] 新建 `apps/web/src/api/index.js`
- [ ] 新建 `apps/web/src/hooks/{useApi,useTableQuery,useDateRange,useJobPolling,useToast}.js` + `index.js`
- [ ] 新建 `apps/web/src/components/{PageHeader,HeroCard,DateRangePicker,DataTable}.jsx` + 更新 `components/index.js`
- [ ] `apps/web/src/App.jsx` + `apps/web/src/main.jsx`：顶层包 `<AntdApp>`（注意 DispatchConfirm 旁路也要包）
- [ ] CI build 通过
- [ ] 11 个 page 浏览器各跑一遍，无回归

### PR-V3-B1（迁 AdminUsage）
- [ ] 用 `useApi` + `<DataTable>` 重写 `AdminUsagePage.jsx`
- [ ] 行数从 277 → ≤ 160
- [ ] 切 5 个 interval 无竞态、503 走 setError 不弹 toast、200 正常

### PR-V3-B2（迁 DailyReport）
- [ ] 用 `useDateRange` + `useTableQuery` + `<DateRangePicker>` + `<DataTable>` 重写 `DailyReportPage.jsx`
- [ ] 行数从 415 → ≤ 220
- [ ] 改日期 / 翻页 / 改 pageSize / 搜索 / 重置 / 导出 全通过
- [ ] 断网时正确 `message.error`

---

## 附录 B：风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| `useApi` 内部竞态保护写错 → 出现旧数据覆盖 | 用户看到错数据 | Step B AdminUsagePage 切 interval 必须手工连点 5 次验证 |
| `<AntdApp>` 包错层级 → DispatchConfirm 公开页 message 不弹 | 公开页确认时无反馈 | main.jsx 里 `isPublicConfirmPage` 分支也要包 AntdApp |
| Step A 引入了 7 个 api 文件但没人用 → 死代码 | 短期 | Step B 必须紧跟，且文档明示"未引用即代表 Step A 未完成" |
| AntD 5 的 App.useApp() 要求树内 → useToast 在 page 顶部用没问题，但在 `api/http.js` 拦截器里不能用 | 拦截器无法弹 toast | 拦截器维持 `window.location.href`（401）+ throw，不在拦截器弹 toast |
| 迁移后 page 读取的是 `data.items` 而旧后端返回 `data.rows` | 某 endpoint 命名不一致 | 在 `api/reports.js` 里做一次 normalize（DailyReport 用 `items`、Dashboard.drilldown 也用 `items`，已对齐） |

回滚：每个 PR 独立可 `git revert`。Step A 不动 page，回滚=删 17 个新文件即可。

---

（完）
