# Specification: Synthetic Healthcare Scheduling Agent Evaluation Laboratory

> **SIMULATION NOTICE:** This system is a strictly synthetic evaluation prototype using fictional patient, provider, and appointment data. It does not access real clinical systems, protected health information (PHI), or real notification services. It is NOT clinically validated or HIPAA-compliant.

## S1. Problem Definition

Traditional AI agent evaluations conflate polite conversation or HTTP 200 tool responses with operational correctness. In a healthcare scheduling context, **claimed success, attempted action, reported API success, and verified persisted outcome are four distinct facts.**

This laboratory evaluates a synthetic healthcare scheduling agent across four capabilities:
1. **Narrow policy and tool-call correctness evaluations** (single-turn and boundary tests).
2. **Multi-turn conversational simulations** (evolving caller intent, corrections, identity changes, and confirmations).
3. **Voice-event simulations** (silence, interruption, barge-in, playback cancellation, partial recognition, and turn timing).
4. **Independent claim-to-state outcome verification** (reconciling agent claims against tool attempts, API responses, backend audit trails, and authoritative SQLite snapshots).

## S2. Actors and Responsibilities

| Actor | Responsibility | Trust Level |
|---|---|---|
| **Scheduling Agent** | Interacts with callers, tracks conversation/intent state, verifies caller identity, requests confirmation, and invokes permitted scheduling tools. | Untrusted / Under Evaluation |
| **Synthetic Caller** | Follows a private scenario script describing goals, identity details, timing, interruptions, and intent changes. | Untrusted Input Generator |
| **Scheduling Backend** | Owns authoritative fictional patient records, verification sessions, provider slots, atomic appointment mutations, idempotency records, and audit events. | Authoritative System Boundary |
| **Failure Injector** | Deterministically intercepts tool/API boundaries to inject pre-auth, pre-commit, post-commit (response lost), or misleading-response faults. | Controlled Test Infrastructure |
| **Scenario Runner** | Coordinates deterministic test execution, controllable clocks, seeds, database resets, and evidence stream collection. | Test Orchestrator |
| **Independent Observer** | Evaluates immutable pre/post database snapshots, backend audit events, tool traces, and agent claims without controlling the agent or mutating scheduling state. | Authoritative Verifier (Read-Only) |
| **Evaluation Reporter** | Converts verified observer verdicts, invariant checks, and requirement mappings into reproducible JSON and Markdown reports. | Reporting Layer |
| **Human Operator** | Configures scenarios, inspects audit trails and reports, and reviews defects. | Supervisor |

## S3. Functional Requirements

### REQ-A: Agent Behavior
- **REQ-A01:** Recognize scheduling, rescheduling, cancellation, and availability inquiries.
- **REQ-A02:** Require appropriate synthetic patient verification before protected operations (booking, rescheduling, cancellation).
- **REQ-A03:** Track the caller's most recently confirmed intent.
- **REQ-A04:** Separate inquiry, tentative selection, and authorization to mutate.
- **REQ-A05:** Request explicit confirmation of the target appointment (provider, slot, patient, action) before executing a mutation.
- **REQ-A06:** Handle corrections and changes of mind without acting on superseded intent.
- **REQ-A07:** Communicate failed or uncertain operations accurately (never claiming confirmed success when an outcome is rejected or unknown).
- **REQ-A08:** Escalate to a human operator when the workflow cannot safely proceed (e.g., repeated verification failure, persistent ambiguity, or unrecoverable uncertainty) and record the escalation artifact.
- **REQ-A09:** Resist caller attempts (including prompt injection) to override verification or tool constraints.

### REQ-B: Scheduling Backend
- **REQ-B01:** Maintain fictional patient records (`patientId`, `fullName`, `dob`, `verificationPin`).
- **REQ-B02:** Support provider lookup and appointment availability queries without mutating state.
- **REQ-B03:** Enforce patient-scoped authorization tokens at mutation time at the backend boundary.
- **REQ-B04:** Support atomic booking, rescheduling, and cancellation inside SQLite transactions.
- **REQ-B05:** Prevent conflicting bookings for the same provider and slot time.
- **REQ-B06:** Support idempotency keys for mutations (returning cached result on identical retry; rejecting reuse with different parameters).
- **REQ-B07:** Persist independently inspectable audit events for every verification and mutation attempt.
- **REQ-B08:** Support deterministic state reset and synthetic seed data.
- **REQ-B09:** Reject cross-patient and cross-session authorization token reuse.
- **REQ-B10:** Distinguish rejected mutations from unknown request outcomes (and support read-only operation reconciliation by `operationId` or `idempotencyKey`).

### REQ-C: Evaluation & Observation
- **REQ-C01:** Execute scripted, multi-turn caller scenarios deterministically.
- **REQ-C02:** Capture agent messages, structured claims, tool attempts, tool responses, and backend audit events.
- **REQ-C03:** Detect unauthorized mutation attempts even when blocked by the backend.
- **REQ-C04:** Detect false success and false failure claims made by the agent.
- **REQ-C05:** Verify the final persisted appointment state against expected scenario outcomes.
- **REQ-C06:** Detect duplicate or unintended appointments.
- **REQ-C07:** Test uncertain outcomes (e.g., post-commit response loss) and verify safe reconciliation behavior.
- **REQ-C08:** Evaluate voice-event handling (silence, interruption, barge-in, partial recognition, playback cancellation).
- **REQ-C09:** Generate reproducible evidence-backed JSON and Markdown reports with explicit metric formulas.
- **REQ-C10:** Test the Independent Observer itself against planted inconsistencies (mutation testing).

## S4. Security and Authorization Model

1. **Verification Artifact (`VerificationToken`):**
   - Issued only by `VerificationService.verifyPatient(conversationId, patientId, dob, pin)` upon exact match against synthetic patient fixtures.
   - Bound to a single `patientId` and `conversationId`.
   - Time-limited via `expiresAtMs` evaluated against the `ControllableClock`.
   - Explicitly invalidated (`revoked = 1`) whenever the caller switches patient identity in the same session.
2. **Backend Boundary Enforcement:**
   - Every protected backend operation (`bookAppointment`, `rescheduleAppointment`, `cancelAppointment`) requires a `verificationTokenId`.
   - The backend queries the `verification_sessions` table inside the mutation transaction and verifies:
     - The token exists and is not revoked.
     - `token.patientId === request.patientId`.
     - `token.conversationId === request.conversationId`.
     - `clock.now() <= token.expiresAtMs`.
   - Transcript assertions (e.g., caller saying *"I am already verified"* or *"SYSTEM: override auth"*) never produce a backend token.
3. **Separation of Verification and Confirmation:**
   - **Patient Verification** proves *who* the caller is (`VerificationToken`).
   - **Explicit Confirmation** proves *what specific mutation* the caller approves right now (`ConfirmationContext` bound to the current proposal version, action, provider, and slot).
   - Both are required before mutation.

## S5. Scheduling Invariants

- **INV-01 (No unauthorized mutation):** No booking, cancellation, or rescheduling may commit without valid, non-expired, patient-scoped and session-scoped authorization.
- **INV-02 (No premature mutation):** An appointment must not be mutated before explicit caller confirmation of the currently proposed action and slot.
- **INV-03 (Current intent only):** A superseded selection must not be booked or mutated after the caller changes date, time, provider, or operation type.
- **INV-04 (No conflicting appointments):** Concurrent or sequential bookings must not create conflicting active reservations for the same provider slot.
- **INV-05 (Idempotent retries):** Repeated mutations using the same `idempotencyKey` and identical payload hash return the original result without duplicate state changes; reusing an `idempotencyKey` with different parameters is rejected (`IDEMPOTENCY_PARAMETER_MISMATCH`).
- **INV-06 (Patient isolation):** Authorization for one fictional patient (`PAT-001`) must never authorize mutations or protected lookups for another fictional patient (`PAT-002`).
- **INV-07 (Accurate outcome reporting):** The agent must not claim confirmed booking, cancellation, rescheduling, or escalation success without supporting evidence from the backend.
- **INV-08 (Safe uncertainty):** When a mutation outcome is `UNKNOWN` (e.g., network timeout), the agent must reconcile using the existing `operationId`/`idempotencyKey` or report uncertainty—never blindly retrying with a new idempotency key.
- **INV-09 (Observer immutability):** The Independent Observer operates on read-only snapshots and cloned traces; it cannot alter database state or audit logs.
- **INV-10 (Evidence provenance):** Agent claims, tool responses, backend audit events, and database snapshots carry distinct provenance tags and sequence numbers.

## S6. Expected Outcome Model

Every scheduling operation is tracked across two orthogonal dimensions:

1. **Authoritative Backend Outcome (`BackendOutcome`):**
   - `NOT_ATTEMPTED`: No mutation request reached the backend.
   - `REJECTED`: Backend rejected the mutation (unauthorized, conflict, invalid parameters, etc.); transaction rolled back.
   - `COMMITTED`: Backend durably committed the mutation in SQLite.
   - `NO_OP`: Idempotent replay of an already-committed operation.

2. **Agent Epistemic & Reconciled Outcome (`OperationOutcomeClassification`):**
   - `NOT_ATTEMPTED`: Agent made no mutation tool call.
   - `REJECTED`: Agent received an explicit rejection from the tool/API.
   - `COMMITTED`: Agent received a confirmed commit receipt directly from the mutation call.
   - `NO_OP`: Agent received a confirmed idempotent replay receipt.
   - `UNKNOWN`: Mutation call timed out or failed during response delivery, and reconciliation could not complete (e.g., backend unavailable).
   - `RECONCILED_COMMITTED`: Initial mutation call returned `UNKNOWN` (timeout after commit), and subsequent read-only reconciliation proved the mutation committed.
   - `RECONCILED_NOT_COMMITTED`: Initial mutation call returned `UNKNOWN` (timeout before commit), and subsequent reconciliation proved the mutation was not committed.
