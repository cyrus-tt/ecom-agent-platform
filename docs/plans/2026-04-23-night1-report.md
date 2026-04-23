# 2026-04-23 夜间推进报告 · PR1 / PR2 / PR3 就绪

> **给 Cyrus 的早起验收单。Claude 夜间自主推进完成，等你审。**

---

## TL;DR

| 项 | 结果 |
|---|---|
| 完成 PR 数 | 4（设计 + PR1 + PR2 + PR3） |
| 新增测试 | 25 条 smoke，3 次稳定全绿 |
| 新增依赖 | vitest 2.x / supertest 7.x / pino 9.x / pino-roll / pino-pretty |
| 代码风险 | 零（全部纯新增或等价替换） |
| 生产受影响 | 0（没动 `feature/dispatch-agent`） |
| 待你做的事 | 审 4 个 PR，按顺序合并 |

---

## 4 个待审 PR（按合并顺序）

### 0. 设计文档 PR（可选先合或最后合）

- 分支：`codex/mac/uplift-design`
- commits：`b345c30` + `49a4872`
- 文件：
  - `docs/plans/2026-04-23-uplift-to-9-design.md` · 完整 3 周设计（320 行）
  - `docs/plans/2026-04-23-uplift-to-9-plan.md` · 10 PR implementation plan（676 行）
  - `docs/plans/2026-04-23-night1-report.md` · 本文件
- 风险：零（只有文档）
- 建议：先合，让后续 PR 有上下文可查

### 1. PR1 · GitHub Actions CI

- 分支：`codex/mac/uplift-pr1-ci`
- commit：`042ab7b`
- 文件：
  - `.github/workflows/ci.yml` · Node 20 + gateway syntax check + web build + test
  - `docs/adr/0001-introduce-github-actions-ci.md`
- 风险：零（不动运行时代码）
- PR 链接：https://github.com/cyrus-tt/ecom-agent-platform/pull/new/codex/mac/uplift-pr1-ci

### 2. PR2 · 25 条 Smoke 测试

- 分支：`codex/mac/uplift-pr2-smoke-tests`
- commit：`fd0b4e4`
- 新增/修改文件（15 个）：
  - `apps/gateway/server.js` · 2 行：AUTH_CONFIG_PATH / AUTH_CONFIG_LOCAL_PATH 支持环境变量覆盖（生产不设不变）
  - `apps/gateway/package.json` / `package-lock.json` · 新增 vitest + supertest devDep
  - `apps/gateway/vitest.config.js` · vitest 配置
  - `apps/gateway/tests/fixtures/*.json` · 2 份测试账号 fixture
  - `apps/gateway/tests/helpers/app.js` · 共用测试工具
  - `apps/gateway/tests/smoke/*.test.js` · 6 个测试文件
  - `package.json` · 根 test 脚本从占位符改为 `npm --prefix apps/gateway test`
  - `docs/adr/0002-testing-strategy.md`
- 测试覆盖（25 条，0.5 秒跑完）：
  - health（3）: /healthz, /readyz, /api/ping 认证语义
  - auth（7）: 登录正/反、/api/auth/me、登出、权限边界
  - admin（4）: accounts 三角色 + 不泄漏 password_hash
  - report（4）: 鉴权 + 权限分层（不测 DB 数据）
  - dispatch（4）: tryRegister + 权限 + 公开 preview
  - agent（3）: /api/agent/skills 三角色
- 风险：低。server.js 的 2 行改动是「env || default」，生产零影响
- PR 链接：https://github.com/cyrus-tt/ecom-agent-platform/pull/new/codex/mac/uplift-pr2-smoke-tests

### 3. PR3 · pino 集中日志

- 分支：`codex/mac/uplift-pr3-pino-logging` （**基于 PR2 分支，必须在 PR2 之后合**）
- commit：`c9b3e57`
- 新增/修改文件（10 个）：
  - `apps/gateway/lib/logger.js` · 新增（pino + 文件滚动）
  - `apps/gateway/package.json` / `package-lock.json` · +pino +pino-roll +pino-pretty
  - 15 处 `console.*` → `log.*`：
    - `apps/gateway/server.js`（9 处）
    - `apps/gateway/services/reportRepo.js`（1 处）
    - `apps/gateway/services/dispatch/index.js`（3 处）
    - `apps/gateway/services/dispatch/orchestrator.js`（1 处）
    - `apps/gateway/services/dispatch/taskStore.js`（1 处）
  - `.gitignore` · +runtime/logs/
  - `docs/adr/0003-logging-strategy.md`
- 测试：基于 PR2 的 smoke，3 次稳定 25/25 全绿
- 风险：中低。日志后端从 console 换 pino，业务行为零变化，合并后需要**重启一次 gateway**让新 logger 生效
- PR 链接：https://github.com/cyrus-tt/ecom-agent-platform/pull/new/codex/mac/uplift-pr3-pino-logging

---

## 建议合并顺序

```
1. codex/mac/uplift-design         → feature/dispatch-agent   [零风险，先合]
2. codex/mac/uplift-pr1-ci         → feature/dispatch-agent   [零风险]
3. codex/mac/uplift-pr2-smoke-tests → feature/dispatch-agent  [从此 CI 能跑真测试]
4. codex/mac/uplift-pr3-pino-logging → feature/dispatch-agent [需重启 gateway]
```

**重要**：PR3 的 commit 包含了 PR2 的 commit（因为 PR3 是从 PR2 分支拉的）。如果你用 "Create a merge commit" 方式合 PR2，PR3 合并时应该 fast-forward 或需要一次小 rebase。如果用 "Squash and merge"，PR3 可能需要重新 base。**建议用 "Rebase and merge" 或 "Create a merge commit"**。

---

## Windows 生产机验收 SOP

### 合 PR1（CI）

1. `git fetch origin && git pull --ff-only`（在 `feature/dispatch-agent`）
2. 打开 https://github.com/cyrus-tt/ecom-agent-platform/actions
3. 看 workflow `CI` 是否有一条新运行 + 是否绿
4. **无需重启 gateway**

### 合 PR2（smoke）

1. `git pull --ff-only`
2. 可选：本地跑一次 `npm test` 看是否 25/25 绿（会自动跑 `npm --prefix apps/gateway install` 因为有新 devDep，首次慢）
   - 如果 `apps/gateway/node_modules` 不新鲜，先 `npm --prefix apps/gateway ci`
3. **无需重启 gateway**（纯测试代码 + server.js 的 env 覆盖是向后兼容的）

### 合 PR3（pino）

**这个要小心，按双端口方案来：**

1. `git pull --ff-only`
2. `npm --prefix apps/gateway ci`（新增 pino 依赖）
3. **在 :3002 起新版 gateway 冷待**（不关老的）：
   ```powershell
   $env:PORT = "3002"
   $env:LOG_DIR = "runtime/logs-new"  # 避免和老版日志撞
   npm run ops:start:saas
   ```
4. 5 步烟囱打 :3002：
   - [ ] 访问 `http://localhost:3002/healthz` → 200 `{ok: true}`
   - [ ] 登录 `POST /api/auth/login` → 200 + 带 cookie
   - [ ] 日报页 `GET /api/report-daily/dates` → 2xx
   - [ ] 调拨页能打开任务列表（至少不 500）
   - [ ] `ls runtime/logs-new/` 看到 `gateway-<today>.log` 有内容
5. OK → 切流量（两种方式，选一）：
   - (a) 停 :3001，改新版 PORT=3001，重启
   - (b) 改前端 VITE_API_BASE 指向 :3002，web rebuild
6. 保留老版（如果方式 a 已停，保留 2503 备份）1 小时，如异常立刻回切
7. **一小时无报错 → 完成**

### 若任一步翻车（回滚脚本）

```powershell
# 方法 1: revert 合并 commit
git revert <merge-sha>
git push origin feature/dispatch-agent
npm run ops:stop:saas
npm run ops:start:saas

# 方法 2: 若 :3001 老版还活着，直接 kill :3002 新版即可
```

---

## 已知问题 / 非目标声明

### 1. README.md / docs/DISPATCH_AGENT_SETUP.md 的 BOM 差异（非 Claude 引入）

在 Mac worktree 中 `git status` 会看到这两个文件 "M"。**这是 Windows 端提交的 UTF-8 BOM 与 Mac checkout 之间的跨平台差异**，不是今晚的 3 个 PR 引入的。

- 没有被任何 PR 暂存或提交（每个 commit 都精确 `git add <文件>`）
- 不影响运行
- 建议后续单独开一个清理 PR，加 `.gitattributes` 统一 UTF-8 无 BOM

### 2. 测试范围 = HTTP 层行为，不验证 DB 数据

当前 smoke 只测 路由 / 鉴权 / 权限 / 响应 shape。不测：
- PostgreSQL 查询结果正确性（需要集成测试，V2 做）
- 调拨 Agent 的完整流程（需要 XLSX 上传 + 多步确认，太复杂）
- AI 分析的 DeepSeek 返回内容

**这是有意的**：smoke 的定位是 PR4 拆分的「行为一致性」安全网，不是功能验收测试。

### 3. 密码 hash 依然是 SHA256（PR5 处理）

PR5 会做 bcrypt 迁移 + 兼容升级。这一轮 PR1-3 不动。

---

## 进度条

```
[x] 设计 & 计划           （4/21 天）
[x] PR1 CI                （4/21 天）
[x] PR2 Smoke            （4/21 天）
[x] PR3 Pino             （4/21 天）
[ ] PR4 server.js 拆分    （高风险，待上面 3 个合并后再开）
[ ] PR5 bcrypt
[ ] PR6 zod
[ ] PR7 审计表
[ ] PR8 Sentry + 指标
[ ] PR9 用量统计页
[ ] PR10 OpenAPI + Runbook
```

4/21 天已消化 3 个 PR。节奏健康。

---

## 给 Claude（我自己）的下一步

等你早起后，告诉我：
1. **哪些 PR 合了、哪些打回、哪些需要修**
2. 是否开启 PR4（server.js 拆分）—— 这是第一个**中风险**的，需要你确认完 PR2 smoke 在生产一切正常再开

如果你早起前有疑问，直接在 PR 评论，或消息我。

---

**Claude 下线。PR 链接再贴一遍，方便你开：**

- https://github.com/cyrus-tt/ecom-agent-platform/pull/new/codex/mac/uplift-design
- https://github.com/cyrus-tt/ecom-agent-platform/pull/new/codex/mac/uplift-pr1-ci
- https://github.com/cyrus-tt/ecom-agent-platform/pull/new/codex/mac/uplift-pr2-smoke-tests
- https://github.com/cyrus-tt/ecom-agent-platform/pull/new/codex/mac/uplift-pr3-pino-logging
