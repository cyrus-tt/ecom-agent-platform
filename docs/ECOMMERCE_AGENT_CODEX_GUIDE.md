# ECOMMERCE_AGENT_CODEX_GUIDE

> 唯一真实规划源（Single Source of Truth）
>
> 最后更新：2026-03-07
> 维护方式：Claude 规划 + Codex 执行 + 本文档滚动同步

## 1) 项目目标与边界

### 目标
- 在现有网关内落地可持续迭代的电商经营系统：数据看板 + 经营分析 Agent。
- 支持业务日常使用与企业级立项评审（可解释、可扩展、可治理）。

### 当前硬约束
- 本地部署、局域网访问。
- 继续使用会话鉴权（本阶段不切 JWT / RBAC）。
- AI 出站数据最小化：仅聚合指标，不发送 SKU/款号/品名等明细字段。
- 数据层沿用 `ecom_dashboard_v2` + `anta_daily`。

---

## 2) 当前状态快照（截至 2026-03-07）

### 已落地（Done）
- [x] 会话鉴权与 `/api/auth/*`。
- [x] 日报能力 `/api/report-daily/*` 与 legacy 页面 `/report-daily`。
- [x] Agent 三接口：
  - `POST /api/agent/run`
  - `GET /api/agent/reports`
  - `GET /api/agent/reports/:id`
- [x] Agent 报告入库 `anta_daily.analysis_reports`（含 `metrics_json/report_md/status/error_msg/created_at`）
- [x] Analysis 页面闭环（生成、失败提示、历史回看）。
- [x] DeepSeek 接入（`openai` SDK + `baseURL`），温度与超时已限制。
- [x] 出站审计校验（拦截 `sku/style/product_name` 等敏感字段）。

### 本轮新增（已实现）
- [x] Dashboard API：
  - `GET /api/dashboard/dates`
  - `GET /api/dashboard/overview?anchor_date=YYYY-MM-DD`
- [x] 看板口径：
  - 日环比：`D` vs `D-1`
  - 周环比：`[D-6, D]` vs `[D-13, D-7]`
- [x] 看板聚合缓存：短 TTL 内存缓存（45s）。
- [x] React + Vite 前端（`client`）承接：`/`、`/dashboard`、`/analysis`。
- [x] 网关托管 React 构建产物，`/report-daily` legacy 保留兼容。
- [x] 门户补充“数据可视化看板”入口。

---

## 3) 阶段路线图（重排后）

## Phase FE-1（视觉与路由升级）

### 目标
- 完成 React 基础壳层与企业风格门户。
- 路由切换到 React 承接：`/`、`/dashboard`、`/analysis`。
- 保留 `/report-daily` 不中断。

### 验收
- React 页面可在网关直接访问。
- 门户四入口完整：日报主表/新品看板/经营分析/数据可视化看板。
- 登录态与会话行为不回退。

### 回滚策略
- 网关路由切回 `public/*.html`（保留旧文件）。
- 保持 `/api/*` 不变。

状态：`进行中（主体完成，需持续打磨 UI 与交互细节）`

---

## Phase FE-2（Dashboard 与对比指标）

### 目标
- 提供单接口聚合看板数据，前端一次请求完成展示。
- 落地 KPI、日/周对比、趋势与品类结构/升降榜。

### 固定响应结构
- `meta`: `anchor_date`、`day_date`、`week_range_current`、`week_range_prev`
- `kpis`: `gmv/qty/sell_through/discount_rate`
  - 每项含 `current/day_prev/day_pct/week_prev/week_pct`
- `trends_daily`: 近30天
- `trends_weekly`: 近12周
- `category_structure`
- `category_movement` (`rising`/`falling`)

### 验收
- 指标字段完整且口径一致。
- 空数据与异常状态前端可视化可读。
- 看板首屏可渲染、链路可用。

### 回滚策略
- 关闭 `/dashboard` 新入口，仅保留旧页。
- 新 API 可保留但前端不调用。

状态：`已实现第一版，可进入性能与视觉深水区优化`

---

## Phase FE-3（全量迁移与性能优化）

### 目标
- 统一前端体验与组件规范。
- 建立性能基线并持续优化（首屏、包体、图表渲染）。

### 重点项
- 代码分割（按路由懒加载）、图表按需加载。
- 表格与图表低/高数据量稳定性验证。
- 错误态/空态/加载态标准化与埋点。

### 验收
- Dashboard 与 Analysis 在桌面/移动断点可用。
- 首屏交互耗时、API 响应耗时纳入验收记录。

### 回滚策略
- 可独立回滚到 FE-2 稳定版本（接口兼容不变）。

状态：`待启动`

---

## 4) 企业级差距清单（立项关注）

| 领域 | 当前 | 目标 | 差距等级 |
|---|---|---|---|
| 权限模型 | 单账号会话 | RBAC（admin/analyst/viewer） | 高 |
| 任务执行 | 同步请求 | 异步任务队列 + 状态机 + 重试 | 高 |
| 可观测性 | 基础日志 | 结构化日志 + tracing + metrics + 告警 | 高 |
| 审计留痕 | 局部日志 | 全链路审计（请求/出站/变更） | 高 |
| 部署规范 | 本机启动脚本 | PM2/服务化/发布回滚SOP/健康检查 | 中 |
| 性能治理 | 暂无基线 | 明确 SLA 与容量评估 | 中 |
| 测试体系 | 以联调为主 | API 合约 + 指标口径 + E2E 自动化 | 高 |

---

## 5) 下一阶段执行清单（建议直接排期）

1. FE-3 第一轮：
- 路由懒加载、图表按需拆包、包体降重。
- Dashboard 组件化（KPI/趋势/结构区分模块）。

2. 可观测性底座：
- 接口耗时日志、错误分类、慢 SQL 指标落盘。
- 为 `/api/dashboard/overview` 和 `/api/agent/run` 增加追踪 ID。

3. 企业级能力预研：
- RBAC 数据模型与最小权限矩阵。
- Agent 异步化（队列/任务表/轮询或推送）。

4. 立项材料补证据：
- 截图与录屏（门户、看板、分析页全链路）。
- 指标口径说明文档 + 样例 SQL 对账结果。

---

## 6) 操作约定（对 Codex）

- 仅增量修改，不破坏现有可用链路。
- 不提交真实密钥，不修改 `.env` 实值。
- 每轮迭代后同步本文档：
  - 已完成项打勾
  - 新风险与回滚策略补齐
  - 下一里程碑明确到可验收条目