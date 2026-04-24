# ADR 0004: server.js 路由分域抽取（保留 helpers / 中间件 / state）

- 日期：2026-04-23
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：PR4
- 关联设计：`docs/plans/2026-04-23-uplift-to-9-design.md`

## 背景

`server.js` 2524 行（PR3 合并后），单一文件承载：
- 依赖 import（17 个）
- 常量 + 全局 state（SESSION_STORE / JOB_STORE / AUTH_STORE 等）
- 40+ 个 helper 函数
- 认证中间件 + session 管理
- arrival service 子进程生命周期
- 所有 API 路由（45 条）
- SPA 页面 fallback
- 启动函数 `startServer()` + warmup

**具体症状**：
- IDE 无法一屏显示
- 任意两个域的改动都会改到同一个文件 → git 冲突高发
- 新人难以定位"报告逻辑在哪一段"
- 40 人部门推广后，多人并行改动必然冲突

## 决策

**按域抽取路由，保留 helpers / middleware / state 在 server.js**。

具体策略：
1. **路由模块化**：每个域一个 `apps/gateway/routes/<domain>.js`，暴露 `register(app, ctx)` 工厂函数
2. **依赖注入**：通过 `ctx` 对象把 helpers / middleware / services 传给各路由模块
3. **不动 state**：SESSION_STORE / JOB_STORE / AUTH_STORE 等运行时状态继续留在 server.js 顶层
4. **不动 middleware**：`app.use((req, res, next) => {...})` 类中间件留在 server.js，因为它们和 session 状态、请求预处理绑定
5. **不动 helper 函数**：sha256 / parseCookies / escapeHtml / spawnArrivalService 等 140+ 行 helpers 留在 server.js（本 PR 不动，PR4b 才进一步抽 lib/）

### 路由模块清单（本 PR 产出）

| 模块 | 路径前缀 | 行数 | 关键职责 |
|---|---|---|---|
| `routes/auth-public.js` | /api/auth/login, /login, /logout | 68 | 登录前公开路由 |
| `routes/auth-session.js` | /api/auth/logout, /api/auth/me | 39 | 登录后会话路由 |
| `routes/admin.js` | /api/admin/\*, /api/settings/\* | 231 | 账号管理 + AI 密钥 + 运维任务 |
| `routes/health.js` | /healthz, /readyz, /api/health, /api/ping | 125 | 健康检查 + 可观测性端点 |
| `routes/report.js` | /api/report/\*, /api/report-daily/\* | 278 | 周报 + 日报 + Excel 导出 |
| `routes/dashboard.js` | /api/dashboard/\*, /api/channel-dashboard/\* | 170 | 可视化看板 + 钻取 |
| `routes/agent.js` | /api/agent/\* | 175 | AI 分析 + 报告存档 |
| `routes/arrival.js` | /api/arrival/\*, /notes-api/\*, /api/{image,status,data,config,review,refresh}/\* | 118 | Arrival 代理 + 笔记转发 + 用户目录 |
| `routes/spa.js` | /, /dashboard, /analysis, /report-daily, /admin/accounts, ... | 57 | React 页面 fallback |
| **合计** | | **1261** | **9 个模块** |

### server.js 变化

```
PR3 末态：2524 行
PR4 末态：1658 行
抽出：   -866 行（−34%）
```

每个路由模块 < 300 行，IDE 一屏可见。

## 不做什么（本 PR 划清边界）

- ❌ 不动 helpers（`sha256` / `parseCookies` / `spawnArrivalService` 等）
- ❌ 不动 middleware（`app.use((req, res, next) => ...)` 两段）
- ❌ 不动 state（SESSION_STORE / JOB_STORE / AUTH_STORE）
- ❌ 不改 dispatch 模块（在 `dispatchModule.tryRegister()` 内部）
- ❌ 不新增业务功能或行为
- ❌ 不改 helper 签名（纯搬家）

这些是 V2 的事：`PR4b` 抽 `lib/helpers.js` + `middleware/auth.js` + `services/authService.js`。

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| 一次性彻底重构 | 高风险，PR diff 会超 3000 行，合并困难 |
| 按功能边界拆（auth / report / dispatch 各自完整包）| 边界划不清，auth 内部和 middleware 耦合太深 |
| 放弃，接受单体 | 40 人并行开发必然冲突，长痛 |
| 用 express.Router() | 需要重构更多 app.use 调用，风险不成比例 |

## 后果

- ✅ server.js 缩减 34%，每个路由文件独立可读
- ✅ 不同域的 PR 不再冲突同一个文件
- ✅ 为 PR7 审计中间件、PR10 OpenAPI 注释提供清晰挂载点
- ✅ 25 个 smoke 测试 3 次稳定全绿，**零行为变化**
- ⚠️ 每个 register 调用的 ctx 参数较长（6–17 个字段）—— 可接受，显式优于隐式
- ⚠️ server.js 1658 行仍然大，V2 继续往下拆

## 验证

- 25 smoke 测试 3 次稳定全绿（PR2 提供的安全网）
- `node --check apps/gateway/server.js` 通过
- **行为零变化**：所有响应 shape / HTTP 状态码 / 权限分层保持一致（smoke 覆盖）

## 后续

- **PR4b（V2 计划）**：抽 `lib/helpers.js` + `middleware/auth.js` + `services/authService.js`，目标 server.js ≤ 600 行
- **PR5 bcrypt**：在 `routes/auth-public.js` 的 login handler 加 bcrypt 比对 + 兼容升级
- **PR6 zod**：在 `routes/*.js` 的关键端点前加入 schema 校验中间件
- **PR7 审计**：在全局 app.use 处 + 各 register 前统一挂审计中间件
