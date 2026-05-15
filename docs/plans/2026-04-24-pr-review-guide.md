# PR 审核指南 · 12 个 PR 合并到 feature/dispatch-agent

> 给 Cyrus 2026-04-24 早晨用。一句话：按下面的**真实 base 链顺序**合，不是按编号顺序合。
> 预计通读 10 分钟，单 PR 审核 5-15 分钟，12 个 PR 全合 1-2 小时（含 CI 等待）。

---

## ⚠️ 先读这块（硬约束）

1. **目标 base 分支**: `feature/dispatch-agent`（**不是** `main`）
2. **合并顺序按 base 链，不按编号**：
   - 独立先合：**PR1**（CI 配置，sibling，无依赖）
   - 主链顺序：**PR2 → PR3 → PR4 → PR5 → PR6 → PR7 → PR10 → PR8 → PR9 → PR11 → PR12**
   - 注意：**PR10 (docs) 插在 PR8 之前**！这是因为 PR10 是先写的，PR8/PR9 在 PR10 之上叠加了 prom-client/Sentry/用量统计。
3. **禁用 "Squash and merge"** —— 会把每个 PR 的所有 commit 压成 1 个，下一个 PR 的 parent 就在 main 上找不到，整条链断，后续 PR merge 时会看到重复 diff 或大量冲突。
4. **推荐 "Create a merge commit"**（省事）或 **"Rebase and merge"**（线性历史）—— 见下节对比。
5. **合 PR1 前先把 CI secret 配好**（如果要 GitHub Actions 真的跑测试；否则 workflow 会 fail 但不影响合并）。

---

## 真实 base 链（git 亲自验证过）

```
feature/dispatch-agent (current HEAD: a1a5afe)
  │
  ├─ PR1  · 042ab7b · uplift-pr1-ci              (.github/workflows/ci.yml + ADR-0001)
  │
  └─ PR2  · fd0b4e4 · uplift-pr2-smoke-tests     (vitest + supertest + 25 smoke)
       └─ PR3  · c9b3e57 · uplift-pr3-pino-logging (pino + 15 console.* 迁移)
            └─ PR4  · 8150be7 · uplift-pr4-server-split (server.js 2524→1658 行)
                 └─ PR5  · f75e139 · uplift-pr5-bcrypt (bcrypt 首登升级)
                      └─ PR6  · a990806 · uplift-pr6-zod (zod + 2 端点)
                           └─ PR7  · e93069e · uplift-pr7-audit (审计日志双 sink)
                                └─ PR10 · dff5684 · uplift-pr10-docs (OpenAPI + Swagger + Runbook)
                                     └─ PR8  · 4ab5770 · uplift-pr8-metrics (prom-client + Sentry)
                                          └─ PR9  · c684796 · uplift-pr9-usage (用量统计页)
                                               └─ PR11 · c9875d6 · uplift-pr11-cleanup (BOM 清理)
                                                    └─ PR12 · 1355cb9 · uplift-pr12-zod-expand (zod 扩展 5 端点)
```

> 核验命令：`git log --graph --oneline --decorate origin/feature/dispatch-agent..origin/codex/mac/uplift-pr12-zod-expand | head -30`

---

## 合并方式选择

| 方式 | 省事程度 | 历史清晰度 | 推荐场景 |
|---|---|---|---|
| **Create a merge commit** | ⭐⭐⭐ 最省事 | 多 12 个 merge commit | 急推 + 不在乎线性历史 → 本次推荐 |
| **Rebase and merge** | ⭐ 每合一个要点 "Update branch" | 线性历史干净 | 严格线性主义者 |
| **Squash and merge** | — | — | **禁用** |

**推荐 Create a merge commit** 的理由：
- 保留每个 PR 的独立 commit 信息（48 条测试通过、rebase 历史、ADR 引用）
- base 链的每个节点 hash 不变，下一个 PR 不用 rebase
- 出问题定位容易（`git bisect` 能定位到具体 PR）
- 12 个 merge commit 不影响 feature/dispatch-agent 的开发节奏

如果坚持 Rebase：每合一个，下一 PR 顶部会出现 "This branch is out-of-date" + "Update branch" 按钮，点一下 GitHub 自动帮你 rebase + force-push。冲突时需要本地解，参见下方 §冲突处理。

---

## PR 审核清单（按合并顺序）

### PR1 · GitHub Actions CI `042ab7b`

- **分支**: `codex/mac/uplift-pr1-ci`
- **一句话**: 每个 PR 自动跑 `node --check + web build + npm test`，Node 20 锁死。
- **关键文件**（2 个）:
  - `.github/workflows/ci.yml` — 40 行 YAML
  - `docs/adr/0001-introduce-github-actions-ci.md`
- **重点看**: workflow 触发条件（`pull_request` 到 `feature/dispatch-agent`）、Node 版本、超时 15min。
- **风险**: 零。即便 CI 失败也不影响生产（没有强制分支保护）。
- **快速验收**: 合入后在下一个 PR 上看 Actions tab 是否触发。
- **合并后动作**: 无。

### PR2 · 25 条 Smoke 测试 `fd0b4e4`

- **分支**: `codex/mac/uplift-pr2-smoke-tests`
- **一句话**: vitest + supertest，6 测试文件覆盖 health / auth / admin / report / dispatch / agent。
- **关键文件**:
  - `apps/gateway/server.js`（仅 +8 -2 行，`AUTH_CONFIG_PATH` / `AUTH_CONFIG_LOCAL_PATH` 环境变量化）—— **必看 diff**
  - `apps/gateway/tests/helpers/app.js` — 测试入口
  - `apps/gateway/tests/fixtures/auth.fixture.json` — 测试账号（username: admin/user/tester）
  - `apps/gateway/vitest.config.js`
  - `package.json` 根的 `test` 脚本从占位改为实跑
- **重点看**:
  - server.js 改动只有 2 个路径环境变量，生产不设则 100% 保留原路径（行为零变化）
  - fixture 里的测试密码是 **SHA256 散列**（不是明文），确保 vitest 不泄漏真实密码
- **风险**: 低。只多了 test 依赖（~350MB node_modules），不改生产代码。
- **快速验收**:
  ```bash
  cd apps/gateway && npm test
  # 期望：25 passed (~0.5s)
  ```
- **合并后动作**: 无。

### PR3 · pino 集中日志 `c9b3e57`

- **分支**: `codex/mac/uplift-pr3-pino-logging`
- **一句话**: 引入 pino，15 处 `console.*` 迁移到结构化日志 + 文件按日滚动。
- **关键文件**:
  - `apps/gateway/lib/logger.js` — pino factory（dev/prod/test 三态）
  - `apps/gateway/server.js` — 9 处替换
  - `apps/gateway/services/dispatch/*.js` — 5 处替换
  - `.gitignore` — 新增 `runtime/logs/`
- **重点看**:
  - dev 模式 pretty 彩色到 stdout + 文件；prod 模式 JSON stdout + 文件；test 模式 silent
  - 按日滚动，100MB 上限，保留 7 份 archives（`pino-roll`）
  - 后台任务内存环 `JOB_LOG_LIMIT=300` **没动**（UI 依赖）
- **风险**: 中低。日志格式从字符串变结构化，如果你有 tail/grep 脚本可能需要调整。但 msg 字段保留了原字符串，兼容大多数 grep。
- **快速验收**:
  ```bash
  cd apps/gateway && npm test  # 25 条仍全绿
  ls runtime/logs/  # 生产跑起来后应能看到 gateway-YYYY-MM-DD.log
  ```
- **合并后动作**: Windows 生产机重启网关后，观察 `runtime/logs/` 是否生成日志。`LOG_DIR` 可自定义路径。

### PR4 · server.js 拆分 `8150be7` ⭐ 最大单笔重构

- **分支**: `codex/mac/uplift-pr4-server-split`
- **一句话**: 45 条路由从 2524 行 server.js 抽到 9 个 routes/*.js，server.js 减 34%。
- **关键文件**（都在 `apps/gateway/`）:
  - `routes/auth-public.js`、`routes/auth-session.js`、`routes/admin.js`、`routes/health.js`、`routes/report.js`、`routes/dashboard.js`、`routes/agent.js`、`routes/arrival.js`、`routes/spa.js`
  - `server.js`（-866 行，保留 helpers / middleware / session store / startServer / warmup）
- **重点看**:
  - factory 模式：每个 routes/*.js 导出 `register(app, ctx)`，ctx 是依赖注入对象
  - **helpers / middleware / state 没动**（保留在 server.js）—— 这是有意的。V2 再做更深的抽取。
  - `server.js` 的 startup 顺序：auth-public → auth guard middleware → auth-session → 业务路由
- **风险**: 中。最大单笔改动，但 25 条 smoke 已跑 × 3 次稳定全绿。
- **快速验收**:
  ```bash
  cd apps/gateway && npm test           # 25 条全绿
  grep -c "app.get\|app.post" server.js # 应该大幅下降
  wc -l routes/*.js                     # 每个 ≤ 300 行
  ```
- **合并后动作**: Windows 重启网关 → 手点 login / /api/me / /api/admin/accounts 三个端点各一次确认。

### PR5 · bcrypt 密码迁移 `f75e139`

- **分支**: `codex/mac/uplift-pr5-bcrypt`
- **一句话**: 引入 bcryptjs，SHA256 兼容 + 登录首次自动升级 bcrypt，零用户感知。
- **关键文件**:
  - `apps/gateway/lib/passwordHasher.js` — 核心逻辑 95 行
  - `apps/gateway/server.js` — `findAccountByCredentials` / `getMatchedAccount` / `upgradeAccountToBcrypt` / `createManagedAccount` / `updateManagedAccountPassword`
  - `apps/gateway/tests/unit/passwordHasher.test.js` — 7 条 unit
  - `apps/gateway/vitest.config.js` — `ENABLE_BCRYPT=false` 避免 bcrypt.hashSync 拖慢
- **重点看**:
  - 字段兼容：`password_hash`（SHA256）保留 + `password_bcrypt` 新增
  - 登录成功且 needsUpgrade → **异步** 持久化 bcrypt（非阻塞）
  - 应急阀门：`ENABLE_BCRYPT=false` 完全退回纯 SHA256
  - `BCRYPT_COST=10` 默认（Windows 生产机 hashSync 约 60ms，可接受）
- **风险**: 中。密码是安全边界，但保留了 SHA256 fallback + 应急关闭阀门。
- **快速验收**:
  ```bash
  cd apps/gateway && npm test  # 32 条（+7 hasher unit）全绿
  ```
  Windows 合入后：
  ```bash
  # 用现有 SHA256 密码登录 → 成功后查看 auth.local.json 应该新增 password_bcrypt 字段
  jq '.accounts[0] | {username, has_bcrypt: (.password_bcrypt != null and .password_bcrypt != "")}' data/auth.local.json
  ```
- **合并后动作**:
  - **推荐** 推广前清除旧默认密码 `sha256("123")`（搜 fixture/auth 配置）
  - `ENABLE_BCRYPT=true`（默认）即可，不需要额外配置

### PR6 · zod 参数校验（2 端点） `a990806`

- **分支**: `codex/mac/uplift-pr6-zod`
- **一句话**: zod 3.x + `validateBody` 中间件，先给 POST /api/auth/login 和 POST /api/agent/run 加白名单 body 校验。
- **关键文件**:
  - `apps/gateway/middleware/validateBody.js` — 30 行工厂
  - `apps/gateway/schemas/auth.js` + `schemas/agent.js`
  - `apps/gateway/routes/auth-public.js` + `routes/agent.js` — 各挂 1 行中间件
  - `apps/gateway/tests/smoke/validation.test.js` — 7 条
- **重点看**:
  - 非法入参从 500 → 400 `{ok:false, message, issues:[{path,message}]}`
  - **auth guard 在 validateBody 之前**，未登录仍收 401 而非 400（顺序很重要）
- **风险**: 低。只拒绝非法入参，合法请求行为不变。
- **快速验收**:
  ```bash
  cd apps/gateway && npm test  # 39 条（+7 validation）全绿
  ```
- **合并后动作**: 无。

### PR7 · 审计日志双 sink `e93069e`

- **分支**: `codex/mac/uplift-pr7-audit`
- **一句话**: 每 HTTP 请求写审计记录，pino 文件永远写 + PostgreSQL 批量可选，DB 挂了熔断降级不阻塞。
- **关键文件**:
  - `apps/gateway/services/auditLogger.js` — 双 sink + 批量 + 熔断器 143 行
  - `apps/gateway/middleware/auditRequest.js` — 74 行中间件
  - `apps/gateway/server.js` — 挂在 session 之后、routes 之前
  - `pipelines/pg-daily-wide/sql/90_audit_log.sql` — **建表 SQL**（幂等）
- **重点看**:
  - 批量：32 行 / 500ms flush
  - 熔断：连续 3 次 query 失败 → 暂停 60s
  - 跳过：`/healthz` `/readyz` `/api/ping` `/assets` `/favicon`（避免刷爆）
  - **fire-and-forget，永不抛异常**
- **风险**: 中。DB 新增一张表 + 3 索引，但 schema 只加不改，且 `ENABLE_AUDIT_DB=false` 可随时关。
- **合并后必做（Windows 生产机）**:
  ```bash
  # SSH 到生产 Windows 机
  psql -U postgres -d <DB_NAME> -f pipelines/pg-daily-wide/sql/90_audit_log.sql
  # 预期：CREATE TABLE + 3 CREATE INDEX + 无报错
  # 验证：
  psql -c "\d audit_log"
  ```
- **合并后动作**: 跑上述 SQL → 重启网关 → 发几个请求后 `SELECT count(*) FROM audit_log`。

### PR10 · OpenAPI + Swagger UI + Runbook `dff5684`

> **顺序提醒**：PR10 合在 PR7 之后、PR8 之前。不要跳。

- **分支**: `codex/mac/uplift-pr10-docs`
- **一句话**: 手写 OpenAPI 3.0 覆盖 11 个端点 + Swagger UI 挂 /api/docs (admin) + 10 节 Runbook + Rollout Readiness。
- **关键文件**:
  - `apps/gateway/openapi.yaml` — 247 行
  - `apps/gateway/routes/docs.js` — Swagger UI 挂载
  - `docs/runbook.md` — 10 节运维手册
  - `docs/rollout-readiness-report.md` — 40 人推广就绪清单
  - `docs/adr/0010-openapi-and-runbook.md`
- **重点看**:
  - Swagger UI **admin-gated**，非 admin 访问 /api/docs 会被拒
  - `/api/docs.yaml` 和 `/api/docs.json` 原文下载（方便 Postman 导入）
  - runbook §4.2 有**双端口 + 5 步烟囱**切流量方案
- **风险**: 零。纯文档 + 1 个新只读端点。
- **快速验收**:
  ```bash
  cd apps/gateway && npm test  # 42 条全绿
  ```
  合入后用 admin 账号浏览器访问 `https://<gateway>/api/docs` 确认 Swagger UI 能打开。
- **合并后动作**: 把 runbook §4.2 的切流量方案 review 一遍。

### PR8 · prom-client + Sentry `4ab5770`

- **分支**: `codex/mac/uplift-pr8-metrics`
- **一句话**: `/api/metrics` 暴露 HTTP RED + process/heap 指标（admin-gated），Sentry 无 DSN 时 no-op。
- **关键文件**:
  - `apps/gateway/lib/metrics.js` — Registry + 2 自定义 metric
  - `apps/gateway/lib/sentryClient.js` — 初始化或 no-op stubs
  - `apps/gateway/middleware/metrics.js` — 请求级埋点
  - `apps/gateway/routes/metrics.js` — scrape 端点
  - `apps/gateway/server.js` — 中间件链调整
- **重点看**:
  - **labels**: method / route (Express 模板，不是 raw path) / status_class (2xx/4xx/5xx)
  - **bucket**: 10ms..30s（合理覆盖内网延迟分布）
  - 跳过 `/api/metrics` `/healthz` `/readyz` 自身打点
  - Sentry no-op 策略：无 `SENTRY_DSN` 时所有方法安全降级，上层无需 `if(enabled)`
- **风险**: 低。metrics 是纯只读 + admin 保护，Sentry 无 DSN 零动作。
- **快速验收**:
  ```bash
  cd apps/gateway && npm test  # 42 条全绿
  # admin 登录后：
  curl -sb cookie.txt https://<gateway>/api/metrics | head -20
  ```
- **合并后动作**:
  - 想接 Sentry？设 `SENTRY_DSN` + 重启
  - 想接 Prometheus？当前只能用 admin session scrape，**建议等 V2 metrics-auth PR 合并后**（已在今夜 Agent Team 产出中）用 Bearer METRICS_TOKEN

### PR9 · 用量统计页 `c684796`

- **分支**: `codex/mac/uplift-pr9-usage`
- **一句话**: 基于 PR7 的 `audit_log` 表，admin 页面看请求量 / 错误率 / p95 延迟 / Top path / Top user。
- **关键文件**:
  - `apps/gateway/services/usageRepo.js` — 3 条并行 SQL
  - `apps/gateway/routes/admin.js` — `GET /api/admin/usage` 挂载
  - `apps/web/src/pages/AdminUsagePage.jsx` — AntD 前端
  - `apps/web/src/App.jsx` + `auth/modules.js` — 菜单 + 路由
- **重点看**:
  - 时间窗口白名单 `1h/6h/24h/7d/30d`（防 SQL 注入）
  - p95 用原生 `PERCENTILE_CONT`
  - `audit_log` 表不存在时 → 503 + 友好消息（不会把前端搞崩）
- **风险**: 低。纯只读聚合页 + admin 保护。
- **依赖**: PR7 的 `audit_log` 表必须存在（已在 PR7 合并后执行 SQL）。
- **快速验收**: admin 浏览器访问 `/admin/usage`，应看到三张卡 + 两张表。
- **合并后动作**: 前端 build（Cyrus 在 Windows 侧 `npm run build` 应正常，Mac 有 esbuild v25 bug 绕过即可 —— 见 ADR-0009）。

### PR11 · BOM 清理 `c9875d6`

- **分支**: `codex/mac/uplift-pr11-cleanup`
- **一句话**: 23 个文件的首字节 UTF-8 BOM 移除 + `.gitattributes` 4 行注释。
- **关键文件**: 每个受影响文件只有第 1 行 diff（`﻿# ...` → `# ...`）。
- **重点看**: 目测 `.gitattributes` 新增 4 行注释；其他文件 diff 只有第 1 行。
- **风险**: 极低。纯编码清理，无代码语义变化。
- **范围外**（V2）: `runtime/*` 下 3 个 BOM 文件，违反 `.gitignore` 规则，应从 git 跟踪移除而非清 BOM。
- **快速验收**: `git diff --stat` 每文件只 1 行 +/-。
- **合并后动作**: 团队约定编辑器统一 UTF-8 no-BOM（VSCode 默认即此）。

### PR12 · zod 覆盖 5 端点 `1355cb9`

- **分支**: `codex/mac/uplift-pr12-zod-expand`
- **一句话**: 把 PR6 的 validation pattern 扩展到 5 个高频 mutation 端点。
- **关键文件**:
  - `apps/gateway/schemas/admin.js` + `schemas/dispatch.js`
  - `apps/gateway/routes/admin.js` — 3 端点挂中间件
  - `apps/gateway/services/dispatch/routes.js` — 1 端点挂中间件
  - `apps/gateway/tests/smoke/validation.test.js` — +6 条
- **重点看**:
  - 5 个端点：admin 账号 create / permissions / password / AI key、dispatch public confirm
  - **auth guard 全部在 validateBody 之前**（401/403 优先于 400）
- **风险**: 低。拒绝非法入参，合法请求不变。
- **快速验收**:
  ```bash
  cd apps/gateway && npm test  # 48 条全绿
  ```
- **合并后动作**: 无。

---

## 合并后 Windows 生产机动作（一次性）

按时间顺序：

1. **PR7 合入后必做**：
   ```bash
   psql -U postgres -d <DB_NAME> -f pipelines/pg-daily-wide/sql/90_audit_log.sql
   ```
2. **PR10 合入后可选**：用 admin 账号访问 `/api/docs` 确认 Swagger 打得开
3. **全部合完后**：
   - 重启网关（双端口烟囱方案，见 `docs/runbook.md` §4.2）
   - smoke 一轮：login / /api/me / /api/admin/accounts / /api/admin/usage / /api/metrics
   - `SELECT count(*) FROM audit_log WHERE created_at > NOW() - INTERVAL '10 minutes'` 确认审计写入

---

## 冲突处理

如果 GitHub 显示 "This branch has conflicts that must be resolved"：

1. **优先让作者（Claude）rebase**。告诉 Claude："rebase PR<n> onto feature/dispatch-agent 最新 HEAD"，Claude 会在对应 worktree 里解冲突并 force-push。
2. **绝不在 GitHub UI 里在线解冲突**（会生成 merge commit 破坏链路）。
3. 如果 rebase 连环冲突，最坏情况是让 Claude 从 PR<n> 开始的剩余 PR 全部重做 rebase。每个 worktree 独立，不影响生产。

---

## 回滚方案

**粒度 1：单 PR 回滚**（合入后发现问题）
```bash
git revert -m 1 <merge_commit_hash>   # 如果用 Create a merge commit
git revert <commit_hash>              # 如果用 Rebase and merge
git push origin feature/dispatch-agent
```

**粒度 2：一组 PR 回滚**
- 用 `git reset --hard <last_known_good>` + `git push --force-with-lease`
- **Cyrus 手动确认**，Claude 不自动 force-push
- 生产机同步：`git fetch && git reset --hard origin/feature/dispatch-agent` + 重启

**粒度 3：应急阀门**（不回滚代码，只关功能）
- pino 日志过多：`LOG_LEVEL=warn`
- bcrypt 拖慢：`ENABLE_BCRYPT=false`
- audit DB 写挂：`ENABLE_AUDIT_DB=false`
- prom-client 挂：`ENABLE_METRICS=false`
- Sentry 噪音：取消 `SENTRY_DSN` 环境变量

---

## FAQ

**Q1: PR1 没跑 CI 怎么办？**
A: 因为 PR1 合之前 `.github/workflows/ci.yml` 还没进 feature/dispatch-agent，所以 PR1 本身不会触发 CI。合入后，**PR2 及之后**会自动触发。

**Q2: GitHub 上 PR8 的 base 显示 feature/dispatch-agent 但箭头指向 PR10？**
A: 正确。GitHub 会根据 PR base 字段显示目标分支，但 diff 是基于 `merge-base(PR8, target)` 算的。合并顺序必须按 base 链，不按 GitHub 界面显示的顺序。

**Q3: 能不能并行合 PR1 和 PR2？**
A: 能。PR1 和 PR2 是 siblings（都基于 `a1a5afe`）。先合哪个都行，只是 CI 只会在第二个合入的 PR 上触发。

**Q4: PR9 合入后前端没更新？**
A: PR9 改了 `apps/web/`，但前端 bundle 产物在 runtime。合入后 Cyrus 在 Windows 侧 `cd apps/web && npm run build` 一次，或看 CI 里有无前端 build（PR1 的 CI 已经跑 `web build`）。

**Q5: 合入过程中要不要停服？**
A: 不用。每个 PR 都是向后兼容的。最冒险的是 PR4（server.js 拆分）和 PR5（bcrypt）—— smoke 已跑稳，失败时可用 runbook §4.2 的烟囱切流量方案。

**Q6: Claude 今夜在推 V2 的 3 个 Agent 任务（Grafana / metrics-auth / password-policy），会不会冲突？**
A: 不会。V2 worktree 都基于 PR12 HEAD，分支名 `codex/mac/uplift-v2-*`，与 PR1-12 链无交叉。等 PR1-12 合完后，V2 分支再自行 rebase 到 main 即可。

---

## 合并后 Claude 侧收尾

- 更新 `docs/plans/2026-04-23-night1-report.md` 的状态为"已全部合入"
- 12 个 worktree 可以 `git worktree remove <path>` 逐个清理（保留分支 tag 便于回查）
- V2 分支（Grafana / metrics-auth / password-policy）进入下一轮推进

---

**总结**：
- 按 `PR1 // PR2→3→4→5→6→7→**10**→8→9→11→12` 顺序合
- 用 "Create a merge commit"（推荐）或 "Rebase and merge"
- **禁 Squash**
- PR7 合后必在 Windows 执行 `90_audit_log.sql`
- 有任何疑问：本文件 + `docs/plans/2026-04-23-night1-report.md` + `docs/runbook.md` §4.2
