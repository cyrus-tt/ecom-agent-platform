# Grafana 仪表盘：Ecom Agent Gateway

本目录提供 ecom-agent-platform 网关的 Grafana 一键导入仪表盘。
配套 prom-client 自定义指标（PR8 引入，见 [ADR-0008](../adr/0008-metrics-and-sentry.md)）与 prom-client 默认采集的 Node.js 运行时指标。

- 文件：`ecom-agent-platform-dashboard.json`
- Dashboard UID：`ecom-agent-gateway`
- Title：`Ecom Agent Gateway`
- 适配版本：Grafana 10+

## 1. 导入步骤

1. 打开 Grafana：`Dashboards` → `New` → `Import`。
2. 方式 A：上传 `docs/grafana/ecom-agent-platform-dashboard.json`；方式 B：直接粘贴文件内容到 `Import via panel json` 文本框。
3. 页面会提示选择 `DS_PROMETHEUS` 的具体数据源——选择已经在抓 `ecom-agent-gateway` 的 Prometheus 实例。
4. 点击 `Import`。仪表盘顶部自动出现 `job` / `instance` 两个下拉筛选变量。

## 2. Prometheus scrape 配置

/api/metrics 受 `requireAdmin` 保护（见 `apps/gateway/routes/metrics.js`），Prometheus **不能直接匿名 scrape**。因此本 PR 只提供静态 target 模板，实际部署有两种路径：

### 方式 A：等 ADR-0012（metrics-auth，V2 待落地）

V2 规划新增 `METRICS_TOKEN` 环境变量，允许 Prometheus 携带 `Authorization: Bearer <token>` 免 admin session 直接 scrape。届时 scrape 片段如下：

```yaml
scrape_configs:
  - job_name: ecom-agent-gateway
    scrape_interval: 15s
    metrics_path: /api/metrics
    scheme: http
    authorization:
      type: Bearer
      credentials: <METRICS_TOKEN>   # 从 gateway .env 取
    static_configs:
      - targets:
          - gateway-prod.lan:3000
        labels:
          env: prod
      - targets:
          - gateway-stage.lan:3000
        labels:
          env: stage
```

### 方式 B：过渡期（ADR-0012 未合并）

- 手动 `curl -b <admin-cookie>` 导出一次 `/api/metrics` 到本地文件，喂给本地 Prometheus 验证仪表盘可渲染。
- 或在 `routes/metrics.js` 临时做 127.0.0.1 白名单（**仅限内网测试**，不要合入 main）。
- 禁止把 `/api/metrics` 彻底匿名开放——内含用户密码哈希参数名、数据库连接池等敏感上下文。

详细取舍见 [ADR-0011](../adr/0011-grafana-dashboard.md) 与 ADR-0012（V2 待写）。

## 3. 面板清单与关注阈值

| 面板 | 目的 | 建议报警思路（文字版，不在本 JSON 预置 alert rule） |
|---|---|---|
| HTTP 延迟 p50/p95/p99 (按 route) | 发现慢接口、慢 SQL 回退到路由层的症状 | 某 route p95 连续 5 分钟 > 2s → 告警 |
| HTTP QPS (按 status_class 堆叠) | 整体流量 + 错误占比直观 | 5xx 非零且持续 > 1 分钟 → 告警 |
| 5xx 错误率 (最近 5 分钟) | 全局错误率单值 | >1% → warning；>5% → critical |
| Top 5 慢 route (p95) | 日常巡检找退化点 | 与历史 p95 基线比较，>2× → 告警 |
| Event loop 延迟 | 抓同步 CPU 卡住 IO 的情况 | p99 > 200ms 持续 5 分钟 → 告警 |
| Heap used / total | 内存泄漏 / 过载预警 | used/total > 90% 持续 10 分钟 → 告警 |
| Process CPU | 单核跑满预警 | `rate[1m] > 0.8` 持续 5 分钟 → 告警 |
| 活跃句柄 + 打开 FD | 连接 / 文件泄漏 | 稳态基线之上 2× 且不回落 → 告警 |
| 审计写入速率（代理指标） | PR7 审计未暴露 counter 时的近似 | 写操作 QPS 突降到 0（审计 DB 挂了的间接信号） |

## 4. 已知限制

1. **audit_log counter 未暴露**：PR7 审计只落 DB + pino，没有 `audit_log_writes_total` counter。本仪表盘用 `http_requests_total{method=~"POST|PUT|DELETE|PATCH"}` 作为代理指标，V2 补齐真正 counter 后需要修改第 21 号面板 expr。
2. **scrape 受 admin 鉴权约束**：在 ADR-0012 落地之前，请按第 2 节方式 B 手动验证；切勿把 `/api/metrics` 改成全匿名。
3. **本 JSON 不内嵌 Alert rule**：Grafana Alert 或 Prometheus Alertmanager 的规则由运维根据上表阈值自行配置，保持仪表盘可跨环境复用。
4. **route 标签依赖 Express `req.route.path`**：若将来引入自定义路由（如动态加载），记得同步更新 `apps/gateway/lib/metrics.js` 的 `labelRoute` 逻辑，否则会出现 route="<unknown>"/raw path 爆基数。

## 5. 本地验证

在没有真实 Grafana 的情况下最低限度的校验：

```bash
# JSON 合法性
jq empty docs/grafana/ecom-agent-platform-dashboard.json

# 列出所有面板
jq '[.panels[] | {id, title, type}]' docs/grafana/ecom-agent-platform-dashboard.json
```

真实环境验证：在任意 Grafana 10+ 实例里 `Import` → 选 Prometheus datasource → 预览无红字即可（无 scrape 数据时面板 `No data` 属于预期）。
