# Paging Dr. Placebo (`paging-dr-placebo`)

> **SIMULATION NOTICE:** This repository is a strictly synthetic healthcare scheduling agent evaluation laboratory using fictional patient (`PAT-001`..`PAT-003`), provider (`PRV-001`..`PRV-002`), and appointment fixtures. It never accesses real patient records, clinical systems, or external notification channels. It is **NOT** clinically validated or HIPAA-compliant.

## Core Principle

**Claimed success, attempted action, reported API success, and verified persisted outcome are four different things.**

This laboratory evaluates a healthcare scheduling agent across four orthogonal layers:
1. **Narrow Policy & Tool-Call Correctness** (`tests/eval-narrow/narrow-harness.test.ts`)
2. **Multi-Turn Conversational State & Intent Evolution** (`tests/eval-conversation/multi-turn.test.ts`)
3. **Level 1 Voice-Event & Turn-Ownership Simulation** (`tests/eval-voice/voice-events.test.ts`)
4. **Independent Claim-to-State Outcome & Mutation Verification** (`tests/observer/observer-mutations.test.ts`)

---

## Execution Commands (`C4`)

Run all commands from `c:\Users\bette\Desktop\GH clones\paging-dr-placebo`:

```bash
# 1. Launch Interactive UI Playground (http://127.0.0.1:4321)
npm run ui

# 2. Database setup & seed verification
npm run db:setup

# 2. Unit tests (Backend transactions, auth tokens, patient isolation, idempotency, fault injection)
npm run test:unit

# 3. Integration tests (Agent + Backend + HTTP Server + Reporting contracts)
npm run test:integration

# 4. Narrow policy & boundary evaluations (T01..T03, T07..T12, T16..T20)
npm run eval:narrow

# 5. Multi-turn conversational evaluations (T04..T06, M01..M03)
npm run eval:conversation

# 6. Voice-event evaluations (T13..T15, V01: silence, barge-in, playback cancellation, partial ASR)
npm run eval:voice

# 7. Independent Observer mutation tests (OBS-01..OBS-09: planted contradictions & missing evidence)
npm run test:observer

# 8. Full deterministic evaluation & test suite
npm run eval:full

# 9. Live Local LLM evaluation suite (LM Studio on 127.0.0.1:1234, default model: hermes-3-llama-3.1-8b)
npm run eval:llm

# 10. Reproducible JSON & Markdown report generation
npm run report:generate

# 11. Complete verification gate (Typecheck + Full Suite + Report Generation)
npm run check
```

---

## SPARC Documentation Index

- **Specification (`S`):**
  - [`docs/specification.md`](./docs/specification.md)
  - [`docs/requirements-matrix.md`](./docs/requirements-matrix.md)
  - [`docs/threat-model.md`](./docs/threat-model.md)
  - [`docs/assumptions.md`](./docs/assumptions.md)
- **Pseudocode (`P`):**
  - [`docs/pseudocode.md`](./docs/pseudocode.md)
  - [`docs/state-machines.md`](./docs/state-machines.md)
  - [`docs/failure-semantics.md`](./docs/failure-semantics.md)
- **Architecture (`A`):**
  - [`docs/architecture.md`](./docs/architecture.md)
  - [`docs/data-model.md`](./docs/data-model.md)
  - [`docs/api-contracts.md`](./docs/api-contracts.md)
  - [`docs/adr/ADR-001-to-005.md`](./docs/adr/ADR-001-to-005.md)
- **Generated Reports (`R` / `C`):**
  - [`reports/latest-evaluation.md`](./reports/latest-evaluation.md)
  - [`reports/latest-evaluation.json`](./reports/latest-evaluation.json)

---

## Known Limitations & Future Enhancement Backlog (`C3` / `C5`)

1. **Level 2 Live Acoustic Audio Excluded by Design:** Level 1 deterministic `VoiceEventSimulator` (silence, barge-in, partial utterance, playback cancellation, relative-date ambiguity) is verified. Level 2 live acoustic ASR/TTS streaming is exposed as the `AudioProviderAdapter` interface (`src/simulator/voice-event-simulator.ts`) so offline CI runs require zero external cloud keys; we do not claim acoustic accuracy from Level 1 tests.
2. **Deterministic Intent Parser Default:** By default, `SchedulingAgent` uses a deterministic NLU/state-machine policy so regression and mutation tests are 100% reproducible without external LLM token spend or network variance. Live LLM adapters can be plugged into `SchedulingAgent` while keeping `SchedulingApi` and `IndependentObserver` unchanged.
3. **Single-Process SQLite Concurrency:** Contention (`T07`) is enforced via `BEGIN IMMEDIATE TRANSACTION` and `CREATE UNIQUE INDEX idx_unique_booked_slot ON appointments(slot_id) WHERE status = 'BOOKED'` in `node:sqlite`. Multi-process distributed locking would require migrating the repository adapter to PostgreSQL.
