# ecom-agent-platform 7→9 分加固 · 设计文档

- 日期：2026-04-23
- 作者：Cyrus（产品经理）+ Claude（主驱执行）
- 状态：✅ 设计已审批（2026-04-23）
- 目标基线：`feature/dispatch-agent`（生产分支，40 人在用）
- 设计分支：`codex/mac/uplift-design`

---

## 0. 背景

在对仓库进行一次完整代码审阅后，当前系统自评 **7.0 / 10**：

**优势**：业务闭环真实可用（日报 / 调拨 / AI 分析三条线），文档密度高，数据隐私审计（`apps/gateway/services/agentService.js:37-48`）做得好，跨平台开发模式清晰（local / remote / fixture 三档）。

**硬伤**：
- `apps/gateway/server.js` = 2515 行、`services/reportRepo.js` = 3270 行，单体失控
- 零自动化测试（`package.json:15` 是占位符）、零 CI
- 密码 `sha256()` 无盐、默认密码 `sha256("123")` 硬编码
- 日志仅 `console.log`，后台任务日志只存内存 300 行
- 缓存无主动失效、无 API 契约、无操作审计
- 无可观测性基础（无错误追踪、无基础指标）

**业务背景**：Cyrus 即将在本部门（约 40 人）推广本系统，因此必须：
1. 达到**部门级内部产品**的工程化水准（目标 9.0 分）
2. **过程中零生产影响**（40 人在用，不允许 regress）
3. **3 周内完成**（推广窗口已到）

---

## 1. 目标与非目标

### 目标

| 维度 | 当前 | 目标 |
|---|---|---|
| 可维护性 | server.js 2515 行单体 | 按域拆成 6 个路由文件，每个 ≤ 600 行 |
| 测试 | 0% | 5 条关键链路 smoke 测试 + CI 自动跑 |
| 安全 | SHA256 无盐 | bcrypt + 操作审计表 + 参数校验 |
| 可观测性 | `console.log` | pino 集中日志 + Sentry 错误追踪 + prom-client 指标 |
| 对外契约 | 无 API 文档 | OpenAPI spec + Swagger UI |
| 发版流程 | 手动 PowerShell | GitHub Actions CI + 双端口安全切换 |

### 非目标（明确砍掉，避免 3 周超时）

- ❌ SSO 集成 — 用现有账密 + bcrypt 升级 + 操作审计 = 等效安全
- ❌ `reportRepo.js` 3270 行拆分 — 列 V2 P1，此轮不动
- ❌ Flyway / Liquibase 数据库迁移框架 — 人工 SQL 够用到 40 人规模
- ❌ 多租户、容器化、云部署、K8s
- ❌ OpenTelemetry 链路追踪全家桶 — Sentry + prom-client 已够 B 级
- ❌ 行级权限 — 模块级权限对 40 人场景够用

---

## 2. 硬约束

来自用户的三个不可违反约束：

1. **不能影响生产**：40 人在 `feature/dispatch-agent` 上使用，任何改动必须可秒级回滚
2. **合并必须用户审核**：Claude 可自主建 worktree / 分支 / push，但**合并 PR 必须用户手动按按钮**
3. **急推 3 周内完成**：砍掉所有 nice-to-have，只做到 9 分必需的

### 硬性红线（Claude 执行时不可违反）

- 不直接 push 到 `main` 或 `feature/dispatch-agent`
- 不删除旧代码，用 feature flag 包起来，2 周观察期后再清
- 数据库 schema 只加不改（新表、新列 nullable），绝不 `ALTER` / `DROP`
- 所有合并由用户手动操作
- 代码提交范围严格遵守白名单（`apps/**` / `pipelines/**` / `docs/**` / `ops/windows/**` / `package*.json`）

---

## 3. 分支与 PR 模型

```
main
 └── feature/dispatch-agent  (生产分支，40 人在用)
      ├── codex/mac/uplift-design                (本文件所在分支)
      ├── codex/mac/uplift-pr1-ci
      ├── codex/mac/uplift-pr2-smoke-tests
      ├── codex/mac/uplift-pr3-pino-logging
      ├── codex/mac/uplift-pr4-server-split
      ├── codex/mac/uplift-pr5-bcrypt
      ├── codex/mac/uplift-pr6-zod-validation
      ├── codex/mac/uplift-pr7-audit-log
      ├── codex/mac/uplift-pr8-sentry-metrics
      ├── codex/mac/uplift-pr9-usage-stats
      └── codex/mac/uplift-pr10-openapi
                ↓ push + 提 PR
           ← 用户审 + 手动合并到 feature/dispatch-agent
```

### 每个 PR 必带的证据包

| 项 | 说明 |
|---|---|
| 1. 本地烟囱测试结果 | Mac fixture 模式下 smoke test 全绿的日志 |
| 2. 行为影响面说明 | 哪些接口行为变了、哪些纯重构 |
| 3. 回滚脚本 | `git revert <merge-sha> && npm run ops:stop:saas && npm run ops:start:saas` |
| 4. 5 步手动验收清单 | 用户在 Windows 生产机上执行 |
| 5. ADR 条目 | 决策记录存 `docs/adr/NNN-*.md` |

### 每个 PR 规模约束

- 单个 PR diff 行数 ≤ 1500
- 单个 PR 只做一件事（不打包）
- 若某项工作自然大于 1500 行（如 server.js 拆分），拆成多个 PR 按子模块分批

---

## 4. 3 周 10 PR 发版计划

### 第 1 周 · 铺安全网（不改行为）

先铺测试和日志，给第二周的危险动作提供保护。

| # | PR 主题 | 行为影响 | 风险 | 证据包重点 |
|---|---|---|---|---|
| PR1 | GitHub Actions CI：lint + build + 空测试占位 | 无 | 零 | CI 跑通截图 |
| PR2 | 5 条关键链路 smoke 测试（登录 / 日报查询 / 调拨完整流程 / 分析 Agent / 账号管理） | 无 | 零 | 5 条测试全绿 |
| PR3 | 集中日志 pino（文件滚动 + 控制台），替换所有 `console.log` | 日志目标变了，业务行为不变 | 低 | 日志文件样本 |

### 第 2 周 · 在安全网下做危险动作

| # | PR 主题 | 行为影响 | 风险 | 证据包重点 |
|---|---|---|---|---|
| PR4 | `server.js` 2515 行 → 6 个路由文件（纯抽取，按域拆分） | 零（PR2 smoke 测试断行为一致） | 中 | 拆分前后 API 响应对比 |
| PR5 | bcrypt 密码迁移（SHA256 兼容模式：旧 hash 首次登录自动升级） | 登录流程增加一步，用户无感 | 中 | 兼容性测试（新老账号都能登） |
| PR6 | zod 参数校验（登录 + 调拨 4 端点 + agent/run） | 非法入参从 500 变 400，正常用户无感 | 低 | 合法 / 非法入参测试 |

### 第 3 周 · 可观测性 + 合规 + 对外契约

| # | PR 主题 | 行为影响 | 风险 | 证据包重点 |
|---|---|---|---|---|
| PR7 | 审计表 `audit_log` + 写盘中间件 | 新增一张表，每次 API 写一行 | 低 | 审计条目样本 |
| PR8 | Sentry 自托管 + prom-client `/metrics` | 新端口，Grafana 看板 | 低 | Grafana 截图 |
| PR9 | 用量统计页（管理员）| 新页面 + 新 API，不影响现有 | 零 | 页面截图 |
| PR10 | OpenAPI spec + Swagger UI + Release Runbook | 新增 `/api/docs` | 零 | `/api/docs` 可用 |

### server.js 拆分方案（PR4 详解）

目标拆成 6 个文件，各 ≤ 600 行：

```
apps/gateway/
├── server.js                   (bootstrap only，~200 行)
├── routes/
│   ├── auth.js                 (登录/注销/会话管理)
│   ├── report.js               (日报 + 仪表盘 + 渠道看板)
│   ├── dispatch.js             (调拨 Agent 端点，委托给现有 dispatch/routes.js)
│   ├── analysis.js             (AI 分析相关)
│   ├── admin.js                (账号权限管理)
│   └── ops.js                  (健康检查 + Arrival 代理 + 任务管理)
└── middleware/
    ├── auth.js                 (权限检查中间件)
    ├── logging.js              (请求日志)
    └── errors.js               (错误兜底)
```

**拆分准则**：
- 纯剪切 + 粘贴，不重命名函数、不改签名、不改行为
- 依赖通过构造函数 / 参数注入，不依赖全局状态
- PR2 的 smoke 测试跑前后两版，响应必须**逐字节一致**

---

## 5. 无 staging 的双端口安全切换

由于没有 staging，发版流程设计为：

```
[Windows 生产机当前状态]
生产 gateway 跑在 :3001（40 人在用）

[用户审 PR 通过后]
1. 在 Windows 生产机 pull 最新 feature/dispatch-agent
2. 在 :3002 启动新版 gateway（冷待，不接流量）
3. 用户按 5 步手动烟囱清单打 :3002 验证
4. 确认 OK：
   方案 (a) 切前端环境变量 VITE_API_BASE 指向 :3002，rebuild 前端
   方案 (b) 停 :3001 → 新版占 :3001 → 前端不需改
5. 保留老版 1 小时不 kill（一键回切保险）

[若任一步翻车]
pm2 stop <新版> / taskkill /PID <新版> → 老版还在跑 → 秒级回滚
```

**为此 PR3 会附带做的事**：让 gateway 完整支持 `PORT` 环境变量（当前只支持部分），使双端口部署可行。

---

## 6. 风险控制 · CLAUDE.md 四问对齐

| 四问 | 本计划怎么回答 |
|---|---|
| Q1 这一步为什么存在？能消除吗？ | 每个 PR 的 ADR 开头必须答「不做会怎样」；非目标清单明确砍 |
| Q2 失败怎么表现？能救活吗？ | 每 PR 带 `git revert` 脚本 + 双端口冷待 = 秒回滚 |
| Q3 真实环境跑过吗？ | Mac smoke 覆盖 80%（API 行为、fixture 数据）；**Windows 最后一米只有用户能验**，每 PR 给精确 5 步 |
| Q4 3 个月后看得懂吗？ | 每个大决策写 ADR，`docs/adr/NNN-*.md` 结构化沉淀 |

---

## 7. 子 Agent 并行执行模型

**主对话（本 Claude session）**：总指挥，负责计划、审查、PR 组织、与用户沟通。

**并行子 agent**（通过 Agent 工具调用）：处理可独立完成的工作项。

| 场景 | 并行度 | 子 agent 类型 |
|---|---|---|
| PR2 烟囱测试编写 | 5 个链路同时写 | general-purpose |
| PR4 server.js 拆分 | 6 个路由文件同时抽取 | general-purpose |
| PR10 OpenAPI 注释生成 | 按模块并行 | general-purpose |
| 代码审查 | 关键 PR 额外审 | superpowers:code-reviewer |

### Worktree 布局

```
/Volumes/tyj/Cyrus/GitHub/
├── ecom-agent-platform/                           (主工作目录)
└── ecom-agent-platform-worktrees/
    ├── codex-mac-uplift-pr1-ci/
    ├── codex-mac-uplift-pr2-smoke-tests/
    ├── codex-mac-uplift-pr3-pino-logging/
    └── ... 每个 PR 一个独立 worktree
```

**好处**：多 PR 并行开发不冲突，可以同时有 2–3 个 PR 在不同阶段（PR3 在审、PR4 在写、PR5 在测）。

---

## 8. 验收协议

每个 PR 的标准流程：

```
[1] Claude 在 worktree 完成开发
[2] Claude 本地 Mac 跑全部 smoke → 截图放 PR 描述
[3] Claude push + 提 PR，内含：
    - what changed / what didn't
    - 5 步手动验收清单（给用户）
    - 回滚脚本
    - ADR
[4] 用户审 PR，提问或要求修改
[5] 用户合并 PR 到 feature/dispatch-agent
[6] 用户到 Windows 生产机 pull
[7] 用户按双端口方案 + 5 步清单验证
[8] 用户告诉 Claude"合了没问题"或"回滚了，因为 X"
[9] Claude 进入下一个 PR
```

### PR 节奏预期

- 用户每天晚上集中审 1–2 个 PR，或随机时段审
- Claude 白天推进 1–2 个 PR 到 ready-for-review
- 3 周时间预算：10 PR / 21 天 = 每 2 天 1 个 PR，留 1 天缓冲

---

## 9. 最终交付清单

**代码层**
- 10 个 PR 全部合并，生产 0 事故
- `apps/gateway/server.js` 拆分完成，单文件 ≤ 600 行
- 测试覆盖至少 5 条关键链路，CI 强制通过
- 密码全部迁到 bcrypt，审计表有完整条目

**文档层**
- `docs/adr/` 下每个大决策一个 ADR
- `docs/rollout-readiness-report.md`：40 人推广就绪清单
- `docs/runbook.md`：运维 SOP（出故障时看哪个日志、重启哪个服务、怎么回滚）
- `/api/docs`：OpenAPI Swagger UI 可访问

**自评**
- 按原 rubric 重新评分，证明 ≥ 9.0
- 列出仍有的短板（V2 P1 清单，供后续迭代）

---

## 10. 环境基线

确认过的生产/开发环境参数，写入 CI 锁死：

- Node.js: **20.x**（`package.json:engines` 已约束）
- PostgreSQL: **18.x**（生产环境 Windows 机器）
- npm: 随 Node 20 附带
- 操作系统：
  - 生产：Windows（PowerShell 脚本 `ops/windows/`）
  - 开发：macOS（当前这台 Mac）

---

## 11. 下一步

本设计文档审批后：

1. 本文件 commit 到 `codex/mac/uplift-design` 分支 + push
2. 合并本 PR 到 `feature/dispatch-agent`（用户操作）
3. 调用 `superpowers:writing-plans` skill，把本设计拆成 10 个可执行 task spec（每个对应一个 PR）
4. 开始 PR1（GitHub Actions CI）

---

## 附录 A · 评分 rubric（用于 3 周末自评）

| 维度 | 当前 7.0 | 目标 9.0 | 验证手段 |
|---|---|---|---|
| 代码可维护性 | server.js 2515 行 | 各路由文件 ≤ 600 行，职责单一 | 行数 + 职责说明 |
| 测试覆盖 | 0% | ≥ 5 条关键链路 smoke 全绿 | CI 跑 10 次无 flaky |
| CI/CD | 无 | lint + test + build 每 PR 强制 | GitHub Actions 历史 |
| 日志与错误追踪 | console.log + 300 行内存 | pino 文件滚动 + Sentry | 日志文件 + Sentry dashboard |
| 基础指标 | 无 | prom-client /metrics + Grafana RED | Grafana 截图 |
| 参数校验 | 无 | zod 覆盖 5+ 关键端点 | 非法入参返回 400 |
| 密码安全 | SHA256 无盐 | bcrypt + 兼容升级 | 测试新老账号登录 |
| 操作审计 | 无 | audit_log 表 + 全端点中间件 | 审计条目样本 |
| API 文档 | 无 | OpenAPI + Swagger UI | `/api/docs` 可访问 |
| 用量可视 | 无 | 管理员页面展示使用频次 | 截图 |
| 回滚能力 | 手动 | 每 PR 一键 revert + 双端口冷待 | 每 PR 回滚脚本 |
| 文档完备 | 架构文档有 | + ADR + Runbook + Rollout Readiness | 文档列表 |
