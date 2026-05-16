# PLAN · Agent 自动做表（Phase 1：对话生成 → 预览 → 导出美观 Excel）

**PROGRESS 编号**：F-AGENT-REPORT
**创建于**：2026-05-16
**Deadline**：—（按步骤分批交付）
**状态**：🟡 approved（2026-05-16 Cyrus 确认）

---

## 1. 一句话任务

让 Streaming Agent 能根据用户对话或报表模板，自动查 PG 数据、在前端渲染可交互的类 Excel 预览表格，用户确认后一键导出带完整格式的 .xlsx 文件。

## 2. 为什么做（Why）

Cyrus（2026-05-16）提出：
- **核心痛点**：每天 1-2 小时做表（拉报表 → VLOOKUP → 透视 → 格式化 → 发给部门），整个部门都有这个痛点
- **现状**：Streaming Agent 能对话分析数据，但无法输出可交付的 Excel 报表
- **目标**：从"每天手动做表"变成"Agent 做好 → 预览确认 → 导出"，5 分钟完成
- **项目升级方向**：让平台从"BI 看板 + AI 分析"进化为"AI 自动做表 + 人确认交付"的 AI-native 模式

调研支撑：`docs/research/2026-05-15-*.md`（4 份调研报告）

## 3. 边界（不做什么）

- ❌ 不做定时调度（Phase 2 再做，本期全部由用户触发）
- ❌ 不做审批流（Phase 2，本期是"预览确认"不是"审批执行"）
- ❌ 不做图表嵌入 Excel（用 RichReport 的 ECharts 在前端看图表，Excel 专注表格数据）
- ❌ 不对接公司 BI 系统（数据源仅限项目内 PostgreSQL）
- ❌ 不做 Agent 自动发送报表（导出后手动发，降低出错风险）
- ❌ 不动现有 Streaming Agent 的 ReAct 核心循环（只扩展工具和前端）
- ❌ 不引入 Carbone 模板引擎（本期用 ExcelJS 代码构建，模板引擎留后续评估）

## 4. 方案步骤

### S1 — 扩展 Agent 数据查询工具（后端）

在 `apps/gateway/services/streamingAgent/tools.js` 新增 3 个工具：

| 工具名 | 功能 | 返回 |
|---|---|---|
| `query_daily_summary` | 按日期范围 + 可选渠道/品类筛选，返回日维度聚合数据 | 日期 × 渠道 × 品类 的销售额/销量/折扣率 |
| `query_sku_details` | 按条件查 SKU 级明细（Top N / 筛选）| SKU × 日期的销量/库存/周转（出站审计：只返回聚合行，不泄露 SKU 编码给 LLM） |
| `query_comparison` | 同比/环比对比（本周 vs 上周，本月 vs 上月）| 两段时间的指标对比 + 变化率 |

原则：
- 复用现有 `SALES_DAILY_TABLE` / `CHANNEL_DASHBOARD_OPTIONS` / `SKU_FILTER_SQL`
- 所有工具走 `assertSafeModelPayload` 出站审计
- Zod schema 验证输入

### S2 — 报表 Schema 协议（后端 + 前端共用）

定义 Agent → 前端的报表数据协议。Agent 的工具调用结果经 LLM 处理后，输出标准化的 Report Schema：

```javascript
{
  type: "report_data",          // SSE 事件类型
  report: {
    title: "2026-05-16 各渠道品类销售汇总",
    sheets: [{
      name: "渠道汇总",
      columns: [
        { header: "渠道", key: "channel", width: 15, type: "text" },
        { header: "销售额", key: "sales", width: 18, type: "currency" },
        { header: "同比", key: "yoy", width: 12, type: "percent",
          conditional: { negative: "red", positive: "green" } }
      ],
      data: [...],
      options: {
        freezeRow: 1,
        autoFilter: true,
        sortBy: { key: "sales", order: "desc" }
      }
    }]
  }
}
```

新增一个专用工具 `build_report` 供 Agent 在完成数据查询后调用：
- Agent 查完数据 → 调 `build_report` 把结果组织成 Report Schema
- 前端收到 `report_data` SSE 事件 → 渲染预览

### S3 — Excel 格式化引擎（后端）

新建 `apps/gateway/lib/report/excelBuilder.js`：

输入：Report Schema（同 S2 的 JSON 结构）
输出：ExcelJS Workbook（带完整格式）

格式化规则（开箱即用）：
- **标题行**：深蓝底白字加粗，字号 12，微软雅黑
- **表头行**：浅蓝底，加粗，底边框，冻结
- **数据行**：交替灰白底色（斑马纹），字号 11
- **数字列**：千分位 `#,##0`，货币 `¥#,##0.00`，百分比 `0.0%`
- **条件格式**：负值标红，正值标绿（按 column 配置）
- **列宽**：按内容自适应（扫描数据计算最大宽度）
- **自动筛选**：表头行启用
- **Sheet 命名**：来自 Schema

暴露 API：`POST /api/report/export` 接受 Report Schema → 返回 .xlsx 二进制流

### S4 — 前端引入 Univer 预览组件

在 `apps/web` 引入 Univer 作为报表预览层：

1. 安装 `@univerjs/core` + `@univerjs/sheets` + `@univerjs/sheets-ui` + `@univerjs/engine-render`
2. 新建 `apps/web/src/components/ReportPreview.jsx`：
   - 接收 Report Schema → 转换为 Univer Workbook 数据
   - 应用列宽、冻结行、条件格式、数字格式
   - 用户可拖拽列、排序、编辑单元格、调整筛选
3. 底部工具栏：「导出 Excel」按钮 + 「重新生成」按钮

导出逻辑：
- 方案 A（优先）：用 Univer 原生 .xlsx 导出（保留用户调整后的格式）
- 方案 B（备选）：把当前 Schema + 用户修改 POST 到后端 `/api/report/export`，由 ExcelJS 生成

### S5 — 改造 AnalysisPage 对话流

改造 `apps/web/src/pages/AnalysisPage.jsx`：

1. SSE 解析新增 `report_data` 事件类型
2. 收到 `report_data` 后：
   - 对话区域显示简报摘要（Agent 的文字说明）
   - 下方弹出 ReportPreview 组件（Univer 表格）
   - 用户可选：「导出 Excel」「在新标签页打开完整预览」「重新生成」
3. 对话历史中保存 Report Schema（localStorage），可回看已生成的报表

### S6 — 报表模板系统（快捷入口）

1. 新建 `apps/gateway/config/reportTemplates.json`：
   ```json
   [
     {
       "id": "daily-channel-summary",
       "name": "日报 · 渠道销售汇总",
       "description": "各渠道当日/本周销售额、销量、同比",
       "prompt": "生成今天各渠道的销售汇总报表，包含销售额、销量、同比变化，按销售额降序",
       "icon": "BarChartOutlined"
     }
   ]
   ```
2. 前端 AnalysisPage 顶部展示模板卡片（3-5 个常用报表）
3. 用户点击模板 = 自动发送预设 prompt → Agent 执行 → 出预览
4. 新增 API `GET /api/report/templates` 返回模板列表

### S7 — 测试 + 文档

1. 后端 smoke 测试：
   - 新工具的返回格式和出站审计
   - excelBuilder 输入 Schema → 输出 .xlsx → 验证冻结行/条件格式/列宽
   - `/api/report/export` 端点返回 200 + 正确 Content-Type
2. 前端 Univer 集成的 smoke 测试（Vite build 不报错）
3. ADR-0022：Agent 报表生成架构决策记录

## 5. 涉及文件 / 资源

**后端新增：**
- `apps/gateway/services/streamingAgent/tools.js` — 新增 3 个查询工具 + `build_report` 工具
- `apps/gateway/lib/report/excelBuilder.js` — **新建**，Excel 格式化引擎
- `apps/gateway/routes/streaming-agent.js` — 新增 `/api/report/export` 端点
- `apps/gateway/config/reportTemplates.json` — **新建**，报表模板配置

**后端修改：**
- `apps/gateway/services/streamingAgent/index.js` — SSE 新增 `report_data` 事件
- `apps/gateway/server.js` — 注册新路由（如果 export 端点独立）

**前端新增：**
- `apps/web/src/components/ReportPreview.jsx` — **新建**，Univer 预览组件
- `apps/web/package.json` — 新增 Univer 依赖

**前端修改：**
- `apps/web/src/pages/AnalysisPage.jsx` — 处理 `report_data` 事件 + 模板卡片
- `apps/web/src/styles.css` — Univer 相关样式

**测试：**
- `apps/gateway/tests/smoke/report-export.test.js` — **新建**
- `apps/gateway/tests/smoke/agent.test.js` — 扩展

**文档：**
- `docs/adr/0022-agent-report-generation.md` — **新建**
- `docs/research/2026-05-15-*.md` — 已有（4 份调研报告）

## 6. 验收标准（全打 ✅ 才算完成）

### 核心功能
- [ ] 用户在 Analysis 页面对话"帮我做一张本周各渠道销售汇总"→ Agent 查数据 → 返回 Univer 可交互预览表
- [ ] 预览表格支持：拖拽列排序、列宽调整、排序、筛选、编辑单元格
- [ ] 点击"导出 Excel"→ 下载 .xlsx，打开后有：冻结首行、自动筛选、列宽自适应、数字千分位、负值红色、交替行颜色
- [ ] 导出的 Excel 在 WPS/Office 打开格式无异常
- [ ] 报表模板卡片可点击，一键生成预设报表

### Agent 工具
- [ ] `query_daily_summary` 返回正确的日维度聚合数据
- [ ] `query_sku_details` 返回 SKU 级明细（出站审计通过：SKU 编码不泄露给 LLM）
- [ ] `query_comparison` 返回正确的同比/环比对比
- [ ] `build_report` 输出合规的 Report Schema

### 工程质量
- [ ] Mac 端 `npm run test` 全绿
- [ ] Mac 端 `npm run build` 全绿（Univer 打包无报错）
- [ ] 后端 smoke 测试覆盖 excelBuilder + export 端点
- [ ] ADR-0022 已 commit
- [ ] Cyrus 在 Windows 公司机 git pull + 启动 + 手测通过

## 7. 风险 / 阻塞

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | Univer 打包体积过大，影响前端加载 | 中 | 中 | 按需引入（只导入 sheets 模块），dynamic import 懒加载 |
| R2 | Univer .xlsx 导出格式与 WPS/Office 不兼容 | 低 | 高 | S4 设计备选方案 B（后端 ExcelJS 导出）；验收时双端测试 |
| R3 | Agent 对 Report Schema 的输出不稳定（LLM 幻觉） | 中 | 中 | `build_report` 工具做 Zod 严格校验；Schema 不合规时返回错误让 Agent 重试 |
| R4 | 新查询工具的 SQL 在大数据量下慢 | 低 | 中 | 加 LIMIT 防护 + 复用现有索引；必要时加 EXPLAIN 分析 |
| R5 | Windows 公司机 Node.js 版本不支持某些 Univer 依赖 | 低 | 高 | Univer 是纯前端，不依赖 Node 版本；构建产物是静态 JS |

阻塞：
- 无外部阻塞。所有数据在本地 PG，所有代码在项目内

## 8. 回滚方案

- **分支**：`codex/mac/feat-agent-report`，与 main 隔离开发
- **前端**：Univer 是新增依赖 + 新组件，不改现有组件逻辑；回滚 = 移除依赖 + 删除 ReportPreview.jsx
- **后端**：excelBuilder 和新工具是独立文件；回滚 = 删文件 + 从 tools.js 移除新工具定义
- **DB**：无 schema 变更
- **配置**：无 .env 变更

最坏情况：`git revert` 整个分支的 merge commit 即可完全回退。

---

## 执行日志（动手后追加）

<!-- 
- YYYY-MM-DD HH:MM — 开始（状态切到 🔵 in-progress）
- YYYY-MM-DD HH:MM — S1 完成：3 个新工具 + build_report
- YYYY-MM-DD HH:MM — S2+S3 完成：Report Schema + excelBuilder
- YYYY-MM-DD HH:MM — S4 完成：Univer 集成
- YYYY-MM-DD HH:MM — S5 完成：AnalysisPage 改造
- YYYY-MM-DD HH:MM — S6 完成：模板系统
- YYYY-MM-DD HH:MM — S7 完成：测试 + ADR
- YYYY-MM-DD HH:MM — Mac 端测试全绿
- YYYY-MM-DD HH:MM — push origin，请 Cyrus 验收
-->
