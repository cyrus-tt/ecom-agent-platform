# 运维 Runbook

> **为谁写的**：日常运维本系统的同事。出故障时第一眼看这里。
> **最后更新**：2026-04-25（V3 frontend api layer）
> **作者**：Cyrus + Claude

---

## 0. 10 秒自检

打开浏览器访问 `http://<host>:3000/healthz`，看到 `{"ok":true,...}` → 进程活着。
访问 `/readyz`：
- 200 → 一切正常
- 503 → 某个上游挂了，看 `body.dependencies` 哪个不 ok

---

## 1. 启动 / 停止 / 重启

### 生产（Windows）

```powershell
# 启动（只启 SaaS 核心，不启 arrival）
npm run ops:start:saas

# 启动（全套：SaaS + arrival + notes）
npm run ops:start:windows

# 停止
npm run ops:stop:saas

# 刷新 PostgreSQL 数据管道
npm run ops:refresh:windows
```

PID 文件：`runtime/pids/`

### 开发（Mac）

```bash
npm run dev:gateway   # 后端 3000
npm run dev:web       # 前端 5173
```

---

## 2. 日志在哪

所有 gateway 日志走 **pino**（PR3 后）：
- 开发：彩色 stdout
- 生产：JSON 同时打 stdout **和** 文件

文件位置：`runtime/logs/gateway-YYYY-MM-DD.log`
滚动策略：每天一个 + 单个 100MB 触发滚动，保留 7 天
环境变量 `LOG_DIR` 可覆盖默认目录
环境变量 `LOG_LEVEL` 默认 `info`（生产）/ `debug`（开发），`silent`（测试）

常用过滤：

```bash
# 今天所有登录相关日志
grep "/api/auth/" runtime/logs/gateway-$(date +%Y-%m-%d).log

# 某个用户的全部审计记录（PR7 后）
jq 'select(.module=="audit" and .username=="张三")' runtime/logs/gateway-*.log

# 所有 slow-sql 告警
jq 'select(.module=="reportRepo" and .msg | contains("slow-sql"))' runtime/logs/gateway-*.log

# 最近 500 条错误
jq 'select(.level>=50)' runtime/logs/gateway-$(date +%Y-%m-%d).log | tail -500
```

---

## 3. 常见故障排查

### 3.1 用户报"登录失败"

1. `grep "/api/auth/login" runtime/logs/gateway-$(date +%Y-%m-%d).log | tail -20`
2. 看 `status_code`：
   - 401 → 用户密码错（正常）
   - 400 → 入参校验失败（前端 bug 或用户输入异常）
   - 500 → 后端 bug，看详细 error 字段
3. 若 bcrypt 相关告警（PR5 后）：
   - 看 `grep "bcrypt auto-upgrade persist failed"` — 升级失败了
   - 应急：`echo 'ENABLE_BCRYPT=false' >> apps/gateway/.env` 然后重启，退回 SHA256

### 3.2 "日报加载不出来"

1. `curl -s http://localhost:3000/readyz | jq` 看 `report_db.ok`
2. `false` → PostgreSQL 不通：
   - `psql -U postgres -d ecom_dashboard_v2 -c "select 1;"`
   - 若连不上 → 重启 PostgreSQL 服务
3. `true` 但用户仍看不到数据 → 查 slow-sql 日志，可能是某个查询被锁住
4. 最后手段：`npm run ops:refresh:windows` 重刷数据

### 3.3 "调拨流程卡住"

1. 看 `runtime/logs/gateway-*.log` 里 `module:"dispatch"` 的记录
2. `jq 'select(.module | startswith("dispatch"))' runtime/logs/gateway-$(date +%Y-%m-%d).log | tail -100`
3. 常见卡点：
   - `state=CONFIRMING` → 需求人还没点确认（查钉钉回链）
   - `state=CONFIRMING_SIZE` → 尺码替代待确认
   - `state=FAILED` → 看 payload.message
4. SQLite 损坏 → `[dispatch] tasks.db 损坏已备份` 日志，文件已 rename，重启即可

### 3.4 "AI 分析跑不出来"

1. 看 `jq 'select(.module=="agentService")' runtime/logs/gateway-*.log | tail -30`
2. 常见：
   - `DEEPSEEK_API_KEY not configured` → 管理员去 `/admin/accounts` > 设置 AI 密钥
   - `出站数据审计失败，检测到敏感字段` → 代码 bug，有字段没过滤，必须 P0 修（`apps/gateway/services/agentService.js:37-48`）
   - `timeout` → DeepSeek 上游慢，前端会显示"AI 报告生成失败"

### 3.5 "整个网关挂了"

1. `ps aux | grep node` / Windows 任务管理器查进程
2. `cat runtime/pids/gateway.pid` 拿到 PID 看它还在不在
3. 看最近的日志最后几行：
   - `Gateway started on...` 是刚启动
   - 没看到，或者看到 `Error:` → 启动失败
4. 失败常见原因：
   - 3000 端口被占：`lsof -i :3000` / Windows `netstat -ano | findstr 3000` 找到占用进程 kill
   - `Cannot find module 'pino'` 或类似 → `npm --prefix apps/gateway ci` 重装
   - `auth.json` 被删或损坏 → 从 `runtime/auth_config_backup.json` 恢复

---

## 4. 发版 SOP

### 4.1 小改动（PR 已在 GitHub Actions CI 绿）

```powershell
cd <repo>
git checkout feature/dispatch-agent
git pull --ff-only
npm --prefix apps/gateway ci
npm --prefix apps/web ci
npm --prefix apps/web run build
npm run ops:stop:saas
npm run ops:start:saas
# 等 5 秒
curl http://localhost:3000/healthz
```

### 4.2 风险改动（涉及 server.js / 数据库 / 核心流程）

**双端口安全切换**：

```powershell
# 当前生产跑在 :3001（假设）
# 1. 拉新代码
git pull --ff-only
npm --prefix apps/gateway ci

# 2. 在 :3002 启新版冷待
$env:PORT = "3002"
$env:LOG_DIR = "runtime/logs-new"   # 避免日志撞
npm run ops:start:saas
# 注意：PID 文件会和老版撞，先改 ops/windows/start_saas_core.ps1 的 PID_FILE 或手动 node apps/gateway/server.js

# 3. 5 步烟囱打 :3002
# 3.1 /healthz → 200
# 3.2 登录 → 200 + cookie
# 3.3 日报 /api/report-daily/dates → 2xx
# 3.4 调拨 /api/dispatch/tasks → 2xx (admin cookie)
# 3.5 ls runtime/logs-new → gateway-<today>.log 有内容

# 4. 切流量：方案 A（改前端 env）或方案 B（切端口）
# 方案 A: 前端 VITE_API_BASE 指 :3002，web rebuild
# 方案 B: 停 :3001 → 改 :3002 到 :3001

# 5. 保留老版 1 小时 不 kill，观察 Sentry / 日志 / 用户报错
# 6. 无异常 → kill 老版
```

### 4.3 回滚

```powershell
# 方法 1: git revert 合并 commit
git revert <merge-sha>
git push origin feature/dispatch-agent
# 然后重复 4.1 发版流程

# 方法 2: 若双端口还在，秒级切回
taskkill /PID <新版 PID>
# :3001 老版还在，服务未中断
```

---

## 5. 审计与安全

### 5.1 查某个用户最近做了什么

PR7 合并后：

```sql
-- 最近 7 天
SELECT created_at, method, path, status_code, duration_ms
FROM anta_daily.audit_log
WHERE username = '张三'
  AND created_at > now() - interval '7 days'
ORDER BY created_at DESC
LIMIT 100;
```

或日志侧：

```bash
jq 'select(.module=="audit" and .username=="张三")' runtime/logs/gateway-*.log | less
```

### 5.2 密码哈希状态检查（PR5 后）

```bash
# auth.local.json 是不是每个账号都升级到 bcrypt 了
jq '.accounts[] | {username, has_bcrypt: (.password_bcrypt != "" and .password_bcrypt != null)}' apps/gateway/config/auth.local.json
```

如果某些账号 `has_bcrypt: false`，说明 TA 从 PR5 上线后还没登录过。V2 清 SHA256 前要催他们登录一次。

### 5.3 应急：关闭 bcrypt / audit / dispatch

```bash
# apps/gateway/.env
ENABLE_BCRYPT=false          # 回退到纯 SHA256 验证
ENABLE_AUDIT_LOG=false       # 完全关审计中间件
ENABLE_AUDIT_DB=false        # 只关 DB 写入，pino 文件仍记录
DISPATCH_AGENT_ENABLED=false # 关调拨模块
```

改完 `.env` 后必须重启 gateway。

---

## 6. 监控 / 告警（V2 待做）

当前**没有**自动告警系统。故障要靠：
1. 用户报（Slack / 钉钉）
2. 每天早上运维手动看日志
3. `/readyz` 每 5 分钟内部探测（可用 curl + cron 做）

V2 计划：引入 Sentry 自托管（错误告警）+ prom-client + Grafana（业务指标）。见设计文档 §7 非目标清单讨论。

---

## 7. 关键文件索引

| 路径 | 作用 |
|---|---|
| `apps/gateway/server.js` | 入口 + helpers + middleware + state（PR4 后 ~1658 行） |
| `apps/gateway/routes/*.js` | 按域拆分的路由（PR4 起 9 个模块） |
| `apps/gateway/services/reportRepo.js` | 所有 PostgreSQL 查询（3270 行，V2 继续拆） |
| `apps/gateway/services/agentService.js` | AI 分析 + 出站敏感字段审计 |
| `apps/gateway/services/auditLogger.js` | 审计日志双 sink（PR7 起） |
| `apps/gateway/lib/logger.js` | pino 集中日志（PR3 起） |
| `apps/gateway/lib/passwordHasher.js` | bcrypt + SHA256 兼容（PR5 起） |
| `apps/gateway/middleware/auditRequest.js` | 审计中间件（PR7） |
| `apps/gateway/middleware/validateBody.js` | zod 参数校验（PR6） |
| `apps/gateway/openapi.yaml` | API 契约（PR10） |
| `apps/gateway/config/auth.local.json` | 本地账号配置（**不要 commit**）|
| `runtime/logs/` | 日志滚动目录（gitignore）|
| `runtime/pids/` | PID 文件（gitignore）|
| `pipelines/pg-daily-wide/sql/` | 数据管道 SQL + 审计表 schema |
| `ops/windows/*.ps1` | Windows 启停脚本 |
| `docs/adr/` | 架构决策记录 |
| `docs/plans/` | 设计文档 |

---

## 8. 外部服务接入点

- **PostgreSQL 18**：`C:\Program Files\PostgreSQL\18\bin\psql.exe`（Windows）。DB = `ecom_dashboard_v2`，schema = `anta_daily`
- **DeepSeek API**：密钥存 `runtime/ai_secrets.json`（gitignore），只有管理员能改
- **钉钉机器人**：dispatch 通知用，环境变量 `DISPATCH_DINGTALK_*`
- **Arrival service**（Python 子进程）：由 gateway 自动拉起，端口 5188
- **Notes service**（Python 子进程）：端口 5190

---

## 9. 联系谁

- 代码 bug：Claude 主驱，Cyrus 审核
- 数据管道：Cyrus
- 钉钉机器人配置：Cyrus
- 紧急 rollback：任何人，按 §4.3

---

## 10. 前端开发约定（V3 起）

新加 page 必须走"api / hooks / components"三层样板，不允许在 page 内直接 `import http`。详见：

- 设计：`docs/plans/2026-04-25-v3-frontend-api-layer-plan.md`
- 决策：`docs/adr/0016-frontend-api-layer.md`
- 样板：`apps/web/src/pages/AdminUsagePage.jsx`（最简单样板）/ `DailyReportPage.jsx`（带分页 + 日期窗口）

3 句话速记：

1. 数据从 `import { reportsApi, errorMessage } from "../api"` 走，不要 `import http`
2. loading/error/refetch 用 `useApi(fetcher, deps)`；列表分页用 `useTableQuery`；日期窗口用 `useDateRange`
3. UI 起步用 `<HeroCard><PageHeader title actions /></HeroCard>` + `<DataTable query={tableQuery} />`

新 page 行数目标 < 200。超过先看是不是没用样板。

## 11. 变更历史

| 日期 | 改动 | 关联 PR |
|---|---|---|
| 2026-04-23 | Runbook 首版 | PR10 |
| 2026-04-25 | 加"前端开发约定"一节（V3 frontend api layer） | PR-V3 |
