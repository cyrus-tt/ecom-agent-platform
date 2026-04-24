# ADR 0006: zod 请求参数校验（两个关键端点）

- 日期：2026-04-23
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：PR6
- 关联设计：`docs/plans/2026-04-23-uplift-to-9-design.md`

## 背景

当前端点对 `req.body` 的处理依赖防御性代码：

```javascript
const body = req.body && typeof req.body === "object" ? req.body : {};
const username = String(body.username || "").trim();
const password = String(body.password || "");
```

这些 defensive coerce 的问题：
1. **错误类型反馈差**：非法入参（缺字段、类型错）会走到业务逻辑再抛 `TypeError` 或 DB 错，返回 500
2. **用户看不到原因**：401 错误密码和 400 空密码回退到同样的 message
3. **散落 40+ 处**：每个 handler 都重复一遍
4. **无契约**：前端不知道必填字段、长度限制

对部门级产品来说，40 人会构造各种奇怪请求，500 错误又不能让用户 debug。

## 决策

引入 **zod 3.x** 作为请求参数校验框架，在**最关键的两个端点**先落地，建立 pattern。

### 选 zod 而非 joi / yup / ajv

- TypeScript-first，社区推荐（即使我们暂时是纯 JS）
- API 紧凑（`z.object({...})` 而非 `Joi.object().keys({...})`）
- 零运行时依赖，体积 ~10KB
- `safeParse` 直接返回 `{ success, data | error }`，不抛异常

### 本 PR 覆盖的端点

| 端点 | schema 文件 | 校验字段 |
|---|---|---|
| POST /api/auth/login | `schemas/auth.js` | username (string, 1-128), password (string, 1-256), next (string, ≤2048, 可选) |
| POST /api/agent/run | `schemas/agent.js` | period_type (string, 必填), start_date / end_date (YYYY-MM-DD, 可选), skill_id / prompt_text (可选) |

### 架构

```
apps/gateway/
├── middleware/
│   └── validateBody.js       — 30 行的通用校验中间件工厂
├── schemas/
│   ├── auth.js
│   └── agent.js
└── routes/
    ├── auth-public.js        — wire: validateBody(loginBodySchema)
    └── agent.js              — wire: validateBody(runBodySchema)
```

### 中间件语义

```javascript
app.post("/api/auth/login",
  express.json({ limit: "256kb" }),       // 1. body parser
  validateBody(loginBodySchema),          // 2. new: validate + coerce
  (req, res) => { ... }                   // 3. handler: req.body 是已校验的
);
```

- 校验失败 → 400 + `{ ok: false, message, issues: [{ path, message }, ...] }`
- 校验成功 → `req.body` 替换为 `parsed.data`（白名单字段 + 默认值）
- 中间件顺序：**auth guard 必须在 validateBody 之前**（这样 401 优先于 400，符合规范）

### 错误响应 shape

```json
{
  "ok": false,
  "message": "invalid input: username: username is required",
  "issues": [
    { "path": "username", "message": "username is required" },
    { "path": "password", "message": "password is required" }
  ]
}
```

前端可按 `path` 字段定位哪个 input 变红。

## 不做什么

- ❌ 不校验 query / params / headers（V2 扩展）
- ❌ 不处理 multipart/form-data（dispatch 文件上传走 multer，单独一套）
- ❌ 不改前端 —— 正常入参仍能穿过，恶意入参现在会收到更清晰 400
- ❌ 不覆盖所有 40+ 端点 —— 本 PR 建 pattern，后续 PR 扩展

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| joi | 语法冗长，TypeScript 支持差 |
| yup | 生态小于 zod，schema 复合时 type inference 弱 |
| ajv + JSON Schema | 配置 schema 需要额外编译步骤，开发体验不如 zod |
| class-validator | 需要装饰器 + TypeScript，改造成本高 |
| 不做 | 错误语义差，生产故障排查困难 |

## 验证

新增 **`tests/smoke/validation.test.js`** 7 条用例：

登录端点：
- 空 body → 400 + issues
- password 是数字 → 400
- 缺 username → 400 + issues 含 `username`
- 合法 body → 200（回归）

分析端点：
- 无 cookie → 401（权限层在 validation 层之前，顺序正确）
- 有 cookie 空 body → 400 + issues 含 `period_type`
- 非 ISO 日期 → 400 + issues 含 `start_date`

合计全仓 **39 测试 × 3 次稳定全绿**（PR2 smoke 25 + PR5 unit 7 + PR6 validation 7）。

## 后续

- **PR7 审计**：审计中间件走在 validateBody 之前，记录全部 400/401/403，便于回放
- **V2 扩展**：把 zod pattern 铺开到 /api/dispatch/* 的公开 preview/confirm 端点、/api/admin/accounts POST/PATCH 等
- **V2 重构**：把 handler 里残存的 `String(...)` 防御性 coerce 删掉（zod 已保证类型）
