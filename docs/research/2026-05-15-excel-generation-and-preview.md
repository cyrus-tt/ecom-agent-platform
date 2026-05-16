# Excel 生成 + 前端预览技术调研

> 调研日期：2026-05-15
> 目的：选型"Agent 做表 → 前端预览 → 导出美观 Excel"的技术方案

---

## 一、后端 Excel 生成库对比

| 特性 | **ExcelJS** ✅已集成 | **SheetJS (xlsx)** | **xlsx-populate** |
|---|---|---|---|
| npm 周下载 | ~7.1M | ~5.6K (社区版) | ~173K |
| License | MIT | Apache-2.0 (社区) | MIT |
| 单元格样式（字体/颜色/边框） | **完整** | 免费版剥离大部分样式 | 完整（从模板保留） |
| 条件格式 | **完整**（数据条/色阶/图标集/表达式） | 免费版写入时丢弃 | 保留已有规则 |
| 冻结窗格 | ✅ | ✅ | 从模板保留 |
| 合并单元格 | ✅ | ✅ | ✅ |
| 自动筛选 | ✅ | ✅ | ✅ |
| 数字格式 | ✅ `numFmt` | ✅ | ✅ |
| 列宽自适应 | ✅ 手动计算更可靠 | 需手动计算 | 无内置 |
| 图片嵌入 | ✅ | Pro 才有 | ✅ |
| 图表 | ❌ 实验性/不可靠 | Pro 才有 | 保留已有图表 |
| 流式处理（大文件） | ✅ | 全量加载 | ❌ |
| 模板填充 | 无原生模板引擎 | 无 | **最强**（保留格式/公式） |

### 结论：继续用 ExcelJS，升级用法

ExcelJS 已经覆盖专业报表所需的所有格式化能力（样式/条件格式/冻结/筛选/合并/数字格式），项目里只是没用到。**不需要换库，需要把现有能力用起来。**

### ExcelJS 已支持但项目未使用的能力

```javascript
// 冻结首行
worksheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

// 自动筛选
worksheet.autoFilter = 'A1:F1';

// 单元格样式
cell.font = { name: '微软雅黑', size: 11, bold: true, color: { argb: 'FFFFFF' } };
cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '4472C4' } };
cell.border = { bottom: { style: 'thin', color: { argb: 'D9D9D9' } } };
cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

// 数字格式
cell.numFmt = '#,##0.00';        // 千分位两位小数
cell.numFmt = '0.0%';            // 百分比
cell.numFmt = 'yyyy-mm-dd';      // 日期

// 条件格式（负增长标红）
worksheet.addConditionalFormatting({
  ref: 'E2:E100',
  rules: [{ type: 'cellIs', operator: 'lessThan', formulae: [0],
            style: { font: { color: { argb: 'FF0000' } } } }]
});

// 列宽
worksheet.columns = [
  { header: '渠道', key: 'channel', width: 15 },
  { header: '销售额', key: 'sales', width: 18, style: { numFmt: '#,##0.00' } },
];

// 合并标题行
worksheet.mergeCells('A1:F1');
```

### 图表的解决方案

ExcelJS 不支持原生图表创建。替代方案：
- 用 ECharts/Chart.js + node-canvas 在服务端渲染 PNG
- 通过 `workbook.addImage()` 嵌入 Excel
- 项目已有 ECharts 依赖，成本低

---

## 二、模板引擎（设计 .xlsx 模板 → 填充数据）

| 引擎 | Stars | 方式 | License | 适用场景 |
|---|---|---|---|---|
| **Carbone** | ~1.3K | 在 Excel 里设计模板，用 `{d.field}` 标签 | CCL（内部工具免费） | 固定布局月报/P&L |
| **xlsx-template** | ~600 | 模板标签填充，保留格式 | MIT | 轻量模板场景 |
| **Docxtemplater** | ~3.3K | 多格式模板 | LGPL（xlsx 需付费模块） | 不推荐（xlsx 要钱） |

### 建议

- **动态 Agent 生成的报表** → ExcelJS 代码构建（灵活）
- **固定布局的报表**（月报、P&L） → Carbone 模板填充（设计友好）
- 两种可共存，不矛盾

---

## 三、前端电子表格组件对比

| 特性 | **Univer** ⭐推荐 | **AG Grid Community** | **Handsontable** | **FortuneSheet** |
|---|---|---|---|---|
| GitHub Stars | ~8K+ | ~15.3K | ~20K | ~3K |
| License | Apache-2.0 | MIT (社区版) | **商用付费 $899+/人/年** | MIT |
| **免费商用？** | ✅ | ✅ | ❌ | ✅ |
| 外观 | **完整 Excel 克隆**（公式栏/Sheet 标签） | 数据网格 | 非常像 Excel | 完整 Excel 克隆 |
| 可编辑单元格 | ✅ | ✅ | ✅ | ✅ |
| 拖拽列排序 | ✅ | ✅ | ✅ | ✅ |
| 列宽调整 | ✅ | ✅ | ✅ | ✅ |
| 排序 + 筛选 | ✅ | ✅ | ✅ | ✅ |
| 冻结行 | ✅ | ✅ | ✅ | ✅ |
| 条件格式 | ✅ 原生，导出保留 | Enterprise 才有 | 仅显示，导出不保留 | ✅ |
| 合并单元格 | ✅ | Enterprise 才有 | ✅ | ✅ |
| 公式 | ✅ 500+ 函数 | Enterprise 才有 | 有限 | ✅ |
| **.xlsx 导出** | ✅ **插件原生，保留格式** | Enterprise 才有 ($999/人/年) | 无，需外接 | 无内置 |
| 万行性能 | 好（Canvas 渲染） | 优秀（DOM 虚拟化） | 好（双轴虚拟化） | 一般（大数据集有问题） |
| 活跃度 | 2026.5 活跃 | 2026.5 活跃 | 2026.5 活跃 | 2025.11 最后发布 ⚠️ |

### 推荐排序

**1. Univer（首选）**
- 完整 Excel 体验：公式栏、Sheet 标签、条件格式、合并单元格
- .xlsx 导出保留格式 — 这是关键差异化，不需要自己写导出桥接
- Apache-2.0 免费商用
- 风险：生态较年轻，用版本锁定 + 薄抽象层缓解

**2. AG Grid Community + ExcelJS（稳定备选）**
- 最成熟的数据网格，5 万行零配置
- 需自己写 ExcelJS 导出桥接（手动映射样式）
- 条件格式/合并/公式需要 Enterprise 付费
- 如果 Univer 验证不过关，这是退路

**3. Handsontable（预算充裕时的最佳 UX）**
- 最打磨的类 Excel 编辑体验
- 但商用必须付费 $899+/人/年
- 对内部工具来说性价比低

---

## 四、AI + Excel 生成模式（行业实践）

### 两阶段架构（推荐）

```
LLM 决定"报什么"（结构/KPI/高亮）
  → 输出报表 Schema（JSON）
  → 确定性代码层渲染 Excel（ExcelJS）
```

LLM 永远不写 cell 坐标。LLM 输出的是结构化描述，代码负责渲染。

### 报表 Schema 示例

```json
{
  "title": "2026-05-15 各渠道 SKU 销售汇总",
  "sheets": [{
    "name": "渠道汇总",
    "columns": [
      { "header": "渠道", "key": "channel", "width": 15 },
      { "header": "销售额", "key": "sales", "width": 18, "format": "currency" },
      { "header": "同比", "key": "yoy", "width": 12, "format": "percent",
        "conditional": { "negative": "red", "positive": "green" } }
    ],
    "sortBy": { "key": "sales", "order": "desc" },
    "freezeRow": 1,
    "autoFilter": true,
    "data": [ ... ]
  }]
}
```

### 公式优先

Agent 输出 Excel 公式（不是计算好的值），让表格保持"活"的 — 收件人可以改输入看变化。

### 图表嵌入

ECharts 服务端渲染 PNG → ExcelJS `addImage()` 嵌入。项目已有 ECharts 依赖。

---

## 五、对我们项目的具体建议

### 技术选型总结

| 层 | 选择 | 理由 |
|---|---|---|
| 后端 Excel 生成 | **ExcelJS**（已有） | 升级用法即可，格式化能力完整 |
| 固定模板报表 | **Carbone**（可选引入） | 设计友好，CCL 免费 |
| 前端预览 | **Univer**（新引入） | 完整 Excel 体验 + 原生 .xlsx 导出 |
| 前端预览备选 | AG Grid Community + ExcelJS | Univer 验证不过关时的退路 |
| 图表嵌入 | ECharts + node-canvas → PNG | 已有依赖，零新增成本 |

### 现有代码要改的

`apps/web/src/features/tools/shared/excel.js` 的 `workbookFromSheets()` 当前是裸 `addRows`，需要升级为带格式的 `buildFormattedWorkbook(schema)` — 接受上述 Schema 格式，输出带完整样式的 Workbook。

---

*来源：npm-compare, ExcelJS GitHub, Carbone.io, AG Grid, Handsontable, Univer, gonzalo123 blog, LlamaIndex 等 30+ 源*
