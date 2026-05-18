# PLAN · 每日自动巡检 + Agent 操控台（Phase 2A+2C）

**PROGRESS 编号**：F-AGENT-INSPECT
**创建于**：2026-05-16
**Deadline**：—
**状态**：🟡 approved（2026-05-16 Cyrus /goal 指令）

---

## 1. 一句话任务

Agent 每日自动巡检经营数据异常（销售下跌/库存告警/新品零销售），前端新增 Agent 操控台展示巡检简报、异常清单和活动时间线。

## 2. 为什么做（Why）

Cyrus（2026-05-16）明确目标：
- **现状**：Agent 只在用户提问时才工作，不会主动发现问题
- **目标**：打开平台第一眼就看到"今日 3 个异常需关注"，而不是自己去翻数据
- **AI-native 进阶**：从"用户驱动 → AI 执行"进化为"AI 主动巡检 → 用户确认"

## 3. 边界（不做什么）

- ❌ 不做审批执行流（Phase 2B，本期只报告异常 + 建议，不自动执行）
- ❌ 不做钉钉/微信推送通知（后续接入，本期只在平台内展示）
- ❌ 不调 LLM 做巡检分析（纯规则引擎 + SQL，快速可靠，不花 API 费用）
- ❌ 不做历史趋势图（本期列表 + 卡片，图表留后续迭代）
- ❌ 不改现有 AnalysisPage（操控台是独立新页面）

## 4. 方案步骤

### S1 — 巡检数据表（SQL）

新建 `pipelines/pg-daily-wide/sql/11_agent_inspection_tables.sql`：

```sql
-- 巡检运行记录
CREATE TABLE IF NOT EXISTS anta_daily.agent_inspections (
  id            serial PRIMARY KEY,
  run_date      date NOT NULL,
  anomaly_count integer DEFAULT 0,
  summary       text,
  findings      jsonb,
  status        varchar(20) DEFAULT 'completed',
  created_at    timestamptz DEFAULT now()
);

-- 异常明细
CREATE TABLE IF NOT EXISTS anta_daily.agent_anomalies (
  id              serial PRIMARY KEY,
  inspection_id   integer REFERENCES anta_daily.agent_inspections(id),
  type            varchar(50) NOT NULL,
  severity        varchar(20) NOT NULL,  -- critical / warning / info
  title           varchar(200) NOT NULL,
  description     text,
  metric_current  numeric,
  metric_previous numeric,
  change_pct      numeric,
  suggested_action text,
  status          varchar(20) DEFAULT 'open',
  created_at      timestamptz DEFAULT now()
);
```

### S2 — 巡检引擎（后端）

新建 `apps/gateway/services/inspection/engine.js`：

纯 SQL + 规则引擎，不调 LLM。检测 4 类异常：

| 类型 | 规则 | 严重度 |
|---|---|---|
| `sales_drop_dod` | 渠道/品类日销同比下跌 >10% | warning; >25% = critical |
| `sales_drop_wow` | 渠道/品类周同比下跌 >15% | warning; >30% = critical |
| `zero_sales_sku` | 有库存但连续 7+ 天零销售的 SKU 数量 | warning |
| `new_product_underperform` | 上架 14 天内零销售的新品 | info; 上架 7 天以上 = warning |

每类异常输出：type, severity, title, description, metric_current, metric_previous, change_pct, suggested_action。

### S3 — 定时调度器（后端）

新建 `apps/gateway/services/inspection/scheduler.js`：

- 用 `node-cron` 定时运行（默认每日 09:00，可通过 env `INSPECTION_CRON` 配置）
- 调用 engine.js 执行巡检
- 结果写入 agent_inspections + agent_anomalies 表
- 如果 PG 不可用，降级到 JSON 文件输出（`runtime/inspections/`）
- 暴露 `runNow()` 方法供手动触发

### S4 — API 端点（后端）

在 `apps/gateway/routes/inspection.js` 新增：

| 端点 | 方法 | 功能 |
|---|---|---|
| `/api/agent/inspections` | GET | 最近 30 天巡检列表 |
| `/api/agent/inspections/latest` | GET | 最新一次巡检 + 异常明细 |
| `/api/agent/inspections/:id` | GET | 指定巡检 + 异常明细 |
| `/api/admin/inspection/run` | POST | 手动触发巡检（admin） |
| `/api/agent/activity` | GET | Agent 活动时间线（合并 agent_runs + inspections） |

### S5 — Agent 操控台前端

新建 `apps/web/src/pages/AgentDashboardPage.jsx`，路由 `/agent-dashboard`：

**布局（从上到下）：**

1. **今日简报卡片**
   - 巡检状态（今日是否已跑）、异常数量（按严重度分色）
   - 关键指标快照：昨日总 GMV / 环比 / 异常渠道数

2. **异常清单**
   - 列表展示每条异常：严重度 badge（🔴/🟡/🔵）+ 标题 + 指标变化 + 建议动作
   - 可展开详情
   - 后续 Phase 2B 在这里加"批准/拒绝"按钮

3. **Agent 活动时间线**
   - 合并展示：自动巡检记录 + 用户触发的 Agent 分析
   - 每条记录：时间、类型、摘要、工具调用次数

4. **历史巡检列表**
   - 日期列表，点击查看历史巡检详情

### S6 — 路由注册 + 导航

- `apps/gateway/server.js` 注册 inspection 路由 + 启动调度器
- `apps/web/src/App.jsx` 添加 `/agent-dashboard` 路由
- 门户页加入操控台入口（图标 + 导航）
- `apps/web/src/auth/modules.js` 添加 `agent_dashboard` 权限模块

## 5. 涉及文件 / 资源

**新建：**
- `pipelines/pg-daily-wide/sql/11_agent_inspection_tables.sql`
- `apps/gateway/services/inspection/engine.js`
- `apps/gateway/services/inspection/scheduler.js`
- `apps/gateway/routes/inspection.js`
- `apps/web/src/pages/AgentDashboardPage.jsx`

**修改：**
- `apps/gateway/server.js` — 注册路由 + 启动调度
- `apps/web/src/App.jsx` — 新路由
- `apps/web/src/auth/modules.js` — 新权限模块
- `apps/web/src/pages/PortalPage.jsx` — 加操控台入口
- `apps/web/src/styles.css` — 操控台样式
- `apps/gateway/package.json` — 加 node-cron

**测试：**
- `apps/gateway/tests/smoke/inspection.test.js`

## 6. 验收标准

- [ ] 手动 POST `/api/admin/inspection/run` → 巡检执行 → 返回异常列表
- [ ] GET `/api/agent/inspections/latest` 返回最新巡检 + 异常明细
- [ ] 前端 `/agent-dashboard` 页面正常渲染：简报卡片 + 异常清单 + 时间线
- [ ] 异常清单按严重度排序（critical > warning > info），颜色正确
- [ ] 门户页有操控台入口，点击跳转正确
- [ ] node-cron 调度器在网关启动时注册（不阻塞启动）
- [ ] Mac 端测试全绿
- [ ] Cyrus 在 Windows 公司机验收通过

## 7. 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | Mac 端没有 PG，巡检 SQL 跑不了 | engine.js 检测 PG 不可用时返回空结果 + fixture mock |
| R2 | node-cron 在 Windows 服务重启后丢失 | 调度器随 server.js 启动自动注册，不依赖外部 cron |
| R3 | 巡检 SQL 在大数据集上慢 | 复用现有索引 + LIMIT + 只查最近 30 天 |

## 8. 回滚方案

- 分支：`codex/mac/feat-agent-inspect`
- DB：DDL 全用 IF NOT EXISTS，回滚 = DROP TABLE（不影响现有表）
- 前端/后端：全是新文件 + 小改动，revert commit 即可

---

## 执行日志
