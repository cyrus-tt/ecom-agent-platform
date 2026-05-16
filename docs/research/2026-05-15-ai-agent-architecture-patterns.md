# AI Agent 技术架构模式（2025-2026 最新）

> 调研日期：2026-05-15
> 目的：适配 Node.js + PostgreSQL + React 技术栈的生产级 Agent 架构

---

## 1. Agent 循环模式

Anthropic 划了最清晰的线：**Workflow** 有预定义代码路径；**Agent** 让 LLM 动态指挥执行。

### Workflow（确定性编排）

| 模式 | 适用场景 | Node.js 实现 |
|---|---|---|
| **Prompt 链** | 固定顺序子任务（提取→验证→插入） | async/await 直接串 |
| **路由** | 分类输入后分发到专门处理器 | Express 中间件 / LangGraph 条件边 |
| **并行化** | 独立子任务或投票/集成 | `Promise.all` + LangGraph 并行分支 |
| **编排器-工人** | 子任务在设计时无法预判 | Lead Agent (Opus) 派 Sub-agent (Sonnet) |
| **评估器-优化器** | 输出质量可通过迭代批评改善 | 独立评估节点 |

### Agent 循环（模型指挥）

| 模式 | 机制 | 权衡 |
|---|---|---|
| **ReAct** | 观察-推理-行动循环；工具调用与推理交替 | 灵活但 token 重，延迟线性增长 |
| **Plan-and-Execute** | 先生成完整计划，执行步骤，仅失败时重规划 | 92% 完成率 + 3.6x 加速（vs ReAct）；适应性弱 |
| **LLM Compiler** | 单次规划并行工具执行 | 最低延迟；实现复杂 |
| **多 Agent Supervisor** | 协调者路由到专业 Agent；层级或扁平 | Google 文档化 8 种子模式 |

**生产建议**：可预测多步骤工作流用 Plan-and-Execute。步骤数未知的开放任务用 ReAct。工具集超 ~15 个或需要不同专业知识时才用多 Agent。

---

## 2. Human-in-the-Loop 审批门控

2025-2026 共识模式：**校准自主权** — 高置信/可逆/低风险动作全自主；不确定/不可逆/高风险动作人类审批。

### Node.js 实现方案

| 方案 | 机制 | 适用 |
|---|---|---|
| **LangGraph `interrupt()`** | 暂停图执行，状态持久化到 PostgresSaver，人类输入后恢复 | 紧耦合 Agent 图 |
| **Temporal Signals** | Workflow 调 `condition()` 等待信号；审批通过 API 到达 | 持久化长时工作流（小时/天级） |
| **Cloudflare Workflows** | Serverless 持久化执行 + 内置挂起/恢复 | 边缘部署 Agent |
| **队列 + Webhook** | Agent 写待办到 PG 表，发通知，Webhook 端点恢复执行 | 简单、框架无关、**适配你的 PG 栈** |

### 推荐方案（适配我们的技术栈）

```
Agent 写一行到 agent_approvals 表（action, payload, risk_level, status=pending）
  → React 看板展示待审批项
  → 用户点批准/拒绝
  → Webhook 或轮询 Worker 拿到决定，恢复 Agent 运行
  → PostgreSQL 就是持久化存储，不需要额外基础设施
```

---

## 3. 记忆与状态

### 三层记忆架构

| 层级 | 内容 | 存储 | 生命周期 |
|---|---|---|---|
| **工作记忆** | 当前上下文窗口 | LLM 内存 | 单次运行 |
| **对话记忆** | 线程历史、检查点 | PostgreSQL (LangGraph PostgresSaver) | 每线程 |
| **长期记忆** | 事实、偏好、学到的技能 | PostgreSQL + pgvector 语义检索 | 跨会话 |

### 关键发展

- **Agentic-db**（开源，2026.4）：为 Agent 记忆、对话历史、工具注册、任务编排提供专用 Postgres schema — 全在一个数据库
- **LangGraph checkpointer**：每步自动保存图状态到 Postgres。进程崩溃后从最后检查点恢复
- **统一记忆管理**（AgeMem 模式）：把 `store/retrieve/update/summarize/discard` 暴露为工具，让 LLM 自己决定记什么

**我们的方案**：PostgreSQL 18 已有实例，加 pgvector 扩展就有语义搜索。`memories` 表用 JSONB + vector embedding 存储。

---

## 4. 工具设计最佳实践

Anthropic 的指导：在工具设计（ACI — Agent-Computer Interface）上投入和 Prompt Engineering 一样多的精力。

1. **幂等性**：LLM Agent 15-30% 的工具调用会重试。写操作必须用幂等键或天然幂等（`CREATE IF NOT EXISTS`, `UPSERT`）
2. **丰富错误信息**："Error: permission denied"没用。返回：什么失败了、为什么、Agent 应该尝试什么替代方案
3. **显式 Schema**：不要依赖模型"知道"惯例。在 JSON Schema 描述中指定格式/约束/有效枚举
4. **合适粒度**：一个工具 = 一个动作。避免"上帝工具"接受子命令参数。但也别拆太细
5. **渐进披露**：发现阶段只加载工具元数据（~5K token/50 工具）。Agent 选择工具后才加载完整 schema
6. **确定性包装**：非确定性操作（API 调用、DB 写入）外面包确定性验证层。执行前验证输入，不是执行后

---

## 5. 可观测性

行业收敛到 **OpenTelemetry (OTel)** 作为厂商中立标准，GenAI 特定语义约定正在积极开发。

### Agent 运行的 Trace 结构

```
trace: agent_run
  span: plan (agent 推理)
  span: tool_call (db_query)
    span: llm_call (生成 SQL)
    span: db_execute
  span: tool_call (api_fetch)
  span: synthesize (最终回答)
```

### 实用技术栈

| 层 | 工具 | 原因 |
|---|---|---|
| Trace 采集 | `@opentelemetry/sdk-node` + GenAI 语义约定 | 厂商中立、面向未来 |
| Agent 专用 | LangSmith（用 LangGraph 时）/ Langfuse（开源） | 思维链可视化、成本归因 |
| 后端 | Jaeger / Grafana Tempo（自建）/ Datadog | 关联 Agent 和基础设施 trace |

### 必须追踪的指标

- 每次运行 token 数
- 每次运行成本
- 工具调用成功率
- 人工干预率
- 端到端延迟
- 循环迭代次数（检测失控 Agent）

---

## 6. 调度模式

| 模式 | 触发 | 场景 | 实现 |
|---|---|---|---|
| **Cron** | 时间（`0 9 * * *`） | 日报、数据同步、清理 | `node-cron` 或 PG `pg_cron` |
| **事件驱动** | Webhook/DB trigger/消息队列 | 新订单、文件上传、Slack 消息 | Express webhook → Agent 调用 |
| **自适应** | Agent 完成后输出 `next_run` 时间 | 可变频率监控 | Agent 写下次运行时间到 PG，调度器轮询 |
| **心跳（常驻）** | 固定间隔 | 持续监控、环境 Agent | Temporal Schedules 或 `setInterval` + 状态持久化 |

**生产护栏**：必须设每 Agent 每日预算上限。小时级 Agent 的 bug 可以一夜耗光 API 预算。

**我们的方案**：`node-cron` 做定时 Agent，Express webhook 做事件驱动。状态存 PostgreSQL。需要持久化多步工作流时才上 Temporal。

---

## 7. 护栏

### 四层护栏体系

| 层 | 内容 | 实现 |
|---|---|---|
| **输入验证** | Prompt 注入检测、输入消毒 | Schema 验证 + 分类器 |
| **执行限制** | 最大迭代/token/工具调用/超时 | Agent 循环配置硬编码 |
| **输出验证** | PII 检测、毒性评分、事实核查、schema 合规 | 后生成验证器流水线 |
| **成本控制** | 每次运行 token 预算、每日美元上限、模型降级 | 软限制（降模型）+ 硬限制（杀运行） |

### 关键模式

- **分级约束**：优先级 1 = 安全（无确认不做破坏性操作）> 2 = 正确性 > 3 = 成本 > 4 = 速度
- **熔断器**：Agent 连续 N 次工具调用失败 → 停止运行升级人工，不烧 token 重试
- **死信队列**：失败的 Agent 运行进 PG 表等人工分类，不静默丢弃

---

## 8. 框架对比（Node.js/TypeScript）

| 框架 | 语言 | 甜区 | 生产就绪度（2026） |
|---|---|---|---|
| **LangGraph.js** | TypeScript | 复杂有状态 Agent + 条件路由 + PG 持久化 | 稳定；Replit/Uber/GitLab 在用 |
| **Vercel AI SDK v6** | TypeScript | 单 Agent + 工具，嵌入 Next.js/React | 稳定；`stopWhen` 控制 + MCP 支持 |
| **Mastra** | TypeScript | 全家桶：Agent/RAG/Workflow/Next.js 集成 | 增长中；Serverless 优先 |
| **OpenAI Agents SDK** | TypeScript | OpenAI 原生 + HITL + 交接 | 2026.3 生产就绪 |
| **Claude Agent SDK** | TypeScript | Anthropic 原生 + 记忆（beta） | 2026.1 公开；记忆功能 beta |

### 我们的推荐

- **LangGraph.js** 做 Agent 编排层（图式、PG 检查点、`interrupt()` 做 HITL）
- **Vercel AI SDK** 如果 Agent 更简单且嵌入 React API 路由
- **PostgreSQL** 作为单一持久化层（检查点、记忆、审批队列、可观测性）
- **OpenTelemetry** 从 Day 1 就加上 tracing

---

*来源：Anthropic, Google Cloud, OpenTelemetry, Redis, LangChain, Vercel, Temporal, Cloudflare 等 18+ 源*
