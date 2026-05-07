# PLAN · 可视化看板筛选基础设施（渠道 + 品类 + 人员默认绑定）

**PROGRESS 编号**：F-DASH-FILTER
**创建于**：2026-05-07
**Deadline**：2026-05-14
**状态**：🔵 in-progress（2026-05-07 Mac 端 S1-S9 全完成 + push origin，待 Cyrus Windows 验收）

---

## 1. 一句话任务

所有看板图表支持渠道 / 品类（大类+中类）筛选，Admin 页可配每个账号的默认渠道，登录后自动带入；架构预留未来店铺粒度扩展口。

## 2. 为什么做（Why）

Cyrus（2026-05-07）提出 5 个看板增强需求，本 PLAN 覆盖其中 #1（渠道筛选 + 人员默认绑定）和 #4（品类筛选），是后续 #3（对比引擎）和 #5（重点 IP 监控）的前置基础设施。

痛点：当前 40 个用户看到的是同一份全量数据，每人负责不同渠道却无法只看自己的，信息过载、效率低。

## 3. 边界（不做什么）

- 不做店铺粒度筛选（当前数据表没有店铺列，预留 `filter_scope` 扩展口即可）
- 不做对比区间 / 对比类型（PR-2 单独做）
- 不做重点 IP 监控区块（PR-3 单独做）
- 不做 DailyReport / Analysis 页面的筛选（这两个页面暂不需要）
- 不改 PG schema（纯应用层改动）
- 不引新 npm 依赖
- 不改洗码小程序（暂搁）

## 4. 方案步骤

### S1 — 账号结构扩展（auth.json + server.js）

- auth.json 每个 account 对象新增字段：
  - `default_channels: string[]`（渠道 code 数组，空 = 全部）
  - `default_categories: string[]`（品类名数组，空 = 全部）
- server.js 修改点：
  - `sanitizeAccountForClient()` 输出新字段
  - `createManagedAccount()` 接收新字段
  - 新增 `updateManagedAccountDefaults(accountId, { default_channels, default_categories })`
  - 新增 API `PATCH /api/admin/accounts/:accountId/defaults`
  - `createSession()` + `buildAuthMePayload()` 传递新字段到前端
- 语义：`default_channels` 是**用户登录后的默认选中项**，不是硬限制；用户可在页面上手动切换到其他渠道（只要有模块权限）

### S2 — 前端 AuthContext 扩展

- `normalizeAuthPayload()` 解析 `default_channels` / `default_categories`
- AuthContext value 暴露 `auth.defaultChannels` / `auth.defaultCategories`

### S3 — reportRepo.js SQL 层：渠道 + 品类过滤

需要改动的查询函数（共 10 个）：

| 函数 | 行号 | 改动 |
|------|------|------|
| `queryDashboardOverviewMetrics` | 2480 | inventory CTE + sales CTE 加 WHERE |
| `queryDashboardDailyTrend` | 2534 | 加 WHERE |
| `queryDashboardWeeklyTrend` | 2570 | 加 WHERE |
| `queryDashboardCategoryStructure` | 2632 | 加渠道 WHERE（不加品类 — 此函数本身展示品类分布） |
| `queryDashboardCategoryMovement` | 2682 | 加渠道 WHERE（同上理由） |
| `buildDashboardDrilldownBaseSql` | 1189 | 加渠道 WHERE |
| `buildChannelDashboardSql` | 1534 | 加品类 WHERE |
| `buildChannelDashboardCombinedSql` | 1695 | 加品类 WHERE |
| `buildChannelDashboardStyleDrilldownBaseSql` | 1831 | 加品类 WHERE |
| `buildDashboardCompareDimensionSql` | 2228 | 加品类 WHERE |

渠道过滤方式：当前数据表的渠道是列名（`sales_women_qty`、`sales_outdoor_qty`...），不是行维度。所以渠道筛选 = 在 SUM 聚合时只加选中渠道的列（动态拼 SQL 表达式），而非 WHERE 子句过滤行。

具体做法：
- 新增 `buildFilteredSalesAmountExpr(channelCodes)` 和 `buildFilteredNetQtyExpr(channelCodes)`
- 当 `channelCodes` 为空或全选时，退化为现有的 `DASHBOARD_SALES_AMOUNT_EXPR` / `DASHBOARD_NET_QTY_EXPR`
- 当选了部分渠道时，只 SUM 选中渠道对应的列

品类过滤方式：WHERE `major_category = $X` AND/OR `category = $Y`（标准行过滤）。
- 品类结构图（`queryDashboardCategoryStructure`）和品类变动（`queryDashboardCategoryMovement`）：只加渠道过滤，不加品类过滤（它们本身就是按品类聚合展示的，加了品类过滤就只剩一行）
- 其他函数：渠道 + 品类都加

### S4 — 入口函数 + 缓存键扩展

- `getDashboardOverview`、`getDashboardDrilldown`、`getDashboardChannelCompare`、`getChannelDashboard`、`getChannelDashboardStyleDrilldown` 五个入口函数加 `selectedChannels` + `selectedCategories` 参数
- 对应 5 个 `makeCacheKey` 函数追加 channels / categories 到 key
- 缓存 TTL / maxEntries 不变（沿用 ddc4813 的 5min / 120）

### S5 — server.js API 层加查询参数

所有看板 API endpoint 加可选查询参数：
- `channels`（逗号分隔渠道 code，如 `women,outdoor`）
- `major_category`（大类名）
- `category`（中类名）

缺省值 = 空 = 不过滤（全量），与现有行为完全兼容。

### S6 — Admin 权限管理页 UI

- `GET /api/admin/accounts` 响应新增 `available_channels[]` 和 `available_categories[]`（从 reportRepo 现有 CHANNEL_OPTIONS 常量 + 数据库 distinct category 获取）
- AdminAccountsPage.jsx 每个账号行新增「默认渠道」多选 Tag + 「默认品类」多选 Tag
- 保存调 `PATCH /api/admin/accounts/:accountId/defaults`

### S7 — Dashboard 页筛选器 UI

- DashboardPage.jsx 顶部新增：
  - 渠道多选下拉（初始值 = `auth.defaultChannels`，空 = 全部）
  - 品类两级联动下拉：大类 → 中类（初始值 = `auth.defaultCategories`，空 = 全部）
- 选中后所有 API 调用追加 `channels` / `major_category` / `category` 参数
- 页面内所有图表 / KPI / 表格联动刷新
- 品类结构图 + 品类变动区块：只传渠道不传品类

### S8 — ChannelDashboard 页筛选器 UI

- ChannelDashboardPage.jsx 顶部新增：
  - 品类两级联动下拉（渠道筛选该页已有 — 就是 channel 多选）
  - 初始值 = `auth.defaultCategories`
- 选中后 API 调用追加 `major_category` / `category` 参数
- 该页的渠道选择器初始值改为 `auth.defaultChannels`（当前是空 = 让用户手选）

### S9 — Mac 端验证 + ADR

- `node --check` server.js + reportRepo.js
- esbuild web build 全绿
- 手动 behavior smoke：带 channels/category 参数请求看板 API，验证返回数据只含选中渠道/品类
- 写 ADR-0021

## 5. 涉及文件 / 资源

- 后端核心：`apps/gateway/services/reportRepo.js`（10 个查询函数 + 5 个缓存键 + 2 个新 helper）
- 后端 API：`apps/gateway/server.js`（账号管理 + 看板 endpoint 参数）
- 配置：`apps/gateway/config/auth.json`（账号字段扩展）
- 前端认证：`apps/web/src/auth/AuthContext.jsx`
- 前端页面：`apps/web/src/pages/DashboardPage.jsx`、`ChannelDashboardPage.jsx`、`AdminAccountsPage.jsx`
- 文档：`docs/adr/0021-dashboard-filter-infra.md`
- 外部依赖：无

## 6. 验收标准（全打 ✅ 才算完成）

### 后端
- [ ] V1：不传 channels/category 参数时，API 返回与改动前完全一致的数据（向后兼容）
- [ ] V2：传 `channels=women,outdoor` 时，Dashboard overview KPI 只含女子+户外渠道的销售数据
- [ ] V3：传 `major_category=运动鞋` 时，Dashboard overview 只含运动鞋大类数据
- [ ] V4：渠道 + 品类组合筛选时数据正确（交集）
- [ ] V5：品类结构图 API 传了渠道但不传品类时，仍返回全品类分布（只是每个品类的数字是选中渠道的）
- [ ] V6：`PATCH /api/admin/accounts/:id/defaults` 正确存储 + 读取

### 前端
- [ ] V7：Admin 页可为每个账号配默认渠道 + 默认品类，保存后刷新不丢
- [ ] V8：Dashboard 页登录后自动带入默认渠道/品类，图表数据对应
- [ ] V9：ChannelDashboard 页登录后渠道选择器自动带入默认值，品类筛选器可用
- [ ] V10：手动切换筛选器后数据即时刷新，切回"全部"恢复全量

### 工程
- [ ] V11：Mac 端 `node --check` server.js + reportRepo.js 双绿
- [ ] V12：esbuild web build 通过
- [ ] V13：Cyrus 在 Windows 公司机 git pull + 启动 + 手测 V1-V10 通过
- [ ] V14：ADR-0021 已 commit

## 7. 风险 / 阻塞

| # | 风险 | 缓解 |
|---|------|------|
| R1 | 渠道是列名不是行维度，SQL 拼接复杂度高 | 封装 `buildFilteredSalesAmountExpr()` 统一处理，unit 级 smoke 验证正确性 |
| R2 | 缓存 key 变长导致内存略增 | maxEntries 120 不变，key 只多几十字节，可忽略 |
| R3 | 品类名含特殊字符 / 空格 | SQL 用参数化查询（$N），不拼接字符串 |
| R4 | 现有 10 个账号的 auth.json 缺新字段 | 代码读取时 fallback 空数组，0 迁移成本 |
| R5 | Dashboard 品类两级联动需要品类列表 API | 新增 `GET /api/dashboard/category-options` 从数据库 DISTINCT 查 |

阻塞：无。全部改动在应用层，不依赖 PG schema 变更。

## 8. 回滚方案

- 分支：`codex/mac/feat-dash-filter`，revert 整个分支的 commit 即可
- DB：无 schema 变更
- 配置：auth.json 新增字段向后兼容（代码读不到就 fallback 空数组），不需要回滚配置
- 缓存：重启 gateway 自动清空

---

## 执行日志（动手后追加）

