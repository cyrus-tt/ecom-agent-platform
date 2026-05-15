# ADR 0013: 密码策略校验（长度 + 大小写 + 数字 + 弱口令黑名单）

- 日期：2026-04-24
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联阶段：V2 加固清单第 3 项
- 前置：ADR 0005（bcrypt 迁移）、ADR 0006（zod 入参校验）

## 背景

PR5 完成了散列升级，PR6/PR12 完成了入参 **形态** 校验，但**强度** 校验一直是空白。

当前 `schemas/admin.js` 里：

```javascript
password: z.string().min(1).max(128)
```

意味着 `1`、`password`、`12345678` 都能穿过 zod → bcrypt → 落库。40 人的内部系统里，
一旦 `auth.local.json` 泄露（比如运维误传到 Git、误拷到 U 盘、被同事截屏），这些弱口令
在 bcrypt 字典攻击下 10 分钟内全部破解。

审计视角：**散列强度是 0 分时你死于明文，散列强度是 100 分时你死于弱口令**，两者必须同时满足。

## 决策

新增 `apps/gateway/lib/passwordPolicy.js`，在 zod schema 的 `.superRefine()` 钩子里调用，
失败则把中文 reason 塞进 `issues[].message`（沿用 PR6 的响应格式）。

### 策略内容

| 维度 | 默认值 | 可调 |
|---|---|---|
| 最小长度 | 8 | `MIN_LENGTH` 常量 |
| 最大长度 | 128 | `MAX_LENGTH` 常量（硬闸，禁用策略时仍生效）|
| 必须包含小写字母 | 是 | `REQUIRE_LOWER` |
| 必须包含大写字母 | 是 | `REQUIRE_UPPER` |
| 必须包含数字 | 是 | `REQUIRE_DIGIT` |
| 必须包含特殊字符 | 否 | `REQUIRE_SPECIAL`（保留，默认关） |
| 弱口令黑名单 | 26 条 | `WEAK_PASSWORDS` 集合 |

黑名单覆盖：SecLists top-1000 前缀、本项目遗留默认值（`ecom123`、`agent123`）、
运维场景常见占位（`admin123`、`letmein`、`changeme`、`000000`）。

### 绑定点

- `POST /api/admin/accounts`（创建账号）
- `PATCH /api/admin/accounts/:id/password`（重置他人密码）

**不校验** 登录路径，因为：
1. 存量账号可能本来就是弱密码，校验了反而登不进去改密码
2. 登录失败应保持"用户名或密码错误"的通用提示，暴露强度细节会帮到攻击者

### 禁用开关

环境变量 `ENABLE_PASSWORD_POLICY`：
- 默认 / 未设置 / 显式 `true` → 启用
- 显式 `false` / `"0"` / `"no"` / `"off"` → 仅校验长度上限，不查强度/黑名单

禁用模式保留的原因：
1. 生产初期若误伤（例如 AD 批量迁移的账号名含特殊字符），可一键止血
2. 测试场景可以批量构造短密码账号，不必每条都造 `Abcdef12`
3. 策略调整期（比如要把 MIN_LENGTH 提到 12）过渡期里临时关闭

长度上限 128 位是 **硬闸**，任何模式都生效 —— 防止攻击者把 10MB 字符串塞进 bcrypt 触发 DoS。

## 响应示例

前端发 `{ name: "小王", password: "weakpwd" }`，后端返回：

```json
{
  "ok": false,
  "message": "invalid input: password: 密码至少 8 位; password: 需要包含大写字母; password: 需要包含数字",
  "issues": [
    { "path": "password", "message": "密码至少 8 位" },
    { "path": "password", "message": "需要包含大写字母" },
    { "path": "password", "message": "需要包含数字" }
  ]
}
```

**一次性返回全部违规**，不是命中第一条就短路 —— 用户改一次就过。

## 不做什么

- ❌ 不做密码历史复用检测（需要多次 bcrypt 存档，扩 schema 成本大，V3 再说）
- ❌ 不接 haveibeenpwned API（需要外网，内网部署不适用）
- ❌ 不校验登录时密码（见上）
- ❌ 不改现有账号的密码（既存弱密码保留，直到用户自己改或管理员重置）
- ❌ 不做密码过期策略（NIST SP 800-63B 已不推荐强制过期）

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| zxcvbn 熵评估 | 15MB 字典文件，内网部署包体积翻倍；我们的威胁模型不需要这么细 |
| 只校验长度 | 对 `password` 这种高频弱口令无效 |
| 强制特殊字符 | NIST SP 800-63B 已不推荐，长密码 > 字符多样性 |
| 在 handler 里校验 | 分散在多处，无法在 OpenAPI / 前端契约里暴露；zod refine 方案能保留单一契约 |

## 验证

单元测试 `tests/unit/passwordPolicy.test.js` 25 条：
- isEnabled() 的 5 种 env 组合
- validate() 启用模式：合法 × 2、太短、缺小写、缺大写、缺数字、黑名单 × 3、超长、空串、非字符串、多违规并列
- validate() 禁用模式：短密码 / 弱口令 / 纯数字通过；超长 / 非字符串仍被拒
- 常量暴露：黑名单 ≥ 10、MIN_LENGTH=8

集成测试 `tests/smoke/admin-password-policy.smoke.test.js` 4 条：
- 创建账号 `Abcdef12` → 201（回归）
- 创建账号 `weakpwd` → 400 + 中文"大写/数字"
- 创建账号 `password` → 400 + 中文"弱口令"
- PATCH 密码 `Short1` → 400 + 中文"至少 8 位"

全仓测试：**77 passed（原 52 + 新 25 + 新 4 - 之前未计入的 smoke = 77）**。

## 后续

- V3：密码历史（last N 次不可复用）
- V3：登录失败频率限制 + 临时锁定（和密码策略解耦，单独一个 ADR）
- V2 剩余项：审计表 retention、secret-in-log 扫描、readiness 超时

## 首性原理自检

**这一步为什么存在？能消除吗？**
答：bcrypt 解决了存储泄露后"明文"问题，但没解决"弱密码"问题。两者不能互相替代。
消不掉——除非放弃密码认证换 SSO/WebAuthn，不在本阶段范围。

**失败路径？**
答：
1. 前端发弱密码 → 400 + 中文 issues，前端按 `path="password"` 标红
2. 运维需要临时关闭 → `ENABLE_PASSWORD_POLICY=false` 重启，退回 PR6 的行为
3. 开发环境测试想用短密码 → fixture 固定走登录路径不触发策略；要造新账号就在 beforeAll 里显式关

**在真实环境跑过吗？**
答：本 PR 在 worktree 里跑了 77 条 vitest 全绿（含 4 条端到端 supertest）。Windows 生产机
尚未部署 —— 随下一次生产发版合并，runbook §5.4 已写应急关闭步骤。

**3 个月后能一眼看懂吗？**
答：`lib/passwordPolicy.js` 一个文件 120 行，schema 里 5 行 superRefine，runbook 有快速关闭
命令。独立常量 + 集中 reasons 列表，改一条黑名单只需要编辑一行。
