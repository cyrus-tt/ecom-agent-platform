# ecom-agent-platform

统一入口的电商经营平台工作区。当前项目已经跑通“原始数据入库 -> PostgreSQL 聚合 -> 网关 API -> React 前端展示 -> AI 经营分析”的主闭环，正在从可用的本地经营工作台，逐步演进为可治理、可扩展的企业级 Agent 平台。

## 项目背景

这个仓库不是单一前端站点，也不是纯 AI Demo，而是围绕电商经营场景搭建的一体化工作区，目标是把原本分散在 Excel、数据库、脚本和人工分析里的能力收敛到同一个入口。

当前重点有两个：

- 先把高频经营动作产品化，包括日报、看板、渠道分析、新品跟进、复盘分析
- 再把这套业务闭环沉淀为后续企业级 Agent 能够复用的底座，包括权限、审计、技能、任务执行与可观测性

从仓库结构和运维方式来看，这个项目目前更接近“本地部署的电商经营操作台 + 数据处理入口 + Agent 试验田”，而不是云原生、多租户、全自动编排的平台产品。

## 当前项目快照

截至 `2026-05-16`，`main` 已作为唯一升级基线同步到 GitHub：

- 本地 `main` 与 `origin/main` 一致，当前基线提交为 `b23ce7d`
- 历史 `origin/*` 功能分支和本地开发分支均已合入 `main`
- 代码工作区干净，未删除历史分支；后续大升级应从 GitHub 最新 `main` 新开分支
- 前端为 `React 18 + Vite 6`，由网关统一托管构建产物
- 网关已承接登录、模块权限、聚合 API、上游代理、任务触发、审计、指标和 OpenAPI 文档
- PostgreSQL 仍是当前唯一推荐的主数据链路
- 自动化测试已进入主线：gateway 使用 Vitest/Supertest，web 保留工具模块 smoke 与生产构建校验

当前项目处于“可运行、可刷新、可分析，且已有基础工程治理”的阶段；仍以本地/局域网部署为主，不应直接按成熟 SaaS 多租户产品理解。

## 项目定位

这个平台要统一承接的能力包括：

- 日报主表与明细查询
- 新品入库看板与备注协同
- 经营数据可视化与趋势看板
- 渠道店铺看板与货号下钻
- AI 经营复盘分析
- 内置 ChatBI 查询与透视表
- 调拨 Agent
- 本地 Excel 小工具
- 后续可扩展的企业级业务 Agent 能力

从业务视角看，它解决的是“把经营数据、经营动作和经营分析放进同一个入口”的问题；从工程视角看，它在搭一套后续可持续演进的 Agent 基座。

## 运行模式

当前仓库明确支持两套运行方式：

- Mac 开发模式
  - 负责写 `apps/web`、`apps/gateway`、SQL、Python 预处理、文档和测试
  - 运行跨平台开发命令，不要求还原公司 Windows 集成环境
- Windows 集成模式
  - 负责真实 PostgreSQL、本地数据刷新、Arrival/Notes 上游服务和完整联调
  - 继续使用 `ops/windows` 里的 PowerShell 脚本作为运维入口

这不是“两套系统不兼容”，而是“跨平台代码”和“Windows 专属运维”分层。

## 当前架构

- `apps/gateway`
  - Express 网关
  - 负责会话登录、模块权限、API 聚合、任务触发、上游代理、静态托管
- `apps/web`
  - React + Vite 前端
  - 承接门户、日报、新品、可视化、渠道、分析、账号权限页面
- `pipelines/pg-daily-wide`
  - PostgreSQL 主数据链路
  - 负责原始 CSV/XLSX 预处理、导入、ETL、宽表/拆分表生成
- `data`
  - `inbox` 放原始文件
  - `prepared` 放预处理结果
  - `archive` 放历史归档
- `ops/windows`
  - Windows 启停脚本、数据刷新脚本、平台一键运行脚本
- `runtime`
  - 运行日志、构建产物、PID、截图、数据刷新结果
- `docs`
  - 项目规划、工程规范、目录约定、Agent 参考资料

## 当前业务闭环

1. 业务原始文件进入 `data/inbox`
2. 通过 `ops/windows/run_pg_pipeline.ps1` 预处理并导入 PostgreSQL
3. 网关从 `ecom_dashboard_v2` / `anta_daily` 提供聚合 API
4. React 前端展示门户、日报、可视化、渠道和分析页面
5. Analysis 页面把聚合指标发送给大模型生成复盘报告
6. 报告写入 `anta_daily.analysis_reports`，支持历史回看

## 已落地模块

当前前端路由和网关能力可以确认已覆盖：

- 门户首页 `/`
- 日报 `/report-daily`
- 新品 `/arrival`
- 数据可视化 `/dashboard`
- 渠道店铺看板 `/channel-dashboard`
- AI 经营分析 `/analysis`
- ChatBI `/bi`
- 调拨 Agent `/dispatch`
- Excel 小工具 `/tools`
- 管理员账号权限管理 `/admin/accounts`
- 管理员用量统计 `/admin/usage`

其中已经明确存在的后端能力包括：

- 会话鉴权与 `/api/auth/*`
- 账号、权限、密码策略与自助改密
- Agent 相关接口
  - `GET /api/agent/context`
  - `POST /api/agent/run`
  - `GET /api/agent/reports`
  - `GET /api/agent/reports/:id`
- Dashboard API
  - `GET /api/dashboard/dates`
  - `GET /api/dashboard/overview?anchor_date=YYYY-MM-DD`
- 后台任务接口
  - `POST /api/admin/rebuild-weekly`
  - `POST /api/admin/cache/clear`
  - `GET /api/admin/jobs/:jobId`
- Prometheus 指标 `/api/metrics`
- OpenAPI/Swagger 文档 `/api/docs`

## 技术栈与依赖关系

### 前端

- React 18
- Vite 6
- Ant Design 5
- ECharts
- Axios
- react-pivottable
- exceljs

### 网关

- Node.js
- Express 4
- `pg`
- `openai` SDK（通过 `baseURL` 对接 DeepSeek）
- `xlsx`
- `zod`
- `prom-client`
- `pino`
- `@sentry/node`

### 数据链路

- PostgreSQL 18 本机实例
- `psql` 命令行工具
- Python 预处理脚本 `pipelines/pg-daily-wide/prepare_pg_sources.py`

### 外部上游依赖

当前项目不是完全自洽的单仓系统，还依赖仓库外服务：

- 新品服务：默认 `http://127.0.0.1:5188`
- 备注服务：默认 `http://127.0.0.1:5190`
- Windows 集成脚本支持通过环境变量显式指定仓库外项目目录
- 当外部服务未启动或未配置时，网关会显式返回“未配置 / 未启用 / 不可用”状态，而不是继续猜作者机器路径

### AI 依赖

AI 分析依赖 DeepSeek 配置：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`，默认 `https://api.deepseek.com`
- `DEEPSEEK_MODEL`，默认 `deepseek-chat`

管理员也可以在前端的“AI 设置”中把 Key 临时写入当前网关进程内存，但该配置在网关重启后会失效。

## Agent 数据模式

为了支持 Mac 开发 Agent、Windows 跑真实集成，Analysis 上下文读取已经抽象成三种模式：

- `local`
  - 直接读取本地 PostgreSQL 和现有 service
  - 适合 Windows 真实环境
- `remote`
  - 请求另一台机器暴露的只读聚合接口 `GET /api/agent/context`
  - 适合 Mac 联调公司 Windows
- `fixture`
  - 直接读取本地 JSON fixture
  - 适合 Mac 本地开发、测试和 eval

推荐配置示例：

```env
AGENT_DATA_MODE=remote
AGENT_REMOTE_BASE_URL=http://<windows-ip>:3000
AGENT_REMOTE_READ_TOKEN=<your-read-token>
```

如果只做本地开发：

```env
AGENT_DATA_MODE=fixture
AGENT_FIXTURE_PATH=apps/gateway/fixtures/analysis-context.sample.json
```

## 环境变量与兼容策略

推荐使用的新环境变量：

- `ARRIVAL_SERVICE_URL`
- `NOTES_SERVICE_URL`
- `ARRIVAL_PROJECT_DIR`
- `NOTES_PROJECT_DIR`
- `PSQL_BIN`
- `AGENT_DATA_MODE`
- `AGENT_REMOTE_BASE_URL`
- `AGENT_REMOTE_READ_TOKEN`
- `AGENT_FIXTURE_PATH`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

当前仍兼容旧名称：

- `ARRIVAL_BASE`
- `NOTES_BASE`

兼容策略如下：

- 新名称优先
- 旧名称只作为过渡兼容
- 未配置项目目录时，不再默认依赖作者机器目录；仅保留 Windows 脚本的旧扫描兜底

## 当前权限与安全边界

项目当前采用的是会话鉴权，不是完整 RBAC：

- 登录方式：表单登录 + HttpOnly Cookie
- 权限模型：按模块授权，管理员拥有完整权限
- 现阶段仍以单机/局域网部署为主
- AI 出站数据已有限制，只发送聚合指标，不发送 SKU、款号、品名等明细字段
- Prometheus 指标支持 Bearer token 或管理员 session
- 管理员创建/重置密码会经过密码策略校验

这意味着项目已经有权限和数据最小化意识，但离企业级权限治理、审计和策略控制还有明显差距。

## 当前硬约束

结合代码、脚本和文档，当前项目的硬约束主要是：

- 以 Windows 本地部署为主，运维脚本集中在 `ops/windows`
- 强依赖本机 PostgreSQL，但 `run_pg_pipeline.ps1` 已支持通过 `PSQL_BIN` 覆盖客户端路径
- 新品模块和备注模块依赖仓库外 Python 服务
- 自动化测试已有基础覆盖，但仍需要随大升级继续补齐端到端验收
- 网关已经完成路由/auth/reportRepo 等拆分，但仍有部分 bootstrap 逻辑集中在 `apps/gateway/server.js`
- 项目当前更适合局域网内部团队使用，还不适合直接按 SaaS 或多租户产品理解

## 启动方式

### 安装依赖

```powershell
npm run install:all
```

### Mac 开发模式

```powershell
npm run dev:web
npm run dev:gateway
npm run test
```

说明：

- `dev:web` 和 `dev:gateway` 是跨平台开发命令
- Mac 环境不要求本地拉起 PostgreSQL、Arrival、Notes
- 缺少真实依赖时，相关接口会显式报未配置或不可用，不影响网关本身启动

### Windows 集成模式

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\start_all.ps1
```

或：

```powershell
npm run ops:start:windows
```

这个入口会做四件事：

- 必要时构建前端
- 按配置启动新品服务
- 按配置启动备注服务
- 启动网关 `3000`

### 强制重建前端后启动

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\start_all.ps1 -RebuildWeb
```

### 停止全部服务

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\stop_all.ps1
```

或：

```powershell
npm run ops:stop:windows
```

## 数据刷新

把新的 `CSV/XLSX` 放入 `data/inbox` 后执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\run_pg_pipeline.ps1
```

或：

```powershell
npm run ops:refresh:windows
```

当前 PostgreSQL 链路的执行顺序是：

1. 运行 `prepare_pg_sources.py`
2. 执行 `01_postgres_daily_wide_ddl.sql`
3. 执行 `02_postgres_daily_wide_load.sql`
4. 执行 `05_postgres_split_daily_wide.sql`

刷新完成后会更新：

- `runtime/pg_pipeline_summary.json`
- `runtime/pg_pipeline_new_skus.txt`
- `runtime/pids/*.pid` 中的运行状态文件

## 仓库结构

```text
apps/
  gateway/                 Express 网关与后端 API
  web/                     React + Vite 前端
pipelines/
  pg-daily-wide/           当前唯一推荐的 PostgreSQL 主数据链路
  sqlserver-legacy/        旧链路归档，仅用于回溯
data/
  inbox/                   原始 CSV/XLSX 输入
  prepared/                预处理后 CSV
  archive/                 历史归档
ops/
  windows/                 启停与数据刷新脚本
docs/                      项目规划与工程规范
runtime/                   日志、构建产物、截图、PID、刷新结果
scripts/                   smoke、压测和辅助脚本
tests/                     预留/兼容测试目录，主测试集中在 apps/gateway/tests
```

## 当前阶段判断

### 已有优势

- 业务主链路已经可用，不是从零开始
- 前后端和数据管道已经完成基础分层
- 门户、日报、可视化、渠道、分析、ChatBI、调拨、小工具、权限管理都已有对应页面
- AI 分析已经接入，且做了最小化出站限制
- 数据导入、平台启停、任务刷新已经有固定脚本
- Vitest/Supertest、OpenAPI 生成、Prometheus 指标和基础审计已经进入主线

### 当前短板

- 仍偏单机工程，环境依赖强
- 自动化测试、可观测性、审计、发布规范已有基础，但还没有达到企业级发布门禁
- 权限模型还是模块级授权，距离完整 RBAC 还有差距
- 新品链路没有完全收敛进本仓
- 大升级前应从 GitHub `main` 新开独立分支，避免再次夹带无关历史

## 面向企业级 Agent 的演进方向

现阶段更适合按下面的顺序推进，而不是直接堆很多 Agent：

1. 先把单 Agent 主闭环做强
   - 明确任务边界、工具边界、验收标准、失败回退
2. 再补 Harness
   - 评测、追踪、审计、恢复、回归测试
3. 把知识从长提示词迁移到文档和技能配置
   - 让 Agent 按需加载，而不是一次塞满上下文
4. 最后再考虑多 Agent 协作
   - 先解决隔离、角色边界和可观测性，再讨论并行调度

## 关键文档

- `docs/ECOMMERCE_AGENT_CODEX_GUIDE.md`
  - 项目阶段路线图、边界约束、已落地能力快照
- `docs/PROJECT_STRUCTURE.md`
  - 目录结构约定
- `docs/ENGINEERING_STANDARD.md`
  - 工程操作规范与每日操作建议
- `docs/ENTERPRISE_AGENT_REFERENCE.md`
  - 企业级 Agent 参考资料与本项目映射
- `MIGRATION_MANIFEST.md`
  - 迁移记录
