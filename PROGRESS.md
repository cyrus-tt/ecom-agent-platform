# ecom-agent-platform 进度跟踪

> **用途**：跟踪当前开发任务、本周焦点、进行中风险。
> **维护**：每个任务状态变化时同步；每周一刷新"本周焦点"。
> **最后更新**：2026-05-16 (Phase 2B+3 完成)

---

## 🎯 本周焦点索引（速查区）

> **用途**：Claude 读 PROGRESS 时**第一眼看这个**，不必通读全表。
> **维护**：每周一整理——完成的从这里删（不删下面详表里的 ✅ 记录），新进行中的从详表挪上来。
> **过期保护**：若下方"索引日期"距今 > 7 天，视为失效，Claude 必须回去扫详细表。
>
> **索引日期**：2026-05-16（周六）　**本周窗口**：5/16–5/22

### 主线（按优先级）

| # | 任务 | 当前状态 | 一句话 |
|---|------|---------|--------|
| ① | **AI-native Phase 2B: 审批队列** | ✅ done（5/16） | Agent 提案 → 风险分级路由 → 高风险排队等审批，低/中自动执行 |
| ② | **AI-native Phase 3: 效果追踪** | ✅ done（5/16） | 提案执行后 3 天自动 re-measure，计算有效率闭环 |
| ③ | **Agent 对话集成巡检工具** | ✅ done（5/16） | 流式 Agent 新增 get_agent_status 工具，可对话查巡检/提案/有效率 |
| ④ | **GitHub main 统一基线** | ✅ done（5/16） | 本地 `main` 与 `origin/main` 同步到 `b23ce7d` |
| ⑤ | **Mac mini 大升级准备** | 🟢 ready | 在 Mac mini 从 GitHub 最新 `main` 拉取后，新开独立升级分支开发 |
| ⑥ | **F-CHANNEL-TOP20** 渠道 Top 20 板块业务逻辑调整 | ⚪ 暂搁置 | 大升级规划时重新评估优先级 |

### 🚨 进行中风险登记（每次开工必看）

| # | 风险 | 触发条件 | 防御 | 登记日 |
|---|---|---|---|---|
| **R0** | **大升级再次污染 main** | 在已有杂分支上继续开发或直接推 main | Mac mini 必须基于 GitHub 最新 `main` 新开独立分支；每个阶段小步提交、先测后合 | 2026-05-16 |
| **R1** | **密码哈希仍用 SHA256（未升 bcrypt）** | 公司账号被撞库 / 数据泄露 | 历史短板，作为后续 PR 单独处理；本次 F-LOGIN 不动以减小爆炸半径 | 2026-04-28 |
| **R2** | **30 天 cookie 在共享电脑是隐患** | 用户在网吧/共享机勾"记住我" | login.html 文案显式提示"仅私人电脑勾选" | 2026-04-28 |
| **R3** | **V2 password-policy 还没整体合入 uplift-design** | F-LOGIN 想用强密码校验 | 仅 cherry-pick `passwordPolicy.js` 单文件，不动 schemas/admin.js（避免与 v2 分支后续合并冲突） | 2026-04-28 |
| **R4** | **主分支 `codex/mac/uplift-design` 0 个 .test.js + 无 test runner** | F-LOGIN 想写 unit/smoke 测试 | Mac 端跳过自动化测试，改由 Cyrus Windows 公司机手测兜底；PR1-12 + V2 合入后 vitest 进入主线，本风险自动消除 | 2026-04-28 |
| **R5** | **缓存击穿**：TTL 过期或启动后首次冷查询 | F-PERF-40C 上线后早高峰 / TTL 过期窗口 | single-flight 兜底（同 key 并发只 1 个 SQL）+ 启动预热扩到 5 个核心查询 | 2026-04-29 |
| **R6** | **PG `max_connections` 可能不够** | 池 max 25 但 PG `max_connections < 50` | Cyrus 在 Windows 端 `SHOW max_connections;` 验证；不够则手动调 `postgresql.conf` | 2026-04-29 |
| **R7** | **PowerShell 40 并发压测精度有限** | F-PERF-40C 验收对比 P95 数字 | PS `Start-ThreadJob` 比 k6 误差 ±10%，但 40 并发量级足够；不引新依赖 | 2026-04-29 |
| **R8** | **重操作排队语义用户困惑** | 用户连点 Excel 导出 5 次 | 429 + 中文友好 message；前端 disabled 防连点是后续 PR | 2026-04-29 |

---

## 🔥 本周必须完成（4/27–5/3）

| 编号 | 任务 | Deadline | 状态 | 下一步 | Owner |
|---|---|---|---|---|---|
| **F-PERF-40C** | 40 并发性能加固 · 8 大 step | 2026-05-03 | ✅ done（5/7） | Windows 验收通过 + Codex 修 2 commit（14ac314 + 15b5968） | — |
| **F-LOGIN** | 登录自助改密 + 记住我 30 天 + 忘记密码联系 Cyrus | 2026-04-30 | ✅ done（5/7） | Windows 验收通过 | — |
| ~~F-OUTBOUND-RENAME~~ | ~~GMV → 出库金额~~ | — | ⚪ **取消** | Cyrus 4/29 改主线，不做 | — |
| **F-CHANNEL-TOP20** | 渠道 Top 20 板块业务逻辑调整 | TBD | ⚪ 暂搁置 | F-PERF-40C 完成后启动 | Claude |
| **PR-REVIEW** | Cyrus 审 + 合 PR1-12（按 base 链顺序）→ V2 三件 → V3 四件 | 自定 | 🟡 等 Cyrus 抽时间 | 看 `docs/plans/2026-04-24-pr-review-guide.md` | Cyrus |
| **PROD-CUTOVER** | PR1-12 全合后按 runbook §4.2 切流量 | PR1-12 全合后 | ⚪ 阻塞 PR-REVIEW | — | Cyrus |

---

## 📋 历史里程碑

### 2026-05-17：AI-native 深化 — 自动报表 + 噪声抑制 + 实时推送

- **自动报告下载**：巡检报告 / 每日渠道汇总 / 周环比对比，一键 Excel
- **噪声抑制学习**：用户确认异常后自动生成 7 天抑制规则，减少重复提醒
- **SSE 实时推送**：巡检完成 / 严重异常 / 新建议，即时推送到浏览器
- **Agent 健康 API**：GET /api/agent/health，系统全局状态摘要
- **快捷报表区域**：Dashboard 新增一键下载常用报表
- 分支：`codex/mac/feat-approval-queue`，13 commits，已 push origin

### 2026-05-16：AI-native Phase 2B + 3 完成，全路线图开发完毕

- **Phase 2B 审批队列**：`agent_proposals` 表 + 规则引擎 + 风险分级路由 + 前端审批 UI
- **Phase 3 效果追踪**：`agent_effects` 表 + 基线记录 + 3日后自动评估 + 有效率统计
- **Agent 对话集成**：流式 Agent 新增 `get_agent_status` 工具，对话时可查巡检/提案/效果
- 分支：`codex/mac/feat-approval-queue`，已 push origin
- AI-native 路线图（Phase 1→2A→2B→2C→3）全部开发完成，进入 Windows 验收阶段

### 2026-05-16：GitHub main 统一与升级基线确认

- 本地 `main` 与 GitHub `origin/main` 同步到 `b23ce7d`
- `origin` 上 25 个非 main 远端分支均已确认包含进 `main`
- 本地非 main 分支 `codex/add-tools-module`、`codex/integrate-all-main` 均已确认包含进 `main`
- 未删除任何本地或远端分支；仅完成合并、验证与 main 推送
- 验证记录：
  - gateway 运行时代码 `node --check` 通过
  - gateway Vitest/Supertest 分组测试共 203 条通过
  - web `test:tools` 通过
  - web production build 通过
- 保留项：本机仍有 `stash@{0}`，仅包含 `data/`、`runtime/` 运行数据保护快照，不影响 GitHub 或 Mac mini 拉取
- 下一步：Mac mini 从 GitHub 最新 `main` 拉取，新开独立分支承接大升级

### 2026-04-23 ~ 2026-04-25：7→9 加固三轮交付（已 push origin）

- **第一轮**：12 PR（codex/mac/uplift-pr1..pr12），48 条 smoke + unit 全绿
- **第二轮 V2**：grafana / metrics-auth / password-policy 三件，独立分支
- **第三轮 V3**：reportRepo 拆分（3273→5 行 facade）/ server.js auth 抽取（1719→940）/ 前端 api 三层 / OpenAPI 双源
- **文档**：18 份 ADR（在 V2/V3 分支）+ 6 份 Cookbook + 3 份 V3 Plan + PR review guide
- **20 个 codex/mac/* 分支全部 push origin**，19 个子 worktree 已清理
- **详见**：`/Volumes/tyj/Cyrus/.claude/checkpoints/2026-04-28-01-ecom-uplift-pushed-and-cleaned.md`

### 2026-04-28 ~ 2026-05-07：F-LOGIN + F-PERF-40C 交付

- **F-LOGIN**：登录自助改密 + 记住我 30 天 + 忘记密码联系 Cyrus（4 commit + ADR-0019）
- **F-PERF-40C**：40 并发性能加固（6 commit + ADR-0020 + 压测脚本）
- **Codex 在 Windows 端修 2 个 bug**：`14ac314` idle_timeout_ms 生效 + clearAllCaches 重构；`15b5968` DailyReportPage columns 初始化顺序
- 分支 `codex/mac/feat-login-self-service-password`，待 PR 合入 `feature/dispatch-agent`

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
