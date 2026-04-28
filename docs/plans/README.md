# docs/plans/ — 任务计划目录

## 核心规则

**硬规定**：预计耗时 > 30 分钟、或改动 > 1 个文件、或涉及部署 / DB / 上游联调的任务，**开工前必须先写 PLAN**，Cyrus approve 后才动手。

**可以不写 PLAN 的例外**：
- 简单查询（看状态、读文档、执行已有脚本）
- 单文件 < 30 分钟的小改
- Cyrus 明确说「不用 PLAN，直接做 X」

---

## 命名规则

`YYYY-MM-DD-<kebab-case-name>.md`

示例：
- `2026-04-28-self-service-password-and-remember-me.md`
- `2026-04-30-channel-top20-business-logic.md`

---

## 标准流程

```
1. Claude 复制 _TEMPLATE.md → docs/plans/YYYY-MM-DD-<名>.md
2. Claude 填完 1-8 节 → 状态设 ⚪ draft
3. Claude 把文件路径 + 摘要读给 Cyrus → 等确认
4. Cyrus 说「OK」或提修改意见
5. Cyrus approve → 状态改 🟡 approved → Claude 才能动手
6. 动手时状态切 🔵 in-progress，执行中追加「执行日志」
7. 完成 → 状态改 ✅ done；同步 PROGRESS.md
```

**关键红线**：状态不是 🟡 approved，不允许进入 🔵 in-progress。

---

## 为什么需要 PLAN

这解决一个老痛点：Claude 常常「理解完就动手」，做到一半才发现理解偏了。PLAN 强制把理解显式化：

- Cyrus 一眼看出理解是否对齐 → 早期纠偏成本低
- Claude 被迫先想清楚边界、验收、回滚 → 不再凭直觉动手
- 完成的 PLAN 沉淀为案例 → 以后类似任务可以参考

这与 OpenAI Harness Engineering 推荐的做法一致：`PLAN.md` 必须先于 code，且随项目一起入 git。

---

## 目录结构

```
docs/plans/
├── README.md                          ← 本文件
├── _TEMPLATE.md                       ← 空白模板
├── 2026-04-23-uplift-to-9-design.md   ← 历史 PLAN（保留）
├── 2026-04-23-uplift-to-9-plan.md
├── 2026-04-23-night1-report.md
├── 2026-04-24-pr-review-guide.md
├── 2026-04-25-v3-*.md                 ← V3 三大改造 Plan
├── 2026-04-28-<新任务>.md             ← 新 PLAN 写在这里
└── ...
```

完成的 PLAN **不删除**，留作知识库。

---

## 与 PROGRESS.md 的关系

- `PROGRESS.md` 是**全局视图**：本周焦点、风险登记、所有任务一览表
- `docs/plans/<plan>.md` 是**单任务视图**：8 节细节 + 执行日志

两者必须保持一致：plan 状态变化时，PROGRESS.md 对应行也要更新。
