# ADR 0008: Prometheus 指标 + Sentry 错误追踪（无 DSN 时 no-op）

- 日期：2026-04-24
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：PR8
- 关联设计：`docs/plans/2026-04-23-uplift-to-9-design.md`

## 背景

前几个 PR 补齐了**可观测性的"写"侧**（日志 + 审计）。还缺**"读"侧**：

1. **没有指标**：运维想知道"过去 1 小时 API 错误率多少？P95 延迟多少？"——需要 grep + jq 日志，效率低
2. **没有错误告警**：用户报 bug 之前，我们不知道有人踩了 500 错误

对部门级产品（40 人）来说，用户报错后再排查会显得很业余。

## 决策

### 1. Prometheus 指标（prom-client）

- 注册表：`apps/gateway/lib/metrics.js`
- 中间件：`apps/gateway/middleware/metrics.js` 记录每个请求的 `method / route / status_class / duration`
- 端点：`/api/metrics`（admin-gated），返回标准 Prometheus 文本格式
- 默认采集：process / heap / event-loop 指标

**两个核心自定义指标**：

```
http_requests_total{method, route, status_class}        — Counter
http_request_duration_seconds{method, route, status_class} — Histogram
  buckets: 10ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s, 30s
```

**标签基数设计**：
- `route` = Express 匹配到的路由模板（如 `/api/agent/reports/:id`）而不是 raw path（`/api/agent/reports/123`）
- 避免按具体 ID 爆炸基数
- `status_class` 是 1xx/2xx/3xx/4xx/5xx，不是具体 status code

**跳过路径**：`/api/metrics` 自己 + `/healthz` + `/readyz`（自引用 + 高频探测噪音）

**环境开关**：`ENABLE_METRICS=false` 可彻底关掉（默认开）

### 2. Sentry 错误追踪（@sentry/node）

- 客户端包装：`apps/gateway/lib/sentryClient.js`
- **关键设计：无 `SENTRY_DSN` 时 no-op**
  - Sentry SDK 不初始化
  - `expressRequestHandler` / `expressErrorHandler` 返回 passthrough 中间件
  - `captureException` 静默忽略
  - 上层代码无条件调用，不需 `if (sentry.enabled)` 判断
- 请求中间件放在 **最前**（捕获所有下游异常）
- 错误中间件放在 **最后但在 generic handler 之前**（Sentry 记录后再继续走 500 响应）

**配置**：
```
SENTRY_DSN                  — 空 = 禁用（默认）
SENTRY_ENVIRONMENT          — 默认跟 NODE_ENV
SENTRY_TRACES_SAMPLE_RATE   — 0..1，默认 0（不启用 perf tracing）
SENTRY_RELEASE              — 可选，CI 里注入 git sha
```

**为什么 no-op 而不是 feature flag**：
- 代码路径统一：handler 内 `captureException(err)` 总是可以调用
- 未来加 DSN 时零代码改动，只加环境变量 → 立即生效
- 测试环境无 DSN，自然是 no-op，不需要显式禁用

## 不做什么

- ❌ 不自托管 Sentry（需要 Docker + Postgres，40 人 LAN 不值得）
- ❌ 不强制要 DSN（没配就 no-op，不阻塞功能）
- ❌ 不把 `/api/metrics` 对外开放（admin-gated，避免内网敏感信息泄漏）
- ❌ 不做 Grafana 仪表盘（Cyrus 决定后单独搭）
- ❌ 不做 `/metrics` 单独端口（对 LAN 部署简化，admin 密码够用）

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| OpenTelemetry 完整栈 | 过度投资，基础 RED 指标 + Sentry 够 B 级 |
| 自托管 Sentry | 基础设施成本高，40 人内部用 sentry.io 免费额度够 |
| 只用日志做告警 | 日志没有直方图聚合，P95/P99 延迟算不出 |
| 匿名 /metrics | 内网虽然"安全"，但日后误开放风险大 |
| 用 `swagger-stats` 一把梭 | 过度集成，prom-client 手工 40 行就够 |

## 架构

```
HTTP request
   ↓
[sentry.requestHandler]       ← 捕获异常用（no-op 若无 DSN）
   ↓
[session enrichment]
   ↓
[metricsMiddleware]           ← 记录 startedNs
   ↓
[auditRequestMiddleware]
   ↓
[authGuard] [routes...]
   ↓
res.finish / res.close
   ↓
metrics records + audit records

--- error path ---
routes throw → next(err)
   ↓
[sentry.errorHandler]         ← 上报到 DSN（no-op 若无）
   ↓
generic 500 handler
```

## 验证

- `node --check apps/gateway/server.js` 通过
- 42 个测试 × 5 次稳定全绿（metrics/sentry 中间件透明加入，不影响既有行为）
- `/api/metrics` 在 admin 登录后返回标准 Prometheus 文本（默认指标 + 自定义 2 个）
- 无 DSN 运行：日志只有 `Sentry SDK disabled (no-op handlers)` 一条 debug
- 有 DSN 时：日志 `Sentry SDK initialized` + 后续错误自动上报

## 合并后配置（Cyrus 操作）

### 启用 Sentry

1. 注册 sentry.io 免费账号（或用公司已有）
2. 创建 Node.js project → 复制 DSN
3. 生产 `.env` 追加：
   ```
   SENTRY_DSN=https://...@sentry.io/xxx
   SENTRY_ENVIRONMENT=production
   SENTRY_TRACES_SAMPLE_RATE=0
   ```
4. 重启 gateway
5. 人为触发一次 500（如 stop PostgreSQL 然后访问日报）→ Sentry 项目页应看到 issue

### 启用 Grafana 仪表盘

**最简 Docker 方案**（在 Windows 或 Mac 上）：

```bash
docker run -d --name prometheus -p 9090:9090 \
  -v $(pwd)/prom.yml:/etc/prometheus/prometheus.yml prom/prometheus

docker run -d --name grafana -p 3001:3000 grafana/grafana
```

`prom.yml`（scrape gateway）：

```yaml
scrape_configs:
  - job_name: ecom-gateway
    scrape_interval: 15s
    metrics_path: /api/metrics
    # 需要 admin cookie, 用 basic_auth 或 Prometheus 不直接支持 cookie
    # 简化方案: 跑个 sidecar 做 admin 登录, 或临时 ENABLE_METRICS 对内部放开
```

⚠️ **实用 tip**：admin-gated 的 `/api/metrics` 对 Prometheus scrape 不友好。
- **选项 A**：V2 加一个 `METRICS_TOKEN` 环境变量允许 `?token=xxx` 匿名 scrape
- **选项 B**：用 Grafana Agent 代理（太重）
- **选项 C**（推荐 LAN 部署）：改 `routes/metrics.js`，白名单 127.0.0.1 scrape 无需 admin

**这些是 V2 小调整**，本 PR 先把"代码能输出指标"做好，scrape 方案可以先手动 `curl` 带 cookie 看。

## 后续

- **V2**：加 `METRICS_TOKEN` 或 IP 白名单，支持 Prometheus 自动 scrape
- **V2**：Grafana 仪表盘 JSON 放 `docs/grafana/` 供一键导入
- **V2**：审计表 + metrics 关联看板（按用户/路径的错误率 + 延迟分布）
- **V2**：Sentry 自托管方案（若公司有合规要求不能用 sentry.io）
