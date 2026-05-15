# ADR 0018: zod → OpenAPI 自动生成（混合模式）

- 日期：2026-04-24
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：PR13（v3-openapi-gen）
- 关联 ADR：0006（zod 校验）、0010（手写 OpenAPI + Runbook）
- 关联文件：`apps/gateway/scripts/build-openapi.js`, `apps/gateway/openapi.generated.yaml`

## 背景

PR10（ADR 0010）落地了 247 行**手写** `apps/gateway/openapi.yaml`，覆盖 11 个最常用端点。
PR6 / PR12 又在 `apps/gateway/schemas/*.js` 里加了 7 个 zod body schema（admin / agent / auth / dispatch）。

**痛点**：

- 加新端点的人要同时改 `schemas/*.js`（运行时校验）和 `openapi.yaml`（文档），两份真相极易脱节。
- ADR 0010 当时拒绝了"swagger-jsdoc 从注释生成"，理由是改动量大；但现在我们已经有了 zod schema，本身就是结构化真相，再不接生成是浪费。
- 手写 yaml 的字段（`maxLength` / `pattern` / `required`）都来自 zod schema，本质是抄一遍。

## 评估候选库

两个主流候选，都跑过 `npm view ... peerDependencies`：

| 库 | 当前版本 | zod 兼容 | node | 备注 |
|---|---|---|---|---|
| `@asteasolutions/zod-to-openapi` | 7.3.4 | `zod ^3.20.2` | 隐式 | zod v4 需 8.0.0-beta；本仓 zod 是 3.25.x，用 7.3.4 |
| `zod-openapi` | 4.2.4 | `zod ^3.21.4` | `>=18` | 也 OK，API 风格类似 |

两者都通过 `extendZodWithOpenApi(z)` 给 zod 原型挂 `.openapi()` 方法，**不需要重写现有 schema**：直接 `require()` 进来注册路径即可。

**选 `@asteasolutions/zod-to-openapi@7.3.4`**：

- 文档更全（README 含完整示例）
- API 优雅度相当，但社区下载量更高（活跃度更稳）
- v7.x 是 zod v3 的稳定线，不是 beta

## 决策：混合模式（Hybrid）

**不**全量替换 `openapi.yaml`，而是**并存**两份 spec：

| 文件 | 用途 | 覆盖 | 维护方式 |
|---|---|---|---|
| `apps/gateway/openapi.yaml` | 默认 spec，PR10 手写 | 11 端点（含 GET-only 端点如 health/list） | 手维护 |
| `apps/gateway/openapi.generated.yaml` | 生成 spec | 当前 7 个写操作端点（覆盖所有 zod 已校验路径） | `npm run build:openapi` |

`/api/docs` 默认仍服务 `openapi.yaml`；`?source=generated` 切换到生成版。
两者都通过 admin gate，行为完全一致，仅 spec 来源不同。

### 为什么混合而不是全替换

1. **GET 端点（health / list）没有 body schema**，强行用 zod 描述 query 参数收益不大，反而把 build script 复杂化。
2. **手写 yaml 已经过线上验证**（Swagger UI Try-it-out 跑通），全部废掉不划算。
3. **失败路径友好**：`build:openapi` 没跑过、yaml 文件不存在时，docs 路由 fallback 到手写版，不会 500。
4. **渐进迁移**：以后每加一个 zod schema 端点，就在 build script 里 `registerPath` 一次，逐步逼近全覆盖；当 generated 版覆盖率超过手写版时再调换默认。

### 为什么不直接用注释扫描（swagger-jsdoc）

ADR 0010 已给过结论：要给每个 handler 写 JSDoc，工作量大于手写 yaml。本方案的优势是**zod schema 已经存在**，registerPath 只描述路径 + status code，schema 本体零重复。

## 实施

### 1. 依赖

`apps/gateway/package.json` devDependencies：
```json
"@asteasolutions/zod-to-openapi": "^7.3.4"
```

### 2. 构建脚本

`apps/gateway/scripts/build-openapi.js`（约 230 行）：
- `extendZodWithOpenApi(z)` 一次性给 zod 加 `.openapi()`
- `require()` 现有所有 schema 文件（无重写）
- `OpenAPIRegistry.register(name, schema)` 注册可复用 schema
- `OpenAPIRegistry.registerPath(...)` 描述每个端点的方法 / 路径 / 安全 / 响应
- `OpenApiGeneratorV3.generateDocument(...)` 生成 OpenAPI 3.0.3 doc
- `js-yaml.dump` 写到 `apps/gateway/openapi.generated.yaml`，文件头加 `# AUTO-GENERATED` 警示

输出：`build-openapi: wrote .../openapi.generated.yaml (7 paths)`。

### 3. 路由切换

`apps/gateway/routes/docs.js` 改成：
- 接受 `?source=generated`，仅 `generated` 字面量切换，否则默认 `manual`
- 各 spec 独立缓存
- 文件不存在时 generated → manual fallback，不 throw

### 4. NPM 脚本

- 根 `package.json`：`"build:openapi": "node apps/gateway/scripts/build-openapi.js"`
- gateway `package.json`：`"build:openapi": "node scripts/build-openapi.js"`

### 5. 测试

`apps/gateway/tests/unit/openapi-build.test.js`：
- 通过 `child_process.execFileSync` 实际跑 build 脚本
- 检查输出文件存在、有 `# AUTO-GENERATED` 头、yaml 可解析
- 检查 `paths.length >= 5`、关键路径 `/api/auth/login` `/api/agent/run` `/api/admin/accounts` 存在
- 检查关键 schema `LoginRequest` `AgentRunRequest` `CreateAccountRequest` 存在
- 检查 `LoginRequest.required` 含 `username` + `password`
- 检查 `securitySchemes.sessionAuth` 配置正确

CI 未来如有人删掉 `registerPath`，测试立刻红。

## 验证

- `node apps/gateway/scripts/build-openapi.js` 本机跑通，输出 7 paths，文件 493 行
- `npm test` (gateway): 49/49 通过（PR12 的 48 + 新增 1）
- 手动检查 `openapi.generated.yaml`：YAML 合法、字段对应 zod schema（minLength / maxLength / pattern / required 均正确还原）

## 不做什么

- ❌ **不删 `openapi.yaml`**：保留作 fallback / 对照 / 全 endpoint 覆盖。
- ❌ **不动现有 schema 文件**：`apps/gateway/schemas/*.js` 保持纯 zod，不耦合 OpenAPI 元数据。需要 `example` 之类增强时，在 `build-openapi.js` 里 `.openapi({example: ...})`。
- ❌ **不挂 prebuild hook**：build script 是手动 / CI 显式触发，避免污染 dev / test 流程。后续如果想强制，再加 `pretest` hook。
- ❌ **不引入 zod-openapi（候选 B）**：API 等价、维护活跃度略低，没必要并存两库。

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| 全量替换 + 删除 openapi.yaml | GET 端点没 zod schema，强行迁移收益小；失败回退路径会更复杂 |
| `zod-openapi`（替代库） | API 等价，下载量略低 |
| `@asteasolutions/zod-to-openapi@8.0.0-beta`（zod v4） | 本仓 zod 是 3.25，没必要冒险用 beta |
| 不自动生成，只加一致性 diff 测试（Step 2） | 评估发现库可用，diff 测试只能"抓脱节"不能"消除维护"，自动生成才是治本 |

## 第一性原理自检

1. **为什么存在？能消除吗？** zod schema + 手写 yaml 的双份维护可以消除一份 → 自动生成是消除路径，不是优化路径。
2. **失败如何表现？** build 失败 → CI test 红；docs 路由读不到 generated → 自动 fallback 到 manual，用户无感。
3. **真实环境跑过吗？** 本机 `node ...build-openapi.js` 跑通；`npm test` 49/49 绿；docs 路由的 `?source=generated` 切换走的是真路径加载，没有桩。
4. **3 个月后看得懂吗？** ADR 0018（本文件） + build script 顶部的 30 行注释（说明 why） + runbook 新章节"OpenAPI 维护"。

## 后续

- 当 `openapi.generated.yaml` 覆盖端点 ≥ `openapi.yaml` 时，调换默认 source（一行改 `routes/docs.js`）
- 把 GET / list 端点的 query 参数也描述成 zod schema（顺带给 `req.query` 加运行时校验，是个独立 PR）
- CI 加一步 `npm run build:openapi && git diff --exit-code apps/gateway/openapi.generated.yaml`，强制提交前刷新（防"忘了 build"）
