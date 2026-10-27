# Failure Injection Semantics

Every injected fault in `FaultInjector` is deterministic, keyed by rule ID, target operation, and trigger count.

## 1. Fault Injection Matrix

| Fault Type | Injection Boundary | Trigger Condition | Does DB Commit? | Response Delivered to Agent | What Agent Can Observe | What Independent Observer Determines |
|---|---|---|---|---|---|---|
| `PRE_AUTH_REJECT` | Before Verification / Auth Check | Matching tool & occurrence | **No** | `REJECTED` (`AUTH_SERVICE_UNAVAILABLE`) | Explicit service failure | `NOT_ATTEMPTED` / `REJECTED` in audit log; no DB change |
| `PRE_COMMIT_ABORT` | Inside API before SQLite `COMMIT` | Matching mutation & occurrence | **No** (Rolled back) | `UNKNOWN` (`TRANSPORT_TIMEOUT`) | Request timed out; outcome unknown (`UNKNOWN`) | DB snapshot unchanged; reconciliation proves `RECONCILED_NOT_COMMITTED` |
| `POST_COMMIT_DROP` | After SQLite `COMMIT`, before HTTP/Tool return | Matching mutation & occurrence | **Yes** (Durable in SQLite) | `UNKNOWN` (`TRANSPORT_TIMEOUT`) | Request timed out; outcome unknown (`UNKNOWN`) until reconciled | DB snapshot & `MUTATION_COMMITTED` audit event prove mutation committed (`RECONCILED_COMMITTED`) |
| `MISLEADING_HTTP_200` | Transport response adapter | Matching mutation & occurrence | **No** (Backend rejected or skipped) | Spoofed `200 OK` (`COMMITTED` fake receipt) | Agent sees spoofed tool response | Observer prioritizes authoritative `DB_SNAPSHOT` and `BACKEND_AUDIT` over transport trace (`INV-10`) |
| `RECONCILIATION_UNAVAILABLE` | On `reconcileOperation` endpoint | Matching reconciliation call | N/A (Read-only) | `UNKNOWN` (`RECONCILIATION_UNAVAILABLE`) | Agent remains in `OUTCOME_UNKNOWN` and must report uncertainty (`INV-08`) | Observer verifies agent claimed `OUTCOME_UNCERTAIN` and did not retry with a fresh idempotency key |

## 2. Deterministic Trigger Evaluation

```text
STRUCTURE FaultRule:
    ruleId: string
    stage: "PRE_AUTH_REJECT" | "PRE_COMMIT_ABORT" | "POST_COMMIT_DROP" | "MISLEADING_HTTP_200" | "RECONCILIATION_UNAVAILABLE"
    targetTool: "verifyPatient" | "bookAppointment" | "cancelAppointment" | "rescheduleAppointment" | "reconcileOperation"
    triggerOnCallIndex: number // 1-based call counter for that tool in the scenario run
```

Because `triggerOnCallIndex` is deterministic:
- In `T08` (idempotent retry after timeout), Call #1 to `bookAppointment` triggers `PRE_COMMIT_ABORT` (or `POST_COMMIT_DROP`), while Call #2 with the **same** `idempotencyKey` succeeds cleanly without fault injection.
- In `T09`, Call #1 to `bookAppointment` commits to SQLite and triggers `POST_COMMIT_DROP`, while Call #1 to `reconcileOperation` succeeds and resolves the state to `RECONCILED_COMMITTED`.
- In `T20`, Call #1 to `bookAppointment` triggers `POST_COMMIT_DROP` and Call #1 to `reconcileOperation` triggers `RECONCILIATION_UNAVAILABLE`, testing that the agent preserves uncertainty (`INV-08`).
