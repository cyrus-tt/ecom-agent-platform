# ecom-agent-platform — 强制工作流 (Auto-loaded)

> 本文件在 Claude 进入 ecom-agent-platform 时自动加载，所有规则**强制执行**。
> 未按流程执行 = 任务未完成，不得向用户汇报「完成」。
>
> 适配自 `/Volumes/tyj/Cyrus/opc/CLAUDE.md` v1.0，针对 ecom 双端模型（Mac 开发 / Windows 公司机生产）裁剪。

---

## 🚀 开工第一件事（强制）

进入仓库后，做任何事之前先执行：

```bash
git status --short
git log --oneline -5
git worktree list
cat PROGRESS.md | head -60         # 看本周焦点 + 风险登记
ls docs/plans/                      # 看有无 🟡 approved / 🔵 in-progress 的 PLAN
```

把"当前焦点 / 进行中 PLAN / 风险登记"读给 Cyrus，确认今天的优先级，**再动手**。

### 必须跑的时机

| 时机 | 原因 |
|---|---|
| 新会话刚进入 ecom | 没有上下文，必须初始化 |
| `/resume-cp` 恢复 Checkpoint 后 | Checkpoint 是快照，PROGRESS / git 可能已变化 |
| `/clear` 清理上下文后 | 等同新会话 |
| Cyrus 说「换回 ecom 做 X」 | 之前话题可能偏离，需要重新对齐 |

跑完 ≠ 完事。必须把 `🟡 approved / 🔵 in-progress` 清单读给 Cyrus，问"今天继续哪个？"——这是防偏离的锚点。

---

## 🔴 红线（违反立即停止，不可商量）

| # | 红线 | 原因 |
|---|------|------|
| 1 | **不直接 push 到 `main` 或 `feature/dispatch-agent`** | 这两条分支是 PR 合入目标，必须经过 GitHub PR + Cyrus 审核 |
| 2 | **不在 `main` 分支写代码** | main 是上游约定主线，开发分支统一用 `codex/mac/*` |
| 3 | **没推 origin 不算「完成」** | Mac 挂了代码丢光，没推就是没存档 |
| 4 | **没在 Windows 公司机本机 `git pull` + 启动验收过不报告「完成」** | Mac 端测试 ≠ 生产验收，Windows 端真实环境验过才算交付 |
| 5 | **未经 Cyrus 明确授权不动 PostgreSQL schema** | DB schema 只加不改；任何变更必须 Cyrus 拍板 + 在 Windows 端先备份 |
| 6 | **代码文件只能放 `/Volumes/tyj/Cyrus` 内** | 工作空间边界（沿袭全局规则） |
| 7 | **精确 `git add <file>`，禁 `git add .` / `git add -A`** | 防误提交 .env / 大文件 / 临时产物 |

---

## 📝 新任务先写 PLAN（强制）

**触发条件**（满足任一即必须写 PLAN）：
- 预计耗时 > 30 分钟
- 涉及 > 1 个文件改动
- 涉及部署 / DB 变更 / 外部联调

**流程**：

```
1. 复制 docs/plans/_TEMPLATE.md → docs/plans/YYYY-MM-DD-<kebab-name>.md
2. 填完 8 节（任务 / Why / 边界 / 步骤 / 文件 / 验收 / 风险 / 回滚）→ 状态 ⚪ draft
3. 把文件路径和摘要读给 Cyrus，等 approve
4. Cyrus 说「OK」→ 状态改 🟡 approved → 才允许动手
5. 完成 → 状态改 ✅ done，同步更新 PROGRESS.md
```

**硬规则**：状态不是 🟡 approved，不允许进入 🔵 in-progress。Claude 自作主张动手 = 违规。

**例外**（可跳过 PLAN）：
- 简单查询（看状态、读文档、跑现成脚本）
- 单文件 < 30 分钟的小改
- Cyrus 明确说「不用 PLAN，直接做 X」

详见 `docs/plans/README.md`。

---

## 📋 必走 8 步开发流程

```
① 开工:        git status / git log -5 / 读 PROGRESS.md / 看 plans/ 状态
② 写 PLAN:     按上一节流程写好并拿到 🟡 approved
③ 建分支:      git worktree add ../<repo>-worktrees/<topic> -b codex/mac/feat-<topic>
              （或单任务直接 git checkout -b codex/mac/feat-<topic>）
④ 写代码 + 提交: git commit（精确 git add <file>，commit message 中文 + scope）
⑤ Mac 端测试:   npm run test / npm run build （unit + smoke 必跑全绿）
⑥ 推 origin:   git push -u origin codex/mac/feat-<topic>
⑦ Windows 验收: Cyrus 在公司机 git fetch + checkout + ops/windows/start_all.ps1 -RebuildWeb
              手测 PLAN §6 全部验收项 → 通过 / 退回
⑧ 合入主线:    GitHub PR → 合到 feature/dispatch-agent
              ⚠️ 用 "Create a merge commit"，禁 Squash（保留 base 链）
```

**任何一步不做 = 任务未完成。**

### Worktree 使用规范

- 多任务并行：`git worktree add ../ecom-agent-platform-worktrees/<topic> -b codex/mac/feat-<topic>`
- 单任务且不跨 PLAN：可直接在主 worktree 开分支
- 完成 push 后清理：`git worktree remove --force <path>`（**绝不 `git branch -D`**，分支引用是最后的安全网）

---

## 📂 目录约定

```
ecom-agent-platform/
├── CLAUDE.md                      ← 本文件（规则）
├── PROGRESS.md                    ← 进度跟踪 + 风险登记
├── README.md                      ← 项目说明（已有）
├── apps/
│   ├── gateway/                   Express 网关（含 server.js / lib/auth/* / lib/passwordPolicy.js）
│   └── web/                       React + Vite 前端
├── pipelines/
│   └── pg-daily-wide/             PostgreSQL 主数据链路 + sql/
├── data/                          inbox / prepared / archive
├── ops/
│   └── windows/                   Windows PowerShell 启停脚本
├── runtime/                       运行日志 / PID / 构建产物
└── docs/
    ├── adr/                       架构决策记录（0001-NNNN）
    ├── plans/                     PLAN 文件 + _TEMPLATE.md + README.md
    ├── recipes/                   加新功能 Cookbook（6 份）
    ├── runbook.md                 运维手册（V2/V3 合入后启用）
    └── ENGINEERING_STANDARD.md    工程规范
```

---

## 🎯 PostgreSQL 迁移流程（强制）

```
1. 写 SQL 脚本放 pipelines/pg-daily-wide/sql/<NN>_<简述>.sql
2. 必须用 CREATE IF NOT EXISTS / ALTER ADD COLUMN IF NOT EXISTS（幂等）
3. SQL 注释里写：用途、安全性（只加不改）、回滚命令
4. Mac 端能跑测试（fixture 或 docker pg）→ Cyrus 在 Windows 公司机执行 → 验证
5. 没有"先 staging 再 prod"的两段式（生产 = Windows 单机），所以严格要求幂等 + 回滚
```

---

## 📊 进度同步（两处必须一致）

| 位置 | 更新时机 |
|------|---------|
| `PROGRESS.md` | 每个任务状态变化、本周焦点切换、新风险登记 |
| `docs/plans/<plan>.md` | 状态机变化（⚪→🟡→🔵→✅） + 执行日志追加 |

两者不一致 = bug，必须修复到一致。

---

## 🧠 第一性原理（强制 4 自检，沿袭全局 CLAUDE.md）

任何交付前必须自答 4 个问题，答不上来 = 在打补丁，重来：

1. **这一步为什么存在？能不能消除？**
2. **如果这一步失败，会怎么表现？脚本能自动救活吗？**
3. **这东西在真实环境跑过吗？还是只写过代码？**
4. **3 个月后我自己打开，一眼看懂为什么这么写吗？**

违反后果：脚本/代码若失败路径上暴露 bug，视为**未交付**。教训追加到 `/Volumes/tyj/Cyrus/Rules_Skills/rules/lessons-learned.md`。

---

## 👤 协作规则

### Cyrus（用户）只做几件事

1. 听到「Mac 端测试已绿，已 push origin，分支名 X」→ 抽时间在 Windows 公司机 git pull + 启动 + 手测
   - 不测 = Claude 不能继续开发新功能
   - 测了 = 说「通过」或「Y 有问题」
2. 听到「申请合入 feature/dispatch-agent」→ 在 GitHub 上 review + Create-merge-commit
3. 拍板设计岔路（brainstorming 阶段提出的多选题）

### Claude 不能做

1. ❌ 没写 PLAN 就动手（除非满足例外条件）
2. ❌ 跳过 Mac 端测试就 push
3. ❌ 直接 push 到 main / feature/dispatch-agent
4. ❌ 改了现有代码却说是「新增」
5. ❌ 发现问题绕开不报（必须第一时间说）
6. ❌ `git add .` / `git add -A`

### Claude 应该做

1. ✅ 每次开工先看 PROGRESS / plans 状态
2. ✅ 改完精确 add + commit + push
3. ✅ 推完通知 Cyrus 去 Windows 验收
4. ✅ 不确定就问，特别是 brainstorming 阶段的设计岔路
5. ✅ 进度两处同步（PROGRESS + 对应 plan 状态）

---

## 🔑 关键访问信息

| 资源 | 地址 |
|------|------|
| GitHub remote | `origin`（codex/mac/* 分支推这里） |
| 主线分支 | `feature/dispatch-agent`（PR 合入目标）/ `main`（上游） |
| 开发分支前缀 | `codex/mac/feat-*` / `codex/mac/uplift-*` |
| Mac 开发端 | 本机 + `apps/gateway/.env`（参考 `.env.example`） |
| Windows 公司机生产端 | Cyrus 持有；启停脚本 `ops/windows/start_*.ps1` |
| PostgreSQL 18 | Windows 本机实例 |
| AGENT_DATA_MODE | `fixture`（测试） / `local`（Windows 生产） / `remote`（Mac 联调） |

---

> 版本：v1.0 (2026-04-28)
> 修订记录：
> - v1.0：初版，从 opc/CLAUDE.md v1.0 + 全局 CLAUDE.md 第一性原理 + 4/23–25 三轮交付实战教训提炼
