# Paging Dr. Placebo — Small Persuasive Scheduling Agent & Observer Demo

> **Branch:** `persuasive-demo` (Focused, zero-bloat demonstration of a synthetic healthcare scheduling agent, an independent observer, a 3-tier evaluation taxonomy, and a complete end-to-end defect lifecycle. See `main` for the full 21-scenario SPARC laboratory and [live interactive playground](https://snackdriven.github.io/paging-dr-placebo/).)

---

## 1. Why This Exists (Not a Giant Agent Framework)

When evaluating a voice or chat scheduling agent, **what the agent tells the patient** is only a hypothesis. The actual truth lives in the appointment database, the API mutation log, and the final call disposition state.

This demonstration is intentionally small (four readable TypeScript files under [`src/demo/`](src/demo/)):

1. **[`src/demo/appointment-api.ts`](src/demo/appointment-api.ts) — Synthetic Appointment API:**
   - Verifies patient identity (DOB + 4-digit PIN), lists open slots, commits bookings with optional `idempotencyKey` protection, records human escalation tickets, and injects realistic API errors (`API_HTTP_500`, `API_TIMEOUT_FIRST_CALL`, `SLOT_TAKEN`).
2. **[`src/demo/scheduling-agent.ts`](src/demo/scheduling-agent.ts) — Synthetic Scheduling Agent:**
   - **Straightforward booking:** Verifies caller identity, proposes the requested slot, waits for explicit confirmation, commits the booking, and sets disposition to `BOOKED`.
   - **Conversational variations:** Handles casual phrasing (*"Can we do Tuesday afternoon?"*), mid-call slot switches (*"Wait, scratch Tuesday — can we do Wednesday at 11am instead?"*), open-availability inquiries (*"What openings does Dr. Zoidberg have?"*), and varied confirmation phrasing (*"Yep, lock that in please"*).
   - **Fails safely on API errors:** When the Appointment API returns `HTTP_500_ERROR`, the agent never claims the appointment was saved; instead it opens an escalation ticket (`ESC-xxx`), sets disposition to `FAILED_SAFE_ESCALATED`, and gives the caller a clear recovery path.
3. **[`src/demo/observer.ts`](src/demo/observer.ts) — Independent Observer:**
   - Evaluates completed calls by joining the **conversation transcript**, **final call disposition**, and **authoritative API/DB snapshot** to flag:
     - **`FALSE_CONFIRMATION`** — Agent tells the caller they are booked when `0` matching appointments were committed in the backend.
     - **`DUPLICATE_ACTION`** — Agent invokes `BOOK_APPOINTMENT` multiple times without a shared `idempotencyKey` (or commits duplicate records).
     - **`INCORRECT_DISPOSITION_STATE`** — Final call disposition (`BOOKED`, `FAILED_SAFE_ESCALATED`, `INQUIRY_ONLY`, etc.) contradicts the database or escalation records.
4. **[`src/demo/run-defect-lifecycle.ts`](src/demo/run-defect-lifecycle.ts) & [`tests/demo/defect-lifecycle.test.ts`](tests/demo/defect-lifecycle.test.ts) — Runnable Defect Lifecycle (`DEFECT-042`):**
   - Reproduces a realistic production bug from discovery through root-cause analysis, code fix, regression test, and verified resolution.

---

## 2. Quick Start (Run in 10 Seconds)

```bash
npm install

# Run the interactive CLI walkthrough (capabilities + full 5-stage defect lifecycle)
npm run demo:lifecycle

# Run the Vitest regression suite for the demo agent & observer
npm run test:demo
```

---

## 3. Evaluation Taxonomy: Deterministic Checks vs. AI Judgment vs. Reviewing Recordings

A trustworthy QA strategy separates checks by **epistemic authority** — never using an LLM judge where a deterministic database join gives a 100% exact answer, and never assuming text transcripts capture acoustic telephony timing.

| Evaluation Tier | What Belongs Here | Concrete Checks in This Project | Why This Tier Is Required |
| :--- | :--- | :--- | :--- |
| **1. Deterministic Checks**<br>*(Automated CI gate on every commit)* | State invariants, database commits, tool-call idempotency, auth gating, and disposition accuracy. | - **`FALSE_CONFIRMATION`:** Join `turn.claimedBooked` against `apiSnapshot.appointments`.<br>- **`DUPLICATE_ACTION`:** Audit `apiSnapshot.callLog` for repeated `BOOK_APPOINTMENT` calls lacking a shared `idempotencyKey`.<br>- **`INCORRECT_DISPOSITION_STATE`:** Verify `finalDisposition === 'BOOKED'` iff an appointment committed, and `FAILED_SAFE_ESCALATED` iff an escalation ticket exists.<br>- **Identity Gate:** Verify `verifyPatient()` succeeded before any booking call. | Binary, reproducible, zero-hallucination truth. Either the row exists in the database with a matching idempotency key and disposition, or it does not. |
| **2. AI Judgment**<br>*(LLM-as-a-Judge / Semantic Rubrics)* | Open-ended conversational quality, tone, empathy during outages, and subtle implied promises in free-form prose. | - **`EMPATHY_ON_API_ERROR`:** Did the agent apologize clearly without blaming the patient or exposing raw stack traces when `HTTP_500_ERROR` occurred?<br>- **`CLARITY_OF_NEXT_STEPS`:** Did the agent give the caller a concrete confirmation number (`APT-xxx`), escalation ticket (`ESC-xxx`), or clear follow-up question?<br>- **Semantic Paraphrase Detection:** Catching soft implied confirmations (*"We'll see you Thursday!"*) that evade strict keyword regexes. | Free-form natural language has phrasing variation that rigid regexes under-fit; rubric-guided LLM judges grade tone and semantic intent across open-ended phrasing. |
| **3. Reviewing Recordings**<br>*(Human Acoustic & Telephony Audit)* | Real-time audio prosody, barge-in cut-off latency, STT noise robustness, and emotional handoff quality. | - **Barge-In Cut-Off Timing:** When a caller interrupts (*"Hold on, wait!"*), does TTS playback stop within `< 250ms` without speaking over the patient?<br>- **TTS Prosody on Alphanumeric IDs:** Does the voice read `APT-101` and dates at a natural pace a patient can write down?<br>- **STT Accuracy Under Noise:** Do background noise or accents cause 4-digit PINs (`4821`) or birthdates to mis-transcribe? | Text transcripts flatten time and strip audio. Only real call recordings reveal acoustic overlap, awkward dead-air pauses, and robotic TTS cadence. |

---

## 4. Complete Defect Lifecycle Walkthrough (`DEFECT-042`)

You can execute this entire lifecycle live with `npm run demo:lifecycle`.

### Stage 1: Failure Discovered
During fault-injection testing against an Appointment API outage (`API_HTTP_500`), the unpatched agent (`simulateDefect042: true`) produced the following failure trace:

- **Caller:** `"I am PAT-001, DOB 1985-04-12, PIN 4821. Book Thursday at 10am."` -> `"Yes, confirm."`
- **Agent Utterance:** `"You are all set! I have confirmed and booked SLOT-THU-10 for PAT-001."`
- **Agent Disposition:** `BOOKED`
- **Actual Database State:** `0` committed appointments (`2` failed `BOOK_APPOINTMENT` calls in `callLog`).
- **Observer Verdict (`FAIL` — 3 Critical Flags Raised):**
  1. `[FLAGGED] FALSE_CONFIRMATION (CRITICAL):` Turn #4 claimed booking succeeded, but `0` matching appointments exist in the Appointment API.
  2. `[FLAGGED] DUPLICATE_ACTION (CRITICAL):` Agent invoked `BOOK_APPOINTMENT` 2 times without a consistent `idempotencyKey` (`keys: [null, null]`).
  3. `[FLAGGED] INCORRECT_DISPOSITION_STATE (CRITICAL):` Final disposition is `'BOOKED'`, but the database contains `0` committed appointments.

### Stage 2: Root Cause Identified
Inspecting [`DemoSchedulingAgent.handleCallerUtterance()`](src/demo/scheduling-agent.ts#L162-L185) revealed three root causes in the booking handler:
1. **Unkeyed Retry:** On `!res.ok`, the agent immediately retried `this.api.bookAppointment({ ..., idempotencyKey: null })`. Under a post-write timeout (`API_TIMEOUT_FIRST_CALL`), this creates a duplicate booking; under `API_HTTP_500`, it hammers the failing endpoint without idempotency protection.
2. **Optimistic Confirmation:** The agent returned the confirmation string `"You are all set! I have confirmed and booked..."` unconditionally after the retry block without checking `if (res.ok)`.
3. **Hardcoded Disposition:** `this.disposition = 'BOOKED'` was set unconditionally instead of branching on the authoritative API response.

### Stage 3: Fix Applied
In [`src/demo/scheduling-agent.ts`](src/demo/scheduling-agent.ts#L187-L234):
1. Generated a deterministic, proposal-scoped key (`idem-${conversationId}-${patientId}-${slotId}-v${proposalVersion}`) and passed it on both the initial attempt and any `TIMEOUT_ERROR` retry.
2. Gated `this.disposition = 'BOOKED'` and `claimedBooked = true` strictly on `res.ok && (res.status === 'COMMITTED' || res.status === 'IDEMPOTENT_REPLAY')`.
3. Added a safe fallback for `HTTP_500_ERROR` that calls `this.api.recordEscalation(...)`, sets `this.disposition = 'FAILED_SAFE_ESCALATED'`, and transparently informs the caller with their escalation ticket ID (`ESC-201`).

### Stage 4: Regression Added
Added automated tests in [`tests/demo/defect-lifecycle.test.ts`](tests/demo/defect-lifecycle.test.ts):
- **Test #4 (`DEFECT-042 Discovery`):** Verifies the `DemoObserver` deterministically flags `FALSE_CONFIRMATION`, `DUPLICATE_ACTION`, and `INCORRECT_DISPOSITION_STATE` when `simulateDefect042: true`.
- **Test #3 & Test #5 (`DEFECT-042 Regression`):** Verifies the patched agent (`simulateDefect042: false`) fails safely with `FAILED_SAFE_ESCALATED` on `API_HTTP_500` and retries idempotently (`1` committed appointment, shared `idempotencyKey`, `0` observer flags) on `API_TIMEOUT_FIRST_CALL`.

### Stage 5: Outcome Verified
Running `npm run demo:lifecycle` and `npm run test:demo` confirms the fix across both failure modes:

```text
--- STAGE 3 & 5: FIX APPLIED & OUTCOME VERIFIED (simulateDefect042 = false) ---
[Fixed under HTTP 500]
  Agent Utterance  : "I apologize, our scheduling system encountered a technical error (HTTP_500_ERROR) so I could not save your booking for SLOT-THU-10. I have opened front-desk escalation ticket ESC-201 so a coordinator can complete your booking right away."
  Agent Disposition: FAILED_SAFE_ESCALATED
  Observer Verdict : PASS (0 flags)

[Fixed under Transient Timeout]
  Agent Utterance  : "Confirmed! Your appointment (APT-101) for SLOT-THU-10 is booked."
  API Calls Made   : 2 (shared key: idem-conv-fixed-timeout-PAT-001-SLOT-THU-10-v1)
  DB Appointments  : 1 (zero duplicates)
  Observer Verdict : PASS (0 flags)
```
