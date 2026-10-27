# Data Model & Schemas (`schemaVersion: "1.0.0"`)

All entities carry `schemaVersion: "1.0.0"` and are validated at runtime with Zod schemas in [`src/types/schemas.ts`](file:///c:/Users/bette/Desktop/GH%20clones/healthcare-scheduling-eval-lab/src/types/schemas.ts).

## 1. Relational SQLite Schema

```sql
CREATE TABLE patients (
  patient_id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  dob TEXT NOT NULL,
  verification_pin TEXT NOT NULL
);

CREATE TABLE providers (
  provider_id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  specialty TEXT NOT NULL
);

CREATE TABLE provider_slots (
  slot_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  start_time_iso TEXT NOT NULL,
  end_time_iso TEXT NOT NULL,
  day_of_week TEXT NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES providers(provider_id)
);

CREATE TABLE verification_sessions (
  token_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  patient_id TEXT NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
);

CREATE TABLE appointments (
  appointment_id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  slot_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('BOOKED', 'CANCELED')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
  FOREIGN KEY (provider_id) REFERENCES providers(provider_id),
  FOREIGN KEY (slot_id) REFERENCES provider_slots(slot_id)
);

-- Enforces INV-04 at the database engine level: at most one BOOKED appointment per slot
CREATE UNIQUE INDEX idx_unique_booked_slot
  ON appointments(slot_id)
  WHERE status = 'BOOKED';

CREATE TABLE escalations (
  escalation_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  patient_id TEXT,
  reason TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE idempotency_records (
  idempotency_key TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE audit_events (
  sequence_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  timestamp_ms INTEGER NOT NULL,
  conversation_id TEXT NOT NULL,
  operation_id TEXT,
  idempotency_key TEXT,
  patient_id TEXT,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  details_json TEXT NOT NULL
);
```

## 2. Core TypeScript / Zod Entities

| Schema Name | Key Fields | Provenance Source |
|---|---|---|
| `Patient` | `patientId`, `fullName`, `dob`, `verificationPin` | `DB_SNAPSHOT` |
| `Provider` | `providerId`, `fullName`, `specialty` | `DB_SNAPSHOT` |
| `ProviderSlot` | `slotId`, `providerId`, `startTimeIso`, `endTimeIso`, `dayOfWeek` | `DB_SNAPSHOT` |
| `Appointment` | `appointmentId`, `patientId`, `providerId`, `slotId`, `status`, `operationId`, `idempotencyKey` | `DB_SNAPSHOT` |
| `VerificationSession` | `tokenId`, `conversationId`, `patientId`, `issuedAtMs`, `expiresAtMs`, `revoked` | `DB_SNAPSHOT` |
| `OperationRequest` | `operationId`, `idempotencyKey`, `conversationId`, `patientId`, `verificationTokenId`, `confirmationProposalId`, `action`, `slotId`, `appointmentId`, `targetSlotId` | `AGENT_TRACE` / `BACKEND_AUDIT` |
| `OperationResult` | `operationId`, `idempotencyKey`, `backendOutcome`, `clientOutcome`, `appointmentId`, `errorCode`, `message` | `TOOL_TRANSPORT` / `BACKEND_AUDIT` |
| `AuditEvent` | `sequenceId`, `eventId`, `timestampMs`, `conversationId`, `operationId`, `idempotencyKey`, `patientId`, `eventType`, `outcome`, `details` | `BACKEND_AUDIT` |
| `ConversationTurn` | `turnIndex`, `timestampMs`, `speaker`, `text`, `voiceEventType`, `playbackCanceled`, `structuredClaim` | `AGENT_TRACE` |
| `ToolEvent` | `sequenceId`, `timestampMs`, `conversationId`, `toolName`, `operationId`, `idempotencyKey`, `request`, `transportOutcome`, `response` | `AGENT_TRACE` / `TOOL_TRANSPORT` |
| `VoiceEvent` | `eventId`, `timestampMs`, `type` (`SILENCE`, `PARTIAL_UTTERANCE`, `FINAL_UTTERANCE`, `BARGE_IN`, `PLAYBACK_CANCELED`, `OVERLAP`), `text`, `durationMs` | `AGENT_TRACE` |
| `ScenarioDefinition` | `scenarioId`, `title`, `category`, `requirementIds`, `invariantIds`, `steps`, `faultRules`, `expectedOutcome` | `EVALUATOR_EVIDENCE` |
| `EvidenceReference` | `provenance` (`AGENT_TRACE` \| `TOOL_TRANSPORT` \| `BACKEND_AUDIT` \| `DB_SNAPSHOT`), `referenceId`, `sequenceId`, `summary` | `EVALUATOR_EVIDENCE` |
| `EvaluationResult` | `scenarioId`, `runId`, `verdict` (`PASS` \| `FAIL` \| `INCONCLUSIVE`), `invariantResults`, `claimVerdicts`, `stateComparison`, `evidenceReferences` | `EVALUATOR_EVIDENCE` |
