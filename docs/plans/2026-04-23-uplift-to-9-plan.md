# 7→9 分加固 · Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. For parallel independent PRs, use superpowers:subagent-driven-development.

**Goal:** 在 3 周内把 ecom-agent-platform 从 7.0 推到 9.0 分，零生产影响，为部门 40 人推广就绪。

**Architecture:** 10 个独立 PR，每个一个 worktree + 分支，分三周逐步从「铺安全网」→「做危险动作」→「补可观测性」。每个 PR 独立可回滚，合并全部由用户手动审核。

**Tech Stack:** Node 20, Express 4, React 18, Vite 5, PostgreSQL 18, AntD 5, ECharts 5; 新增 pino, zod, bcryptjs, vitest/jest, prom-client, @sentry/node, swagger-ui-express, openapi-types, GitHub Actions。

**Reference:** 设计文档 [`docs/plans/2026-04-23-uplift-to-9-design.md`](./2026-04-23-uplift-to-9-design.md)

---

## 依赖图

```
PR1 (CI)  ──────┐
                ├──→ PR4 (server 拆分)  ──┬──→ PR7 (审计)  ──┐
PR2 (smoke) ────┤                         │                   │
                │                         ├──→ PR8 (可观测)   ├──→ PR10 (API docs + Runbook)
PR3 (pino) ─────┘                         │                   │
                                          PR5 (bcrypt) ──────┤
                                                              │
                                          PR6 (zod) ─────────┤
                                                              │
                                          PR9 (用量统计)  ────┘
```

**关键依赖**：
- PR4 必须在 PR2 合并后才能开始（需要 smoke 测试断行为一致）
- PR4 必须在 PR3 合并后才能开始（日志层已稳定，拆分不需要一并动日志）
- PR7 在 PR4 之后做，因为审计中间件要按新路由结构挂载
- PR9、PR10 可以任意时段插入，无强依赖

**并行机会**：
- PR1 / PR2 / PR3 第 1 周可全部并行开发
- PR5 / PR6 第 2 周中与 PR4 并行（不冲突文件）
- PR9 / PR10 第 3 周可并行

---

## PR 一览表

| # | 主题 | 预估 | 风险 | 阻塞 |
|---|---|---|---|---|
| PR1 | GitHub Actions CI（lint + build + test 占位）| 2h | 零 | 无 |
| PR2 | 5 条关键链路 smoke 测试 | 1 天 | 零 | 无 |
| PR3 | pino 集中日志 | 半天 | 低 | 无 |
| PR4 | server.js 拆 6 个路由文件 | 1-2 天 | 中 | PR2, PR3 |
| PR5 | bcrypt 密码迁移（兼容升级）| 半天 | 中 | PR2 |
| PR6 | zod 参数校验（5 端点）| 半天 | 低 | PR2 |
| PR7 | 操作审计表 + 中间件 | 1 天 | 低 | PR4 |
| PR8 | Sentry + prom-client 指标 | 1 天 | 低 | PR3 |
| PR9 | 用量统计页（管理员）| 1 天 | 零 | PR7 |
| PR10 | OpenAPI + Swagger UI + Runbook | 1 天 | 零 | PR4 |

**总工时估算**：约 9.5 天纯开发，3 周日历时间含审核/修改/Windows 验证缓冲。

---

# 详细任务（今晚执行：PR1 → PR2 → PR3）

---

## PR1 · GitHub Actions CI

**Branch:** `codex/mac/uplift-pr1-ci`
**Worktree:** `/Volumes/tyj/Cyrus/GitHub/ecom-agent-platform-worktrees/pr1-ci`

### 目标

让每个 PR 自动跑 lint + build，CI 红就不能合。当前 `package.json` 的 `test` 脚本是占位符，本 PR 保留它，PR2 才真正改 test 命令。

### Files

- Create: `.github/workflows/ci.yml`
- Modify: `package.json`（添加 `lint` script 占位 + `typecheck` 占位，但不强制失败）
- Create: `docs/adr/0001-introduce-github-actions-ci.md`

### 不做什么

- 不添加任何实际测试（那是 PR2 的事）
- 不要求 web 和 gateway 的 ESLint 严格模式（先让 CI 跑通，严格化是后续的事）
- 不在 Windows 上跑 CI（GitHub Actions ubuntu-latest 足够验证 Node 代码）

### Steps

**Step 1：创建 worktree 和分支**

```bash
git worktree add /Volumes/tyj/Cyrus/GitHub/ecom-agent-platform-worktrees/pr1-ci -b codex/mac/uplift-pr1-ci feature/dispatch-agent
cd /Volumes/tyj/Cyrus/GitHub/ecom-agent-platform-worktrees/pr1-ci
```

**Step 2：写 workflow 文件**

`.github/workflows/ci.yml`：

```yaml
name: CI

on:
  pull_request:
    branches: [feature/dispatch-agent, main]
  push:
    branches: [feature/dispatch-agent]

jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: |
            apps/gateway/package-lock.json
            apps/web/package-lock.json

      - name: Install gateway deps
        run: npm --prefix apps/gateway ci

      - name: Install web deps
        run: npm --prefix apps/web ci

      - name: Gateway syntax check
        run: node --check apps/gateway/server.js

      - name: Build web
        run: npm --prefix apps/web run build

      - name: Tests
        run: npm test
```

**Step 3：修 package.json**（可选）

保持 `test` 脚本为占位符，这是 PR1 的意图（先跑通 pipeline）。

**Step 4：写 ADR**

`docs/adr/0001-introduce-github-actions-ci.md`：

```markdown
# ADR 0001: 引入 GitHub Actions CI

- 日期：2026-04-23
- 状态：已采纳
- 决策者：Cyrus

## 背景

当前仓库无自动化检查，所有 lint / build / test 都靠人工。40 人推广后，改动频率会上升，人工检查必然漏。

## 决策

在 PR 到 `feature/dispatch-agent` 时，GitHub Actions 强制跑：
1. gateway `node --check` 语法检查
2. web `npm run build` 构建
3. 根目录 `npm test`（PR1 仍是占位，PR2 替换为真实测试）

## 替代方案

- **不做**：放弃 → 人工漏检风险大
- **Husky + pre-commit**：只能约束本地，不能约束 PR → 不够
- **私有 CI（Jenkins / GitLab CI）**：需要额外基础设施 → 过度

## 后果

- ✅ 每个 PR 有基础保障
- ✅ 为 PR2 的测试自动化打底
- ⚠️ CI 跑失败时开发者等待（通常 < 5 分钟）
```

**Step 5：本地先验 workflow 语法**

```bash
# 如果装了 actionlint，先本地验
command -v actionlint >/dev/null && actionlint .github/workflows/ci.yml || echo "actionlint 未装，跳过"
```

**Step 6：commit + push**

```bash
git add .github/workflows/ci.yml docs/adr/0001-introduce-github-actions-ci.md
git status --short  # 必须只有这两个文件
git diff --cached --name-only
git commit -m "ci: 引入 GitHub Actions 基础 pipeline（lint + build + test 占位）

- 每个 PR 到 feature/dispatch-agent 自动跑 node --check + web build
- test 脚本保持占位，由 PR2 替换为真实 smoke 测试
- 配 Node 20 锁死版本

ADR: docs/adr/0001-introduce-github-actions-ci.md"
git push -u origin codex/mac/uplift-pr1-ci
```

**Step 7：验证 CI 在远端触发**

打开 `https://github.com/cyrus-tt/ecom-agent-platform/actions` 看 workflow 是否出现并跑绿。

**Step 8：PR 描述模板**

```markdown
## 变更摘要
- 新增 .github/workflows/ci.yml：Node 20 + gateway syntax check + web build
- 新增 docs/adr/0001 记录决策

## 行为影响面
- 零。不动任何运行时代码。

## 给 Cyrus 的 5 步手动验收（Windows 生产机）
1. git fetch origin && git checkout feature/dispatch-agent
2. 本次无需合并到生产，此 PR 只影响仓库自动化，合 PR 到 feature/dispatch-agent 后无需重启服务
3. 合并后到 Actions 页面看历史是否显示 workflow 成功
4. 若以后某 PR CI 失败，不要强制合并
5. （可选）若要手动本地跑：`npm --prefix apps/gateway ci && node --check apps/gateway/server.js && npm --prefix apps/web ci && npm --prefix apps/web run build`

## 回滚脚本
git revert <merge-sha> 即可；CI 消失，无运行时影响。
```

---

## PR2 · 5 条关键链路 Smoke 测试

**Branch:** `codex/mac/uplift-pr2-smoke-tests`
**Worktree:** `/Volumes/tyj/Cyrus/GitHub/ecom-agent-platform-worktrees/pr2-smoke-tests`

### 目标

在不改任何业务代码的前提下，给 5 条最关键链路加 smoke 测试，为后续 PR4（server 拆分）和 PR5（bcrypt）的重构提供安全网。

### 5 条链路

| # | 链路 | 证明什么 |
|---|---|---|
| 1 | 登录 → 拿到 session → 权限检查通过 | 认证没坏 |
| 2 | 日报 `/api/report-daily/*` 能拉到数据（fixture 模式）| 查询层没坏 |
| 3 | 调拨：上传 → 清洗 → 确认 → 完成 | 最核心业务流程没坏 |
| 4 | 分析 Agent：调用 `/api/agent/context` 能拿数据上下文 | AI 链路没坏 |
| 5 | 账号管理：创建 / 修改权限 / 登录新账号 | 管理面没坏 |

### 技术选型

- **测试框架**：`vitest`（快，ESM 原生支持，比 jest 轻）
- **HTTP 测试**：`supertest`（直接对 Express app 跑，不起 socket）
- **数据模式**：`fixture` 模式优先，不依赖 PostgreSQL（Mac CI 里跑）

### Files

- Create: `apps/gateway/tests/smoke/auth.test.js`
- Create: `apps/gateway/tests/smoke/report.test.js`
- Create: `apps/gateway/tests/smoke/dispatch.test.js`
- Create: `apps/gateway/tests/smoke/agent.test.js`
- Create: `apps/gateway/tests/smoke/admin.test.js`
- Create: `apps/gateway/tests/fixtures/*.json`（测试数据）
- Modify: `apps/gateway/package.json`（添加 `vitest`, `supertest` devDeps + `test` script）
- Modify: `package.json`（根的 `test` 改为 `npm --prefix apps/gateway test`）
- Create: `docs/adr/0002-testing-strategy.md`

### 实现策略

由于 `server.js` 2515 行是单体，要对它做 supertest 需要把 Express app 从"启动服务"这一步解耦出来。**这是 PR2 的隐藏难点**。

做法：创建 `apps/gateway/app.js`（导出 Express app 实例），让 `server.js` 变成"调用 app.listen()"的瘦壳。这样 supertest 可以直接 `import app from './app.js'` 跑测试。

这个解耦是 **PR4 拆分的第一步**，但本 PR 只做"导出 app"这一最小步。

### Steps

**Step 1：创建 worktree 和分支**

```bash
git worktree add /Volumes/tyj/Cyrus/GitHub/ecom-agent-platform-worktrees/pr2-smoke-tests -b codex/mac/uplift-pr2-smoke-tests feature/dispatch-agent
cd /Volumes/tyj/Cyrus/GitHub/ecom-agent-platform-worktrees/pr2-smoke-tests
```

**Step 2：安装测试框架**

```bash
npm --prefix apps/gateway install --save-dev vitest supertest
```

**Step 3：抽出 `app.js`**

把 `apps/gateway/server.js` 最后几行的 `app.listen(...)` 那部分抠出来，文件结构：

```
apps/gateway/
├── app.js       ← export default app（app 构建完毕，未 listen）
├── server.js    ← import app + app.listen()（保留启动副作用）
```

注意：
- 不要改 app 的 express 初始化逻辑，纯搬家
- server.js 仍然是入口（`npm run dev` / `npm run start` 都调它）
- Arrival 子进程、PID 写文件等"副作用"仍留 server.js（app.js 纯构建应用）

**Step 4：写每条 smoke 测试**（TDD 顺序）

对每条链路：
1. 先写一个会失败的断言
2. 跑测试确认它失败（因为 fixture 数据还没准备好）
3. 准备 fixture + 设置环境变量让 app 跑 fixture 模式
4. 再跑测试确认通过

示例 `tests/smoke/auth.test.js`：

```javascript
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

let app;
beforeAll(async () => {
  process.env.AGENT_DATA_MODE = 'fixture';
  process.env.AUTH_CONFIG_PATH = './tests/fixtures/auth.fixture.json';
  const mod = await import('../../app.js');
  app = mod.default;
});

describe('smoke: auth', () => {
  it('健康端点 200', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
  });

  it('错误凭证 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'ghost', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('正确凭证登录成功 + 返回权限', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'smoke-admin', password: 'smoke-pass' });
    expect(res.status).toBe(200);
    expect(res.body.permissions).toContain('portal');
  });
});
```

同理写 `report.test.js` / `dispatch.test.js` / `agent.test.js` / `admin.test.js`。

**Step 5：准备 fixture 数据**

- `tests/fixtures/auth.fixture.json`：1 个 smoke-admin 账号（SHA256 hash 的 "smoke-pass"）
- `tests/fixtures/report-daily.fixture.json`：5 行样本日报数据
- `tests/fixtures/dispatch-demand.fixture.xlsx`：最小合法调拨需求文件
- `tests/fixtures/analysis-metrics.fixture.json`：agent 上下文样本

**Step 6：接入 package.json**

`apps/gateway/package.json`：

```json
{
  "scripts": {
    "test": "vitest run --reporter=verbose",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "supertest": "^7.0.0"
  }
}
```

根 `package.json`：

```json
{
  "scripts": {
    "test": "npm --prefix apps/gateway test"
  }
}
```

**Step 7：本地跑全部 smoke**

```bash
cd /Volumes/tyj/Cyrus/GitHub/ecom-agent-platform-worktrees/pr2-smoke-tests
npm test
```

期望：5 条测试全绿，< 10 秒。

**Step 8：写 ADR**

`docs/adr/0002-testing-strategy.md`：记录为什么选 vitest + supertest、fixture 模式优先、为什么先做 smoke 而非单元测试。

**Step 9：commit + push**

```bash
git add apps/gateway/app.js \
         apps/gateway/server.js \
         apps/gateway/tests/ \
         apps/gateway/package.json \
         apps/gateway/package-lock.json \
         package.json \
         docs/adr/0002-testing-strategy.md
git status --short
git diff --cached --name-only
git commit -m "test: 引入 vitest + supertest，5 条关键链路 smoke 测试

- 抽 apps/gateway/app.js 与 server.js 解耦，为 supertest 和后续拆分铺路
- tests/smoke/ 覆盖 登录 / 日报 / 调拨 / 分析 / 账号 五条链路
- 根 npm test 接通，CI 首次能跑真实测试

ADR: docs/adr/0002-testing-strategy.md"
git push -u origin codex/mac/uplift-pr2-smoke-tests
```

**Step 10：PR 描述**（含 5 步验收 + 回滚）

---

## PR3 · pino 集中日志

**Branch:** `codex/mac/uplift-pr3-pino-logging`
**Worktree:** `/Volumes/tyj/Cyrus/GitHub/ecom-agent-platform-worktrees/pr3-pino-logging`

### 目标

替换散落的 `console.log / console.warn / console.error`，引入 pino：
- 结构化 JSON 日志（生产）
- 彩色 pretty 日志（开发）
- 文件滚动（按天 + 按 100MB）
- 保留 `JOB_LOG_LIMIT` 内存环形缓冲（现有 UI 依赖）

### Files

- Create: `apps/gateway/lib/logger.js`
- Modify: `apps/gateway/server.js`（全部 console.* 替换为 logger.*）
- Modify: `apps/gateway/services/dispatch/*.js`（同上）
- Modify: `apps/gateway/services/*.js`（同上）
- Modify: `apps/gateway/package.json`（+ pino, pino-pretty, pino-roll）
- Create: `docs/adr/0003-logging-strategy.md`
- Modify: `.gitignore`（新增 `runtime/logs/*.log`）

### 关键约束

- **不改日志内容语义**：原本 console.log 的每一条，logger.info 后字段保留一致
- **保留任务日志内存环**：`server.js:JOB_LOG_LIMIT=300` 的 UI 接口不变，只是往环里推的时候顺带 logger.info
- **pino 配置支持 PORT + LOG_DIR 环境变量**（为 PR4 双端口部署铺路）

### Steps

**Step 1：创建 worktree 和分支**

```bash
git worktree add /Volumes/tyj/Cyrus/GitHub/ecom-agent-platform-worktrees/pr3-pino-logging -b codex/mac/uplift-pr3-pino-logging feature/dispatch-agent
cd /Volumes/tyj/Cyrus/GitHub/ecom-agent-platform-worktrees/pr3-pino-logging
```

**Step 2：装 pino**

```bash
npm --prefix apps/gateway install pino pino-roll
npm --prefix apps/gateway install --save-dev pino-pretty
```

**Step 3：写 logger.js**

```javascript
// apps/gateway/lib/logger.js
import pino from 'pino';
import path from 'path';
import fs from 'fs';

const isDev = process.env.NODE_ENV !== 'production';
const logDir = process.env.LOG_DIR || path.resolve(process.cwd(), 'runtime/logs');
fs.mkdirSync(logDir, { recursive: true });

const targets = [];
if (isDev) {
  targets.push({
    target: 'pino-pretty',
    level: 'debug',
    options: { colorize: true, translateTime: 'HH:MM:ss.l' }
  });
}
targets.push({
  target: 'pino-roll',
  level: 'info',
  options: {
    file: path.join(logDir, 'gateway.log'),
    frequency: 'daily',
    size: '100m',
    mkdir: true,
    dateFormat: 'yyyy-MM-dd'
  }
});

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { targets }
});

export function childLogger(name) {
  return logger.child({ module: name });
}
```

**Step 4：替换 console.***

对每个文件做机械替换（grep + edit）：
- `console.log(` → `logger.info(`
- `console.warn(` → `logger.warn(`
- `console.error(` → `logger.error(`
- 文件顶添加 `import { logger } from './lib/logger.js'`（gateway 内部按相对路径）

**Step 5：保留任务日志内存环**

`server.js` 中的 `pushJobLog(jobId, line)` 函数保留，改为调用时**同时**:
1. 推到内存环（UI 现有接口依赖）
2. `logger.info({ jobId }, line)`（落盘）

**Step 6：补 smoke 测试验证日志不崩**

在 `tests/smoke/auth.test.js` 里加一条：登录时捕获 stdout，断言 logger 有输出一条 info 级别 entry。

**Step 7：本地跑**

```bash
npm run dev:gateway
curl localhost:3001/healthz
ls runtime/logs/
# 期望看到 gateway-2026-04-23.log 文件
```

**Step 8：写 ADR 0003**

**Step 9：commit + push**

```bash
git add apps/gateway/lib/logger.js \
         apps/gateway/server.js \
         apps/gateway/services/ \
         apps/gateway/tests/ \
         apps/gateway/package.json \
         apps/gateway/package-lock.json \
         .gitignore \
         docs/adr/0003-logging-strategy.md
git status --short
git commit -m "feat(logging): 引入 pino 集中日志 + 文件滚动

- 新增 lib/logger.js：开发 pretty + 生产 JSON + 按日/100MB 滚动
- 全部 console.* 替换为 logger.*，语义保留
- 任务日志内存环保留（UI 依赖），同时落盘
- runtime/logs/ 加入 .gitignore

ADR: docs/adr/0003-logging-strategy.md"
git push -u origin codex/mac/uplift-pr3-pino-logging
```

---

# 后续 PR 概要（实施前会在各自 PR 中细化）

## PR4 · server.js 拆 6 个路由文件

**前置**：PR2 smoke 已绿 + PR3 logger 已稳定
**策略**：纯机械抽取（剪切 + 粘贴），每次抽一个路由组，跑一次 smoke 全绿再抽下一个。
**验证**：拆完后 smoke 全绿，且 API 行为响应 diff（拆前 vs 拆后）逐字段一致。

## PR5 · bcrypt 密码迁移

**策略**：双 hash 兼容：用户表加 `password_bcrypt` 字段，登录时先验 bcrypt，失败则回落 SHA256 验，成功后立即 hash 一次 bcrypt 落盘。新账号直接 bcrypt。
**Feature flag**：`ENABLE_BCRYPT=true` 开关，默认开。关掉可退回纯 SHA256 模式。
**迁移周期**：2 周观察期后清除 SHA256 路径。

## PR6 · zod 参数校验

**策略**：新增 `apps/gateway/schemas/` 目录，为 5 个关键端点（`/api/auth/login`, 调拨的 4 个路由, `/api/agent/run`）写 zod schema，在路由 handler 前加中间件。
**验证**：非法入参从 500 变 400，合法入参不受影响。

## PR7 · 操作审计表 + 中间件

**schema**：

```sql
CREATE TABLE anta_daily.audit_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  user_id TEXT,
  action TEXT,        -- 例如 'auth.login', 'dispatch.create', 'agent.run'
  target TEXT,        -- 例如 task_id, account_id
  ip TEXT,
  user_agent TEXT,
  status_code INT,
  duration_ms INT,
  metadata JSONB
);
CREATE INDEX idx_audit_user_ts ON anta_daily.audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_action_ts ON anta_daily.audit_log(action, created_at DESC);
```

**策略**：全局中间件，按路由名派生 action，status_code 和 duration 从 res 拿，每条请求异步写一行（不 block 响应）。

## PR8 · Sentry 自托管 + prom-client

**策略**：
- Sentry：引入 `@sentry/node`，通过 Express 中间件捕获未处理异常，DSN 从环境变量拿，不配置 DSN 时 Sentry 自动 no-op
- prom-client：暴露 `/metrics`，使用 `promBundle` 自动采集 HTTP RED（rate/error/duration）

**Windows 侧需要**：用户起一个 Grafana（Docker 或本地），按照 Runbook 配 dashboard。

## PR9 · 用量统计页

**前置**：PR7 审计表
**后端**：`GET /api/admin/usage?range=7d` → 聚合审计表 → 按 user_id / action / 日期汇总
**前端**：`AdminUsagePage.jsx` 在 `AdminAccountsPage` 旁边加 tab
**权限**：仅管理员可见

## PR10 · OpenAPI + Swagger UI + Release Runbook

**工具**：`swagger-jsdoc` 从 JSDoc 注释生成 spec，`swagger-ui-express` 提供 UI 在 `/api/docs`

**交付文档**：
- `docs/runbook.md`：日常运维 SOP（重启服务、看日志、发版、回滚）
- `docs/rollout-readiness-report.md`：40 人推广就绪清单（环境、账号、培训材料、应急联系）

---

# 执行协议

**今晚夜间自动推进**：PR1 → PR2 → PR3（纯新增，零生产影响）

每个 PR：
1. 新 worktree + 分支
2. 按上面的 Steps 实施
3. 本地 smoke 全绿
4. commit + push
5. 在 PR 描述里附证据包（变更摘要 / 影响面 / 回滚 / 5 步验收）
6. 报告分支名 + commit hash + 文件列表

**用户明早验收流程**：
1. 检查 3 个 PR 的描述和 diff
2. 任何一个不通过，提问或打回
3. 通过的按顺序合并到 `feature/dispatch-agent`
4. PR1（纯 CI）合了就好；PR2/PR3 合了后可选本地 `npm test` 确认不崩，无需重启生产服务（因为 PR2 只加测试代码 + 抽了 app.js 壳子、PR3 只换日志后端）

**实际生产影响评估**：
- PR1：无（仅 `.github/`）
- PR2：抽 `app.js` 壳子，理论行为零变化；但启动入口微调（server.js → import app.js），需要合完后一次重启服务 **这个要提醒**
- PR3：日志后端从 console 换 pino，需要合完后重启服务确认日志落盘

**建议合并顺序 + 重启策略**：
- 先合 PR1 → 不重启
- 然后合 PR2 + PR3（两个一起合或连续合）→ 重启一次 gateway，按双端口方案：先在 :3002 起新版，smoke 清单打完 → 切

---

# 风险自检（CLAUDE.md 四问）

**Q1 为什么存在？** 每个 PR 在设计文档 §3 都答过「不做会怎样」。

**Q2 失败怎么表现？**
- PR1 失败：CI 跑不起来，不影响任何生产代码
- PR2 失败：smoke 测试本身跑不过 → 不合并，不影响生产
- PR3 失败：日志异常退化为 console（pino 回退），业务不受影响

**Q3 真实环境跑过吗？**
- PR1：CI 在 GitHub Actions 自动跑，PR 页面可见
- PR2：Mac 本地跑过 `npm test`，5 条全绿截图附 PR
- PR3：Mac 本地 `npm run dev:gateway` + curl 验证日志文件生成
- Windows 侧：合并后用户按双端口 + 5 步清单验

**Q4 3 个月后看得懂吗？** 每 PR 配 ADR + PR 描述结构化，commit message 规范。
