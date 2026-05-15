# ADR 0011: Grafana 仪表盘一键导入 JSON

- 日期：2026-04-24
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：V2 加固清单第 1 项（Grafana dashboard）
- 关联 ADR：[0008 Prometheus 指标 + Sentry](./0008-metrics-and-sentry.md)、0012 metrics-auth（待写）

## 背景

PR8 已经把 prom-client 接入 gateway，`/api/metrics` 暴露了 HTTP RED 指标与 Node.js 运行时默认指标。
但仪表盘侧还缺落地产物，表现为：

1. 运维要想看"过去 1 小时 p95 / 5xx 率"，只能手写 PromQL，门槛高。
2. 每次 Grafana 重建或新环境上线，面板设计要从零手搓，容易漏关键面板（如 event loop lag）。
3. 没有文档写清楚 Prometheus scrape 应该怎么 match 现在 admin-gated 的 `/api/metrics`。

对一个 40 人部门级产品，这三件事累加起来会变成"有指标但没人看"的废数据。

## 决策

### 1. 以 Grafana 10+ JSON 作为唯一产物

- 位置：`docs/grafana/ecom-agent-platform-dashboard.json`
- UID 固定：`ecom-agent-gateway`（跨环境复用同一 URL 书签）
- Title：`Ecom Agent Gateway`
- datasource 通过 `${DS_PROMETHEUS}` 占位符，Import 时让 Grafana 提示用户选。
- 不内嵌 Alert rule，保持仪表盘在任何 Grafana 实例干净可导入。

### 2. 面板集：HTTP RED + Node.js 运行时 + 审计（预留）

两行布局：

**Row A — HTTP RED（Rate / Errors / Duration）**
- p50/p95/p99 延迟（按 route 分组，基于 `http_request_duration_seconds_bucket`）
- QPS 按 `status_class` 堆叠（绿/黄/橙/红映射 2xx/3xx/4xx/5xx）
- 5xx 错误率单值（Stat，阈值 0.5% / 1%）
- Top 5 慢 route p95（BarGauge）

**Row B — Node.js 运行时**
- event loop lag（current + p99）
- heap used / total
- process CPU（rate）
- 活跃句柄数 + 打开 FD

**Row C — 审计（预留）**
- 暂用 `http_requests_total{method=~"POST|PUT|DELETE|PATCH"}` 作代理指标；V2 audit counter 到位后替换 expr。

### 3. 模板变量

- `DS_PROMETHEUS`：datasource 选择器。
- `job`：默认 `ecom-agent-gateway`，允许切换其他 scrape job。
- `instance`：多选 + All，方便在多实例场景里看单机或聚合。

### 4. scrape 约束显式文档化

因为 `/api/metrics` 受 `requireAdmin` 保护（ADR-0008 决议），本仓库在 `docs/grafana/README.md` 明确：
- 推荐路径：等 ADR-0012 metrics-auth 落地（引入 `METRICS_TOKEN`，Prometheus 用 Bearer），仪表盘无需改动。
- 过渡路径：手动 curl 带 cookie 验证，或 127.0.0.1 白名单仅限内网测试。
- 禁止路径：把 `/api/metrics` 彻底匿名开放。

## 不做什么

- ❌ 不在本仪表盘里预置 Alert rule（阈值因环境而异，且会让 JSON 在不同 Grafana 版本上冲突）。
- ❌ 不引入 `grafana-provisioning` YAML（40 人 LAN 规模，手动 Import 成本低于维护 provisioning 流水线）。
- ❌ 不拆成多个仪表盘（HTTP + Node.js 同一屏，减少跳转）。
- ❌ 不改 `apps/gateway/` 任何代码——这是纯 docs 产物，与 scrape 鉴权解耦。
- ❌ 不预置 audit counter 面板的真实 PromQL（counter 还不存在，预置会显示 No data 误导用户）。

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| Grafana provisioning （YAML + datasource UID 硬编码） | 40 人内网，手动 Import 一次 = 5 分钟，不值得维护 provisioning。 |
| 多个分专题 dashboard（HTTP 一个、Runtime 一个） | 日常排查一屏看完更省时间，跳转成本 > 拆分收益。 |
| 预置 Alert rule（p95 > 2s 等） | 阈值因业务形态而异，预置反而会在新环境误报；README 给文字建议更稳。 |
| 不提供 JSON，只写 PromQL 清单让运维自搭 | 违背"一键导入"目标，新人上手成本高。 |
| 等 audit counter 做完再一起提交 | 阻塞 V2 观测性收敛时间；用代理指标 + 注释先占位更务实。 |

## 架构

```
prom-client (/api/metrics, admin-gated)
        │
        │  (scrape: cookie / Bearer / 白名单——见 ADR-0012)
        ▼
Prometheus ────► Grafana
                   │
                   │  Import docs/grafana/ecom-agent-platform-dashboard.json
                   ▼
          Dashboard "Ecom Agent Gateway" (uid=ecom-agent-gateway)
            ├─ Row A: HTTP RED   ×4 panels
            ├─ Row B: Runtime    ×4 panels
            └─ Row C: Audit (预留 ×1 panel)
```

## 验证

- `jq empty docs/grafana/ecom-agent-platform-dashboard.json` 通过。
- `jq '[.panels[] | {id, title, type}]'` 12 个面板（3 row + 9 data panel）全量列出。
- 所有 PromQL 表达式的 metric 名均来自 `apps/gateway/lib/metrics.js`（`http_requests_total`、`http_request_duration_seconds`）或 prom-client 默认采集项（`nodejs_eventloop_lag_seconds`、`nodejs_heap_size_used_bytes`、`nodejs_heap_size_total_bytes`、`process_cpu_seconds_total`、`process_open_fds`、`nodejs_active_handles_total`），未编造。
- README 给出本地 jq 校验命令；真实 Grafana 导入预览留给 Cyrus 在配环境时执行。

## 后续

- **ADR-0012**（V2）：落 `METRICS_TOKEN` Bearer 方案，scrape 配置转为匿名友好；dashboard 无需改动。
- **V2**：补 `audit_log_writes_total` counter（在 `apps/gateway/services/auditLogger.js` 上 inc），然后把 panel 21 的 expr 从代理指标换成真实 counter。
- **V2**：增加"PostgreSQL 慢查询"专题 row（需要先在 `reportRepo` 层加 histogram）。
- **V2**：若将来接入 Sentry 自托管，补 Sentry issue count 面板（Sentry 自带 Prometheus exporter）。
