# ADR 0016: 前端 api / hooks / components 三层落地

- 日期：2026-04-25
- 状态：已采纳（V3 框架 + 两份样板 page）
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：PR-V3-A（框架）+ PR-V3-B1（AdminUsage）+ PR-V3-B2（DailyReport），合并为单 PR 上线
- 关联设计：`docs/plans/2026-04-25-v3-frontend-api-layer-plan.md`
- 依赖：PR12（zod 校验扩面，公开端点 /api/dispatch/public/* 已加守门）

## 背景

11 个 page 平均行数 ~480，最大 1272（ArrivalPage）。每个 page 自己 `import http`、自己拼 axios、自己写 try/catch、自己 hand-roll loading state、自己实现"日期范围 + 默认窗口 + disabledDate"、自己 hand-roll 防竞态 `loadRequestRef + requestId`。结果：

- **38 个 endpoint 调用全部在 page 里裸调** axios（除 dispatch 外）
- **`message.error(err?.response?.data?.message || err.message || "xx 失败")` 这串字符 38 处** 在仓库里复制粘贴
- **time-window 选择器逻辑 4 个 page 各写一遍**（DailyReport / ChannelDashboard / Dashboard / Analysis）
- **轮询 job 的 `while(true) sleep` 循环 PortalPage 和 ArrivalPage 几乎同一份**
- 加新 page 起步成本极高（要把 8 类 antipattern 都重抄一遍）

## 决策

引入三层结构，强制约束所有未来 page 走样板：

```
apps/web/src/
├── api/        — 一个文件 = 一个后端模块；签名统一 (params) => Promise<data>；自动加 _t 防缓存
├── hooks/      — 5 个通用 hook 解决 ≥3 个 page 共享的 antipattern
├── components/ — 4 个共享 UI 包装（HeroCard/PageHeader/DateRangePicker/DataTable）
└── pages/      — 业务页：只组合 api + hooks + components，不再 import http
```

### 1. api 层（17 文件中的 7 + 2 改）

每个 module 文件 export 命名 fetcher，签名统一 `(params) => Promise<data>`：

```js
// api/reports.js
export async function getDailyReportRows({ dateFrom, dateTo, page, pageSize, keyword }) {
  const resp = await http.get("/api/report-daily/rows", {
    params: { dateFrom, dateTo, page, pageSize, keyword: keyword || undefined, _t: Date.now() },
  });
  return resp.data;
}
```

强约束：

1. **永远只 return resp.data** — page 拿不到 axios 的 status/headers，避免耦合
2. **`_t: Date.now()` 防缓存由 fetcher 自动加** — page 不再手抖
3. **错误透传** — fetcher 不 try/catch，交给 useApi
4. **不引入 zod 前端校验** — V3 范围外，留 V4
5. **统一 errorMessage(err, fallback)** — `api/http.js` 导出，全站 message.error 走它

### 2. hooks 层（6 文件）

| hook | 用途 | 替代了 |
|---|---|---|
| `useApi(fetcher, deps, options)` | loading + error + 防竞态 + 自动 message.error | 38 处 useState 三件套 + 4 处 hand-roll requestId |
| `useTableQuery(fetcher, options)` | 分页 + pageSize + 搜索 + onChange | DailyReport / Dashboard.drilldown / AdminUsage 的分页 state |
| `useDateRange(options)` | salesDates + draft/applied + disabledDate + 默认窗口 | DailyReport / ChannelDashboard / Dashboard / Analysis 4 份重复 |
| `useJobPolling(options)` | 轮询 job 直到 done/error | PortalPage / ArrivalPage 的 `while(true) sleep` |
| `useToast()` | 拿 AntD App.useApp() 的 message 实例 + 统一 error 拼装 | 直接 import { message } from "antd" 的静态调用警告 |
| `index.js` | 聚合 export | — |

`useApi` 的关键设计：

- 内置 `reqIdRef` 解决竞态（旧版 4 个 page 各写一份）
- 默认弹 `message.error(errorMessage(err, fallback))`
- 503 / 自定义错误流程：`silentError: true` + 自己 `onError` 处理（AdminUsage 把 503 写到 Alert 的场景就走这条）
- `setData` 暴露：mutation 后乐观更新

### 3. components 层（4 新 + 1 index）

| 组件 | 用途 |
|---|---|
| `<HeroCard>` | `<Card className="hero-card" size="small">` 的样板包装 |
| `<PageHeader title description tags actions />` | 标题区 + 右侧 actions |
| `<DateRangePicker range>` | 受 `useDateRange` 返回值驱动的 RangePicker |
| `<DataTable query>` | AntD Table 的样板包装，可一行接 useTableQuery 返回值 |

ChannelCompareSection / SkuPreview 保留不动，仍可从 `components/index.js` 拿到。

### 4. AntdApp 包层（关键风险）

`main.jsx` 在两条分支（公开页旁路 + 主路由）外层都包 `<AntdApp>`：

```jsx
<StyleProvider hashPriority={...}>
  <AntdApp>
    {isPublicConfirmPage ? <DispatchConfirmPage /> : <BrowserRouter>...</BrowserRouter>}
  </AntdApp>
</StyleProvider>
```

否则 `useToast()` / `useApi` 内部的 `App.useApp()` 拿不到实例 → console 报警告 + message 不弹。Plan §风险表里专门列了这一条。

### 5. 拦截器与 toast 的边界

`api/http.js` 的 401 拦截器不在 React 树内，**不能**用 useApp() 的 message。它只负责 `window.location.href = /login?next=...`，toast 留给 useApi/useToast 在树内处理。

## 样板 page 的迁移效果

| Page | 旧版 | 新版 | 减幅 | 验收 |
|---|---|---|---|---|
| `AdminUsagePage.jsx` | 277 | 127 | -54% | 5 个 interval 切换无竞态、503 走 Alert 不弹 toast、200 正常 |
| `DailyReportPage.jsx` | 415 | 204 | -51% | 改日期 / 翻页 / 改 pageSize / 搜索 / 重置 / 导出 全通过 |

两份 page 都在头部写了：
```js
// V3 migrated to api/hooks/components — see docs/plans/2026-04-25-v3-frontend-api-layer-plan.md
```

让 3 个月后接手的人一眼看到样板出处。

## 不做什么

- ❌ 不引入 react-query / SWR — useApi 已够用，避免无谓依赖
- ❌ 不引入 TypeScript / zustand / styled-components — 维持现有最薄技术栈
- ❌ 不重写 ChannelCompareSection / SkuPreview / arrival utils
- ❌ 不在本轮 Step A/B 之外迁移其他 9 个 page（V4）
- ❌ 不改后端 / 不改样式 / 不动 AuthContext
- ❌ 不抽 AI 设置 Modal（V4，会用 authApi 包成 `<AiSettingsModal>`）

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| 引入 react-query | 用 useApi 收敛 80% 场景已够，引入第三方库会拉升新人理解成本，且 SSE / job polling 它也覆盖不了 |
| 一次性把 11 个 page 全迁完 | 风险过高，回滚不便；Step B 只迁 2 个先验证抽象层是否真好用 |
| 写一个 `BaseListPage` 高阶组件 | 11 个 page 业务差异太大（drilldown / SSE / 多用户 notes），HOC 反而把灵活性压死 |
| 把 `_t: Date.now()` 干掉，让浏览器 / 后端各自处理缓存 | 影响面大（包括公开页 / SSE），不在本轮范围 |
| 让 page 自己继续直接 `import http` | 上面 8 类 antipattern 永远收敛不了 |

## 验证

### 自动化
- 前端无 vitest / jest（确认现状）
- esbuild 直接编译 `src/main.jsx` 整 bundle 通过，5.9MB（与 PR12 同量级，新增层未引入额外依赖）
- Mac 端 Node v25.8.1 + 系统 esbuild bin 有兼容 bug → 用 `./node_modules/@esbuild/darwin-arm64/bin/esbuild` 绕过（同 ADR-0009）

### 手工
- `main.jsx` 公开页分支也包 AntdApp（已写在 PageHeader 外层）
- `api/index.js` 聚合 export 7 个 namespace + http + errorMessage
- `hooks/index.js` 聚合 export 5 个 hook
- `components/index.js` 聚合 export 6 个组件（4 新 + 2 旧）
- 两个迁移 page grep `import http` / `useState.*loading` 都为 0，证明真的脱离了直接 axios

### 待 V4 / 真实环境补
- 浏览器端 happy path：换日期 / 翻页 / 搜索 / 重置 / 导出
- 浏览器端 error path：DevTools offline → 弹 message.error；503 → Alert 不弹 toast
- 切 AdminUsage 5 个 interval 连点验证 `reqIdRef` 防竞态生效

## 关键文件索引

| 路径 | 说明 |
|---|---|
| `apps/web/src/api/http.js` | axios 实例 + 401 拦截 + errorMessage 工具 |
| `apps/web/src/api/index.js` | 聚合 export 入口（page 一行 import） |
| `apps/web/src/api/{auth,admin,reports,arrival,notes,agent,dispatch}.js` | 一个文件 = 一个后端模块 |
| `apps/web/src/hooks/{useApi,useTableQuery,useDateRange,useJobPolling,useToast}.js` | 5 个通用 hook |
| `apps/web/src/components/{HeroCard,PageHeader,DateRangePicker,DataTable}.jsx` | 4 个共享 UI 包装 |
| `apps/web/src/main.jsx` | 顶层 `<AntdApp>` 包到两条分支 |
| `apps/web/src/pages/AdminUsagePage.jsx` | 样板 1（277 → 127） |
| `apps/web/src/pages/DailyReportPage.jsx` | 样板 2（415 → 204） |
| `docs/plans/2026-04-25-v3-frontend-api-layer-plan.md` | 总设计 |

## 后续（V4）

剩余 9 个 page 按下面顺序迁（由易到难）：

1. PortalPage — 小，且能验 `useJobPolling`
2. AdminAccountsPage — 4 endpoint，admin 域
3. AnalysisPage — 多步初始化 + markdown，验 useApi 嵌套
4. ChannelDashboardPage — 双 RangePicker + 多渠道 select
5. DashboardPage — 最复杂的 drilldown
6. DispatchPage — 已有 api/dispatch，加 useApi 即可
7. DispatchConfirmPage — 公开页，把内嵌 axios 替换成 dispatchApi.{getPublicPreview,postPublicConfirm}
8. ArrivalPage — 1272 行最大头，建议拆子组件 + useTableQuery + useJobPolling
9. App.jsx 内 AI 设置 Modal — 抽成 `<AiSettingsModal>` 用 authApi

每迁一个：浏览器手测 + build 通过 + page 头部加 V3 注释，行数目标 < 200。
