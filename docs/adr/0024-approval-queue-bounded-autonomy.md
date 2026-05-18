# ADR-0024: Approval Queue — Bounded Autonomy

**Status:** accepted
**Date:** 2026-05-16
**Deciders:** Claude (autonomous session), pending Cyrus review

## Context

Phase 2A (daily inspection) and 2C (dashboard) are done. The system detects anomalies but has no mechanism to propose and execute actions. Users must manually interpret anomalies and decide what to do.

Phase 2B introduces the "bounded autonomy" pattern: the Agent proposes actions based on anomalies, routes them by risk level, and either auto-executes or queues for human approval.

## Decision

### Risk-based routing

| Risk Level | Behavior | Examples |
|---|---|---|
| Low | Auto-execute silently | Acknowledge new-product observation period |
| Medium | Auto-execute + record in timeline | Send alert notification |
| High | Queue for explicit human approval | Inventory adjustment, promotion suggestion, investigation flag (critical) |

### Architecture

1. **Rule engine** (`proposals.js`): Maps anomaly types + severity → action proposals
2. **Persistence**: `agent_proposals` table with status machine (pending → approved/rejected → executed/failed)
3. **Integration**: Proposals generated automatically after each inspection run
4. **Frontend**: Approval queue card in Agent Dashboard with approve/reject buttons

### Status machine

```
[inspection detects anomaly]
    ↓
[rule engine generates proposal]
    ↓
  risk_level == high? → status: pending → user approve → executed
                      → user reject → rejected
  risk_level != high? → status: approved → auto-execute → executed
```

### Action execution (MVP)

Actions currently record decisions only (no ERP/WMS integration). The `runAction()` function is a hook point for future integrations:
- `send_alert` — will integrate with DingTalk/WeChat Work
- `suggest_clearance` — will integrate with inventory system
- `suggest_promotion` — will integrate with promotion platform

## Consequences

- Users get a clear approval interface for high-risk Agent actions
- Low/medium risk actions execute without friction (but remain auditable)
- Timeline shows all proposal decisions for traceability
- Future integrations plug into `runAction()` without changing the approval flow
