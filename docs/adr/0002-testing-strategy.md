# ADR 0002: 首批 Smoke 测试策略（vitest + supertest）

- 日期：2026-04-23
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：PR2
- 关联设计：`docs/plans/2026-04-23-uplift-to-9-design.md`

## 背景

当前测试覆盖率 0%：
- `package.json:15` 的 `test` 脚本是占位符
- `apps/gateway/tests/` 不存在
- 即将在 PR4 做 `server.js` 2515 行拆成 6 路由文件的危险动作，无任何自动化安全网

如果拆分过程中破坏了中间件顺序、路由注册、权限检查或响应 shape，且无测试，会在生产环境被 40 人发现。

## 决策

引入 **vitest + supertest**，对 **5 类最关键链路** 写 smoke 测试：

| 文件 | 覆盖 |
|---|---|
| `tests/smoke/health.test.js` | `/healthz` `/readyz` + 未认证的 401 语义 |
| `tests/smoke/auth.test.js` | 登录（正/反）+ `/api/auth/me` + 登出 + 非管理员权限边界 |
| `tests/smoke/admin.test.js` | `/api/admin/accounts` 三角色（匿名/用户/管理员）+ 不泄漏 `password_hash` |
| `tests/smoke/report.test.js` | 日报路由的鉴权与权限分层（不断言 DB 数据） |
| `tests/smoke/dispatch.test.js` | 调拨路由注册 + `dispatch` 权限 + 公开 preview 端点 |
| `tests/smoke/agent.test.js` | `/api/agent/skills` 三角色 + 权限分层 |

**测试范围** = 路由存在 + 中间件顺序 + 权限包装 + 响应 shape。
**测试范围外** = PostgreSQL 数据准确性、钉钉回调、实际文件上传。这些需要集成测试（后续）。

## 技术选型

### vitest 而非 jest

- **原生 ESM**：vitest 基于 Vite，直接用 `import` 语法，无需 babel/ts-jest 配置
- **快**：25 个测试 <1 秒冷启动（jest 通常要 3–5 秒）
- **无需 `__mocks__` 魔术目录**：`vi.mock` 在测试内显式声明
- **同团队已用 Vite**（`apps/web`），技术栈一致

### supertest 而非启动真实端口

- 直接对 Express `app` 对象调用，不经过 socket → 更快、不占端口
- 避免并发测试端口冲突

### 通过 `require('./server')` 而非抽 `app.js`

设计文档原本打算抽 `apps/gateway/app.js` 解耦 listen。实际发现 `server.js:2511-2515` 已经是：

```javascript
if (require.main === module) {
  startServer();
}
module.exports = { app, startServer };
```

`require.main` guard 已经保证测试 require 不会启动 HTTP listener。**无需再抽 app.js，PR2 纯加测试不重构**。PR4 拆分会更彻底地分割，到时再讨论 app.js 形态。

## 测试数据

不依赖 PostgreSQL：
- Auth 配置走 fixture：`tests/fixtures/auth.fixture.json` 2 个账号（admin + user）
- DB 相关端点只断言 HTTP 层行为（2xx/5xx 非 404/403），不断言数据内容
- Agent 上下文走 `AGENT_DATA_MODE=fixture` 环境变量

这种 smoke 范围够 PR4 重构做"行为一致性"验证：只要响应 shape、鉴权和路由分层一致，拆分就是安全的。

## 启用环境变量覆盖 auth 配置路径（必要改动）

原 `server.js:29-30`：

```javascript
const AUTH_CONFIG_DEFAULT_PATH = path.join(BASE_DIR, "config", "auth.json");
const AUTH_CONFIG_LOCAL_PATH = path.join(BASE_DIR, "config", "auth.local.json");
```

改为：

```javascript
const AUTH_CONFIG_DEFAULT_PATH = process.env.AUTH_CONFIG_PATH
  ? path.resolve(process.env.AUTH_CONFIG_PATH)
  : path.join(BASE_DIR, "config", "auth.json");
const AUTH_CONFIG_LOCAL_PATH = process.env.AUTH_CONFIG_LOCAL_PATH
  ? path.resolve(process.env.AUTH_CONFIG_LOCAL_PATH)
  : path.join(BASE_DIR, "config", "auth.local.json");
```

**行为影响**：生产不设这两个环境变量时 100% 保留原路径。测试 / CI 通过 `vitest.config.js` 注入 fixture 路径。

**风险**：无（新增 `env || default` 分支，不影响现有调用）。

## 后果

- ✅ 为 PR4 server 拆分提供安全网：25 个断言覆盖中间件/路由/权限
- ✅ 首次让 `npm test` 有意义（根 `package.json` 不再是占位符）
- ✅ CI 从 PR1 开始就能跑真实测试
- ⚠️ 测试**不验证 DB 数据**，仅验证 HTTP 行为。数据层回归需要集成测试（P1）
- ⚠️ 测试时长 ~0.5 秒，即使扩展 10 倍到 250 个用例仍 < 10 秒，对 CI 预算友好

## 后续路线

- **PR5（bcrypt）**：扩展 `auth.test.js`，新加"旧 SHA256 hash 首次登录自动升级"的测试
- **PR6（zod）**：新增 `tests/validation/*.test.js`，验证非法入参 400
- **V2**：引入测试容器 PostgreSQL（testcontainers-node），写真实数据的集成测试
