# ADR 0015: server.js auth/session/permission 二抽到 lib/auth + middleware/

- 日期：2026-04-25
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：V3 PR13（`codex/mac/uplift-v3-server-auth`）
- 关联设计：`docs/plans/2026-04-25-v3-server-auth-extract-plan.md`
- 前序 ADR：ADR-0004（首轮 routes/* 抽取）

## 背景

PR4 把 9 个 routes 模块从 `server.js` 搬出后，主文件仍 1719 行，
原因是 **auth / session / permission** 这一横切关注点没动：

- 18 个顶层模块状态（`AUTH_STORE` / `SESSION_STORE` / 路径常量等）
- 51 个顶层函数，其中 **30+ 个**全部围绕 auth 旋转
- 每条 route 的 `register(app, ctx)` 调用平均要传 **9-15 个回调**给 ctx

具体症状：
- `routes/admin.js` 一行 register 收 17 个 ctx 字段，新增 admin 端点需要在
  server.js 同步加注入项 → 改 1 行变改 2 文件
- `lib/auth/*` 里没有任何代码 → 单测覆盖 0
- `AUTH_STORE` 通过闭包共享，跨文件单例靠"只在 server.js evaluate 一次"
  这种隐式约束维护，迁移到 `lib/` 后才能用 Node `require` 缓存的标准语义
- 行 200 `const AUTH_CONFIG = loadAuthConfig()` 死代码（PR12 grep 验证全文
  无第二处引用）

## 决策

**把 auth/session/permission 一次性搬到 `apps/gateway/lib/auth/`，
中间件搬到 `apps/gateway/middleware/`。routes/* 改为直接 require，
彻底放弃 ctx 注入这条路径。**

具体策略：
1. **lib/auth/ × 7 + index** —— 每个文件按职责切：
   - `permissions.js` — 权限矩阵 + matrix 函数
   - `accounts.js` — normalize / sanitize / validate / CRUD
   - `config.js` — 文件 IO + buildAuthStore + persistAuthStore
   - `store.js` — AUTH_STORE 模块单例
   - `credentials.js` — 凭据匹配 + bcrypt 自动升级
   - `session.js` — SESSION_STORE 模块单例 + cookie 处理
   - `redirects.js` — normalizeNext / isPublicPath / resolvePostLoginRoute
   - `index.js` — 聚合 re-export，便于 `require("./lib/auth")` 一站式取用
2. **middleware/ × 4** —— 每个文件 1 个职责：
   - `sessionEnrichment.js` — 把行 1502-1510 的匿名 use 抽出
   - `requirePermission.js` — `requirePermission` + `requireAnyPermission`
   - `requireAdmin.js` — admin 闸
   - `requireAgentContextAccess.js` — analysis 权限 OR Bearer token
3. **routes/* 改 require（方案 B 一刀切）** —— 不留双轨。
   `routes/auth-public.js` 等不再从 `ctx` 取 `getAuthStore`、
   `requirePermission`，直接 `require("../lib/auth/...")` 或
   `require("../middleware/...")`。
4. **死代码删除**：`AUTH_CONFIG` 常量 + `loadAuthConfig` 函数。
   `server.js` 内的局部 `sha256` 函数改用 `passwordHasher.sha256Hex`。
5. **lib/auth/__tests__/* × 6 套单测** —— 第一次给 auth 子系统加上
   逐函数的覆盖（permissions/accounts/config/store/credentials/session/
   redirects 共 95 个 assertion）。

### 新文件清单

```
apps/gateway/
├── lib/auth/
│   ├── index.js                 (22)   聚合 re-export
│   ├── permissions.js          (116)   AUTH_PERMISSION_MODULES + matrix
│   ├── accounts.js             (190)   normalize/sanitize/CRUD
│   ├── config.js               (192)   safeJsonRead/buildAuthStore/persist
│   ├── store.js                 (55)   AUTH_STORE 单例
│   ├── credentials.js           (84)   findAccount/upgradeBcrypt
│   ├── session.js              (165)   SESSION_STORE 单例 + cookie
│   ├── redirects.js             (56)   normalizeNext/isPublicPath
│   └── __tests__/
│       ├── permissions.test.js  (140)
│       ├── accounts.test.js     (155)
│       ├── config.test.js       (105)
│       ├── store.test.js        (~70)
│       ├── credentials.test.js  (~75)
│       ├── session.test.js      (~110)
│       └── redirects.test.js    (~85)
└── middleware/
    ├── sessionEnrichment.js     (32)   req.authSession 注入
    ├── requirePermission.js     (65)   requirePermission/Any
    ├── requireAdmin.js          (40)   admin 闸 + denyAdmin
    └── requireAgentContextAccess.js (45)
```

### server.js 减肥效果

```
PR12 末态：1719 行
PR13 末态：940 行
抽出：    -779 行（−45%）
```

剩余 940 行全部是 V3 不抽的 V4 留场内容（plan §9 写明）：
- arrival/notes 子进程编排（spawn / proxy / probe / forward）
- JOB_STORE + startManagedJob
- xlsx / SPA fallback / 启动 + warmup

## 关键设计选择

### 单例语义靠 Node require 缓存

`AUTH_STORE` 在 `lib/auth/store.js` module-scope 内 `let AUTH_STORE = null`，
`SESSION_STORE` 在 `lib/auth/session.js` 内 `const SESSION_STORE = new Map()`。
Node 对同一绝对路径只 evaluate 一次，所以这两个单例天然全局唯一。
**前提**：禁止引入第二个 require 路径（如 `lib/auth/store/index.js`），
否则会生成两份模块实例。`lib/auth/index.js` 走的是 re-export，不会复制。

### persistAuthStore 写盘顺序锁定

```js
function persistAuthStore(nextStore) {
  ensureAuthConfigBackup();           // 1) 写 backup（仅首次）
  fs.mkdirSync(...);                  //
  writeJsonAtomic(LOCAL_PATH, ...);   // 2) 写 local 文件
  return replaceAuthStore(            // 3) 替换内存单例
    buildAuthStore(exportAuthConfig(nextStore))
  );
}
```

**顺序不能调**：先 replace 再写盘，进程崩溃后磁盘还是旧的，
但内存里下次 reload 也还是旧的——直到下次写盘前的所有变更全部丢失。
单测 `lib/auth/__tests__/config.test.js` 验证 buildAuthStore 行为，
端到端通过 `tests/smoke/admin.test.js`（账号 CRUD）做回归。

### dispatch 顶层依赖

`permissions.js` 顶层 `require("../../services/dispatch")`，
`AUTH_PERMISSION_MODULES` 在 module load 时根据 `dispatchModule.isEnabled()`
决定是否包含 dispatch 行。**对测试的约束**：要切换
`DISPATCH_AGENT_ENABLED` 必须在 `require("./lib/auth/permissions")` 之前。
vitest.config.js 已在 `env.DISPATCH_AGENT_ENABLED = "true"` 锁死，
新单测里加了注释。

### 循环依赖通过 lazy require 化解

`accounts.js` 的 CRUD 函数需要 `./store` 和 `./config`，
`config.js` 的 `buildAuthStore` 需要 `accounts.normalizeAuthAccount`。
解法：accounts.js 在 CRUD 函数体内 `require("./config")`、
`require("./store")`，不是顶层 require。Node `require` 缓存兜底，
首次调用前两个模块都已完成 evaluate。同样套路用于
`config.exportAuthConfig` lazy require `./store.getAuthStore`。

## 不做什么（V4 留口）

- ❌ 不引入 SSO / OAuth / OIDC（会议级讨论）
- ❌ 不持久化 SESSION_STORE（保持 in-memory，重启失效已知）
- ❌ 不抽 `startServer` / warmup（与启动期紧耦合）
- ❌ 不抽 arrival/notes 子进程编排（V4 → `lib/arrival.js`）
- ❌ 不抽 `JOB_STORE` / `startManagedJob`（V4 → `lib/jobs.js`）
- ❌ 不动 `proxyRequest` / `probeJson`（V4 → `lib/proxy.js`）
- ❌ 不改任何业务行为，**纯结构搬迁**

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| A. server.js 仍持函数，函数体改成 `lib/auth/*` 转发 | routes/* 零改动，但 server.js 还是 30+ 函数 export，组装清单冗长 |
| C. 双轨（server.js 注入 + routes/* 也 require） | 同一函数 2 个引用源，单例语义完全靠 require 缓存 |
| ✓ B. routes/* 直接 require，server.js 只 register | 触及 8 个 routes 文件但改动机械、易 review，一次切干净 |

## 后果

- ✅ server.js 940 行（−45%），routes/* register 调用 ctx 字段从 9-17 降到 0-12
- ✅ `lib/auth/__tests__/*` 6 套单测，95 个 assertion，第一次给 auth 子系统建立逐函数单测覆盖
- ✅ 全套 `npm test` 143 passed（baseline 48 → +95），多次稳定全绿
- ✅ 死代码 `AUTH_CONFIG` / `loadAuthConfig` 删除，`server.js sha256` 局部函数被 `passwordHasher.sha256Hex` 取代
- ⚠️ middleware 之间为避免互相 require 复制了 ~10 行 denyPermission 逻辑（`requirePermission.js` vs `requireAdmin.js`）—— 故意为之，避免互依
- ⚠️ SESSION_STORE 仍是进程内存，部署仍会让所有用户重新登录一次（与现状一致）

## 验证

- `npm test --prefix apps/gateway`：143/143 passed，10 次连续运行全绿
- `grep -rn "loadAuthConfig\b\|\bAUTH_CONFIG[^_]" apps/gateway`：空
- `grep -rn "ctx\.\(getAuthStore\|requirePermission\|...\)" routes/`：空
- 高风险函数（plan §8.7 列的 8 个）逐个有单测覆盖：
  - `buildAuthStore` → `config.test.js`（admin 强制、permissions 重写、TTL 下限、primary admin 兜底）
  - `getAuthStore` 单例 → `store.test.js`（双调用同引用 + reload 替换）
  - `createSession` / `getSessionByRequest` → `session.test.js`（round-trip + 过期清理）
  - `denyPermission` → 通过 smoke `admin.test.js` 的 401/403 端到端验证
  - `AUTH_PERMISSION_MODULES` dispatch 依赖 → `permissions.test.js` 验证 dispatch key 在 vitest env 下出现
  - session enrichment middleware → 通过 smoke `auth.test.js` 的 me/logout 端到端验证

## 后续

- **V4 PR**：抽 `lib/jobs.js` + `lib/proxy.js` + `lib/arrival.js`，把 server.js 推到目标 ≤ 600 行
- **V4 SESSION 持久化**：评估 Redis 方案以摆脱"重启全员失效"
- **持续覆盖**：在 lib/auth/__tests__/ 增加 fuzz 测试覆盖 normalizeAuthAccount 边界
