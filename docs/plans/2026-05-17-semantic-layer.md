# PLAN · Semantic Layer — 语义模型驱动的动态查询 Agent

**PROGRESS 编号**：F-SEMANTIC-LAYER
**创建于**：2026-05-17
**Deadline**：—
**状态**：🔵 in-progress

---

## 1. 一句话任务

用一份语义配置文件描述所有业务概念（渠道/指标/维度/关系），让 Agent 能回答任意业务问题而非只支持 6 个预设工具。

## 2. 为什么做（Why）

- **现状**：Agent 有 6 个写死的工具，每个对应一段固定 SQL。用户只能问这 6 种问题。想问"哪个品类折扣率最大"或"上周新品动销率多少"就答不了。
- **目标**：用户用自然语言问任何关于经营数据的问题，Agent 基于语义模型自己生成 SQL 查询并返回准确结果。
- **参考**：Microsoft Fabric Data Agent + Semantic Model 的模式——语义模型定义表/列/度量值/关系，Agent 调用 NL2SQL 生成查询。
- **提出人**：Cyrus · 2026-05-17

## 3. 边界（不做什么）

- 不做通用 BI 引擎，只覆盖安踏电商经营数据（rpt_sales_sku_daily + rpt_inventory_sku_latest）
- 不做可视化拖拽建模（语义配置是 YAML 文件，开发者/Cyrus 手动维护）
- 不替换现有 6 个固定工具（保留作为"快速路径"，语义层作为"灵活路径"共存）
- 不做多数据源联邦查询（只查 PostgreSQL 单库）
- 第一版不做缓存和物化视图优化

## 4. 方案步骤

### Phase A：语义配置设计（Cyrus 主导 + Claude 辅助）

**S1** — Claude 从现有工具提取初版示例问题（5-10 个），Cyrus 日常使用中渐进补充
- 产出：`docs/semantic/example_questions.md`

**S2** — Cyrus 审核/补充业务术语表（Claude 从现有代码提取初稿）
- 产出：`config/semantic.yml`，包含：
  - `tables`：可查询的表 + 列描述 + 数据类型
  - `channels`：22 个渠道的 code/label/字段映射
  - `metrics`：GMV/销量/库存/折扣率/动销率等计算公式
  - `dimensions`：品类/性别/时间/渠道 等切面
  - `relationships`：表之间的 join 关系
  - `detection_rules`：检测阈值（从 engine.js 迁出）
  - `examples`：5-10 个问题 → SQL 的标注样例

**S3** — Claude 设计配置 schema（Zod 验证）+ 加载器
- 产出：`apps/gateway/services/semantic/schema.js` + `loader.js`

### Phase B：NL2SQL 引擎（Claude 主导）

**S4** — 实现 `nl2sql.js` 服务
- 输入：用户自然语言 + semantic.yml 上下文
- 流程：把语义配置注入 LLM prompt → LLM 生成 SQL → 验证 SQL 安全性 → 执行
- 安全：白名单表/列，禁止 INSERT/UPDATE/DELETE/DROP，限制返回行数

**S5** — 新增 Agent 工具 `query_dynamic`
- 描述："根据用户问题动态查询经营数据"
- 内部调用 nl2sql.js
- 与现有固定工具共存：Agent 优先尝试固定工具（快+准），fallback 到动态查询

**S6** — SQL 生成准确率提升
- 利用 semantic.yml 中的 `examples` 做 few-shot
- 对 LLM 生成的 SQL 做 EXPLAIN 检查（不执行代价过高的查询）
- 错误反馈循环：SQL 报错时让 LLM 修正一次

### Phase C：检测规则外部化（Claude 主导）

**S7** — 把 engine.js 的硬编码阈值迁移到 semantic.yml 的 `detection_rules` 节
- engine.js 改为启动时读配置
- Cyrus 以后改阈值直接改 YAML，不用改代码

### Phase D：验证 + 调优

**S8** — 用 S1 的 20-30 个问题做准确率测试
- 目标：80% 问题能生成正确 SQL 并返回合理结果
- 低于 80% → 补充 examples / 修改 prompt / 调整 schema

## 5. 涉及文件 / 资源

- 配置：`config/semantic.yml`
- 后端：`apps/gateway/services/semantic/`（schema.js, loader.js, nl2sql.js, validator.js）
- 工具：`apps/gateway/services/streamingAgent/tools.js`（追加 query_dynamic）
- 巡检：`apps/gateway/services/inspection/engine.js`（读取外部阈值）
- 文档：`docs/semantic/example_questions.md`、`docs/adr/0025-semantic-layer.md`
- 外部依赖：DeepSeek API（NL2SQL 需要 LLM）

## 6. 验收标准（全打 ✅ 才算完成）

- [ ] semantic.yml 包含全部 22 个渠道 + 至少 10 个指标定义
- [ ] Cyrus 列出的 20 个问题中，至少 16 个能正确回答（80% 准确率）
- [ ] Agent 对话中问"上周户外渠道 GMV 多少"能动态生成 SQL 返回正确数字
- [ ] Agent 对话中问"哪个品类库存周转最差"能返回合理结果
- [ ] engine.js 的阈值从 YAML 读取，修改 YAML 后重启生效
- [ ] 动态 SQL 有安全白名单，不能查非业务表、不能写入
- [ ] Mac 端验证 → Windows 部署验收通过

## 7. 风险 / 阻塞

| 风险 | 影响 | 缓解 |
|------|------|------|
| LLM 生成的 SQL 不准确 | 返回错误数据，用户失去信任 | few-shot examples + EXPLAIN 检查 + 错误重试 |
| 复杂问题需要多表 JOIN | 生成的 SQL 性能差或逻辑错 | 限制 JOIN 深度为 2，复杂问题降级到"无法回答" |
| DeepSeek API 不可用 | 动态查询完全不能用 | fallback 到现有固定工具，不阻塞基础功能 |
| 语义配置维护成本 | 新增字段/表时要同步更新 YAML | 配置加 validation，启动时检查是否与实际 schema 一致 |

**阻塞**：
- ~~Cyrus 需要先列出典型问题清单（S1）~~ → 改为 Claude 出初版 + Cyrus 渐进补充，不再阻塞
- 需要 DeepSeek API key 可用（Windows 环境）

## 8. 回滚方案

- 分支：`codex/mac/feat-semantic-layer`
- 语义层是新增模块，不修改现有功能，回滚 = 不用这个工具即可
- engine.js 阈值外部化如果出问题：revert 回硬编码版本（单 commit）
- DB：无 schema 变更

---

## 分工

| 谁 | 做什么 | 前置条件 |
|---|---|---|
| **Cyrus** | 列出 20-30 个日常会问的问题 | 无，随时可以开始 |
| **Cyrus** | 审核/修正 Claude 提取的业务术语初稿 | Claude 先出初稿 |
| **Cyrus** | 验收：问 Agent 问题，判断答案对不对 | Phase B 完成后 |
| **Claude** | 从现有代码提取语义初稿（渠道/指标/维度） | 无 |
| **Claude** | 设计 YAML schema + 加载器 | S2 完成后 |
| **Claude** | 实现 NL2SQL 引擎 + query_dynamic 工具 | S3 完成后 |
| **Claude** | 准确率调优（补 examples / 修 prompt） | S8 测试结果出来后 |

---

## 执行日志（动手后追加）

- **2026-05-17**：Cyrus approve PLAN，S1 改为渐进式（Claude 出初版示例 + Cyrus 日常补充）。开始 S2 语义提取。
