# Cookbook · 加新权限模块

> **目标**：加一个新的"模块权限"（如 `forecast` / `inventory_audit`），让它能：
> - 在后端 `requirePermission("forecast")` 闸住对应 routes
> - 在前端菜单 / GuardedElement 自动起作用
> - 在 admin 账号管理界面（`/admin/accounts`）展示成可勾选项

> **重要前提**：本 cookbook 描述的是"模块级权限"（粗粒度，绑定到一个 page）。如果是"行为级"（如"能看 daily 但不能 export"），那是 V4 议题，不要在 V3 结构里硬塞。

---

## 0. 前置阅读

- ADR-0015 `docs/adr/0015-server-auth-extract.md`：lib/auth 子系统结构（permissions / accounts / store / session / redirects）
- 样板代码：
  - `apps/gateway/lib/auth/permissions.js` —— `AUTH_PERMISSION_MODULES` 是单一来源
  - `apps/gateway/lib/auth/__tests__/permissions.test.js` —— 加权限后必须扩这里
  - `apps/web/src/auth/modules.js` —— 前端镜像
  - `apps/gateway/tests/fixtures/auth.fixture.json` —— 测试账号 perms

---

## 1. 关键约束（先读，省一小时）

权限 key 在 **5 个地方**必须对齐，**任何一处漏改都会让权限静默失效**：

| 位置 | 文件 | 字段 |
|---|---|---|
| 后端权限矩阵 | `apps/gateway/lib/auth/permissions.js` | `AUTH_PERMISSION_MODULES[].key` |
| 后端 routes 闸 | `apps/gateway/routes/<domain>.js` | `requirePermission("xxx")` |
| 后端 isRouteAllowedForAccount | `apps/gateway/lib/auth/permissions.js` | `routePath.startsWith("/xxx")` 那段 |
| 前端模块定义 | `apps/web/src/auth/modules.js` | `APP_MODULES[].key` |
| 前端 GuardedElement | `apps/web/src/App.jsx` | `<GuardedElement permission="xxx">` |
| 测试 fixture | `apps/gateway/tests/fixtures/auth.fixture.json` | `accounts[].permissions[]` |

加权限的本质就是：**在这 5 处插入一致的 key**，再扩单测。

---

## 2. 步骤

### Step 1 · 后端权限矩阵

文件：`apps/gateway/lib/auth/permissions.js`

```js
const AUTH_PERMISSION_MODULES = [
  { key: "portal", label: "门户", route: "/", description: "登录后的首页与系统健康概览" },
  { key: "report_daily", label: "日报", route: "/report-daily", description: "日报主表与导出" },
  // ... 现有项 ...
  // ↓ 新增 ↓
  { key: "forecast", label: "预测", route: "/forecast", description: "未来 4 周销售预测" },
  // ↑ 新增 ↑
  ...(dispatchModule.isEnabled() ? [dispatchModule.PERMISSION_MODULE] : []),
];
```

**位置规则**：
- 顺序决定 `resolvePreferredRouteForPermissions()` 的 fallback 顺序（数组顺序 = 用户登录后的首选页面回退顺序）
- 把"业务核心"放前面（如 portal / report_daily），辅助页放后面
- 条件性模块（如 dispatch）继续用 spread 控制

### Step 2 · 后端路由白名单

仍是 `apps/gateway/lib/auth/permissions.js`，找到 `isRouteAllowedForAccount(account, pathname)`：

```js
function isRouteAllowedForAccount(account, pathname) {
  // ...
  if (routePath.startsWith("/dashboard")) {
    return accountHasPermission(account, "dashboard");
  }
  // ↓ 新增 ↓
  if (routePath.startsWith("/forecast")) {
    return accountHasPermission(account, "forecast");
  }
  // ↑ 新增 ↑
  // ...
}
```

这个函数被 `redirects.js` 的 `resolvePostLoginRoute` 用，决定登录后 `?next=/forecast` 是否能放行。**忘加这一段会让有权限的用户登录后被重定向回首选页，看似没问题但实际是 bug**。

### Step 3 · 后端 routes 闸

文件：`apps/gateway/routes/<domain>.js`（新建或现有）

```js
const { requirePermission } = require("../middleware/requirePermission");

app.get("/api/forecast/list", requirePermission("forecast"), async (req, res, next) => {
  try {
    // ... handler
  } catch (err) {
    next(err);
  }
});
```

> 完整加端点流程见 [`add-new-route.md`](./add-new-route.md)。

### Step 4 · 后端单测扩 permissions.test.js

文件：`apps/gateway/lib/auth/__tests__/permissions.test.js`

最少加 3 个 case：

```js
it("AUTH_PERMISSION_KEYS includes forecast", () => {
  expect(AUTH_PERMISSION_KEYS).toContain("forecast");
});

it("/forecast requires forecast permission", () => {
  const userForecast = { permissions: ["forecast"] };
  const userOther = { permissions: ["report_daily"] };
  expect(isRouteAllowedForAccount(userForecast, "/forecast")).toBe(true);
  expect(isRouteAllowedForAccount(userOther, "/forecast")).toBe(false);
});

it("non-admin with forecast lands at /forecast", () => {
  expect(resolvePreferredRouteForAccount({
    is_admin: false,
    permissions: ["forecast"],
  })).toBe("/forecast");
});
```

跑：

```bash
cd apps/gateway
npm test -- lib/auth/__tests__/permissions
```

### Step 5 · 前端模块定义

文件：`apps/web/src/auth/modules.js`

```js
export const APP_MODULES = [
  // ...
  {
    key: "forecast",            // 必须等于后端的 key
    label: "预测",
    path: "/forecast",
    menuKey: "/forecast",
    description: "未来 4 周销售预测",
  },
  // ...
];
```

`hasModulePermission(auth, "forecast")` 会自动工作（admin 永真，普通用户看 `auth.permissions` 数组）。

### Step 6 · 前端 App.jsx 加 Route + 菜单 icon

文件：`apps/web/src/App.jsx`

```jsx
import { LineChartOutlined } from "@ant-design/icons";
import ForecastPage from "./pages/ForecastPage";

// 1. 加菜单 icon 映射
const MODULE_ICON_MAP = {
  // ...
  forecast: <LineChartOutlined />,    // ← 新增
};

// 2. 加 Route + GuardedElement
<Route
  path="/forecast"
  element={
    <GuardedElement permission="forecast">
      <ForecastPage />
    </GuardedElement>
  }
/>
```

> Page 本身怎么写见 [`add-new-page.md`](./add-new-page.md)。

### Step 7 · 测试账号 fixture

文件：`apps/gateway/tests/fixtures/auth.fixture.json`

可以选两种方式之一：

**方式 A**（最省事）：让 `smoke-admin` 自动有新权限——admin 在 `permissions.js` 里被自动 OR true，**fixture 里 admin 的 permissions 数组其实可以不动**，因为 `accountHasPermission` 第一行 `if (account.is_admin === true) return true`。

但出于"显式胜于隐式"，建议跟现有风格保持一致，把新 key 加到 admin 的数组：

```json
{
  "id": "acct_smoke_admin",
  "is_admin": true,
  "permissions": ["portal", "report_daily", "arrival", "dashboard", "channel_dashboard", "analysis", "dispatch", "forecast"]
}
```

**方式 B**（精细化测试用）：加一个新 fixture 账号 `smoke-forecast` 只有 `forecast` 权限，专门写"只有这权限的人能进 /forecast、不能进 /report-daily"的 smoke。

> 注意：fixture 里 password_hash 是 sha256(密码)，**改密码必须同步更新 hash**。`smoke-admin` 的密码是 `smoke-pass`，`smoke-user` 的是 `smoke-user-pass`。这两组 hash 已固化，不要动。

### Step 8 · smoke 测试

新建 `apps/gateway/tests/smoke/forecast.test.js`，按 [`add-new-route.md`](./add-new-route.md#step-4--写-smoke-测试强制) 的样板写。最少覆盖：

- 401（无 cookie）
- 403（smoke-user 无 forecast 权限）
- 200 / 5xx（smoke-admin 能到 handler）

---

## 3. 测试要求

```bash
cd apps/gateway

# 1. 单测：permissions matrix
npm test -- lib/auth/__tests__/permissions

# 2. smoke：新 routes + 新权限的端到端
npm test -- tests/smoke/forecast

# 3. 全套
npm test
```

期望：全绿。`permissions.test.js` 现有 11 个 describe block，加你 1-3 条 case 进去，总用例数应增加。

前端：

```bash
cd apps/web
npm run build
```

并浏览器手测：
- admin 登录 → 菜单看到"预测" → 点击进 /forecast → 看到页面
- smoke-user 登录 → 菜单**没有**"预测" → 手动访问 /forecast → 被 GuardedElement 重定向走

---

## 4. 示例 PR / commit

| 场景 | 参考 |
|---|---|
| 加 dispatch 权限（条件性，由 env flag 控制） | `services/dispatch/index.js` 的 `PERMISSION_MODULE` + `permissions.js` 顶部的 spread |
| 加 admin-only 子页（不进权限矩阵） | PR9 的 `/admin/usage`：`auth/modules.js` 的 `ADMIN_USAGE_ROUTE` + `App.jsx` 的 `adminOnly` |
| permissions.test.js 既有覆盖样例 | `lib/auth/__tests__/permissions.test.js` 的 `describe("isRouteAllowedForAccount")` |

---

## 5. 常见踩坑

1. **后端 `permissions.js` 加了，前端 `modules.js` 没加** —— admin 能看到 page（admin 永真），普通用户登录后 `auth.permissions` 拿到 `["forecast"]` 但前端不认这个 key，菜单不出现。
2. **`isRouteAllowedForAccount` 漏加** —— 用户从邮件点 `?next=/forecast` 登录，看似登录成功但被踢回首选页，看不出 bug。**写新权限时 grep 一下 `routePath.startsWith` 把所有现有项扫一眼**。
3. **`dispatchModule.isEnabled()` 模式没复制** —— 你想加一个"只在 env flag 开启时存在"的模块，必须模仿 dispatch 的 spread，不能直接 hard-code，否则关掉 flag 也保留权限项。
4. **fixture 改 password_hash 而忘了改 password** —— smoke 全红 invalid credentials。**两个值必须配对**。
5. **顺序拍错** —— `AUTH_PERMISSION_MODULES` 的顺序决定 `resolvePreferredRouteForPermissions` 的 fallback。把 forecast 放在 portal 之前 → 普通用户登录后默认进 /forecast 而不是 /，看似无害但破坏了"门户优先"约定。新模块默认放数组**末尾**（dispatch 之前）。
6. **以为前端 `APP_MODULES` 顺序无影响** —— 影响菜单显示顺序。横向菜单用户体感很重要，跟后端 permissions 顺序保持一致就好。
7. **删旧权限不清理** —— 删 key 时既要从 `AUTH_PERMISSION_MODULES` 删，也要从所有 fixture 账号的 `permissions` 数组删（否则 normalizePermissionKeys 会过滤掉，但配置文件留下脏数据 → 下次有人 add 新模块复制粘贴时混淆）。

---

## 6. 完成检查清单

- [ ] `lib/auth/permissions.js` 的 `AUTH_PERMISSION_MODULES` 加了新项（key/label/route/description）
- [ ] `lib/auth/permissions.js` 的 `isRouteAllowedForAccount` 加了对应 if 分支
- [ ] `routes/<domain>.js` 用 `requirePermission("<key>")` 闸住所有 endpoint
- [ ] `lib/auth/__tests__/permissions.test.js` 至少加 3 条 case（in keys / route allowed / preferred route）
- [ ] `apps/web/src/auth/modules.js` 的 `APP_MODULES` 加了同名项（key 完全一致）
- [ ] `apps/web/src/App.jsx` 加了 `<Route>` + `<GuardedElement permission="<key>">` + `MODULE_ICON_MAP[<key>]`
- [ ] `tests/fixtures/auth.fixture.json` 的 `smoke-admin.permissions` 包含新 key
- [ ] 新建 `tests/smoke/<domain>.test.js` 覆盖 401 / 403 / 200-or-5xx
- [ ] grep 自查：`grep -rn '"<新 key>"' apps/` 应该出现在 5 个文件以上（permissions.js / routes / modules.js / App.jsx / fixture）
- [ ] `npm test --prefix apps/gateway` 全绿
- [ ] `npm run build --prefix apps/web` 通过
- [ ] 浏览器：admin 看到菜单 + 进 page；普通用户菜单看不到 + 手动访问被重定向
