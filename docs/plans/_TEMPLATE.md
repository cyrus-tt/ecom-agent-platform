# PLAN · <任务名>

**PROGRESS 编号**：<如 F-LOGIN / F-CHANNEL-TOP20；新任务填 `N/A`>
**创建于**：YYYY-MM-DD
**Deadline**：YYYY-MM-DD 或 `—`
**状态**：⚪ draft → 🟡 approved → 🔵 in-progress → ✅ done / ❌ cancelled

---

## 1. 一句话任务

<一行说清楚做什么，不超过 2 行>

## 2. 为什么做（Why）

<解决什么问题？谁提的需求？（每条需求附人名 + 日期）>

## 3. 边界（不做什么）

<明确非目标，防止范围蔓延。常见：不改 X、不动 Y、不兼容 Z>

## 4. 方案步骤

1. Step 1 — <预期产出>
2. Step 2 — <预期产出>
3. Step 3 — <预期产出>

## 5. 涉及文件 / 资源

- 后端代码：`apps/gateway/...`
- 前端代码：`apps/web/src/...`
- SQL：`pipelines/pg-daily-wide/sql/...`
- 文档：`docs/adr/NNNN-...md`
- 测试：`apps/gateway/tests/{unit,smoke}/...`
- 外部依赖：<接口 / 人员 / 工具>

## 6. 验收标准（全打 ✅ 才算完成）

- [ ] 条件 1（可测试）
- [ ] 条件 2（可测试）
- [ ] 条件 3（可测试）
- [ ] Mac 端 unit + smoke 测试全绿
- [ ] Cyrus 在 Windows 公司机 git pull + 启动 + 手测通过
- [ ] ADR-NNNN 已 commit（如适用）

## 7. 风险 / 阻塞

- 风险：<已知可能出错的地方 + 缓解措施>
- 阻塞：<在等谁 / 等什么>

## 8. 回滚方案

<如果方案失败或发现错了，怎么撤回？命令、分支、备份路径>

- 分支：`codex/mac/feat-<topic>`，单 commit revert 即可 / 多 commit 见下
- DB：<无 schema 变更 / 有则给出 down 脚本>
- 配置：<改了哪些 .env / config 文件，恢复方法>

---

## 执行日志（动手后追加）

- YYYY-MM-DD HH:MM — 开始（状态切到 🔵 in-progress）
- YYYY-MM-DD HH:MM — <关键进展>
- YYYY-MM-DD HH:MM — Mac 端测试 X/X 全绿
- YYYY-MM-DD HH:MM — push origin <分支名>，请 Cyrus 验收
- YYYY-MM-DD HH:MM — Cyrus 验收通过 / 退回（如退回写原因）
- YYYY-MM-DD HH:MM — 完成（状态切 ✅ done，PROGRESS.md 已同步）
