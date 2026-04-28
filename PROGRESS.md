# ecom-agent-platform 进度跟踪

> **用途**：跟踪当前开发任务、本周焦点、进行中风险。
> **维护**：每个任务状态变化时同步；每周一刷新"本周焦点"。
> **最后更新**：2026-04-28

---

## 🎯 本周焦点索引（速查区）

> **用途**：Claude 读 PROGRESS 时**第一眼看这个**，不必通读全表。
> **维护**：每周一整理——完成的从这里删（不删下面详表里的 ✅ 记录），新进行中的从详表挪上来。
> **过期保护**：若下方"索引日期"距今 > 7 天，视为失效，Claude 必须回去扫详细表。
>
> **索引日期**：2026-04-28（周二）　**本周窗口**：4/27–5/3

### 主线（按优先级）

| # | 任务 | 当前状态 | 一句话 |
|---|------|---------|--------|
| ① | **F-LOGIN** 登录自助改密 + 记住我 30 天 | 🟡 approved（4/28）→ 待动手 | 登录页加"30 天免登录"勾选 + "忘记密码联系 Cyrus" + 登录后右上角自助改密 |
| ② | **F-CHANNEL-TOP20** 渠道 Top 20 板块业务逻辑调整 | ⚪ 仅口头需求 | 等 ① 完成后 brainstorm 细节 |
| ③ | **审 + 合 PR1-12 + V2/V3** 历史 7→9 改造交付 | 🟡 待 Cyrus 审 | 见 `docs/plans/2026-04-24-pr-review-guide.md` |

### 🚨 进行中风险登记（每次开工必看）

| # | 风险 | 触发条件 | 防御 | 登记日 |
|---|---|---|---|---|
| **R1** | **密码哈希仍用 SHA256（未升 bcrypt）** | 公司账号被撞库 / 数据泄露 | 历史短板，作为后续 PR 单独处理；本次 F-LOGIN 不动以减小爆炸半径 | 2026-04-28 |
| **R2** | **30 天 cookie 在共享电脑是隐患** | 用户在网吧/共享机勾"记住我" | login.html 文案显式提示"仅私人电脑勾选" | 2026-04-28 |
| **R3** | **V2 password-policy 还没整体合入 uplift-design** | F-LOGIN 想用强密码校验 | 仅 cherry-pick `passwordPolicy.js` 单文件，不动 schemas/admin.js（避免与 v2 分支后续合并冲突） | 2026-04-28 |

---

## 🔥 本周必须完成（4/27–5/3）

| 编号 | 任务 | Deadline | 状态 | 下一步 | Owner |
|---|---|---|---|---|---|
| **F-LOGIN** | 登录自助改密 + 记住我 30 天 + 忘记密码联系 Cyrus | 2026-04-30 | 🟡 approved | 开 worktree 分支 `codex/mac/feat-login-self-service-password` 动手 | Claude → Cyrus 验收 |
| **F-CHANNEL-TOP20** | 渠道 Top 20 板块业务逻辑调整 | TBD | ⚪ 待 brainstorm | F-LOGIN 完成后启动 | Claude |
| **PR-REVIEW** | Cyrus 审 + 合 PR1-12（按 base 链顺序）→ V2 三件 → V3 四件 | 自定 | 🟡 等 Cyrus 抽时间 | 看 `docs/plans/2026-04-24-pr-review-guide.md` | Cyrus |
| **PROD-CUTOVER** | PR1-12 全合后按 runbook §4.2 切流量 | PR1-12 全合后 | ⚪ 阻塞 PR-REVIEW | — | Cyrus |

---

## 📋 历史里程碑

### 2026-04-23 ~ 2026-04-25：7→9 加固三轮交付（已 push origin）

- **第一轮**：12 PR（codex/mac/uplift-pr1..pr12），48 条 smoke + unit 全绿
- **第二轮 V2**：grafana / metrics-auth / password-policy 三件，独立分支
- **第三轮 V3**：reportRepo 拆分（3273→5 行 facade）/ server.js auth 抽取（1719→940）/ 前端 api 三层 / OpenAPI 双源
- **文档**：18 份 ADR（在 V2/V3 分支）+ 6 份 Cookbook + 3 份 V3 Plan + PR review guide
- **20 个 codex/mac/* 分支全部 push origin**，19 个子 worktree 已清理
- **详见**：`/Volumes/tyj/Cyrus/.claude/checkpoints/2026-04-28-01-ecom-uplift-pushed-and-cleaned.md`

### 2026-04-28：项目治理文件落地

- 建 `CLAUDE.md`（项目根，~150 行）
- 建 `PROGRESS.md`（本文件）
- 建 `docs/plans/_TEMPLATE.md` + `docs/plans/README.md`
- 应用 `/Volumes/tyj/Cyrus/opc/CLAUDE.md` 规范，按 ecom 双端实际裁剪

---

## 🔗 关联资源

- **Checkpoint（最近）**：`/Volumes/tyj/Cyrus/.claude/checkpoints/2026-04-28-01-ecom-uplift-pushed-and-cleaned.md`
- **PR 审核手册**：`docs/plans/2026-04-24-pr-review-guide.md`
- **加新功能 Cookbook**：`docs/recipes/`
- **全局规则**：`/Volumes/tyj/Cyrus/CLAUDE.md`（第一性原理 4 问）
- **opc 规范源**：`/Volumes/tyj/Cyrus/opc/CLAUDE.md`（本项目规范的母版）
