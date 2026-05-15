# ADR 0005: bcrypt 密码迁移（兼容 SHA256 的无感升级）

- 日期：2026-04-23
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：PR5
- 关联设计：`docs/plans/2026-04-23-uplift-to-9-design.md`

## 背景

当前密码存储：
- `account.password_hash = sha256(plaintext)` — 64 位十六进制
- **无盐**（无 salt）
- **一次 hash**（无 iteration count）

`server.js:150` 甚至有 `password_hash: sha256("123")` 作为默认密码。

**问题**：
- SHA256 设计目标是快（~30M hash/s GPU），适合数字签名，不适合密码存储
- 无盐 → 一张 2GB 的彩虹表可反向查出所有常见密码
- 40 人推广后，任何一次数据库泄漏（文件备份、Windows 远程桌面截屏、Git 误提交）都能直接爆出所有明文密码

## 决策

引入 bcryptjs（cost=10），**与 SHA256 兼容共存**，**首次登录时无感升级**。

### 账号字段扩展

```javascript
{
  id: "acct_xxx",
  name: "张三",
  username: "anta",
  password_hash: "8a1d...c2f"   // 64 位 hex，SHA256，**保留**
  password_bcrypt: "$2a$10$..."  // 新增，可为空字符串
  is_admin: true,
  permissions: [...]
}
```

两个字段共存：
- `password_hash` — 保留，兼容现存账号
- `password_bcrypt` — 新增，bcrypt cost=10 格式

### 登录验证顺序

```
passwordHasher.verify(plaintext, account):
  1. 若 account.password_bcrypt 非空：
     尝试 bcrypt.compareSync → 成功返回 { valid, method: "bcrypt", needsUpgrade: false }
  2. 否则或 bcrypt 匹配失败：
     fallback 到 SHA256 timing-safe 比较 → 若成功：
       返回 { valid, method: "sha256", needsUpgrade: !bcrypt_hash_exists }
  3. 两者都失败 → { valid: false }
```

### 无感自动升级

当登录走 SHA256 路径成功，且环境变量 `ENABLE_BCRYPT=true`（默认）：
1. 用 plaintext 生成 bcrypt hash
2. 原子写入 `auth.local.json`（存 `password_bcrypt` 字段）
3. 下次登录该账号 → bcrypt 快路径

**用户无感**：不需要重置密码、不需要改前端、不需要培训。

### 管理员设置密码

`createManagedAccount` / `updateManagedAccountPassword` 同时写两个字段：
- `password_hash = sha256(new_password)` — 保留兼容
- `password_bcrypt = bcrypt.hashSync(new_password, 10)` — 首选

这样新建或重置的账号从诞生起就有 bcrypt，不需要触发 SHA256 升级路径。

### 环境开关

- `ENABLE_BCRYPT=true`（默认）：全部上述逻辑生效
- `ENABLE_BCRYPT=false`：关闭 bcrypt 路径，100% 退回 SHA256
  - 应急阀门，出问题可 1 分钟回滚

### 测试环境

- `vitest.config.js` 显式 `ENABLE_BCRYPT=false`
  - 原因 1：bcrypt.hashSync(cost=10) 每次 ~50ms，25 条 smoke 多处登录累积会拖慢
  - 原因 2：auto-upgrade 会写 `auth-local.fixture.json`，污染 fixture，造成 flaky

## 不做什么

- ❌ 不强制所有账号必须重新登录（兼容期内 SHA256 仍能登）
- ❌ 不删除 SHA256 字段（V2 观察期满后再清）
- ❌ 不引入 salt 列（bcrypt 内置 salt）
- ❌ 不改前端（登录 API 入参出参不变）
- ❌ 不引入密码策略（长度、复杂度），保持现有 `validateAccountPassword` 规则

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| 直接切到 bcrypt，强制所有人重置 | 40 人同时被迫重置，运维灾难 |
| argon2 | Node.js 下需要 native 编译，Windows 和 Mac 双端维护麻烦；bcrypt 已达现代标准 |
| pbkdf2 | 更慢，行业共识偏向 bcrypt/argon2 |
| 保持 SHA256 | 不达 B 级产品安全底线 |
| 引入密码管理服务（HashiCorp Vault 等）| 过度投资，40 人内网用不到 |

## 验证

**单元测试**（`tests/unit/passwordHasher.test.js`，7 条）：
- SHA256 路径：验证 / 拒绝
- bcrypt 路径：hashForStorage → verify
- 双 hash 并存：bcrypt 优先
- bcrypt 错配 → 回退 SHA256
- 全错：拒绝
- 空账户：优雅返回 false

**烟囱测试**（25 条，基于 PR2）：
- 全部通过 × 3 次稳定
- 测试环境 `ENABLE_BCRYPT=false`，保证 fixture 不被污染

合计 **32/32 测试稳定通过**。

## 生产部署步骤

1. 合并 PR5 → `feature/dispatch-agent`
2. Windows 生产机 `git pull`
3. `npm --prefix apps/gateway ci`（新增 bcryptjs 依赖）
4. 按双端口方案在 :3002 启动新版，用 3 个管理员账号登录 × 2 次验证：
   - 第 1 次：走 SHA256 路径，`auth.local.json` 里新增 `password_bcrypt` 字段
   - 第 2 次：走 bcrypt 路径（查日志确认 `method=bcrypt`）
5. 切 :3001 → 新版
6. 老版保留 1 小时
7. 观察 1 周，所有 40 人陆续被动升级
8. 第 2 周：V2 可清除 SHA256 fallback 路径

## 若发现问题

即时回滚：
```
echo 'ENABLE_BCRYPT=false' >> apps/gateway/.env
npm run ops:stop:saas && npm run ops:start:saas
# 所有登录退回 SHA256 路径，password_bcrypt 字段被忽略
```

或完整 git revert 合并 commit。
