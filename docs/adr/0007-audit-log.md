# ADR 0007: 操作审计日志（pino + PostgreSQL 双 sink）

- 日期：2026-04-23
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：PR7
- 关联设计：`docs/plans/2026-04-23-uplift-to-9-design.md`

## 背景

当前系统对用户操作无任何审计：
- 前端报"今天下午 3 点调拨怎么失败的？"—— 开发只能猜
- 内部合规要求知道"是谁在 X 时间登录了系统"
- 40 人推广后，有人误操作（账号变更、AI 报告误生成）无法追溯

仅靠 pino 日志不够：
- 日志文件是线性文本，查询"过去 24 小时内谁调用了 /api/agent/run"需要 grep + 组装
- 日志文件按天滚动，跨天查询复杂

## 决策

**双 sink 审计**：
1. **pino 文件 sink**（始终开启）：每次请求写一行 `module:"audit"` 的 JSON 日志到 `runtime/logs/gateway-*.log`。已由 PR3 提供。
2. **PostgreSQL sink**（`ENABLE_AUDIT_DB=true` 默认）：批量（32 行或 500ms）插入到 `anta_daily.audit_log`，方便 SQL 查询 + BI 接入。

### Schema

`pipelines/pg-daily-wide/sql/90_audit_log.sql`：

```sql
CREATE TABLE IF NOT EXISTS anta_daily.audit_log (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  account_id   TEXT,
  username     TEXT,
  is_admin     BOOLEAN,
  method       TEXT NOT NULL,
  path         TEXT NOT NULL,
  status_code  INT,
  duration_ms  INT,
  ip           TEXT,
  user_agent   TEXT,
  metadata     JSONB
);
CREATE INDEX idx_audit_log_created ON ...(created_at DESC);
CREATE INDEX idx_audit_log_account_created ON ...(account_id, created_at DESC);
CREATE INDEX idx_audit_log_path_created ON ...(path, created_at DESC);
```

**只增不改**：SQL 用 `CREATE TABLE IF NOT EXISTS`，符合"DB schema 只加不改"红线。

### 请求生命周期

```
HTTP request in
  ↓
[session enrichment middleware]   (PR0 已有)
  ↓
[audit middleware]                 (PR7 新增)  ← 记录 startedAt
  ↓
[route handler]                    (PR4 已有)
  ↓
response finish event              → 计算 duration_ms，调 auditLogger.record(entry)
  ↓                                  auditLogger pino.info 立即落盘
  ↓                                  + queue push (DB 异步批量 flush)
HTTP response out
```

### 审计记录示例

```json
{
  "level": 30,
  "time": "2026-04-23T17:55:23.412Z",
  "module": "audit",
  "account_id": "acct_...",
  "username": "anta",
  "is_admin": true,
  "method": "POST",
  "path": "/api/agent/run",
  "status_code": 200,
  "duration_ms": 8542,
  "ip": "10.1.2.5",
  "user_agent": "Mozilla/5.0 ...",
  "msg": "POST /api/agent/run → 200 8542ms"
}
```

### 跳过路径

高频探测 + 无意义：
- `/healthz`, `/readyz`, `/api/ping` — 健康检查
- `/api/metrics` — 预留给 PR8 的 Prometheus scrape
- `/assets/*`, `/favicon*` — 静态资源

### 容错设计

`auditLogger.record()` 是 **fire-and-forget**，三重护盾：

1. **pino sink 总是先写**：DB 挂了，日志文件还在
2. **DB sink 异步 + 批量**：500ms 或 32 行触发 flush，不阻塞请求
3. **熔断器**：DB insert 连续失败 3 次 → 暂停 60 秒。避免日志灌爆的风险

DB 日志丢行 > 用户请求失败。永远选前者。

### 环境开关

- `ENABLE_AUDIT_LOG=true`（默认）：audit middleware 生效
- `ENABLE_AUDIT_LOG=false`：完全关闭（应急）
- `ENABLE_AUDIT_DB=true`（默认）：DB 写入开启
- `ENABLE_AUDIT_DB=false`：只走 pino sink，DB 跳过
- `AUDIT_FLUSH_BATCH_SIZE=32` / `AUDIT_FLUSH_INTERVAL_MS=500` / `AUDIT_BREAKER_MS=60000`：调参

## 不做什么

- ❌ 不记录 request body（PII 风险 + 日志膨胀）
- ❌ 不记录 response body
- ❌ 不扩展 `metadata` JSONB 的具体字段（V2 按需）
- ❌ 不写日志审计 UI（PR9 用量统计页基于此表做）
- ❌ 不做 retention policy（SQL 内注释了手动 DELETE 模板，由 ops 定时跑）

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| 只写文件，不写 DB | 查询不便，跨天难 |
| 只写 DB | DB 故障时丢审计 |
| 用 Fluentd / Logstash | 对 40 人内网过度投资 |
| 每行同步插 DB | 阻塞请求路径，违反"用户请求优先" |
| 改 DB 原有表加审计字段 | 违反"只加不改" + 污染业务表 |

## 验证

**单元测试**（`tests/unit/auditLogger.test.js`，3 条）：
- 正常批量 flush：2 行 records → 1 次 query call，20 个 placeholders
- `ENABLE_AUDIT_DB=false` 时不调用 pool
- DB query reject 时不抛异常（fire-and-forget 契约）

**烟囱测试**（25 条 + validation 7 条，基于 PR2/PR6）：
- 全部通过，审计中间件不改变任何既有行为
- 测试环境 `ENABLE_AUDIT_DB=false`：只走 pino sink

合计 **42 测试 × 5 次稳定全绿**。

## 部署步骤

1. 合并 PR7 → `feature/dispatch-agent`
2. 在 Windows 生产机：
   - `psql -d ecom_dashboard_v2 -f pipelines/pg-daily-wide/sql/90_audit_log.sql` 建表（幂等）
   - `git pull && npm --prefix apps/gateway ci`
3. 按双端口方案起新版
4. 3 分钟后跑查询验证：
   ```sql
   SELECT path, count(*), max(created_at)
   FROM anta_daily.audit_log
   WHERE created_at > now() - interval '5 minutes'
   GROUP BY path;
   ```
5. 若看到条目 → 审计通路正常
6. 切 :3001 → 新版

## 回滚

```
echo 'ENABLE_AUDIT_LOG=false' >> apps/gateway/.env
npm run ops:stop:saas && npm run ops:start:saas
# 审计层彻底关闭，对业务零影响
```

数据保留：即便关闭中间件，已有 audit_log 表不删除，便于事后取证。

## 后续

- **PR9 用量统计页**：基于 audit_log 表，管理员 UI 看"过去 7 天 SQL+ 用了多少次"
- **V2**：给 audit 加 data_in/data_out 字段 JSON，审计级别可配置（仅敏感端点）
- **V2**：审计数据接 Grafana，做运维看板
