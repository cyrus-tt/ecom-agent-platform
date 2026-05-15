# ADR-0019: 登录自助改密码 + 记住我 30 天

**状态**：Accepted（2026-04-28）
**关联 PLAN**：`docs/plans/2026-04-28-self-service-password-and-remember-me.md`
**关联 PROGRESS**：F-LOGIN
**关联 PR 分支**：`codex/mac/feat-login-self-service-password`

---

## 上下文

ecom-agent-platform 现有登录系统的两个用户痛点（Cyrus 2026-04-28 提出）：

1. **每次关浏览器都要重输密码** — 现状 cookie maxAge = `session_ttl_seconds * 1000`（24 小时），关浏览器后第二天打开仍要登（cookie 已过期）
2. **改密只能管理员代改** — 现有 `PATCH /api/admin/accounts/:accountId/password` 是 `requireAdmin`，普通用户没有自助路径，改密请求堆积在 Cyrus 钉钉私聊

同时系统**没有邮件 / SMS 能力**（package.json 无 nodemailer / SendGrid / Twilio），传统的"忘记密码 → 收链接 → 重置"路径走不通。

## 决策

**采用方案 A（无邮件依赖）+ B2（30 天 cookie 长会话） + 隐式 B3（HTML autocomplete）三件套**。

### 1. 自助改密码（方案 A 核心）

新增 `POST /api/auth/me/password`：
- 入参：`{ oldPassword, newPassword }`
- 旧密验证 → 通过 `verifyPasswordHash` 复用现有逻辑
- 新密强度 → 通过 `apps/gateway/lib/passwordPolicy.js`（cherry-pick 自 V2 commit `6a85c16` 单文件）：
  - 长度 8-128
  - 必须含大写 + 小写 + 数字
  - 26 条弱口令黑名单
- 写入 → 复用 `updateManagedAccountPassword`（admin reset 已有的存档逻辑）
- 成功 → **当前会话失效**（清服务端 SESSION_STORE + 清浏览器 cookie），强制重登

### 2. 「30 天免登录」(B2)

- 登录页加复选框 "30 天内免登录（仅在私人电脑勾选）"
- `POST /api/auth/login` 接受 `body.remember: boolean`
- `setSessionCookie` 增加 `options.remember`：
  - `true` → cookie `maxAge = 30 * 24 * 60 * 60 * 1000`
  - `false` → 不设 maxAge（session-only，关浏览器即失效）
  - 不传（向后兼容旧调用）→ 沿用 `authStore.session_ttl_seconds`

**行为变更说明**：未勾选时从"24h TTL"改为"session-only"。理由：
- B2 业界标准（GitHub / Notion / Linear / 几乎所有 SaaS）= 不勾 session-only / 勾 long
- "未勾就保持 24h" 在语义上模糊（用户不知道自己是否会被记住）
- 公司机典型场景：浏览器一直开着 → session-only 影响极小；下班关机后第二天勾"记住我"=30 天免登

### 3. 「忘记密码 → 联系 Cyrus」(方案 A 闭环)

- 登录页底部加链接 "忘记密码？请在钉钉联系 Cyrus"
- 用户走钉钉私聊 → Cyrus 在 `/admin/accounts` 复用 `PATCH /api/admin/accounts/:accountId/password`（已存在的能力）

### 4. HTML autocomplete (隐式 B3)

- `<input name="username">` 加 `autocomplete="username"`
- `<input name="password">` 已有 `autocomplete="current-password"`
- ChangePasswordModal 的旧密用 `current-password`，新密用 `new-password`

让浏览器 / 系统 keychain 帮忙存密码，比明文写 localStorage 安全。

## 拒绝的备选方案

| 方案 | 拒绝理由 |
|---|---|
| **加邮件能力**（nodemailer + SMTP） | 公司没现成 SMTP；引入新外部依赖 + 配置 + 监控；over-engineering（用户都在内网） |
| **加短信能力**（Twilio / 阿里云短信） | 成本（每条 5 分钱以上）+ 没合作供应商；同样 over-engineering |
| **安全问题自助找回**（如 "你的小学是？"） | UX 差（用户答错率高 → 还是要找管理员）；问题选不好就是双因素的形式但实际更弱 |
| **"勾不勾都 24h TTL"** | 与"记住我"语义不符；用户勾了不知道有没有用 |
| **改密成功后保持登录态**（不强制重登） | 安全短板：改密后旧 session 能继续用，相当于改密无效；坚持失效本会话 |
| **整体合并 V2 password-policy 分支** | 范围扩大、与 V2 整体合入时 lockfile 冲突；只 cherry-pick `passwordPolicy.js` 单文件即可 |
| **本 PR 也升级 SHA256 → bcrypt** | 爆炸半径大（要迁移所有存量哈希）；登记到 PROGRESS R1 单独 PR 处理 |

## 后果

### 正面

- 用户自助改密，钉钉私聊请求降为零
- "30 天免登录"标准做法，贴合主流 SaaS 用户预期
- 利用 V2 password-policy 强制强密码（Aaa12345 起步）
- 拒绝弱口令（password / 12345678 / admin 等 26 条黑名单）

### 负面 / 已知风险

- **R2（PROGRESS）**：30 天 cookie 在共享电脑是隐患 → 已用 login.html 文案"仅私人电脑勾选"缓解
- **R3（PROGRESS）**：本 PR cherry-pick `passwordPolicy.js` 单文件，未来 V2 整体合入时需手动 verify 文件无差异（commit hash 一致 → 零差异）
- **行为变更**：未勾"记住我"时从 24h TTL 改成 session-only，部分用户可能感知"以前关了浏览器还在，现在关一下就要重登"——属于符合预期的标准做法，且勾选即可解决
- **R4（PROGRESS）**：本 PR Mac 端跳过自动化测试（主分支无 test runner），完全依赖 Cyrus Windows 端手测；PR1-12 + V2 合入后 vitest 进入主线，本风险消除

### 验收路径

详见 `docs/plans/2026-04-28-self-service-password-and-remember-me.md` §6。Mac 端只做 `node --check` 语法 + 平台 esbuild build；功能验收以 Cyrus 在 Windows 公司机 `git pull` + `ops/windows/start_all.ps1 -RebuildWeb` + 浏览器手测 7 条为准。

## 相关

- `docs/plans/2026-04-28-self-service-password-and-remember-me.md` — 本 PR 完整 PLAN
- `apps/gateway/lib/passwordPolicy.js` — cherry-pick 自 V2 `6a85c16`
- `apps/gateway/server.js` — 改 4 处：require + setSessionCookie + login + 新 endpoint
- `apps/gateway/public/login.{html,js,css}` — 加 checkbox + 忘记密码链接
- `apps/web/src/components/ChangePasswordModal.jsx` — 新组件
- `apps/web/src/App.jsx` — Header actions 加按钮 + 渲染 Modal
- `PROGRESS.md` R1 / R2 / R3 / R4 — 风险登记
- ADR-0009 — Mac esbuild v25 bug 绕过（本 PR Mac 端 build 用了）
- ADR-0013（V2 分支）— password-policy 引入背景；本 ADR 引用其 policy 模块
