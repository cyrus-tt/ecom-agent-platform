# PLAN · 登录自助改密 + 记住我 30 天 + 忘记密码联系 Cyrus

**PROGRESS 编号**：F-LOGIN
**创建于**：2026-04-28
**Deadline**：2026-04-30
**状态**：✅ done（2026-05-07 Windows 验收通过 + Codex 修 2 commit，Mac 已 pull 同步）

---

## 1. 一句话任务

登录页升级：加"30 天免登录"勾选 + "忘记密码请联系 Cyrus（钉钉）"提示，并新增登录后用户自助改密码能力（旧密 + 新密双因素）。

## 2. 为什么做（Why）

Cyrus（2026-04-28）提出：
- **痛点 ①**：用户每次关浏览器都要重输密码，体验差，影响日常使用
- **痛点 ②**：想改密码只能找管理员代改，钉钉私聊请求堆积，流程慢
- **决策**：方案 A（无邮件依赖）+ B2（30 天 cookie 长会话），不引入 SMTP

## 3. 边界（不做什么）

- ❌ 不加邮件 / SMS 能力，不做 reset token 链接流程
- ❌ 不动密码哈希算法（继续 SHA256，bcrypt 升级登记到 PROGRESS R1，单独 PR 处理）
- ❌ 不动 admin 重置功能（`PATCH /api/admin/accounts/:accountId/password` 已存在，复用不改）
- ❌ 不做"改密后强制其他设备退出"（YAGNI，本期单设备失效即可）
- ❌ 不整体并入 V2 password-policy 分支（仅 cherry-pick `passwordPolicy.js` 单文件，不动 `schemas/admin.js`）
- ❌ 不动密码存储位置（继续 `apps/gateway/config/auth.json`）

## 4. 方案步骤

1. **后端 · 自助改密 endpoint** — 新增 `POST /api/auth/me/password`
   - body：`{ oldPassword: string, newPassword: string }`
   - 流程：verify session → verify oldPassword → validate newPassword by passwordPolicy → write hash → 当前 session 失效（清 cookie）
   - 写在 `server.js`（参考 `/api/admin/accounts/:accountId/password` 1631 行的写法）

2. **后端 · 记住我 cookie maxAge** — 改 `POST /api/auth/login`
   - body 增字段：`remember: boolean`（可选，默认 false）
   - true → cookie `maxAge = 30 * 24 * 3600 * 1000`（30 天）
   - false → cookie 不设 maxAge（session-only，关浏览器即失效）
   - 写在 `server.js:1475` 的 login handler 里

3. **后端 · password policy 复用** — cherry-pick `apps/gateway/lib/passwordPolicy.js`（来自 V2 分支 commit `6a85c16`）
   - 只复制单个文件，不动 `schemas/admin.js`（避免与 v2 整体合并时冲突）
   - 在自助改密 handler 里直接 `require('./lib/passwordPolicy').validate(newPassword)`
   - 不强制 ENABLE_PASSWORD_POLICY 默认值（保持现状默认开启）

4. **前端 · login.html 升级**
   - 加 `<input type="checkbox" name="remember" id="remember">` + label "30 天内免登录（仅在私人电脑勾选）"
   - 加 `<a>` "忘记密码？请在钉钉联系 Cyrus"（占位 `[Cyrus]`，后续替换为实际钉钉号/二维码）
   - `<input type="text" name="username">` 加 `autocomplete="username"`
   - `<input type="password" name="password">` 加 `autocomplete="current-password"`

5. **前端 · login.js 调整**
   - 提交时把 `remember` checkbox 状态带进 fetch body

6. **前端 · React 端自助改密入口**
   - 新增 `apps/web/src/components/ChangePasswordModal.jsx`（旧密 + 新密 + 确认新密 三字段 + 提交按钮）
   - 在右上角下拉菜单（已有用户头像/登出位置）加"修改密码"项
   - 提交成功 → 提示"密码已更新，请重新登录" → 跳 `/login.html`
   - `apps/web/src/api/auth.js`（如已存在则追加 `changeOwnPassword(oldPwd, newPwd)`；不存在则新建）

7. **测试（修订 2026-04-28 · Cyrus 决策：Mac 端跳过自动化测试）**
   - **不写 unit / smoke 自动化测试**。原因：主分支 `codex/mac/uplift-design` 0 个 `.test.js` + 无 test runner（vitest 仅在 V2 引入未合入），本 PR 不引依赖、不污染 V2 lockfile。
   - **替代验收**：Mac 端 `npm run build` 前端编译过 + `node apps/gateway/server.js` 启动不崩 → push origin → **Cyrus 在 Windows 公司机 git pull + 启动 + 浏览器手测全部 §6 验收项**。
   - **遗留登记**：主分支测试基础设施缺失 → PROGRESS R4（等 PR1-12 + V2 合入自然消除）
   - **Cyrus 手测脚本**（Windows 端按顺序跑）：
     1. 不勾"记住我" 登录 → 完成 → 关浏览器 → 重开 → 跳回登录页（session-only cookie 失效）
     2. 勾"记住我" 登录 → 完成 → 关浏览器 → 重开 → 仍登录态（30 天 cookie）
     3. 右上角"修改密码"：旧密错 → 提示 + 不放行
     4. 右上角"修改密码"：新密弱（如 `1234`）→ 提示中文 reasons
     5. 右上角"修改密码"：旧密对 + 新密合规（如 `Aaa12345`）→ 提示"请重新登录" + 跳登录页
     6. 用旧密登录 → 失败；用新密登录 → 成功
     7. 登录页可见"忘记密码 请在钉钉联系 Cyrus"链接

8. **文档**
   - 新增 `docs/adr/0019-self-service-password-and-remember-me.md`
     - 决策：方案 A + B2 + autocomplete
     - 拒绝理由：邮件能力（无 SMTP）/ 安全问题（UX 差）/ 短信（成本+无供应商）
     - 风险登记：30 天 cookie 共享电脑隐患（已通过文案缓解）

## 5. 涉及文件 / 资源

- **后端**：
  - `apps/gateway/server.js`（改 login 处理 + 新增 self-service password endpoint）
  - `apps/gateway/lib/passwordPolicy.js`（新增，来自 V2 分支）
  - `apps/gateway/lib/auth/*`（如 V3 server-auth 已合可用其结构；当前 uplift-design 上还没合，按现状写在 server.js）
- **前端**：
  - `apps/gateway/public/login.html`（改）
  - `apps/gateway/public/login.js`（改）
  - `apps/web/src/components/ChangePasswordModal.jsx`（新）
  - `apps/web/src/api/auth.js`（追加方法 / 新建）
  - `apps/web/src/layouts/*` 或 `apps/web/src/components/UserMenu.jsx`（找到现有右上角菜单加入口）
- **测试**：本 PR 不写自动化测试（详 §4.7 修订）；Cyrus Windows 端手测 = 唯一验收路径
- **文档**：
  - `docs/adr/0019-self-service-password-and-remember-me.md`（新）
- **PROGRESS / Plan**：
  - `PROGRESS.md`（状态切换时同步）
  - 本 PLAN（执行日志追加）

## 6. 验收标准（全 ✅ 才算完成）

### 功能验收

- [ ] 登录页可见"30 天免登录"复选框 + 文案"仅在私人电脑勾选"
- [ ] 登录页可见"忘记密码？请在钉钉联系 Cyrus"链接
- [ ] 勾选"记住我"+ 登录 → 关浏览器再开 → 仍处于登录态
- [ ] 不勾选 + 登录 → 关浏览器再开 → 跳回登录页
- [ ] 登录后右上角菜单可见"修改密码"入口
- [ ] 修改密码：旧密码错 → 提示并 401
- [ ] 修改密码：新密码违反 policy（< 8 位 / 缺大小写或数字 / 黑名单词） → 提示并 422
- [ ] 修改密码：正常提交 → 200 + 提示"请重新登录" + 跳转登录页
- [ ] 改密后用旧密登录失败、用新密登录成功

### 工程验收（修订 2026-04-28：删除自动化测试相关项）

- [ ] login.html `<input>` autocomplete 属性正确（username / current-password）
- [ ] Mac 端 `npm run build`（前端）成功
- [ ] Mac 端 `node apps/gateway/server.js` 启动不报错（require / 路由注册无异常即可）
- [ ] push origin `codex/mac/feat-login-self-service-password` 成功
- [ ] **Cyrus 在 Windows 公司机 `git pull` + `ops/windows/start_all.ps1 -RebuildWeb` + 浏览器按 §4.7 手测脚本 7 条全部通过**
- [ ] ADR-0019 已 commit
- [ ] PROGRESS.md F-LOGIN 行状态切到 ✅ done + R4（测试基础设施缺失）已登记
- [ ] PROGRESS.md F-LOGIN 行状态切到 ✅ done

## 7. 风险 / 阻塞

### 风险

- **R1（PROGRESS）**：SHA256 哈希仍在用 → 本期不动；登记到 PROGRESS R1，下个独立 PR 处理
- **R2（PROGRESS）**：30 天 cookie 共享电脑隐患 → 已在 login.html 文案缓解（"仅私人电脑勾选"）
- **R3（PROGRESS）**：V2 password-policy 还没整体合入 → 仅复制单文件 `passwordPolicy.js`，schemas/admin.js 不动；未来 V2 整体合入时合并冲突域为零（不重叠）
- **新风险（本 PLAN）**：React 端入口位置依赖现有 UserMenu 组件结构 → 动手前先 `grep` 确认菜单位置；找不到则新建 UserMenu

### 阻塞

- ❌ 无阻塞。V2 password-policy 文件可独立 cherry-pick，不依赖整个分支合入。

## 8. 回滚方案

- **分支策略**：所有改动在 `codex/mac/feat-login-self-service-password`（基于 `codex/mac/uplift-design` HEAD `bb88b5e`）
- **回滚命令**：`git checkout codex/mac/uplift-design`（直接切回，分支保留作历史）
- **生产回滚**：Cyrus 在 Windows 公司机 `git checkout codex/mac/uplift-design && ops/windows/start_all.ps1 -RebuildWeb`
- **DB**：无 schema 变更，零回滚成本
- **配置**：无新环境变量；`ENABLE_PASSWORD_POLICY` 沿用 V2 默认值（true）
- **数据**：现有 `auth.json` 密码哈希格式不变（继续 SHA256），存量账号无影响

---

## 执行日志（动手后追加）

- 2026-04-28 — PLAN 创建，状态 ⚪ draft → 🟡 approved（Cyrus 口头确认 4 个细节均 OK）
- 2026-04-28 — Cyrus 决策：Mac 端跳过自动化测试，PLAN §4.7 + §6 修订；PROGRESS R4 登记
- 2026-04-28 — 状态切 🔵 in-progress；开 worktree `codex/mac/feat-login-self-service-password` 基于 `codex/mac/uplift-design` HEAD `5ba7815`
- 2026-04-28 — Commit A `69aff00`：cherry-pick `passwordPolicy.js` + server.js 改 4 处（require + setSessionCookie 加 options + login 接 remember + 新 endpoint /api/auth/me/password）
- 2026-04-28 — Commit B `4e6ed52`：login.html / login.js / login.css 加 checkbox + "忘记密码 联系 Cyrus" + autocomplete username
- 2026-04-28 — Commit C `c8a8cca`：React ChangePasswordModal 新组件 + App.jsx Header 加按钮 + server.js 旧密错 401→400（避免 axios interceptor 误踢）
- 2026-04-28 — 平台 esbuild 二进制（ADR-0009 workaround）build 通过：6.1mb js + 15.1kb css / 350ms
- 2026-04-28 — Commit D（含本日志条目）：ADR-0019 + PROGRESS / PLAN 状态同步
