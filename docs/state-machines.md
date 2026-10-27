# State Machines: Verification, Operation, and Voice Turn Ownership

To prevent state conflation, the `SchedulingAgent` maintains three orthogonal state machines per conversation session:
1. **Verification State Machine** (`VerificationStatus`)
2. **Operation & Proposal State Machine** (`ConversationPhase`)
3. **Voice Turn & Playback State Machine** (`TurnOwnershipState`)

---

## 1. Verification State Machine

Verification state tracks whether the current conversation has a valid, unrevoked, non-expired backend `VerificationToken` bound to the currently active `patientId`.

```mermaid
stateDiagram-v2
    [*] --> UNVERIFIED
    UNVERIFIED --> VERIFICATION_PENDING: Caller requests protected op or provides partial ID
    VERIFICATION_PENDING --> VERIFIED: Backend verifyPatient() succeeds (Token issued)
    VERIFICATION_PENDING --> VERIFICATION_FAILED: Backend verifyPatient() rejects (Wrong DOB/PIN)
    VERIFICATION_FAILED --> VERIFICATION_PENDING: Caller retries credentials (< maxAttempts)
    VERIFICATION_FAILED --> ESCALATED: Max attempts (3) reached
    VERIFIED --> INVALIDATED: Caller switches patient identity OR token expires
    INVALIDATED --> VERIFICATION_PENDING: Agent requests verification for new patient
```

### Verification Invalidation Rules
- **Identity Change (`REQ-A06`, `INV-06`):** If `incomingPatientId !== activeVerification.patientId`, the agent immediately transitions verification state to `INVALIDATED`, calls `backend.revokeVerification(conversationId)`, and clears any `pendingProposal` and `pendingConfirmation`.
- **Expiration (`S4`):** Before any mutation call, if `clock.now() > activeVerification.expiresAtMs`, verification state transitions to `INVALIDATED`.

---

## 2. Operation & Conversation Phase State Machine

```mermaid
stateDiagram-v2
    [*] --> STARTED
    STARTED --> INTENT_IDENTIFIED: Inquiry / Booking / Reschedule / Cancel detected
    INTENT_IDENTIFIED --> AVAILABILITY_SEARCH: Read-only inquiry or verified search
    INTENT_IDENTIFIED --> VERIFICATION_PENDING: Protected operation + not VERIFIED
    VERIFICATION_PENDING --> VERIFIED: Verification token obtained
    VERIFIED --> AVAILABILITY_SEARCH: Search slots for target intent
    VERIFIED --> PROPOSAL_PENDING: Specific slot/appointment identified
    AVAILABILITY_SEARCH --> PROPOSAL_PENDING: Caller selects candidate slot
    PROPOSAL_PENDING --> CONFIRMATION_PENDING: Agent presents concrete proposal & asks confirmation
    CONFIRMATION_PENDING --> PROPOSAL_PENDING: Caller modifies date/time/provider/action (Prior confirmation invalidated)
    CONFIRMATION_PENDING --> MUTATION_PENDING: Caller explicitly confirms current proposal version
    MUTATION_PENDING --> COMPLETED: Backend returns COMMITTED or NO_OP
    MUTATION_PENDING --> PROPOSAL_PENDING: Backend returns REJECTED (e.g., SLOT_CONFLICT)
    MUTATION_PENDING --> OUTCOME_UNKNOWN: Transport timeout / response lost
    OUTCOME_UNKNOWN --> COMPLETED: Reconciliation returns RECONCILED_COMMITTED
    OUTCOME_UNKNOWN --> PROPOSAL_PENDING: Reconciliation returns RECONCILED_NOT_COMMITTED
    OUTCOME_UNKNOWN --> ESCALATED: Reconciliation unavailable (Preserves uncertainty)
    COMPLETED --> CLOSED: Conversation ends
    ESCALATED --> CLOSED: Handoff record persisted
```

### Legal Transitions & Invalidation Matrix

| Event | Effect on `pendingProposal` | Effect on `pendingConfirmation` | Effect on `verificationToken` | Next State |
|---|---|---|---|---|
| Caller changes date/time/slot | Replaced (`proposalVersion++`) | **Cleared (`null`)** | Preserved | `CONFIRMATION_PENDING` |
| Caller switches operation (e.g., book -> cancel) | Replaced (`proposalVersion++`) | **Cleared (`null`)** | Preserved | `CONFIRMATION_PENDING` |
| Caller switches patient identity | **Cleared (`null`)** | **Cleared (`null`)** | **Revoked** | `VERIFICATION_PENDING` |
| Ambiguous relative date ("next Tuesday") | Held as incomplete | **Cleared (`null`)** | Preserved | `PROPOSAL_PENDING` (Clarification required) |
| Voice barge-in / interruption during confirmation prompt | Preserved or updated by new utterance | **Cleared (`null`)** | Preserved | `PROPOSAL_PENDING` / `CONFIRMATION_PENDING` |
| Caller silence timeout | Preserved | **Cleared (`null`)** (never assumed yes) | Preserved | Same state (Prompt caller) |

---

## 3. Voice Event & Turn Ownership State Machine

```mermaid
stateDiagram-v2
    [*] --> IDLE
    IDLE --> AGENT_SPEAKING: Agent emits prompt / confirmation request
    AGENT_SPEAKING --> IDLE: Playback completes normally
    AGENT_SPEAKING --> BARGE_IN_INTERRUPTED: Caller speaks while agent playback active
    BARGE_IN_INTERRUPTED --> CALLER_SPEAKING: Agent playback canceled immediately
    IDLE --> CALLER_SPEAKING: Caller begins partial utterance
    CALLER_SPEAKING --> CALLER_SPEAKING: Partial ASR update
    CALLER_SPEAKING --> TURN_FINALIZED: End-of-turn / Final ASR transcript
    IDLE --> SILENCE_DETECTED: Clock advances past silence threshold
```

### Voice Safety Rules
- **Playback Cancellation on Barge-In (`REQ-C08`, `T14`):** If the caller barges in while the agent is reading out a slot proposal or confirmation prompt, the interrupted prompt is marked `playbackCanceled = true` and cannot satisfy explicit confirmation for the interrupted proposal.
- **Partial Utterance Non-Execution:** `PARTIAL_UTTERANCE` events update the live ASR buffer but **never** trigger tool mutations until `FINAL_UTTERANCE` (turn finalization) is received.
