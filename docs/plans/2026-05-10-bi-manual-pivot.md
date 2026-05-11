# PLAN · ChatBI 增强：手动透视 + 预设数据集 + 中文字段 + 模板保存

**PROGRESS 编号**：F-CHATBI-V2
**创建于**：2026-05-10
**Deadline**：2026-05-14
**状态**：🟡 approved（2026-05-10 Cyrus 确认 A+C 方案 + 3 个预设数据集）

---

## 1. 一句话任务

BiPage 改为双 Tab（手动透视 + AI 透视），手动模式支持 3 个预设数据集 + 日期区间选择 + 全中文字段 + 拖拽透视 + 模板保存加载。

## 2. 为什么做（Why）

Cyrus（2026-05-10）反馈：AI 生成 SQL 有时不准确，用户更需要"像 Excel 一样自己拖透视"的基础能力。ChatBI 作为增强，但手动模式是核心。

## 3. 边界（不做什么）

- 不做图表可视化（V3）
- 不改 PG schema
- 不改现有 dashboard/channel-dashboard 页面

## 4. 方案步骤

### S1 — 中文字段映射常量

- biQueryService.js 新增 `COLUMN_LABEL_MAP`：英文列名 → 中文标签
- 覆盖 rpt_sales_sku_daily + rpt_inventory_sku_latest 全部列
- 新增 `mapColumnsToChinese(rows)` 函数：把 row 对象的 key 从英文替换为中文

### S2 — 预设数据集 API

- `POST /api/bi/dataset` body: `{ key: "daily_sales" | "inventory" | "sales_inventory", date_from?, date_to? }`
- 3 个预设 SQL：
  - `daily_sales`：SELECT 全列 FROM rpt_sales_sku_daily WHERE date range + SKU_FILTER + LIMIT 5000，列名用中文 AS
  - `inventory`：SELECT 全列 FROM rpt_inventory_sku_latest WHERE SKU_FILTER + LIMIT 5000
  - `sales_inventory`：两表 JOIN on sku，合并销售+库存
- 返回 `{ ok, columns: [{ name, type }], rows, rowCount, elapsed_ms }`
- rows 的 key 全部是中文

### S3 — 模板存储 API

- 模板存 `apps/gateway/config/bi-templates.json`（JSON 文件，类似 auth.json 模式）
- 结构：`{ templates: [{ id, name, account_id, dataset_key, pivotState: { rows, cols, vals, aggregatorName }, created_at }] }`
- `GET /api/bi/templates` — 返回当前用户的模板列表
- `POST /api/bi/templates` body: `{ name, dataset_key, pivotState }` — 保存新模板
- `DELETE /api/bi/templates/:id` — 删除模板

### S4 — BiPage 重构为双 Tab

- Tab 1「手动透视」：
  - 数据集选择器（3 个预设，带说明）
  - 日期区间选择器（仅 daily_sales 和 sales_inventory 需要）
  - "加载数据"按钮 → POST /api/bi/dataset
  - PivotTableUI（中文字段）
  - "保存为模板"按钮 + 模板列表下拉（加载已存模板）
- Tab 2「AI 透视」：现有 ChatBI 功能（保持不变）

### S5 — Mac 端验证 + ADR

## 5. 涉及文件 / 资源

- 改文件：`apps/gateway/services/biQueryService.js`（中文映射 + 预设 SQL）
- 改文件：`apps/gateway/server.js`（2 个新 endpoint）
- 改文件：`apps/web/src/pages/BiPage.jsx`（双 Tab 重构）
- 新文件：`apps/gateway/config/bi-templates.json`
- 文档：ADR-0023

## 6. 验收标准

- [ ] V1：手动模式选"日报销售明细" + 日期区间 → 数据加载，字段全中文
- [ ] V2：拖拽行/列/值，透视表实时更新
- [ ] V3：保存模板 → 刷新页面 → 加载模板 → 透视配置恢复
- [ ] V4：3 个预设数据集都能正常加载
- [ ] V5：AI 透视 Tab 功能不变
- [ ] V6：Mac 端 node --check + esbuild 全绿

## 7. 风险

| # | 风险 | 缓解 |
|---|------|------|
| R1 | rpt_sales_sku_daily 列很多（100+），全选太宽 | 预设 SQL 精选核心维度+度量（~30 列） |
| R2 | 5000 行在前端 PivotTable 可能卡 | react-pivottable 实测 5000 行流畅 |

## 8. 回滚方案

- 在现有 feat-chatbi 分支上继续，revert commit 即可

---

## 执行日志

