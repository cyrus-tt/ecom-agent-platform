# 待人工验收

> **用法**：每次 Claude 写完代码后，自动追加验收项到这里。
> Cyrus 打开此文件，从上往下测，测完打 `[x]`。全部打勾 → 可以合并/发版。
> **不用问 AI，不用翻 commit，不用翻 PROGRESS。**

---

## 2026-05-16~17 · AI-native 全链路升级 (codex/mac/feat-approval-queue)

**背景**：在已有的巡检引擎（Phase 2A）和操控台（Phase 2C）基础上，补齐审批队列（2B）、效果追踪（3）、以及一系列 AI-native 增强能力。15 个 commit，22 个文件，+3112 行。

### 前置：数据库 DDL（必须先跑）

在 Windows PostgreSQL 上依次执行：
- [ ] `pipelines/pg-daily-wide/sql/11_agent_inspection_tables.sql`（如果之前没跑过）
- [ ] `pipelines/pg-daily-wide/sql/12_agent_proposals_table.sql`
- [ ] `pipelines/pg-daily-wide/sql/13_agent_effect_tracking.sql`
- [ ] `pipelines/pg-daily-wide/sql/14_agent_suppressions.sql`

### 验收 1：审批队列（Phase 2B）

- [ ] 打开操控台 `/agent-dashboard`，看到「审批队列」卡片
- [ ] 手动触发巡检（admin 按钮）→ 巡检完成后审批队列出现待审批建议
- [ ] 点击「批准执行」→ 状态变为已执行，下方"已处理建议"折叠区显示
- [ ] 点击「拒绝」→ 弹出原因输入框 → 确认后状态变为已拒绝
- [ ] 如果 pending > 1 条，出现「全部批准」按钮 → 点击后全部执行

### 验收 2：效果追踪（Phase 3）

- [ ] 操控台出现「效果追踪」卡片，显示有效率统计（首次可能全 0）
- [ ] 批准并执行若干建议后，3 天后再次巡检 → 效果追踪自动评估 → 显示 improved/unchanged/worsened

### 验收 3：异常可视化

- [ ] 展开任意异常 → 看到**推理链**：`日环比检测 → 阈值 → 实际值 → 判定`
- [ ] 展开渠道类异常（日环比/周环比）→ 看到 **7 天 GMV 迷你折线图**，异常日标红点
- [ ] 非渠道类异常（零销SKU/新品滞销）→ 只有推理链，无趋势图（正确行为）

### 验收 4：每日简报 + 下载报告

- [ ] 巡检完成后，Briefing 卡片顶部显示简报内容（异常数/待审批/有效率）
- [ ] Briefing 卡片有「下载报告」按钮 → 点击下载 Excel（3 个 sheet：异常汇总/建议/统计）
- [ ] 「快捷报表」区域有 3 个按钮：每日渠道汇总 / 周环比对比 / 巡检报告 → 各自下载 Excel

### 验收 5：异常确认 + 噪声抑制

- [ ] 展开异常 → 点击「已知悉，标记为已处理」→ 异常状态变为 acknowledged
- [ ] 再次触发巡检 → 同类异常（相同渠道+相近幅度）在 7 天内被抑制，不再出现

### 验收 6：实时推送

- [ ] 保持操控台页面打开 → 在另一个 tab 触发巡检 → 操控台弹出消息提示并自动刷新

### 验收 7：Agent 对话集成

- [ ] 打开分析页面 → 问 Agent「最近有什么异常」→ Agent 调用 get_agent_status 工具返回巡检数据
- [ ] 问「Agent 建议有效吗」→ 返回有效率统计

### 可选验收（需 DeepSeek API key）

- [ ] 配置 DEEPSEEK_API_KEY → 触发巡检 → Briefing 卡片出现紫色「AI Analysis」块，含模式分析和行动建议
