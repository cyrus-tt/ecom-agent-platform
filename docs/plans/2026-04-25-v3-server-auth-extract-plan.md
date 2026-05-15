# V3 · server.js auth/session/permission 二轮抽取 Plan

- 起草日期: 2026-04-25
- 目标分支: `codex/mac/uplift-design`（V3 加固周期内开 PR13）
- 范围: 仅 `apps/gateway/server.js`（1719 行）→ 抽到 `lib/auth/`、`middleware/`，
  使 server.js 回归"组装清单"（目标 ≤ 600 行）
- **不做事项**: 不引入 SSO/OAuth、不改 SESSION_STORE 持久化、不改业务行为。
  本 PR 是**纯结构搬迁**（pure refactor），任何函数体改动仅限：
  1. 把 `AUTH_PERMISSION_KEYS` 从模块顶层常量改为 lazy-getter（解决跨文件引用循环）
  2. 把 `getAuthStore` 等单例闭包改为 module-scoped 单例
  其他逻辑保持字节级一致。

---

## 0. 第一性原理自检

> 4 个问题对照（CLAUDE.md 强制）

1. **这一步为什么存在？能不能消除？**
   - server.js 1719 行的根因：PR1-PR4 抽 routes/* 后，`auth/session/permission`
     仍混在主文件，路由通过 `ctx` 注入 9-15 个回调。
   - 不能消除：auth 是横切关注点，必须独立成 `lib/auth/`，否则 PR13 之后还是巨石。
   - 能否一次到位？可以——本 PR 把所有 auth 相关函数搬到 `lib/auth/*`，
     server.js 只剩 ~ 组装。
2. **如果失败，会怎么表现？脚本能救活吗？**
   - 失败模式：跨文件 `AUTH_STORE` 单例失效 / `SESSION_STORE` 被复制成多份 /
     `AUTH_PERMISSION_MODULES` 在 dispatch 开关切换时不一致。
   - 守门：现有 `tests/smoke/auth.test.js` + `admin.test.js` + `dispatch.test.js`
     全跑；额外加 `lib/auth/__tests__/*` 单测验证单例语义；
     回滚方案：单 PR、可一键 revert（不动 routes/*）。
3. **真实环境跑过吗？**
   - 必须在合并前跑一次 `npm test --prefix apps/gateway`（vitest 全套）+
     启动一次本地 gateway 用浏览器走 login → admin 列表 → logout 流程。
4. **3 个月后另一人能照做吗？**
   - 是。本 Plan 把每个函数迁移目标写死为 1:1 表（见 §4）。
   - `lib/auth/index.js` 提供聚合 re-export，让搜索 `require("./lib/auth")`
     即可命中所有相关 API。

---

## 1. server.js 残留剖析

### 1.1 总量

- 总行数: **1719**
- 顶层 require: 19 行
- 顶层 const/let（模块状态）: 18 个
- 顶层 function: **51 个**（含 spawn/proxy/probe，下表标 ※ 表示**本次不抽**）
- 顶层 `app.use` / `routes/* register`: 28 处
- 顶层 `module.exports`: 1 行（`{ app, startServer }`）

### 1.2 顶层模块状态清单

| 标识符 | 类型 | 含义 | 归属 |
|---|---|---|---|
| `BASE_DIR` / `PUBLIC_DIR` / `PROJECT_ROOT` / `WEB_DIST_DIR` / `WEB_INDEX_PATH` | const | 路径常量 | 留在 server.js（boot 用） |
| `AUTH_CONFIG_DEFAULT_PATH` / `AUTH_CONFIG_LOCAL_PATH` / `AUTH_CONFIG_BACKUP_PATH` | const | auth 配置文件路径 | → `lib/auth/config.js` |
| `ARRIVAL_BASE` / `NOTES_BASE` / `ARRIVAL_PROJECT_DIR` / `PG_PIPELINE_SCRIPT` / `ARRIVAL_URL` / `ARRIVAL_*_TIMEOUT_MS` | const | arrival/notes 配置 | 留 server.js（V3 不抽） |
| `AUTH_COOKIE_SECURE` | const | cookie 安全标记 | → `lib/auth/session.js` |
| `SESSION_STORE` | `new Map()` | 在线 session（in-memory） | → `lib/auth/session.js`（module-scoped） |
| `JOB_STORE` / `RUNNING_JOB_BY_TYPE` / `JOB_LOG_LIMIT` | Map / 常量 | 后台任务管理 | 留 server.js（V4 抽 `lib/jobs.js`） |
| `ARRIVAL_SERVICE_PROCESS` / `ARRIVAL_SERVICE_START_PROMISE` / `ARRIVAL_SERVICE_LAST_ERROR` | let | arrival 子进程状态 | 留 server.js |
| `AUTH_STORE` | let | 当前 auth 存储（lazy 初始化） | → `lib/auth/store.js`（module-scoped） |
| `AUTH_PERMISSION_MODULES` | const | 权限矩阵定义 | → `lib/auth/permissions.js` |
| `AUTH_PERMISSION_KEYS` / `AUTH_PERMISSION_SET` | const | 衍生集合 | → `lib/auth/permissions.js` |
| `AUTH_CONFIG` | const（200 行处） | 旧 loader 的一次性结果，**实际未被任何函数使用** | **删除**（死代码，见 §1.4） |

### 1.3 函数分组（按目标文件）

> 行号取自 PR12 worktree 的 `apps/gateway/server.js`

#### A. 工具（→ 部分 `lib/auth/permissions.js` 用，部分留 server.js）

| 行号 | 函数 | 简述 | 目标 |
|---|---|---|---|
| 72  | `sha256(text)` | sha256 hex | 复用 `passwordHasher.sha256Hex`（已存在） |
| 76  | `safeJsonRead(path, fallback)` | 读 JSON 容错 | → `lib/auth/config.js`（私有） |
| 84  | `writeJsonAtomic(path, data)` | 原子写 JSON | → `lib/auth/config.js`（私有） |
| 90  | `escapeHtml(text)` | HTML 转义 | 留 server.js（仅 `renderLoginPage` 用） |

#### B. 权限矩阵（→ `lib/auth/permissions.js`）⚠ 先抽

| 行号 | 函数 | 简述 |
|---|---|---|
| 99  | `normalizePermissionKeys(raw, fallback)` | 过滤合法权限键 |
| 297 | `resolvePreferredRouteForPermissions(permissions)` | 由权限推首选路由 |
| 307 | `resolvePreferredRouteForAccount(account)` | account → 首选路由 |
| 317 | `accountHasPermission(account, key)` | 是否有指定权限 |
| 327 | `accountHasAnyPermission(account, keys)` | 是否任一权限 |
| 331 | `isRouteAllowedForAccount(account, pathname)` | 路径是否对账号可见 |

#### C. 账号 normalize（→ `lib/auth/accounts.js`）

| 行号 | 函数 | 简述 |
|---|---|---|
| 114 | `buildAccountId(raw, fallbackUsername, index)` | 生成 acct_xxxx id |
| 128 | `normalizeAuthAccount(raw, ...)` | 原始 account → 标准 shape |
| 408 | `sanitizeAccountForClient(account)` | 输出给前端（去敏） |
| 423 | `cloneAccountForMutation(account)` | 复制给 mutator |
| 435 | `validateAccountName(name, existing, currentId)` | 校验账号名 |
| 450 | `validateAccountPassword(password)` | 校验密码长度 |

#### D. auth 配置加载与持久化（→ `lib/auth/config.js`）

| 行号 | 函数 | 简述 |
|---|---|---|
| 150 | `loadAuthConfig()` | **仅供旧 `AUTH_CONFIG` 一次性用**（删） |
| 202 | `buildAuthStore(raw)` | 把原始 config 构造成 store |
| 267 | `loadManagedAuthStore()` | 读两个文件 + buildAuthStore |
| 360 | `exportAuthConfig(authStore?)` | store → 可写回磁盘的对象 |
| 381 | `ensureAuthConfigBackup()` | 首次确保 backup 存在 |
| 389 | `persistAuthStore(nextStore)` | 写盘 + 重新 buildAuthStore + replace |

#### E. AUTH_STORE 单例操作（→ `lib/auth/store.js`）

| 行号 | 函数 | 简述 |
|---|---|---|
| 281 | `getAuthStore()` | lazy 单例 |
| 288 | `replaceAuthStore(next)` | setter |
| 293 | `reloadAuthStore()` | 重新读盘 |
| 396 | `getAuthAccountById(id)` | by id |
| 404 | `isPrimaryAdminAccount(id)` | 是否主管理员 |

#### F. 账号 CRUD（→ `lib/auth/accounts.js`，依赖 store + permissions + passwordHasher）

| 行号 | 函数 | 简述 |
|---|---|---|
| 461 | `updateAuthStore(mutator)` | 通用 draft → persist |
| 468 | `createManagedAccount({...})` | 新建账号 |
| 488 | `updateManagedAccountPermissions(id, perms)` | 更新权限 |
| 502 | `updateManagedAccountPassword(id, password)` | 更新密码（生成 sha256+bcrypt） |

> 注：原 server.js 没有 `updateManagedAccount` / `deleteManagedAccount` 函数
> （任务描述中提到的，实际不存在）。本 Plan 不创造，按现状抽。

#### G. 登录核心（→ `lib/auth/credentials.js`，依赖 `lib/passwordHasher` + store）

| 行号 | 函数 | 简述 |
|---|---|---|
| 703 | `verifyPasswordHash(password, hex)` | 兼容旧调用（保留） |
| 709 | `findAccountByCredentials(username, password)` | 查匹配账号 |
| 726 | `upgradeAccountToBcrypt(id, plain)` | sha256→bcrypt 自动升级 |
| 749 | `getMatchedAccount(username, password)` | 上面两个的合体 |

#### H. SESSION_STORE 操作（→ `lib/auth/session.js`，依赖 store + permissions + accounts）

| 行号 | 函数 | 简述 |
|---|---|---|
| 647 | `parseCookies(cookieHeader)` | 解析 Cookie 头 |
| 669 | `cleanupSessions()` | 清理过期 session |
| 678 | `createSession(account)` | 生成 sid + 写入 store |
| 757 | `getSessionByRequest(req)` | req → session |
| 789 | `setSessionCookie(res, sid)` | 写 set-cookie |
| 800 | `clearSessionCookie(res)` | 清 cookie |
| 833 | `buildAuthMePayload(session)` | /api/auth/me 输出 |

#### I. middleware（→ `apps/gateway/middleware/`）

| 行号 | 函数 | 简述 | 目标 |
|---|---|---|---|
| 809 | `normalizeNext(raw)` | 校验 next URL | → `lib/auth/redirects.js`（小工具） |
| 817 | `isPublicPath(pathname)` | 公共路径白名单 | → `lib/auth/redirects.js` |
| 847 | `isApiLikeRequest(req)` | 是否 API 请求 | → `middleware/requireAuth.js`（私有） |
| 851 | `denyPermission(req, res, key)` | 403 / redirect | → `middleware/requirePermission.js`（私有） |
| 868 | `requirePermission(key)` | 工厂 | → `middleware/requirePermission.js` |
| 877 | `requireAnyPermission(keys)` | 工厂 | → `middleware/requirePermission.js` |
| 886 | `requireAdmin(req, res, next)` | 必须 admin | → `middleware/requireAdmin.js` |
| 893 | `hasAgentReadToken(req)` | bearer/header token 识别 | → `middleware/requireAgentContextAccess.js`（私有） |
| 906 | `requireAgentContextAccess(req, res, next)` | analysis OR agent token | → `middleware/requireAgentContextAccess.js` |
| 920 | `resolvePostLoginRoute(account, rawNext)` | 登录后重定向决定 | → `lib/auth/redirects.js` |
| 929 | `renderLoginPage(sharedUsername)` | 渲染 login.html | 留 server.js（依赖 PUBLIC_DIR） |

#### J. 顶层 session 注入中间件（行 1502-1510）

> 当前是匿名 `app.use((req, _res, next) => { req.authSession = ...; next(); })`，
> 抽成具名 `middleware/sessionEnrichment.js`（依赖 `lib/auth/session.getSessionByRequest`）。

#### K. 不抽（V4 / 留场）※

| 函数（行号） | 说明 |
|---|---|
| `getLanIps` (517) / `stampNow` (530) / `nowText` (540) | server.js 工具 |
| `findLatestGapWorkbookPath` (551) / `ensureSheet` (573) / `buildGapTemplateWorkbook` (582) | report 模块的 xlsx 辅助 |
| `parsePositiveInt` (610) / `normalizeAgentPeriodType` (618) | 参数校验工具 |
| `hasClientBuild` (626) / `sendReactApp` (630) | SPA 渲染工具 |
| `appendJobLog` (934) / `sleep` (947) / `isChildRunning` (951) / `appendArrivalServiceLog` (955) | jobs/arrival 工具（V4 抽 `lib/jobs.js`） |
| `getArrivalStatusUrl` (966) / `getNotesHealthUrl` (970) / `getArrivalStartScriptPath` (974) / `getArrivalAutoStartState` (978) / `getReportDbStatus` (1016) / `spawnArrivalService` (1031) / `ensureArrivalServiceReady` (1073) / `getArrivalServiceStatus` (1111) / `getNotesServiceStatus` (1155) / `refreshArrivalViaUpstream` (1169) | arrival/notes 子进程编排（V4） |
| `startManagedJob` (1210) | jobs（V4） |
| `proxyRequest` (1273) / `proxyArrivalRequest` (1389) / `forwardNotesRequest` (1409) / `probeJson` (1461) | 代理（V4 抽 `lib/proxy.js`） |
| `startServer` (1674) | 启动 + warmup（保留） |

### 1.4 死代码确认

- 行 200 `const AUTH_CONFIG = loadAuthConfig();` —— 计算后**没有任何引用**
  （PR12 grep 验证：仅出现在第 200 行赋值）。`loadAuthConfig` 函数本身也只服务于这一处。
  - **结论**：本 PR 删除 `AUTH_CONFIG` 常量与 `loadAuthConfig` 函数。
  - 防回归：迁移后 `grep -rn "loadAuthConfig\|AUTH_CONFIG[^_]" apps/gateway` 必须为空。

---

## 2. 消费者地图

### 2.1 routes/* × ctx 函数矩阵

| 函数（来自 server.js） | auth-public | auth-session | admin | arrival | agent | spa | health | dashboard | report | docs | metrics |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `getAuthStore` | ✓ | ✓ | ✓ | ✓ |  |  | ✓ |  |  |  |  |
| `getMatchedAccount` | ✓ |  |  |  |  |  |  |  |  |  |  |
| `createSession` | ✓ |  |  |  |  |  |  |  |  |  |  |
| `setSessionCookie` | ✓ |  |  |  |  |  |  |  |  |  |  |
| `clearSessionCookie` | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| `SESSION_STORE` | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| `parseCookies` | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| `buildAuthMePayload` | ✓ | ✓ |  |  |  |  |  |  |  |  |  |
| `normalizeNext` | ✓ |  |  |  |  |  |  |  |  |  |  |
| `resolvePostLoginRoute` | ✓ |  |  |  |  |  |  |  |  |  |  |
| `renderLoginPage` | ✓ |  |  |  |  |  |  |  |  |  |  |
| `sanitizeAccountForClient` |  |  | ✓ |  |  |  |  |  |  |  |  |
| `createManagedAccount` |  |  | ✓ |  |  |  |  |  |  |  |  |
| `updateManagedAccountPermissions` |  |  | ✓ |  |  |  |  |  |  |  |  |
| `updateManagedAccountPassword` |  |  | ✓ |  |  |  |  |  |  |  |  |
| `AUTH_PERMISSION_MODULES` |  |  | ✓ |  |  |  |  |  |  |  |  |
| `requireAdmin` |  |  | ✓ |  |  | ✓ |  |  |  | ✓ | ✓ |
| `requirePermission` |  |  |  | ✓ | ✓ | ✓ |  | ✓ | ✓ |  |  |
| `requireAnyPermission` |  |  |  |  |  |  |  |  | ✓ |  |  |
| `requireAgentContextAccess` |  |  |  |  | ✓ |  |  |  |  |  |  |
| `isPrimaryAdminAccount` |  |  |  | ✓ |  |  |  |  |  |  |  |

> dispatch 模块（`services/dispatch.tryRegister`）直接收 `{ requirePermission }`。

### 2.2 中间件如何注入 req.*

`server.js` 行 1502-1510 的匿名中间件：
- `req.authSession` ← `getSessionByRequest(req)`
- `req.authAccountId` / `req.authUser` / `req.authName` / `req.authIsAdmin` / `req.authPermissions`
  ← 从 session 解构

下游消费：
- `routes/auth-public.js` 用 `req.authUser` / `req.authSession`
- `routes/auth-session.js` 用 `req.authSession`
- `middleware/auditRequest.js` 用 `req.authAccountId` / `req.authUser` / `req.authIsAdmin`
- 几乎所有 `requirePermission` 工厂用 `req.authSession`
- `routes/arrival.js` 用 `req.authSession?.account_id` / `name` / `is_admin`

---

## 3. 拟定新文件结构

```
apps/gateway/
├── server.js                              ~ 600 行（仅组装：require + app.use + register）
├── lib/
│   ├── passwordHasher.js                  （现存，不动）
│   └── auth/
│       ├── index.js                       聚合 re-export，方便外部 require
│       ├── permissions.js                 AUTH_PERMISSION_MODULES + 矩阵函数
│       ├── accounts.js                    normalize + sanitize + clone + validate + CRUD
│       ├── config.js                      路径常量 + safeJsonRead + writeJsonAtomic + buildAuthStore + loadManagedAuthStore + exportAuthConfig + ensureBackup + persistAuthStore
│       ├── store.js                       AUTH_STORE 单例 (getAuthStore/replace/reload) + getAuthAccountById + isPrimaryAdminAccount
│       ├── credentials.js                 verifyPasswordHash + findAccountByCredentials + upgradeAccountToBcrypt + getMatchedAccount
│       ├── session.js                     SESSION_STORE 单例 + parseCookies + cleanupSessions + createSession + getSessionByRequest + setSessionCookie + clearSessionCookie + buildAuthMePayload + AUTH_COOKIE_SECURE
│       └── redirects.js                   normalizeNext + isPublicPath + resolvePostLoginRoute
└── middleware/
    ├── auditRequest.js                    （现存）
    ├── metrics.js                         （现存）
    ├── validateBody.js                    （现存）
    ├── sessionEnrichment.js               把行 1502-1510 抽出
    ├── requirePermission.js               requirePermission + requireAnyPermission + denyPermission(私) + isApiLikeRequest(私)
    ├── requireAdmin.js                    requireAdmin
    └── requireAgentContextAccess.js       requireAgentContextAccess + hasAgentReadToken(私)
```

### 3.1 `lib/auth/index.js` 聚合示例（伪码）

```js
"use strict";
module.exports = {
  ...require("./permissions"),
  ...require("./accounts"),
  ...require("./config"),
  ...require("./store"),
  ...require("./credentials"),
  ...require("./session"),
  ...require("./redirects"),
};
```

> 谁需要某个具体函数仍可 `const { createSession } = require("./lib/auth/session")`,
> 但 `require("./lib/auth")` 是后向兼容的总入口。

### 3.2 `AUTH_PERMISSION_MODULES` 的 dispatch 依赖

原代码：
```js
const AUTH_PERMISSION_MODULES = [
  ...,
  ...(dispatchModule.isEnabled() ? [dispatchModule.PERMISSION_MODULE] : []),
];
```
→ 抽到 `lib/auth/permissions.js` 后**保持顶层求值**。
依赖关系：`permissions.js` 在顶层 `require("../../services/dispatch")`。
注意：`dispatchModule.isEnabled()` 必须在 `permissions.js` 被首次 require 之前就拥有
最终值（实际取决于 `process.env.DISPATCH_AGENT_ENABLED`，启动期已定）。
**风险点**：如果有人在测试中先 `vi.stubEnv` 再 `require("./lib/auth")`，
顺序错了会拿到旧值。本 PR 在 `permissions.js` 顶端加注释写明这个约束。

---

## 4. 函数迁移映射表（1:1）

| 源行号 | 函数/常量 | → 目标文件 | 导出 | 备注 |
|---:|---|---|:-:|---|
| 32-38 | `AUTH_CONFIG_*_PATH` 常量 | `lib/auth/config.js` | ✓ | |
| 46-48 | `AUTH_COOKIE_SECURE` | `lib/auth/session.js` | ✓ | |
| 50 | `SESSION_STORE` | `lib/auth/session.js` | ✓ (具名) | module-scoped |
| 57 | `AUTH_STORE` (let) | `lib/auth/store.js` | ✗ | 闭包内私有 |
| 59-67 | `AUTH_PERMISSION_MODULES` | `lib/auth/permissions.js` | ✓ | dispatch 顶层依赖 |
| 69-70 | `AUTH_PERMISSION_KEYS` / `_SET` | `lib/auth/permissions.js` | ✓ | |
| 72 | `sha256` | **删除**（用 `passwordHasher.sha256Hex`） | – | server.js 内 hash 调用切换 |
| 76 | `safeJsonRead` | `lib/auth/config.js` | ✗ | 私有 |
| 84 | `writeJsonAtomic` | `lib/auth/config.js` | ✗ | 私有 |
| 90 | `escapeHtml` | 留 server.js | – | 仅 `renderLoginPage` 用 |
| 99 | `normalizePermissionKeys` | `lib/auth/permissions.js` | ✓ | |
| 114 | `buildAccountId` | `lib/auth/accounts.js` | ✗ | `normalizeAuthAccount` 内部 |
| 128 | `normalizeAuthAccount` | `lib/auth/accounts.js` | ✓ | |
| 150-198 | `loadAuthConfig` | **删除** | – | 死代码 |
| 200 | `AUTH_CONFIG` | **删除** | – | 死代码 |
| 202 | `buildAuthStore` | `lib/auth/config.js` | ✓ | |
| 267 | `loadManagedAuthStore` | `lib/auth/config.js` | ✓ | |
| 281 | `getAuthStore` | `lib/auth/store.js` | ✓ | lazy 单例 |
| 288 | `replaceAuthStore` | `lib/auth/store.js` | ✓ | |
| 293 | `reloadAuthStore` | `lib/auth/store.js` | ✓ | |
| 297 | `resolvePreferredRouteForPermissions` | `lib/auth/permissions.js` | ✓ | |
| 307 | `resolvePreferredRouteForAccount` | `lib/auth/permissions.js` | ✓ | |
| 317 | `accountHasPermission` | `lib/auth/permissions.js` | ✓ | |
| 327 | `accountHasAnyPermission` | `lib/auth/permissions.js` | ✓ | |
| 331 | `isRouteAllowedForAccount` | `lib/auth/permissions.js` | ✓ | |
| 360 | `exportAuthConfig` | `lib/auth/config.js` | ✓ | |
| 381 | `ensureAuthConfigBackup` | `lib/auth/config.js` | ✓ | |
| 389 | `persistAuthStore` | `lib/auth/config.js` | ✓ | 写盘+replaceStore |
| 396 | `getAuthAccountById` | `lib/auth/store.js` | ✓ | |
| 404 | `isPrimaryAdminAccount` | `lib/auth/store.js` | ✓ | |
| 408 | `sanitizeAccountForClient` | `lib/auth/accounts.js` | ✓ | |
| 423 | `cloneAccountForMutation` | `lib/auth/accounts.js` | ✓ | |
| 435 | `validateAccountName` | `lib/auth/accounts.js` | ✗ | CRUD 内部 |
| 450 | `validateAccountPassword` | `lib/auth/accounts.js` | ✗ | CRUD 内部 |
| 461 | `updateAuthStore` | `lib/auth/accounts.js` | ✗ | CRUD 内部 |
| 468 | `createManagedAccount` | `lib/auth/accounts.js` | ✓ | |
| 488 | `updateManagedAccountPermissions` | `lib/auth/accounts.js` | ✓ | |
| 502 | `updateManagedAccountPassword` | `lib/auth/accounts.js` | ✓ | |
| 647 | `parseCookies` | `lib/auth/session.js` | ✓ | |
| 669 | `cleanupSessions` | `lib/auth/session.js` | ✗ | session 内部 |
| 678 | `createSession` | `lib/auth/session.js` | ✓ | |
| 703 | `verifyPasswordHash` | `lib/auth/credentials.js` | ✓ | |
| 709 | `findAccountByCredentials` | `lib/auth/credentials.js` | ✓ | |
| 726 | `upgradeAccountToBcrypt` | `lib/auth/credentials.js` | ✗ | |
| 749 | `getMatchedAccount` | `lib/auth/credentials.js` | ✓ | |
| 757 | `getSessionByRequest` | `lib/auth/session.js` | ✓ | |
| 789 | `setSessionCookie` | `lib/auth/session.js` | ✓ | |
| 800 | `clearSessionCookie` | `lib/auth/session.js` | ✓ | |
| 809 | `normalizeNext` | `lib/auth/redirects.js` | ✓ | |
| 817 | `isPublicPath` | `lib/auth/redirects.js` | ✓ | |
| 833 | `buildAuthMePayload` | `lib/auth/session.js` | ✓ | |
| 847 | `isApiLikeRequest` | `middleware/requirePermission.js` | ✗ | 私有 |
| 851 | `denyPermission` | `middleware/requirePermission.js` | ✗ | 私有 |
| 868 | `requirePermission` | `middleware/requirePermission.js` | ✓ | |
| 877 | `requireAnyPermission` | `middleware/requirePermission.js` | ✓ | |
| 886 | `requireAdmin` | `middleware/requireAdmin.js` | ✓ | |
| 893 | `hasAgentReadToken` | `middleware/requireAgentContextAccess.js` | ✗ | 私有 |
| 906 | `requireAgentContextAccess` | `middleware/requireAgentContextAccess.js` | ✓ | |
| 920 | `resolvePostLoginRoute` | `lib/auth/redirects.js` | ✓ | |
| 929 | `renderLoginPage` | 留 server.js | – | 依赖 PUBLIC_DIR |
| 1502-1510 | session enrichment 中间件 | `middleware/sessionEnrichment.js` | ✓ | factory 接受 `getSessionByRequest` |

**条目数**: 51 条（含死代码删除 2 条 + 留场 2 条 + 真迁移 47 条）。

---

## 5. ctx 注入模式：兼容期策略

### 5.1 当前 routes/* 通过 ctx 注入的代价

每条 route register 平均接收 9-15 个回调。当 server.js 把这些回调**真正定义**
到自己的顶层时，ctx 注入是必要的。但现在它们将搬到 `lib/auth/*`，
routes/* 完全可以**直接 require**。

### 5.2 三种方案对比

| 方案 | 改动范围 | 风险 | V3 决策 |
|---|---|---|---|
| A. server.js 继续注入，函数体改成转发到 lib/auth/* | routes/* 零改动 | server.js 还要保留 30+ 函数引用，组装清单还是冗长 | ✗ |
| B. routes/* 改成直接 `require("../lib/auth")`，删除对应 ctx 字段 | 触及 8 个 routes 文件 | 测试矩阵覆盖良好；改动机械、易 review | **✓ 推荐** |
| C. 二者并存（server.js 注入 + routes/* 也 require） | 双轨；最差 | 同一函数 2 个引用源，状态一致性靠 require 缓存 | ✗ |

### 5.3 推荐：方案 B + 一个 PR 完成

- routes/auth-public.js / auth-session.js / admin.js / arrival.js / agent.js
  改成：`const auth = require("../lib/auth");` + 直接调用。
- server.js 的 register 调用从 `register(app, { … 15 个回调 … })` 简化为
  `register(app, { express, /* 仅业务依赖（reportRepo / agentService 等）*/ })`。
- 中间件 `requirePermission` / `requireAdmin` / `requireAgentContextAccess`
  也改成 `routes/* require("../middleware/...")`，不再走 ctx。

> 兼容期：如果想保守，可在 `lib/auth/index.js` 加 deprecate 注释，
> 给 server.js 留一个 `legacyAuthCtx()` helper 一次性吐出旧 ctx 形状。
> 但这在单 PR 内意义不大——本 PR 一次切干净。

### 5.4 ctx 简化后 server.js 的 register 调用例

抽取后 `server.js` 的 routes/admin 注册：
```js
require("./routes/admin").register(app, {
  express,
  runtimeSecrets,
  // ops 相关仍走 ctx（V4 再抽）
  getArrivalAutoStartState,
  getArrivalServiceStatus,
  refreshArrivalViaUpstream,
  startManagedJob,
  JOB_STORE,
  ARRIVAL_BASE,
  ARRIVAL_PROJECT_DIR,
  PG_PIPELINE_SCRIPT,
  PROJECT_ROOT,
  getPool: () => reportRepo.getPool(),
});
```
admin.js 内部 `require("../middleware/requireAdmin")` + `require("../lib/auth")`。

---

## 6. 拆分顺序（PR 内 commit-by-commit，可逐步验证）

每步结束后跑 `npm test --prefix apps/gateway`（vitest），全绿才往下。

| 步 | 动作 | 验证 |
|---:|---|---|
| 1 | 创建 `lib/auth/permissions.js`，**复制**函数过去并 export；server.js 改成 `const perm = require("./lib/auth/permissions")` 后用 `perm.xxx` | 全绿 |
| 2 | 删 server.js 内被取代的函数体 | 全绿 |
| 3 | 同样手法抽 `lib/auth/accounts.js`（除 CRUD 函数，先抽 normalize/sanitize/clone） | 全绿 |
| 4 | 抽 `lib/auth/config.js`（safeJsonRead + writeJsonAtomic + buildAuthStore + loadManagedAuthStore + exportAuthConfig + ensureAuthConfigBackup + persistAuthStore），同时**删** `loadAuthConfig` 和 `AUTH_CONFIG` | 全绿 |
| 5 | 抽 `lib/auth/store.js`（getAuthStore/replace/reload/getAccountById/isPrimaryAdminAccount） | 全绿 |
| 6 | 把 CRUD（create/updatePerm/updatePwd + validate/clone/updateAuthStore）搬到 `lib/auth/accounts.js` | 全绿 |
| 7 | 抽 `lib/auth/credentials.js`（verifyPasswordHash + findAccountByCredentials + upgradeAccountToBcrypt + getMatchedAccount） | 全绿 |
| 8 | 抽 `lib/auth/session.js`（SESSION_STORE + parseCookies + cleanupSessions + createSession + getSessionByRequest + setSessionCookie + clearSessionCookie + buildAuthMePayload + AUTH_COOKIE_SECURE） | 全绿（重点观察 admin/auth smoke） |
| 9 | 抽 `lib/auth/redirects.js`（normalizeNext + isPublicPath + resolvePostLoginRoute） | 全绿 |
| 10 | 创建 `lib/auth/index.js` 聚合 re-export | 全绿 |
| 11 | 抽 `middleware/requirePermission.js`、`requireAdmin.js`、`requireAgentContextAccess.js` | 全绿 |
| 12 | 抽 `middleware/sessionEnrichment.js`，server.js 行 1502-1510 改成 `app.use(sessionEnrichment(getSessionByRequest))` | 全绿 |
| 13 | 改 routes/* 直接 require（删除 ctx 注入），server.js register 调用同步精简 | 全绿（最大改动 commit，重点 review） |
| 14 | 加 `lib/auth/__tests__/*` 单测（见 §7） | 全绿 |
| 15 | 跑完整套：`npm test`、`npm run lint`、本地 `node apps/gateway/server.js` 走 login → admin → logout | 手工冒烟 ✓ |

---

## 7. 测试矩阵

### 7.1 既有 smoke（必须不破）

| 文件 | 关键覆盖路径 |
|---|---|
| `tests/smoke/auth.test.js` | 错密 401、未知 user 401、正确 200+set-cookie、me 401/200、logout、非 admin 权限 |
| `tests/smoke/admin.test.js` | 401 / 403 / 200 / password_hash 不泄露 |
| `tests/smoke/dispatch.test.js` | dispatch 开关与权限 |
| `tests/smoke/agent.test.js` | requireAgentContextAccess 路径 |
| `tests/smoke/health.test.js` | healthz / readyz / api/health |
| `tests/smoke/report.test.js` | requirePermission("report_daily") |
| `tests/smoke/validation.test.js` | validateBody schema |

> 这 7 套全跑 = 守住边界。本 PR **不修改任何 smoke 文件**。

### 7.2 必须新增的单测（lib 级）

| 新文件 | 覆盖 |
|---|---|
| `lib/auth/__tests__/permissions.test.js` | normalizePermissionKeys 边界（非数组/未知 key/重复）、accountHasPermission（admin / 非 admin / null）、isRouteAllowedForAccount 全 case、resolvePreferredRouteFor* |
| `lib/auth/__tests__/accounts.test.js` | normalizeAuthAccount（缺字段 / 非 hex / 默认值）、sanitizeAccountForClient（不泄露敏感）、validateAccountName/Password 的抛错 |
| `lib/auth/__tests__/store.test.js` | getAuthStore 单例（多次调用同一引用）、reloadAuthStore 后引用更新、isPrimaryAdminAccount |
| `lib/auth/__tests__/session.test.js` | SESSION_STORE 单例（跨 require 同一 Map）、createSession + getSessionByRequest 闭环、cleanupSessions 过期回收 |
| `lib/auth/__tests__/credentials.test.js` | findAccountByCredentials（匹配 / 不匹配 / 触发 needsUpgrade）、upgradeAccountToBcrypt 持久化失败时不抛 |
| `lib/auth/__tests__/redirects.test.js` | normalizeNext（"/"/"//evil"/相对路径）、isPublicPath、resolvePostLoginRoute |

> 这些测试用 `apps/gateway/tests/fixtures/auth.fixture.json`（已有），
> 在测试入口 `process.env.AUTH_CONFIG_PATH` 指向 fixture，与现有 smoke 一致。

### 7.3 bcrypt 路径（PR5）回归确认

`tests/smoke/auth.test.js` 的 "正确密码 200 + set-cookie" 已经走的是
`getMatchedAccount` → `findAccountByCredentials` → `passwordHasher.verify`。
迁移后该路径必须不破，且 needsUpgrade 分支仍然触发
`upgradeAccountToBcrypt`（用 fixture 中 sha256-only 账号触发即可）。

---

## 8. 风险点

### 8.1 单例语义（⚠ 最高优先级）

- **AUTH_STORE / SESSION_STORE 必须跨文件单例。**
  Node `require` 缓存机制保证：同一绝对路径模块只 evaluate 一次，
  module 顶层 `let SESSION_STORE = new Map()` 即天然单例。
  但要小心：
  - **vitest 隔离**：vitest 默认每个 test file 一个 module registry，
    即跨 test file 共享同一 Map 不成立。这与现状（server.js 也是 module-scoped）一致，
    不引入新风险。
  - **多份 require 路径**：禁止 `require("./lib/auth/session.js")` 与
    `require("./lib/auth/session/index.js")` 并存（路径解析不同会生成两份 module）。
    本 Plan 只用 `lib/auth/session.js` 单文件入口。

### 8.2 `replaceAuthStore` 的写入语义 ⚠

- `persistAuthStore` 顺序：写 backup → 写 local 文件 → `replaceAuthStore(buildAuthStore(...))`。
- 抽走后必须保持**完全相同顺序**。如果先 replace 再写文件，进程崩溃会丢盘。
- 兼容性：`persistAuthStore` 现位于 `config.js`，但 `replaceAuthStore` 在 `store.js`。
  → `config.js` `require("./store").replaceAuthStore`，无环依赖。

### 8.3 `AUTH_PERMISSION_MODULES` 的 dispatch 顶层依赖 ⚠

- `permissions.js` 顶层 `require("../../services/dispatch")`，
  这意味着首次 `require("./lib/auth/permissions")` 必然 evaluate dispatch 模块。
- 测试中如果想动态切换 `DISPATCH_AGENT_ENABLED`，必须**先 stub env 再 require**。
  在 `lib/auth/__tests__/permissions.test.js` 顶部加注释。

### 8.4 `normalizeAuthAccount` 的隐式默认值

- `is_admin: raw.is_admin !== false`（默认 true！）。这是历史包袱，
  `buildAuthStore` 后续会强制把非 primary admin 的 `is_admin` 重置为 false，
  抹掉这个默认值。**不能在迁移中"顺手"修正这个语义**。
  → 在 `accounts.js` 加注释说明，本 PR 不动行为。

### 8.5 `SESSION_STORE` 不能丢

- 抽到 `lib/auth/session.js` 后，**所有现有在线用户的 sid 都还在内存里**——
  只要 server 进程不重启就 OK。但本 PR 的部署本身要重启进程，
  所以发布会让现有用户重新登录一次。**这是预期行为，已与现状（重启失效）一致**。
  → 发布说明里写一行。

### 8.6 测试 fixture 路径

- vitest.config.js 通过 `AUTH_CONFIG_PATH` 指向 fixture。
  `lib/auth/config.js` 必须**沿用** `process.env.AUTH_CONFIG_PATH` 读法
  （不能改成模块顶层求值，否则测试 stub 失效）。
  → 路径常量 `AUTH_CONFIG_DEFAULT_PATH` 仍保持模块顶层求值，但每次 `loadManagedAuthStore`
    都重新 read，不缓存。与现状一致。

### 8.7 高风险函数清单（合 review 必须二人 confirm）

- ⚠ `buildAuthStore`（行 202-265）—— 60+ 行，含 primary admin 强制、permissions 重写。一行错就权限全炸。
- ⚠ `persistAuthStore`（行 389）—— 写盘 + buildAuthStore 二次 normalize + replace，顺序敏感。
- ⚠ `getAuthStore`（行 281）—— lazy 单例，迁移后必须保持"首次调用前不读盘"行为。
- ⚠ `createSession`（行 678）—— `getAuthAccountById(session.account_id)` 立即校验，
  抽出后 `session.js` 必须 require `store.js` 且无环。
- ⚠ `getSessionByRequest`（行 757）—— 涉及过期清理 + cookie 解析 + store 查找，路径长。
- ⚠ `denyPermission`（行 851）—— 决定 401/403/redirect，front-end 行为依赖。
- ⚠ session enrichment 中间件（行 1502-1510）—— 注入 5 个 req 字段，
  下游 `auditRequest`/`requirePermission` 全部依赖。
- ⚠ `AUTH_PERMISSION_MODULES`（行 59-67）—— 顶层 dispatch 依赖，evaluate 时机敏感。

---

## 9. 不做什么（V4 留口）

- ✗ 不引入 SSO / OAuth / OIDC
- ✗ 不改 SESSION_STORE 持久化（保持 in-memory）
- ✗ 不抽 `startServer` / warmup（保持在 server.js）
- ✗ 不抽 `arrival/notes` 子进程管理（spawnArrivalService / ensureArrivalServiceReady / proxyArrivalRequest / forwardNotesRequest）→ V4 抽 `lib/proxy.js` + `lib/arrival.js`
- ✗ 不抽 `JOB_STORE` / `startManagedJob`（V4 抽 `lib/jobs.js`）
- ✗ 不抽 `getReportDbStatus` / `getNotesServiceStatus` / `getArrivalServiceStatus`（V4 随 arrival/notes 一并抽）
- ✗ 不动 `proxyRequest` / `probeJson`（V4 抽 `lib/proxy.js`）
- ✗ 不动业务行为，**只迁移代码位置**

---

## 10. 完工定义（DoD）

- [ ] `apps/gateway/server.js` 行数 ≤ 600
- [ ] `apps/gateway/lib/auth/` 7 个新文件就位（permissions / accounts / config / store / credentials / session / redirects + index）
- [ ] `apps/gateway/middleware/` 4 个新文件（sessionEnrichment / requirePermission / requireAdmin / requireAgentContextAccess）
- [ ] `apps/gateway/lib/auth/__tests__/` 6 套单测就位且全绿
- [ ] `npm test --prefix apps/gateway` 全绿（含原 7 套 smoke）
- [ ] `grep -rn "loadAuthConfig\b\|\bAUTH_CONFIG[^_]" apps/gateway` 为空（死代码已清）
- [ ] 本地启动 gateway 走完 login → /api/auth/me → /api/admin/accounts → logout 流程
- [ ] PR 描述写明：单 PR 可一键 revert / SESSION_STORE 重启失效（已知）/ 不动业务行为
- [ ] CHANGELOG 一行：`gateway: extract auth/session/permission to lib/auth and middleware/* (no behavior change)`

---

## 附录 A. 估算

| 项 | 数量 |
|---|---:|
| 新建文件 | 11（lib/auth × 7 含 index + middleware × 4） |
| 新建测试 | 6 |
| 修改文件 | server.js + 8 routes |
| 删除函数 | 2（loadAuthConfig、sha256） |
| 删除常量 | 1（AUTH_CONFIG） |
| 迁移函数 | 47 |
| 预计 LoC：新增 ~ 1500（含测试），删除 ~ 1100 | net +400 |
| 预计开发工时 | 1 天（含跑测试 + 手工冒烟） |
