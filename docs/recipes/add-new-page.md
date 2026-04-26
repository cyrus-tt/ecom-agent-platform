# Cookbook · 前端加新页面

> **目标**：在 `apps/web/src/pages/` 加一个新页面，挂菜单 + 路由 + GuardedElement，**只组合 api/hooks/components 三层，不自己 import http、不 hand-roll loading**。
>
> **目标行数**：< 200 行（样板 page `AdminUsagePage.jsx` 127 行 / `DailyReportPage.jsx` 204 行）。

---

## 0. 前置阅读

- ADR-0009 `docs/adr/0009-usage-stats.md`：用量统计页（admin 限定）
- ADR-0016 `docs/adr/0016-frontend-api-layer.md`：前端三层架构 by 来由
- Plan：`docs/plans/2026-04-25-v3-frontend-api-layer-plan.md`（694 行，有完整 hook/组件设计与样板对照）
- 样板代码：
  - `apps/web/src/pages/AdminUsagePage.jsx`（127 行，用 useApi + DataTable + Segmented）
  - `apps/web/src/pages/DailyReportPage.jsx`（204 行，用 useDateRange + useTableQuery + DateRangePicker）

---

## 1. 决策树：你需要哪些 hook？

| 你的页面要…… | 用这个 |
|---|---|
| 拉一次数据 → 显示 | `useApi(fetcher, deps)` |
| 拉数据 + 显示在 AntD Table，需要分页 / 搜索 | `useTableQuery(fetcher)` + `<DataTable query={...}>` |
| 让用户选日期范围（从可选清单里选） | `useDateRange({ fetchDates })` + `<DateRangePicker range={...}>` |
| 触发后端 job 后轮询状态 | `useJobPolling(...)` |
| 拿 message.success / message.error 实例 | `useToast()`（**不要**直接 `import { message } from "antd"`） |

**所有 fetcher 必须从 `apps/web/src/api/` 走**，禁止页面里 `import http` 直接拼 axios。

---

## 2. 步骤

### Step 1 · 加菜单 / 路由元信息（如果是常驻菜单页）

文件：`apps/web/src/auth/modules.js`

```js
export const APP_MODULES = [
  // ...
  {
    key: "my_module",                 // 必须与后端 AUTH_PERMISSION_MODULES 的 key 一致
    label: "我的模块",                 // 顶部菜单文字
    path: "/my-module",
    menuKey: "/my-module",
    description: "<一句话描述>",
  },
];
```

如果只是 admin-only 页（不进权限矩阵），加在 `modules.js` 顶部：

```js
export const ADMIN_MY_TOOL_ROUTE = "/admin/my-tool";
```

然后在 `App.jsx` 的 admin menu 段加一项（参考 `ADMIN_USAGE_ROUTE` 的处理）。

### Step 2 · 加 fetcher（如果后端端点不在 api/* 里）

文件：`apps/web/src/api/<domain>.js`（已有就追加，没有就新建）

```js
import http from "./http";

/**
 * GET /api/my-module/list
 * @param {{ page?: number, pageSize?: number, keyword?: string }} params
 * @returns {Promise<{ ok: boolean, items: any[], total: number }>}
 */
export async function listItems({ page = 1, pageSize = 50, keyword } = {}) {
  const resp = await http.get("/api/my-module/list", {
    params: { page, pageSize, keyword: keyword || undefined, _t: Date.now() },
  });
  return resp.data;
}
```

新模块需要在 `apps/web/src/api/index.js` 里 export：

```js
import * as myDomainApi from "./<domain>";
export { myDomainApi };
```

约定（V3 起强制）：
- 一个文件 = 一个后端模块
- fetcher 签名：`(params) => Promise<data>`，**返回 `resp.data` 不返回 axios 响应**
- 防缓存 `_t: Date.now()` **由 fetcher 加**，page 不再手抖
- fetcher **不 try/catch**，错误透传给 useApi

### Step 3 · 写页面骨架

文件：`apps/web/src/pages/MyModulePage.jsx`

最小可用模板：

```jsx
// V3 migrated to api/hooks/components — see docs/plans/2026-04-25-v3-frontend-api-layer-plan.md
import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Space, Typography } from "antd";
import { useState } from "react";
import { myDomainApi } from "../api";
import { DataTable, HeroCard, PageHeader } from "../components";
import { useApi } from "../hooks";

const { Text } = Typography;

const COLUMNS = [
  { title: "ID", dataIndex: "id", key: "id", width: 100 },
  { title: "名称", dataIndex: "name", key: "name" },
  { title: "状态", dataIndex: "status", key: "status", width: 120 },
];

export default function MyModulePage() {
  const [keyword, setKeyword] = useState("");

  const { data, loading, refetch } = useApi(
    () => myDomainApi.listItems({ keyword }),
    [keyword],
    { fallbackMessage: "读取列表失败" }
  );

  const items = Array.isArray(data?.items) ? data.items : [];

  const headerActions = (
    <Space>
      <Button icon={<ReloadOutlined />} onClick={() => void refetch()} loading={loading}>
        刷新
      </Button>
    </Space>
  );

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <HeroCard>
        <PageHeader title="我的模块" description="<一句话说明>" actions={headerActions} />
      </HeroCard>

      <Card size="small">
        <DataTable
          rowKey="id"
          columns={COLUMNS}
          dataSource={items}
          loading={loading}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          scroll={{ x: 800 }}
        />
      </Card>
    </div>
  );
}
```

### Step 4 · 列表 + 分页 + 搜索（用 useTableQuery 样板）

```jsx
import { useTableQuery } from "../hooks";
import { reportsApi } from "../api";

export default function MyListPage() {
  const tableQuery = useTableQuery(
    ({ page, pageSize, keyword }) => reportsApi.listItems({ page, pageSize, keyword }),
    {
      initialPageSize: 50,
      initialFilters: { keyword: "" },
      fallbackMessage: "读取列表失败",
    }
  );

  return (
    <DataTable
      rowKey="id"
      columns={COLUMNS}
      dataSource={tableQuery.dataSource}    // 自动 normalize 成数组
      pagination={tableQuery.pagination}     // 含 total/showSizeChanger
      loading={tableQuery.loading}
      onChange={tableQuery.onChange}         // page/pageSize 变化自动 refetch
    />
  );
}
```

**fetcher 签名约束**：`useTableQuery` 要求 fetcher 返回 `{ items: T[], total: number }`。如果后端形状是 `{ rows, total }`，在 fetcher 里 normalize 一下。

### Step 5 · 日期范围选择（用 useDateRange 样板）

```jsx
import { useDateRange } from "../hooks";
import { DateRangePicker } from "../components";
import { reportsApi } from "../api";

const dateRange = useDateRange({
  fetchDates: reportsApi.getDailyReportDates,
  pickDates: (data) => data?.sales_dates,         // 后端字段映射
  pickDefault: (data) => data?.default_sales_date,
  defaultSpanDays: 7,                             // 默认窗口宽度
});

const [dateFrom, dateTo] = dateRange.appliedTexts;  // ["2026-04-01", "2026-04-07"]
const hasRange = Boolean(dateFrom && dateTo);

// JSX
<DateRangePicker
  range={dateRange}
  onChange={(nextRange) => {
    if (!nextRange.length) return;
    dateRange.apply(nextRange);
    // ...你需要的副作用：触发数据加载
  }}
/>
```

### Step 6 · 在 App.jsx 注册路由 + GuardedElement

文件：`apps/web/src/App.jsx`

```jsx
import MyModulePage from "./pages/MyModulePage";

// 在 <Routes> 内加：
<Route
  path="/my-module"
  element={
    <GuardedElement permission="my_module">
      <MyModulePage />
    </GuardedElement>
  }
/>
```

`GuardedElement` 在 `App.jsx` 里已定义，会从 `useAuth()` 拿权限。`permission` 字段必须等于 `auth/modules.js` 里 APP_MODULES 的 `key`，也必须等于后端 `AUTH_PERMISSION_MODULES` 的 `key`。

如果是 admin-only 页：

```jsx
<Route
  path="/admin/my-tool"
  element={
    <GuardedElement adminOnly>
      <MyAdminToolPage />
    </GuardedElement>
  }
/>
```

并在 menu 段加图标（菜单 icon 从 `@ant-design/icons` 选）。

### Step 7 · 跑前端 build

```bash
cd apps/web
npm run build
```

期望：esbuild 通过，bundle 大小与基线接近（~5.9MB，PR12 / V3 量级）。

> **Mac 兼容性提醒**：Node v25.8.1 + 系统 esbuild 有兼容 bug，构建脚本 `scripts/build.js` 已自动用 `node_modules/@esbuild/darwin-arm64/bin/esbuild` 绕过。直接 `npm run build` 即可，不要手动调 esbuild。

### Step 8 · 浏览器手测

```bash
cd apps/web
npm run dev          # vite dev server
# 另开终端
cd apps/gateway
npm run dev          # 网关 + 静态 fallback
```

打开 `http://localhost:3000/my-module`，跑：
1. 用 `smoke-admin` 登录 → 应该能看到页面
2. 用 `smoke-user` 登录 → 应该被 `GuardedElement` 重定向到 `/report-daily`
3. DevTools → Network → offline → 触发刷新 → 应弹 `message.error`
4. 后端故意返 503 → 你 page 决定走 toast 还是 Alert（参考 AdminUsagePage 的 silentError + onError 把 503 写到 Alert）

---

## 3. 测试要求

前端目前**没有 vitest / jest**（ADR-0016 §验证 §自动化）。验证全靠：

- [ ] esbuild build 通过
- [ ] 浏览器 happy path（登录 → 进页 → 看到数据）
- [ ] 浏览器 error path（offline / 503 / 401 跳 login）
- [ ] grep `import http` —— 你的 page 应该为空（除非真的要拼非标 URL）

```bash
grep -n "import http" apps/web/src/pages/MyModulePage.jsx
# 预期：no output
grep -n "useState.*loading" apps/web/src/pages/MyModulePage.jsx
# 预期：no output（用 useApi.loading 即可）
```

---

## 4. 示例 PR / commit

| 场景 | 参考 |
|---|---|
| 加最小 admin 页（单 fetcher + Segmented + Table） | `apps/web/src/pages/AdminUsagePage.jsx`（127 行） |
| 加列表页（分页 + 搜索 + 日期范围 + 导出） | `apps/web/src/pages/DailyReportPage.jsx`（204 行） |
| 三层架构 PR 本体（含框架 + 2 个样板 page） | PR-V3-A/B1/B2，合并为单 PR；ADR-0016 |

---

## 5. 常见踩坑

1. **直接 `import { message } from "antd"`** —— AntD 5 弃用了静态 message，会有 console 警告。改用 `useToast()` 或 `useApi` 默认行为。
2. **fetcher 返回 axios 响应而非 `resp.data`** —— page 拿 `data.data.items` 然后说"为啥是 undefined"。规则：fetcher 永远 `return resp.data`。
3. **忘了 `_t: Date.now()`** —— Safari / Edge 缓存 `Cache-Control: max-age` 把同 URL 直接吃，列表不刷新。fetcher 必须加。
4. **`useApi` 的 deps 没传或传错** —— 改 keyword 后页面不刷新。`deps` 数组**必须**包含所有用到的外部变量。
5. **`useTableQuery` 的 fetcher 返回不是 `{ items, total }`** —— Table 永远空。先在 fetcher 里 normalize（`{ items: data.rows, total: data.total }`）。
6. **`useDateRange` 的 `pickDates` 没对上后端字段** —— 默认是 `data.sales_dates`，你的后端如果叫 `data.choices`，要 `pickDates: (d) => d.choices`。
7. **`GuardedElement` 的 `permission` 写错** —— 写成不存在的 key，无论 admin 还是普通用户都被拦。grep `AUTH_PERMISSION_MODULES`（后端）和 `APP_MODULES`（前端）确保 key 一致。
8. **公开页（旁路 BrowserRouter / AuthProvider）忘了包 `<AntdApp>`** —— 公开页里 `useToast()` 拿不到实例，message 不弹。`main.jsx` 顶层已包，但如果你新加公开页要确认还在 AntdApp 内。
9. **`useApi` 在 fetcher 里拼新 fetcher 函数** —— 每次渲染产生新引用，无限刷新。要么 useCallback，要么直接 `() => api.foo(x)` 配合 deps 锁住。

---

## 6. 完成检查清单

- [ ] 后端 endpoint 已在 `apps/web/src/api/<domain>.js` 有 fetcher，签名 `(params) => Promise<data>`
- [ ] api/index.js 已 export `<domain>Api`
- [ ] page 用 `useApi` / `useTableQuery` / `useDateRange` / `useJobPolling`，不 hand-roll
- [ ] page 头部有注释 `// V3 migrated to api/hooks/components — see docs/plans/...`
- [ ] page 用 `<HeroCard>` + `<PageHeader>` 标题区，不自己拼 Card
- [ ] `App.jsx` 加了 `<Route>` + `<GuardedElement permission="...">`（或 `adminOnly`）
- [ ] `auth/modules.js` 的 APP_MODULES 已加（如果是常驻菜单页）
- [ ] permission key 三处对齐：后端 `AUTH_PERMISSION_MODULES` + 前端 `APP_MODULES` + Route 上的 `permission` prop
- [ ] grep `import http` / `useState.*loading` 在 page 文件里为 0
- [ ] `npm run build --prefix apps/web` 通过
- [ ] 浏览器手测：admin OK / 无权限被踢 / offline 弹 toast
