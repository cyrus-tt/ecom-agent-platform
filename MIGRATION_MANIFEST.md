# Migration Manifest

- Timestamp: 2026-03-08 20:42:19
- Mode: Copy only (non-destructive)
- Source A: D:\桌面\电商web看板
- Source B: D:\桌面\new sql
- Target: D:\桌面\ecom-agent-platform

## Copied Modules
- apps/gateway
- apps/web
- pipelines/pg-daily-wide
- pipelines/sqlserver-legacy
- docs/ECOMMERCE_AGENT_CODEX_GUIDE.md
- ops/windows scripts

## Data Copy Rule
- Same name + same hash: keep one file
- Same name + different hash: auto rename with suffix

## Data Inbox File Count
- 9

## Prepared File Count
- 6