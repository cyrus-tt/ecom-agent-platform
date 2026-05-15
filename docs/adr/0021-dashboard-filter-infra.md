# ADR-0021: 看板渠道 + 品类筛选基础设施

**日期**: 2026-05-07
**状态**: Accepted
**关联 PLAN**: docs/plans/2026-05-07-dashboard-filter-infra.md

## 背景

40 位同事共用看板但各自负责不同渠道，全量数据信息过载。需要：
1. 按渠道筛选看板数据
2. 按品类筛选看板数据
3. Admin 可配每个账号的默认渠道

## 决策

### 渠道筛选

数据表的渠道是列名（`sales_women_qty` 等）不是行维度，因此渠道筛选通过**动态拼 SUM 列表达式**实现，而非 WHERE 子句。

- 全量时退化为现有 `DASHBOARD_SALES_AMOUNT_EXPR`（零性能开销）
- 筛选时 GMV = `sum(tag_price * channel_qty * discount)` for 选中渠道

### 品类筛选

行维度 `major_category` + `category` 列，标准 WHERE 参数化查询。

品类结构图和品类变动图只接受渠道过滤不接受品类过滤（它们本身就是按品类聚合展示的）。

### 默认值语义

`default_channels` 是用户登录后的**默认选中项**，不是硬限制。用户可以手动切到其他渠道。

### 缓存

5 个缓存 key 追加 `channels|majorCategory|category` 段。TTL / maxEntries 不变。

## 关键参数

| 参数 | 值 |
|------|-----|
| 渠道数 | 22 个（CHANNEL_DASHBOARD_OPTIONS） |
| 品类层级 | 大类 + 中类（两级联动） |
| 缓存策略 | TTL 5min / maxEntries 120（不变） |
| API 向后兼容 | 不传 channels/category = 不过滤（全量） |

## 影响

- reportRepo.js: 10 个查询函数 + 5 个缓存键 + 6 个新 helper
- server.js: 账号管理 + 5 个 API endpoint
- 前端: AdminAccountsPage + DashboardPage + ChannelDashboardPage + AuthContext
- 无 DB schema 变更
- 无新 npm 依赖
