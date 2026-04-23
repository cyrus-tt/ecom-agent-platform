# Project Boundary (2 Projects)

Last updated: 2026-04-23

## Final split

This workspace now follows a strict two-project model:

1. `ecom-agent-platform` (SaaS main system)
2. `ec-agent` (independent analysis-agent project)

`dispatch-agent` standalone repo is no longer the runtime entry. Dispatch is built into SaaS.

## Ownership

| Domain | Owner repo | Notes |
| --- | --- | --- |
| Dispatch workflow (`/dispatch`) | `ecom-agent-platform` | Built-in module under `apps/gateway/services/dispatch` |
| SaaS pages and account permission | `ecom-agent-platform` | Includes `dispatch` permission module |
| Analysis workbench / ReAct agent UI | `ec-agent` | Runs independently on another port |
| Historical dispatch scripts | `dispatch-agent` | Archive/reference only, not production entry |

## Runtime contract

- SaaS: `http://localhost:3000`
- ec-agent: `http://localhost:3100`

Do not bind both projects to the same port.

## Standard start/stop (SaaS only)

From `ecom-agent-platform` root:

```powershell
npm run ops:start:saas
```

Stop:

```powershell
npm run ops:stop:saas
```

Optional rebuild before start:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\windows\start_saas_core.ps1 -RebuildWeb
```

## Dispatch switch

Dispatch defaults to enabled in SaaS. To explicitly disable:

```powershell
$env:DISPATCH_AGENT_ENABLED = "false"
```

## Guardrail

Any new dispatch feature should be implemented in `ecom-agent-platform` only.  
Do not add new production logic to standalone `dispatch-agent`.
