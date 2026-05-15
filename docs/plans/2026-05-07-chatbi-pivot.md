# PLAN · 内置 ChatBI 透视表（AI 生成 SQL + react-pivottable）

**PROGRESS 编号**：F-CHATBI
**创建于**：2026-05-07
**Deadline**：2026-05-14
**状态**：🔵 in-progress（2026-05-07 Mac 端 S1-S7 全完成 + push origin，待 Cyrus Windows 验收）

---

## 1. 一句话任务

在 SaaS 平台新增 BI 页面：用户用自然语言描述数据需求 → AI 生成 SQL → 后端只读执行 → 前端 react-pivottable 渲染可拖拽透视表。

## 2. 为什么做（Why）

Cyrus（2026-05-07）提出。用户（40 位同事）经常需要灵活查看各维度数据，现有看板是固定视图无法自定义。目标是让用户像在 Excel 里拉透视表一样，但数据直接来自后端 PG，且用 AI 降低使用门槛。

## 3. 边界（不做什么）

- 不做保存/分享 BI 视图（V2）
- 不做图表可视化（V2 可加 echarts）
- 不做多轮对话上下文（每次独立问答）
- 不做 Metabase / Superset 嵌入
- 不动现有 Analysis 页面（独立新页）
- 不改 PG schema（只加只读用户）

## 4. 方案步骤

### S1 — PG 只读用户 + 独立连接池

- 编写 SQL 脚本 `pipelines/pg-daily-wide/sql/07_bi_readonly_user.sql`：
  - `CREATE USER bi_readonly WITH PASSWORD '...' LOGIN`
  - `GRANT USAGE ON SCHEMA anta_daily TO bi_readonly`
  - `GRANT SELECT ON ALL TABLES IN SCHEMA anta_daily TO bi_readonly`
  - `ALTER DEFAULT PRIVILEGES IN SCHEMA anta_daily GRANT SELECT ON TABLES TO bi_readonly`
- reportRepo.js 或新文件 `apps/gateway/services/biQueryService.js`：
  - 独立 `Pool({ max: 5, user: 'bi_readonly', statement_timeout: 30000 })`
  - `executeBiQuery(sql)` 函数：前置正则校验 → 追加 LIMIT → 执行 → 返回 `{ columns, rows, rowCount, elapsed_ms }`
- 前置正则：拒绝 `INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|COPY|EXECUTE|CALL`（不区分大小写）
- 强制行数限制：SQL 末尾没有 LIMIT 则自动追加 `LIMIT 5000`

### S2 — 表结构元数据 API

- `GET /api/bi/schema` → 返回 `anta_daily` schema 下所有表的列名 + 类型 + 注释
- 用 PG `information_schema.columns` 查询
- 结果缓存（TTL 10min，表结构很少变）
- 同时用于 AI system prompt 和前端展示

### S3 — AI 生成 SQL endpoint

- `POST /api/bi/ask` body: `{ question: string }`
- 调用现有 DeepSeek 集成（参考 Analysis 页的 agent 调用模式）
- System prompt 包含：
  - 角色定义（SQL 专家）
  - 完整表结构（从 S2 的元数据获取）
  - 输出格式：JSON `{ sql, pivotConfig: { rows, cols, vals, aggregatorName }, title }`
  - 安全约束（只 SELECT、必须 LIMIT、禁止子查询嵌套超过 2 层）
  - 常用业务术语映射（出库金额 = sales_total_amount、渠道 = 各 channel 列 等）
- 返回 `{ ok, sql, pivotConfig, title, model }`

### S4 — SQL 执行 endpoint

- `POST /api/bi/query` body: `{ sql: string }`
- 调用 S1 的 `executeBiQuery(sql)`
- 返回 `{ ok, columns: [{ name, type }], rows: [...], rowCount, elapsed_ms }`
- 权限：`requirePermission("bi")`

### S5 — 前端 BI 页面

- 安装 `react-pivottable`（唯一新增 npm 依赖）
- 新建 `apps/web/src/pages/BiPage.jsx`
- 路由 `/bi`，权限 key `bi`
- UI 布局：
  - 顶部：输入框 + "生成" 按钮 + loading 状态
  - 中部：SQL 预览区（可编辑的 textarea）+ "执行" 按钮 + 执行耗时/行数标签
  - 底部：`PivotTableUI`（react-pivottable），AI 返回的 pivotConfig 作为初始值，用户可拖拽
- 状态流：
  1. 用户输入问题 → 点"生成" → POST /api/bi/ask → 回填 SQL + pivotConfig
  2. 用户可以修改 SQL → 点"执行" → POST /api/bi/query → 数据灌入 PivotTableUI
  3. 用户拖拽 pivotTable 的行/列/值/聚合方式，纯前端操作无需再请求

### S6 — 权限 + 导航集成

- `AUTH_PERMISSION_MODULES` 新增 `{ key: "bi", label: "数据透视", route: "/bi" }`
- App.jsx 新增路由 `/bi` → `BiPage`
- 侧边栏/导航新增"数据透视"入口

### S7 — Mac 端验证 + ADR

- `node --check` server.js + biQueryService.js
- esbuild web build
- behavior smoke：手动构造 SQL 调 /api/bi/query 验证安全拦截（INSERT 被拒、SELECT 通过、超时被杀）
- ADR-0022

## 5. 涉及文件 / 资源

- 新文件：`apps/gateway/services/biQueryService.js`（只读池 + SQL 校验 + 执行）
- 新文件：`apps/web/src/pages/BiPage.jsx`
- 新文件：`pipelines/pg-daily-wide/sql/07_bi_readonly_user.sql`
- 新文件：`docs/adr/0022-chatbi-pivot.md`
- 改文件：`apps/gateway/server.js`（3 个新 endpoint + 权限 module）
- 改文件：`apps/web/src/App.jsx`（路由 + 导航）
- 改文件：`apps/gateway/config.json`（bi_readonly 连接信息）
- 新依赖：`react-pivottable`（npm install）
- 外部依赖：DeepSeek API（现有集成）

## 6. 验收标准（全打 ✅ 才算完成）

### 安全
- [ ] V1：SQL 含 INSERT/DELETE/DROP → 返回 400 拒绝执行
- [ ] V2：SQL 执行超 30s → 自动终止返回 timeout 错误
- [ ] V3：SQL 无 LIMIT → 自动追加 LIMIT 5000
- [ ] V4：bi_readonly 用户无法执行写操作（PG 层兜底）

### 功能
- [ ] V5：输入"女子渠道按品类的月度出库金额" → AI 返回合理 SQL + pivotConfig
- [ ] V6：SQL 预览可编辑，修改后点执行能拿到新结果
- [ ] V7：PivotTableUI 渲染数据，可拖拽行/列/值/聚合方式
- [ ] V8：空结果 / 错误 SQL 有友好提示

### 工程
- [ ] V9：Mac 端 `node --check` 全绿
- [ ] V10：esbuild web build 通过
- [ ] V11：Cyrus 在 Windows 公司机 git pull + 创建 bi_readonly 用户 + 启动 + 手测 V1-V8 通过
- [ ] V12：ADR-0022 已 commit

## 7. 风险 / 阻塞

| # | 风险 | 缓解 |
|---|------|------|
| R1 | AI 生成的 SQL 不正确 / 幻觉 | SQL 预览可编辑 + 用户可以手动修正后执行 |
| R2 | 全表扫描卡死 PG | 独立连接池 max 5 + statement_timeout 30s + LIMIT 5000 |
| R3 | react-pivottable 新增依赖 | 唯一一个，体积小（~50KB gzipped），无已知安全问题 |
| R4 | DeepSeek API 不可用 | 用户仍可手写 SQL 执行（AI 只是辅助） |
| R5 | PG 只读用户需要 Cyrus 在 Windows 手动创建 | 提供幂等 SQL 脚本，Cyrus 一次性执行 |

阻塞：R5 需要 Cyrus 在 Windows PG 执行 `07_bi_readonly_user.sql`（只做一次）。

## 8. 回滚方案

- 分支：`codex/mac/feat-chatbi`，revert 整个分支即可
- DB：`DROP USER IF EXISTS bi_readonly`（无表变更）
- 配置：config.json 加的 bi 连接信息删除即可
- npm 依赖：`npm uninstall react-pivottable`

---

## 执行日志（动手后追加）

