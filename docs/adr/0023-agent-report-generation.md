# ADR-0023: Agent 报表生成架构

**状态**：accepted
**日期**：2026-05-16
**决策者**：Cyrus

## 背景

用户每天花 1-2 小时手动做 Excel 报表（拉数据 → VLOOKUP → 透视 → 格式化）。现有 Streaming Agent 只能对话分析，无法输出可交付的 Excel 文件。

## 决策

### 1. 两阶段架构：LLM 决策 + 确定性渲染

Agent 通过 ReAct 循环查数据后，调用 `build_report` 工具输出结构化 Report Schema（JSON）。前端渲染预览，后端 ExcelJS 生成带格式的 .xlsx。LLM 不直接操作 Excel 单元格。

**理由**：LLM 输出不稳定，让它决定"报什么"而非"怎么排版"，用 Zod 校验 Schema 兜底。

### 2. ExcelJS 代码构建，不用模板引擎

用 ExcelJS 程序化构建 Workbook（样式/条件格式/冻结行），不引入 Carbone 等模板引擎。

**理由**：报表结构由 Agent 动态决定，模板引擎适合固定布局；ExcelJS 已是项目依赖，零新增成本。

### 3. Univer 做前端预览（降级到 Ant Design Table）

优先用 Univer（Apache-2.0，完整 Excel 体验 + 原生 .xlsx 导出）。如果 Univer 不稳定，降级到 Ant Design Table + 后端 ExcelJS 导出。

**理由**：AG Grid Excel 导出要 $999/人/年，Handsontable 商用 $899/人/年。Univer 免费且功能覆盖最全。

### 4. query_sku_details 双返回模式

返回 `{ summary, detail_rows }`。`summary`（聚合数据）给 LLM 做 observation，`detail_rows`（含款号）给 Excel 导出。

**理由**：出站审计禁止 SKU/款号泄露给 LLM，但用户的 Excel 报表必须包含款号。双返回在安全和功能间取得平衡。

## 影响

- 新增 4 个 Agent 工具（query_daily_summary / query_sku_details / query_comparison / build_report）
- 新增 excelBuilder 模块 + /api/report/export 端点
- 前端新增 ReportPreview 组件（Univer 或 Ant Design Table 降级）
- 无 DB schema 变更
