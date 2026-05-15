# Cookbook · 后端加新端点

> **目标**：在 `apps/gateway/routes/*` 加一个新的 HTTP 端点，带 zod 校验、权限闸、smoke 守门，跑通 401/403/400/200 全路径。

---

## 0. 前置阅读

- ADR-0004 `docs/adr/0004-server-route-extraction.md`：为什么 routes 拆出 server.js
- ADR-0006 `docs/adr/0006-request-validation-zod.md`：为什么 body 必须过 zod
- ADR-0015 `docs/adr/0015-server-auth-extract.md`：routes/* 直接 require lib/auth + middleware，不走 ctx
- 样板代码：`apps/gateway/routes/admin.js` / `apps/gateway/routes/dashboard.js` / `apps/gateway/routes/metrics.js`

---

## 1. 决策树：你的端点属于哪个 routes 文件？

| 端点路径 | 落在哪个 routes 文件 |
|---|---|
| `/api/admin/*` 或 `/api/settings/ai*` | `routes/admin.js`（require admin） |
| `/api/auth/login` `/login` `/logout` 等公开页 | `routes/auth-public.js` |
| `/api/auth/me` `/api/auth/logout` 等已登录 | `routes/auth-session.js` |
| `/api/dashboard/*` `/api/channel-dashboard/*` | `routes/dashboard.js` |
| `/api/report/*` `/api/report-daily/*` | `routes/report.js` |
| `/api/agent/*` `/api/analysis/*` | `routes/agent.js` |
| `/api/arrival/*` `/notes-api/*` | `routes/arrival.js` |
| `/healthz` `/readyz` `/api/health` `/api/ping` | `routes/health.js` |
| `/api/metrics`（Prometheus） | `routes/metrics.js` |
| `/openapi.yaml` `/docs` | `routes/docs.js` |
| `/dispatch/*` `/api/dispatch/*` | `services/dispatch/*`（独立 router） |

**新业务域**？新建 `routes/<domain>.js`，并在 `server.js` 里 `require("./routes/<domain>").register(app, ctx)`。

---

## 2. 步骤

### Step 1 · 写 zod schema（如果有 body / query 输入）

文件：`apps/gateway/schemas/<domain>.js`（按 routes 域分组放）

```js
"use strict";

const { z } = require("zod");

/**
 * POST /api/<domain>/<action>
 *
 * <在这里写 1-2 句业务说明>
 */
const myActionBodySchema = z.object({
  name: z.string().trim().min(1, "name is required").max(64),
  count: z.number().int().min(1).max(100).optional().default(10),
  tags: z.array(z.string().trim().min(1).max(32)).max(16).optional().default([]),
});

module.exports = { myActionBodySchema };
```

约定（从 `schemas/admin.js` 抄来的）：
- `z.string().trim().min(1, "<显式错误>")` —— 不写错误信息时，前端 toast 文字差到看不懂
- 数组 / 字符串都加 `.max()` —— 抗 OOM
- `.default([])` 让 handler 不需要 `req.body.tags || []`

### Step 2 · 在对应 routes/*.js 里注册端点

样板（从 `routes/admin.js` 抠出来的最小可用结构）：

```js
"use strict";

const { validateBody } = require("../middleware/validateBody");
const { requirePermission } = require("../middleware/requirePermission");
const { requireAdmin } = require("../middleware/requireAdmin");
const { myActionBodySchema } = require("../schemas/<domain>");

function register(app, ctx) {
  const {
    express,                  // 用于 express.json({ limit: "256kb" })
    // ...其他业务依赖（pool / repo / config）通过 ctx 注入
  } = ctx;

  // GET 端点：query 参数，无 body
  app.get(
    "/api/<domain>/<action>",
    requirePermission("<perm_key>"),    // 或 requireAdmin
    async (req, res, next) => {
      try {
        const limit = Math.min(100, Number(req.query.limit) || 20);
        const payload = await doSomething({ limit });
        res.json({ ok: true, ...payload });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST 端点：JSON body，必须过 zod
  app.post(
    "/api/<domain>/<action>",
    requirePermission("<perm_key>"),
    express.json({ limit: "256kb" }),   // body parser
    validateBody(myActionBodySchema),   // 校验
    async (req, res) => {
      try {
        // req.body 已被 zod 替换成 parsed value（包含 default）
        const result = await doSomething(req.body);
        res.status(201).json({ ok: true, result });
      } catch (err) {
        return res.status(400).json({
          ok: false,
          message: String(err?.message || err),
        });
      }
    }
  );
}

module.exports = { register };
```

要点：

1. **直接 `require("../middleware/...")` 和 `require("../lib/auth/...")`**，**不要从 ctx 取**（ADR-0015）
2. **顺序固定**：`requirePermission` → `express.json` → `validateBody` → handler
3. **每个 handler 必须 `try/catch` 或 `next(err)`**，否则全局 error middleware 兜不住
4. **响应形状统一**：成功 `{ ok: true, ...data }`，失败 `{ ok: false, message }`，写错误的端点会让前端 errorMessage() 兜不住
5. 200 / 201 / 400 / 401 / 403 / 404 / 503 / 500 含义遵循 `routes/admin.js` 现有约定（401 缺 cookie / 403 权限不够 / 400 校验失败 / 404 资源缺失）

### Step 3 · 在 server.js register（仅"新建 routes 文件"时需要）

`apps/gateway/server.js` 末尾找到现有 register 块，加一行：

```js
require("./routes/<domain>").register(app, {
  express,
  // 业务依赖按需注入
});
```

注意 register 的相对顺序：必须在 `app.use(sessionEnrichment())` 之后；如果端点要走静态 fallback，要在 `app.use(express.static(...))` 之前。

### Step 4 · 写 smoke 测试（强制）

文件：`apps/gateway/tests/smoke/<domain>.test.js`

样板（从 `tests/smoke/admin.test.js` 抠出来）：

```js
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { getApp, login } from "../helpers/app.js";

describe("smoke: <domain> endpoints", () => {
  let agent;

  beforeAll(() => {
    agent = request(getApp());
  });

  // 1. 401：缺 cookie
  it("GET /api/<domain>/<action> without cookie returns 401", async () => {
    const res = await agent.get("/api/<domain>/<action>");
    expect(res.status).toBe(401);
  });

  // 2. 403：权限不够（用 fixture 里 smoke-user，只有 portal/report_daily）
  it("GET /api/<domain>/<action> with smoke-user returns 403", async () => {
    const { cookie } = await login(agent, "smoke-user", "smoke-user-pass");
    const res = await agent.get("/api/<domain>/<action>").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  // 3. admin 能到 handler（PG 没启时 5xx 也算"路由挂上了"）
  it("GET /api/<domain>/<action> with admin reaches handler (NOT 403/404)", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent.get("/api/<domain>/<action>").set("Cookie", cookie);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
    expect([200, 500, 502, 503]).toContain(res.status);
  });

  // 4. POST 端点的 zod 校验：缺字段 → 400 + issues
  it("POST /api/<domain>/<action> rejects empty body with 400", async () => {
    const { cookie } = await login(agent, "smoke-admin", "smoke-pass");
    const res = await agent
      .post("/api/<domain>/<action>")
      .set("Cookie", cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });
});
```

测试账号都在 `apps/gateway/tests/fixtures/auth.fixture.json`：
- `smoke-admin` / `smoke-pass` —— `is_admin: true`，全权限
- `smoke-user` / `smoke-user-pass` —— 只有 `portal` + `report_daily`

需要新权限的测试，新增 fixture 账号或修改 permissions 数组（注意：测试 fixture 的 sha256 hash 已固定，**不要改 password**）。

### Step 5 · 跑测试

```bash
cd apps/gateway
npm test                                 # 全部 11 文件 / 78+ 用例
npm test -- tests/smoke/<domain>         # 只跑你这个 domain
```

期望：全绿。如果 5xx 是因为 PostgreSQL 没启，smoke 用例本身就允许 `[200, 500, 502, 503]`，能 pass 即视为路由挂上了。

### Step 6 · 同步前端 api 层（如果端点要被前端用）

文件：`apps/web/src/api/<domain>.js`

```js
import http from "./http";

/**
 * GET /api/<domain>/<action>
 * @param {{ limit?: number }} params
 */
export async function listMyAction({ limit = 20 } = {}) {
  const resp = await http.get("/api/<domain>/<action>", {
    params: { limit, _t: Date.now() },
  });
  return resp.data;
}

/**
 * POST /api/<domain>/<action>
 * @param {{ name: string, count?: number, tags?: string[] }} payload
 */
export async function createMyAction(payload) {
  const resp = await http.post("/api/<domain>/<action>", payload);
  return resp.data;
}
```

如果 `<domain>` 还没在 `apps/web/src/api/index.js` 里 export，加一行：

```js
import * as myDomainApi from "./<domain>";
export { myDomainApi };
```

详细的"前端怎么消费"见 [`add-new-page.md`](./add-new-page.md)。

### Step 7 · OpenAPI 同步（可选但推荐）

文件：`apps/gateway/openapi.yaml`

V3 后还没有自动生成，仍是手维护。加一段对应路径 + schema，然后访问 `/docs`（swagger-ui-express）肉眼检查。

V4 留口：`docs/adr/0018-openapi-generation.md` 在 `v3-openapi-gen` worktree。

---

## 3. 测试要求清单

- [ ] `npm test --prefix apps/gateway` 全绿
- [ ] 新加的 smoke 至少覆盖：401（无 cookie）/ 403（无权限）/ 200 或 5xx（admin 能到 handler）
- [ ] POST 端点必须有：400（zod 校验失败 + issues 非空）
- [ ] 路径包含 `:id` 等动态参数的：404（id 不存在）

---

## 4. 示例 PR / commit

| 场景 | 参考 |
|---|---|
| 加 admin 端点 + zod schema + smoke | PR9 加 `/api/admin/usage`：`routes/admin.js` 末尾的 usage 块 + `services/usageRepo.js` |
| 加 dashboard 端点（仅 GET，权限 `dashboard`） | `routes/dashboard.js` 5 个端点 |
| 公开端点 + zod | PR12 加 `/api/dispatch/public/preview`：`services/dispatch/router.js` |
| metrics 端点（admin only，text/plain） | `routes/metrics.js` 全文 30 行 |

---

## 5. 常见踩坑

1. **从 ctx 拿 `requirePermission` / `getAuthStore`** —— V3 后 ctx 不再传这些，直接 require。grep 一下 `ctx.requirePermission`，应该为空。
2. **忘了 `express.json({ limit: ... })`** —— 没这一句 `req.body` 永远是 `undefined`，`validateBody` 接到 `{}` 然后 issues 全是"required"。
3. **zod schema 缺 `.max()`** —— 字符串 / 数组没上限，攻击者可以让 body parser 慢慢吃 256kb。
4. **handler 不写 try/catch** —— async handler 抛错 Express 4 不会进 error middleware，必须 `next(err)` 或包 try/catch。
5. **smoke 用 `expect(res.status).toBe(200)`** —— CI 没 PostgreSQL，dashboard / report 类端点会返 500/503，应该用 `expect([200, 500, 503]).toContain(res.status)` 或 `expect(res.status).not.toBe(403)`。
6. **register 顺序错位** —— `routes/spa.js` 必须最后 register（catch-all 把 React 兜住），把你的端点放到它后面 → 永远 404。
7. **OpenAPI / 前端 api 层不同步** —— 后端改了 query 名（`date_from` vs `dateFrom`），前端 fetcher 还在传旧名 → 全屏 400。grep 检查。

---

## 6. 完成检查清单

- [ ] zod schema 写在 `schemas/<domain>.js`，error message 中文友好
- [ ] route handler 在 `routes/<domain>.js`，直接 require middleware（不走 ctx）
- [ ] 顺序：`requirePermission` → `express.json` → `validateBody` → handler
- [ ] handler 全 try/catch 或 next(err)
- [ ] smoke 用例覆盖 401 / 403 / 200-or-5xx，POST 端点加 400
- [ ] 前端 `api/<domain>.js` 的 fetcher 已更新，签名 `(params) => Promise<data>`
- [ ] OpenAPI yaml 描述同步（可选）
- [ ] `npm test --prefix apps/gateway` 全绿
- [ ] grep 自查：`grep -n "ctx.require" apps/gateway/routes/<domain>.js` 应该为空
