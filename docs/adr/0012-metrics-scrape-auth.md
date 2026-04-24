# ADR 0012: /api/metrics 支持 Bearer METRICS_TOKEN 认证（Prometheus scrape 友好）

- 日期：2026-04-24
- 状态：Accepted
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：V2 清单第 5 项（metrics-auth）
- 关联 ADR：ADR 0008（初版 Prometheus 指标，admin-gated）

## 背景

ADR 0008 把 `/api/metrics` 放在 admin session 后面。思路上没错（避免内网指标裸奔），
但在真实运维里卡了 scrape：

- **Prometheus 官方 scrape 不支持 cookie 登录**。要么 basic auth，要么 bearer token，要么 TLS client cert。
- ADR 0008 里就已经承认这是遗留问题，列了 V2 三个选项（token / agent 代理 / IP 白名单）。
- 当前部门 40 人 + LAN 场景下，IP 白名单维护成本高（办公 IP 变化 / VPN 出口），
  Grafana Agent 代理又过重，**Bearer token 是最匹配规模的方案**。

同时有一条硬要求：**不能让 `/api/metrics` 变成公开端点**。部分指标（如 httpRequest duration histogram，按 route 区分）会暴露 API 面板，外网知道以后可以辅助侦察。

## 决策

### 1. 双通道任一放行

`/api/metrics` 在进入 handler 前，按顺序判定：

1. `Authorization: Bearer <token>` 且 `token === process.env.METRICS_TOKEN`
   且 `METRICS_TOKEN` 非空 → 放行（Prometheus 通道）
2. 否则 fallback 到 `requireAdmin`（admin session 通道）

任何一个通过就放行，都不通过返回 401/403（保持和其他 API 一致的错误形状，见 server.js `denyPermission`）。

### 2. METRICS_TOKEN 未设置 = Bearer 通道关闭（非降级为公开）

若 `process.env.METRICS_TOKEN` 未设置 / 为空串 / 仅空白，Bearer 通道**直接关闭**，
只剩老的 admin session 路径。这是刻意设计的「安全默认」：**没显式配 token 的部署不会意外变公开**。

### 3. 常量时间比较 + 长度上限

- 用 `crypto.timingSafeEqual` 做比较，避免 early-exit 时间 side channel。
- token 长度超 256 字节直接拒（防止超大 Authorization header 触发 CPU/内存放大）。
- 比较前校验 buffer 长度相等（`timingSafeEqual` 要求长度严格相等，否则抛）。

### 4. 实现位置

- 新文件：`apps/gateway/middleware/metricsAuth.js`（纯函数 + 构造器，方便单元测试）
- 改动：`apps/gateway/routes/metrics.js` 换成 `buildMetricsAuth(requireAdmin)` 返回的中间件

### 5. 测试（tests/smoke/metrics-auth.smoke.test.js，9 条）

| 场景 | 期望 | 实际 |
|---|---|---|
| 无 cookie + 无 Bearer | 401/403 | ✅ 401 |
| Bearer 匹配 | 200 + `text/plain; version=0.0.4` | ✅ |
| Bearer 不匹配 | 401/403 | ✅ 401 |
| METRICS_TOKEN 未设 + 有 Bearer | 401/403 | ✅ 401 |
| METRICS_TOKEN 空白串 + 有 Bearer | 401/403 | ✅ 401 |
| 超长 Bearer（> 256 字节） | 401/403 | ✅ 401 |
| admin cookie 单独 | 200 | ✅ |
| admin cookie + 错误 Bearer | 200（fallback 走通） | ✅ |
| 非 admin cookie | 403 | ✅ |

## 备选方案

- **IP 白名单**：LAN 场景合理，但 VPN / NAT 出口不稳定；维护成本高。
- **Basic auth**：Prometheus 支持，但凭据混在 URL/日志里风险更大；token 至少专用。
- **单独 metrics 端口**：最规范，但多一个监听/端口映射配置。40 人规模不值得。
- **mTLS**：最安全，但客户端证书分发在部门 IT 环境基本做不了。

## 安全分析

**若 METRICS_TOKEN 泄露会怎样？**

- 攻击面：能无限抓 `/api/metrics`。读到的内容是 RED 指标（请求数、延迟、路径模板、状态码分布）+ 进程/heap/event-loop 数据。
  - **不包含**用户数据、审计明细、API payload
  - **会包含**路由清单 + 流量分布（对攻击者做侦察有一定帮助）
- **不会**拿到 admin session 权限（token 只能过 `/api/metrics` 这个 middleware，不是 session token）。

**缓解**：

1. `METRICS_TOKEN` 至少 32 字节随机（runbook 明写 `openssl rand -hex 32`）
2. 放在 `.env`（gitignore），生产走运维手动注入或 systemd EnvironmentFile
3. 泄露时轮换：改 `.env` 重启 gateway 即失效，Prometheus 侧同步更新 `bearer_token` 即可
4. 未来若要更强：考虑限 source IP + token，或改走 mTLS

**补充**：由于采用 timingSafeEqual + 256 字节长度上限，暴力猜解 / 时序侧信道 / header 放大这三类都不成立。

## 合并后配置

### Prometheus scrape 配置样例（2.26+）

```yaml
scrape_configs:
  - job_name: ecom-gateway
    scrape_interval: 15s
    metrics_path: /api/metrics
    authorization:
      type: Bearer
      credentials: REPLACE_WITH_METRICS_TOKEN
    static_configs:
      - targets: ['gateway-host:3000']
```

或旧版 Prometheus（`bearer_token_file`）：

```yaml
    bearer_token_file: /etc/prometheus/ecom_metrics_token
```

### 生成 token

```bash
openssl rand -hex 32
# 示例输出：c0ffee...（64 字符 hex，约 32 字节熵）
```

写入 `apps/gateway/.env`：

```
METRICS_TOKEN=c0ffee...
```

重启 gateway。验证：

```bash
curl -H "Authorization: Bearer c0ffee..." http://localhost:3000/api/metrics | head
# 应该看到 # HELP ... / # TYPE ...
```

## 非目标

- 不做 IP 白名单（复杂度不匹配规模）
- 不做多 token 轮换（单 token 足够，轮换靠重启）
- 不做 scope 区分（所有指标同一粒度开放，没有必要再分）

## 后续

- 若未来要公网暴露：前面加 nginx + TLS + IP 白名单 + 该 token，多层串联。
- 若指标扩大到包含业务敏感字段：回到 ADR 0008 讨论「哪些指标能上」，而不是改这里的认证。
