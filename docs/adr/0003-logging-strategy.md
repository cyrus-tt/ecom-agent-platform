# ADR 0003: 集中日志（pino）

- 日期：2026-04-23
- 状态：已采纳
- 决策者：Cyrus（产品）+ Claude（执行）
- 关联 PR：PR3
- 关联设计：`docs/plans/2026-04-23-uplift-to-9-design.md`

## 背景

日志现状：
- 15 处 `console.log / console.warn / console.error` 散落在 `server.js` / `reportRepo.js` / `dispatch/*.js`
- 仅输出到 stdout，**重启即丢**
- 后台任务日志存内存（`server.js:JOB_LOG_LIMIT=300` 行），重启也丢
- 无结构化字段、无级别控制、无时间戳（console.log 默认无时间戳）、无模块名标签

**对部门 40 人推广是硬伤**：用户报 bug 说"今天下午 3 点日报打不开"，开发完全没线索。

## 决策

引入 **pino** 作为统一日志层。

### 架构

```
┌────────────────────────────────────────────────┐
│ application code                               │
│   const log = childLogger("module-name")       │
│   log.info({context}, msg)                     │
└──────────────────┬─────────────────────────────┘
                   │
           ┌───────▼────────┐
           │ pino root      │
           │ level + base   │
           └───────┬────────┘
                   │
         ┌─────────┴─────────┐
         │ transport targets │
         └─────────┬─────────┘
     ┌─────────────┼──────────────┐
     ▼             ▼              ▼
┌────────┐   ┌──────────┐   ┌──────────┐
│ pretty │   │ pino/file│   │ pino-roll│
│ (dev)  │   │ (prod    │   │ daily or │
│ stdout │   │  stdout) │   │ 100MB    │
└────────┘   └──────────┘   │ runtime/ │
                             │ logs/    │
                             └──────────┘
```

### 级别规则

| NODE_ENV | 默认 level | 输出 |
|---|---|---|
| `production` | `info` | JSON stdout + 文件滚动 |
| `development`（默认）| `debug` | 彩色 pretty stdout + 文件滚动 |
| `test` | `silent` | 无输出（不污染 vitest 输出） |

所有可被 `LOG_LEVEL` 环境变量覆盖。

### 文件滚动

- 目录：`runtime/logs/`（可用 `LOG_DIR` 覆盖，为 PR4 双端口部署铺路）
- 文件名：`gateway-yyyy-MM-dd.log`
- 触发：按天滚动 **或** 达 100 MB
- 保留：最近 7 天

### 迁移规则

逐字段对应（示意，不改语义）：

```js
// before
console.log(`[warmup] report cache ready for ${week}`)
// after
log.info({ defaultWeek: week }, `[warmup] report cache ready for ${week}`)
```

- 第一个参数 = 结构化字段（可索引、可过滤）
- 第二个参数 = 人读文本（保持原来的字符串，便于 grep）
- **原行为保留**：pino 的 pretty transport 显示为类似 `[14:22:01.234] INFO: [warmup] report cache ready for 2026-W15 (module=server defaultWeek=2026-W15)`

## 不做什么

- ❌ 不改造 `server.js:JOB_LOG_LIMIT=300` 内存环形缓冲 —— 前端 `GET /api/admin/jobs/:jobId` 依赖
- ❌ 不改业务日志的内容（grep 模式、上下游监控脚本都依赖现有字符串）
- ❌ 不把 request logging 加进来 —— 那是 Express middleware 的活（PR7 审计中间件会配）
- ❌ 不 forward 到外部 log aggregator —— 对 40 人内网场景过度投资

## 替代方案

| 方案 | 为什么没选 |
|---|---|
| winston | API 重，transport 配置语法冗长；pino 的 transport 用 worker 线程不阻塞主 loop |
| bunyan | 作者停止维护 |
| 不做，继续 console | 文件无法落盘，生产故障排查失败 |
| 自己写 wrapper | 重复造轮子，少测试覆盖 |

## 后果

- ✅ 所有日志可 `tail -f runtime/logs/gateway-*.log` 实时查看
- ✅ JSON 格式便于未来接 log 聚合（如果有需要）
- ✅ 15 处 console 变 15 处 logger，行为兼容
- ✅ 测试 silent 模式，不污染 vitest 输出
- ⚠️ pino transport 用 worker 线程，冷启动略慢（几十 ms），不影响业务
- ⚠️ 生产需要保证 `runtime/logs/` 目录可写

## 验证

- 25 个 smoke 测试全绿 × 3 次稳定运行（PR2 提供的安全网）
- `node --check apps/gateway/server.js` 语法通过
- 手动 `npm run dev:gateway` 后 `ls runtime/logs/` 应该看到当日 log 文件（留给合并后 Windows 侧验收）

## 后续

- **PR4 拆分**：每个子路由文件用 `childLogger("route-xxx")` 带模块名
- **PR7 审计**：请求/响应日志走审计中间件 → 审计表 + 同时 logger.info 落盘
- **PR8 Sentry**：错误级别日志 → Sentry breadcrumb 自动采集
