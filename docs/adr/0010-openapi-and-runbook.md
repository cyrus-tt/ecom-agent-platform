# ADR 0010: OpenAPI 契约 + Runbook + Rollout Readiness Report

- 日期：2026-04-23
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：PR10
- 关联设计：`docs/plans/2026-04-23-uplift-to-9-design.md`

## 背景

前 9 个 PR 把**代码底座**做到 9 分：CI、测试、日志、拆分、bcrypt、zod、审计。剩下的一分在**用人文档**：

1. **没有 API 契约**：40 人里肯定有人要接 BI / 脚本。没 OpenAPI，他们只能读 `server.js` 反推签名。新人上手障碍。
2. **没有运维 SOP**：故障来了，运维第一反应是"看哪个日志？重启哪个服务？怎么回滚？"。没 Runbook = 靠记忆。
3. **没有推广清单**：40 人部署前，"账号建了吗？密码改了吗？钉钉配了吗？"一个疏漏就翻车。

## 决策

### 1. 手写 `apps/gateway/openapi.yaml`

覆盖 **11 个关键端点**（不是全部 40+）：
- 健康：`/healthz`, `/readyz`
- 认证：`/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
- 日报：`/api/report-daily/dates`, `/api/report-daily/meta`
- 调拨：`/api/dispatch/tasks`
- AI 分析：`/api/agent/skills`, `/api/agent/run`
- 管理：`/api/admin/accounts`

覆盖范围的理由：**新人最可能调用的**。完整 40+ 端点的 OpenAPI 可以 V2 慢慢补。

### 2. Swagger UI at `/api/docs`

- 挂 `routes/docs.js`，接受 admin cookie 认证
- 同时暴露 `/api/docs.yaml`（原文下载）和 `/api/docs.json`（编程读取）
- 非管理员看不到（OpenAPI 列出了所有管理端点，不能匿名公开）

### 3. `docs/runbook.md`

10 节：自检 → 启停 → 日志 → 故障排查 → 发版 → 审计 → 监控 → 文件索引 → 服务端点 → 联系人。

设计原则：
- **按"用户动作"组织**，不按"模块"：出故障时运维想的是"我要干什么"
- **每节附 shell/jq/sql 命令**：复制粘贴能跑
- **指明何时不该做什么**：如"登录失败不要直接删 session，先看日志"

### 4. `docs/rollout-readiness-report.md`

5 张表（代码 / 运维 / 账号 / 数据 / 用户）+ 48 小时倒计时清单 + 9.0 自评打分。
对应"B 级产品"的所有基础设施检查点。

## 不做什么

- ❌ **不做完整 40+ 端点 OpenAPI**：二八定律，V2 按需补
- ❌ **不生成 OpenAPI from code**（`swagger-jsdoc`）：要给每个 handler 写 JSDoc，巨量工作 vs 手写 yaml 一次到位
- ❌ **不做 Postman 导出**：swagger-ui 的"Try it out"已覆盖
- ❌ **不做多语言文档**：部门内都中文，简单直给
- ❌ **不做视频教程**：Runbook 文本版够用，视频 V2

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| `swagger-jsdoc` 从代码注释生成 | 40+ 个 handler 全改注释，工作量大 |
| ReDoc 替代 Swagger UI | Swagger UI 的 Try it out 更实用 |
| 外部托管（ReadMe.io 等）| 内部工具，不值得付费 |
| 文档只放 README，不搞专门页 | README 会被各种更新淹没 |

## 验证

- `apps/gateway/openapi.yaml` 手工验过 YAML 语法 + 对照实际 handler 的响应 shape
- Swagger UI 可访问：管理员登录后访问 `/api/docs` 显示交互页面
- Runbook：逐节走查 Q3 "真实环境跑过吗？" —— 有些命令我无法在 Mac 上验（PowerShell 段），由 Cyrus 在 Windows 侧验
- Rollout Readiness Report：已标注哪些 ✅ 哪些 ⬜（待 Cyrus 勾选）

**烟囱测试 42 条 × 3 次稳定全绿**（docs route 加了不破坏任何现有行为）。

## 合并后在 Windows 上怎么用

1. 管理员登录
2. 访问 `http://localhost:3000/api/docs`
3. 在 Swagger UI 里：
   - 展开某端点
   - 点 "Try it out"
   - 填入参
   - 点 "Execute"
   - 看右侧响应
4. 把 OpenAPI URL 发给 BI 同事，他们用 Postman 导入 → 立刻有 Collection

## 后续

- **V2**：补完其余 30+ 端点的 yaml（尤其 dispatch 上传 / 审计查询）
- **V2**：开放 `/api/docs.yaml`（无 admin 限制，把敏感端点在 spec 里注释掉）方便 BI 接入
- **V2**：Runbook 加"告警响应流程"章节（配合未来的 Sentry）
- **V2**：视频教程 3 段：日报、调拨、分析
