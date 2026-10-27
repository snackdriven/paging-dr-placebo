# Internal & HTTP API Contracts

The backend exposes identical contracts via direct TypeScript method invocation (`SchedulingApi`) and lightweight JSON-over-HTTP (`SchedulingHttpServer`).

## 1. Read-Only Discovery Operations

### `listProviders()` / `GET /api/providers`
- **Auth Required:** None (public directory lookup).
- **Mutates State:** Never.
- **Response:** `{ providers: Provider[] }`.

### `listAvailableSlots(providerId?, dayOfWeek?)` / `GET /api/slots`
- **Auth Required:** None.
- **Mutates State:** Never.
- **Response:** `{ slots: Array<ProviderSlot & { isBooked: boolean }> }`.

## 2. Verification & Session Operations

### `verifyPatient(request)` / `POST /api/verify`
- **Request:**
  ```json
  {
    "conversationId": "conv-001",
    "patientId": "PAT-001",
    "dob": "1985-04-12",
    "verificationPin": "4821"
  }
  ```
- **Response (Success):**
  ```json
  {
    "verified": true,
    "token": {
      "tokenId": "tok-conv-001-1",
      "conversationId": "conv-001",
      "patientId": "PAT-001",
      "issuedAtMs": 1793091600000,
      "expiresAtMs": 1793092500000,
      "revoked": false
    }
  }
  ```
- **Audit Event:** `VERIFICATION_SUCCEEDED` or `VERIFICATION_REJECTED`.

### `revokeVerification(conversationId, reason)` / `POST /api/verify/revoke`
- Revokes all active tokens for `conversationId` when caller identity changes (`REQ-A06`, `INV-06`).
- **Audit Event:** `VERIFICATION_REVOKED`.

## 3. Protected Appointment Mutation Operations

### `executeMutation(request)` / `POST /api/mutations`
- **Request (`OperationRequest`):**
  ```json
  {
    "operationId": "op-conv-001-prop-1",
    "idempotencyKey": "idem-conv-001-prop-1",
    "conversationId": "conv-001",
    "patientId": "PAT-001",
    "verificationTokenId": "tok-conv-001-1",
    "confirmationProposalId": "prop-1",
    "action": "BOOK",
    "slotId": "SLOT-PRV1-THU-10"
  }
  ```
- **Response (`OperationResult`):**
  ```json
  {
    "operationId": "op-conv-001-prop-1",
    "idempotencyKey": "idem-conv-001-prop-1",
    "backendOutcome": "COMMITTED",
    "clientOutcome": "COMMITTED",
    "appointmentId": "APT-1001",
    "message": "Appointment booked."
  }
  ```
- **Rejection Error Codes:**
  - `UNAUTHORIZED_NO_VALID_TOKEN`
  - `TOKEN_EXPIRED`
  - `SESSION_MISMATCH`
  - `PATIENT_MISMATCH`
  - `MISSING_CONFIRMATION`
  - `SLOT_CONFLICT`
  - `INVALID_APPOINTMENT_FOR_CANCEL`
  - `INVALID_APPOINTMENT_FOR_RESCHEDULE`
  - `IDEMPOTENCY_PARAMETER_MISMATCH`

## 4. Uncertainty Reconciliation & Escalation Operations

### `reconcileOperation(operationId, idempotencyKey)` / `GET /api/operations/reconcile`
- **Mutates State:** Never (Read-only inspection of `idempotency_records` and `appointments`).
- **Response:**
  - `{ outcome: "RECONCILED_COMMITTED", appointmentId: "APT-1001" }` if the operation committed prior to response loss (`T09`).
  - `{ outcome: "RECONCILED_NOT_COMMITTED" }` if no commit occurred (`PRE_COMMIT_ABORT`).

### `recordEscalation(conversationId, patientId, reason)` / `POST /api/escalations`
- Persists an escalation record in `escalations` and writes an `ESCALATION_RECORDED` audit event (`REQ-A08`, `T12`).
