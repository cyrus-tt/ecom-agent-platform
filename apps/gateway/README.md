# Gateway

`apps/gateway` 是当前平台的统一入口，负责：

- 登录与会话鉴权
- 模块权限控制
- 聚合 API
- React 构建产物托管
- Arrival / Notes 上游代理
- 后台刷新任务触发

## 运行方式

### 跨平台开发模式

```powershell
npm run dev:gateway
```

说明：

- 该模式允许在没有 PostgreSQL、Arrival、Notes 的环境下启动网关
- 缺失依赖时，相关接口会返回明确的不可用或未配置状态
- `GET /healthz` 用于进程活性检查
- `GET /readyz` 用于依赖就绪检查

### Windows 集成模式

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\..\ops\windows\start_all.ps1
```

该模式用于：

- 连接真实 PostgreSQL
- 启动仓库外 Arrival / Notes Python 服务
- 跑真实数据刷新与联调

## 环境变量

推荐使用的新配置名：

- `ARRIVAL_SERVICE_URL`
- `NOTES_SERVICE_URL`
- `ARRIVAL_PROJECT_DIR`
- `NOTES_PROJECT_DIR`
- `PSQL_BIN`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_MODEL`

过渡兼容：

- `ARRIVAL_BASE`
- `NOTES_BASE`

规则：

- 新变量优先
- 旧变量只作兼容
- 未配置项目目录时，不再默认依赖作者机器目录；仅 Windows 脚本保留旧扫描兜底

## 现有接口

- 登录与账号：
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
- 健康检查：
  - `GET /healthz`
  - `GET /readyz`
  - `GET /api/health`
- Agent 分析：
  - `GET /api/agent/skills`
  - `POST /api/agent/run`
  - `GET /api/agent/reports`
  - `GET /api/agent/reports/:id`
- 后台任务：
  - `POST /api/admin/refresh-arrival`
  - `POST /api/admin/rebuild-weekly`
  - `GET /api/admin/jobs/:jobId`

## 本阶段边界

当前阶段只做工程边界硬化，不做 `/analysis` 的 Agent runtime 重构：

- 不改 `/api/agent/run` 语义
- 不动 `analysis_reports` 表结构和历史报告链路
- 不改现有页面路由
- 不改现有权限模型
