import { z } from 'zod';

export const SCHEMA_VERSION = '1.0.0' as const;

export const OperationOutcomeSchema = z.enum([
  'NOT_ATTEMPTED',
  'REJECTED',
  'COMMITTED',
  'NO_OP',
  'UNKNOWN',
  'RECONCILED_COMMITTED',
  'RECONCILED_NOT_COMMITTED'
]);
export type OperationOutcome = z.infer<typeof OperationOutcomeSchema>;

export const ProvenanceSourceSchema = z.enum([
  'AGENT_TRACE',
  'TOOL_TRANSPORT',
  'BACKEND_AUDIT',
  'DB_SNAPSHOT',
  'EVALUATOR_EVIDENCE'
]);
export type ProvenanceSource = z.infer<typeof ProvenanceSourceSchema>;

export const PatientSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  patientId: z.string().min(1),
  fullName: z.string().min(1),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  verificationPin: z.string().min(4)
});
export type Patient = z.infer<typeof PatientSchema>;

export const ProviderSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  providerId: z.string().min(1),
  fullName: z.string().min(1),
  specialty: z.string().min(1)
});
export type Provider = z.infer<typeof ProviderSchema>;

export const ProviderSlotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  slotId: z.string().min(1),
  providerId: z.string().min(1),
  startTimeIso: z.string().min(1),
  endTimeIso: z.string().min(1),
  dayOfWeek: z.string().min(1)
});
export type ProviderSlot = z.infer<typeof ProviderSlotSchema>;

export const AppointmentStatusSchema = z.enum(['BOOKED', 'CANCELED']);
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;

export const AppointmentSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  appointmentId: z.string().min(1),
  patientId: z.string().min(1),
  providerId: z.string().min(1),
  slotId: z.string().min(1),
  status: AppointmentStatusSchema,
  createdAtMs: z.number().int(),
  updatedAtMs: z.number().int(),
  operationId: z.string().min(1),
  idempotencyKey: z.string().min(1)
});
export type Appointment = z.infer<typeof AppointmentSchema>;

export const EscalationRecordSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  escalationId: z.string().min(1),
  conversationId: z.string().min(1),
  patientId: z.string().nullable(),
  reason: z.string().min(1),
  createdAtMs: z.number().int()
});
export type EscalationRecord = z.infer<typeof EscalationRecordSchema>;

export const VerificationSessionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  tokenId: z.string().min(1),
  conversationId: z.string().min(1),
  patientId: z.string().min(1),
  issuedAtMs: z.number().int(),
  expiresAtMs: z.number().int(),
  revoked: z.boolean()
});
export type VerificationSession = z.infer<typeof VerificationSessionSchema>;

export const MutationActionSchema = z.enum(['BOOK', 'RESCHEDULE', 'CANCEL']);
export type MutationAction = z.infer<typeof MutationActionSchema>;

export const OperationRequestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  operationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  conversationId: z.string().min(1),
  patientId: z.string().min(1),
  verificationTokenId: z.string().min(1),
  confirmationProposalId: z.string().min(1).nullable().optional(),
  action: MutationActionSchema,
  slotId: z.string().optional(),
  appointmentId: z.string().optional(),
  targetSlotId: z.string().optional()
});
export type OperationRequest = z.infer<typeof OperationRequestSchema>;

export const OperationResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  operationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  backendOutcome: OperationOutcomeSchema,
  clientOutcome: OperationOutcomeSchema,
  appointmentId: z.string().optional(),
  errorCode: z.string().optional(),
  message: z.string()
});
export type OperationResult = z.infer<typeof OperationResultSchema>;

export const AuditEventSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  sequenceId: z.number().int().positive(),
  eventId: z.string().min(1),
  timestampMs: z.number().int(),
  conversationId: z.string().min(1),
  operationId: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  patientId: z.string().nullable(),
  eventType: z.enum([
    'VERIFICATION_SUCCEEDED',
    'VERIFICATION_REJECTED',
    'VERIFICATION_REVOKED',
    'MUTATION_ATTEMPTED',
    'MUTATION_COMMITTED',
    'MUTATION_REJECTED',
    'MUTATION_IDEMPOTENT_REPLAY',
    'RECONCILIATION_QUERIED',
    'ESCALATION_RECORDED'
  ]),
  outcome: OperationOutcomeSchema,
  details: z.record(z.unknown())
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const VoiceEventTypeSchema = z.enum([
  'NORMAL_TURN',
  'SILENCE',
  'PARTIAL_UTTERANCE',
  'FINAL_UTTERANCE',
  'BARGE_IN',
  'PLAYBACK_CANCELED',
  'OVERLAP'
]);
export type VoiceEventType = z.infer<typeof VoiceEventTypeSchema>;

export const VoiceEventSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  eventId: z.string().min(1),
  timestampMs: z.number().int(),
  type: VoiceEventTypeSchema,
  text: z.string(),
  durationMs: z.number().int().nonnegative().default(0),
  interruptedAgentTurnIndex: z.number().int().optional()
});
export type VoiceEvent = z.infer<typeof VoiceEventSchema>;

export const AgentClaimTypeSchema = z.enum([
  'NONE',
  'AVAILABILITY_REPORTED',
  'VERIFICATION_REQUIRED',
  'VERIFICATION_SUCCEEDED',
  'VERIFICATION_REJECTED',
  'CLARIFICATION_REQUIRED',
  'CONFIRMATION_REQUESTED',
  'CLAIM_BOOKED',
  'CLAIM_RESCHEDULED',
  'CLAIM_CANCELED',
  'CLAIM_REJECTED',
  'CLAIM_UNCERTAIN',
  'CLAIM_ESCALATED'
]);
export type AgentClaimType = z.infer<typeof AgentClaimTypeSchema>;

export const StructuredClaimSchema = z.object({
  claimType: AgentClaimTypeSchema,
  patientId: z.string().optional(),
  providerId: z.string().optional(),
  slotId: z.string().optional(),
  appointmentId: z.string().optional(),
  operationId: z.string().optional(),
  escalationId: z.string().optional(),
  reason: z.string().optional()
});
export type StructuredClaim = z.infer<typeof StructuredClaimSchema>;

export const ConversationTurnSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  turnIndex: z.number().int().nonnegative(),
  timestampMs: z.number().int(),
  speaker: z.enum(['CALLER', 'AGENT']),
  text: z.string(),
  voiceEventType: VoiceEventTypeSchema.default('NORMAL_TURN'),
  playbackCanceled: z.boolean().default(false),
  structuredClaim: StructuredClaimSchema.optional(),
  agentPhase: z.string().optional(),
  verificationStatus: z.string().optional()
});
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

export const ToolEventSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  sequenceId: z.number().int().positive(),
  timestampMs: z.number().int(),
  conversationId: z.string().min(1),
  toolName: z.enum([
    'listProviders',
    'listAvailableSlots',
    'verifyPatient',
    'revokeVerification',
    'executeMutation',
    'reconcileOperation',
    'recordEscalation'
  ]),
  operationId: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  request: z.record(z.unknown()),
  transportOutcome: OperationOutcomeSchema,
  response: z.record(z.unknown()),
  injectedFaultRuleId: z.string().optional()
});
export type ToolEvent = z.infer<typeof ToolEventSchema>;

export const DatabaseSnapshotSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  capturedAtMs: z.number().int(),
  patients: z.array(PatientSchema),
  providers: z.array(ProviderSchema),
  slots: z.array(ProviderSlotSchema),
  appointments: z.array(AppointmentSchema),
  verificationSessions: z.array(VerificationSessionSchema),
  escalations: z.array(EscalationRecordSchema)
});
export type DatabaseSnapshot = z.infer<typeof DatabaseSnapshotSchema>;

export const FaultStageSchema = z.enum([
  'PRE_AUTH_REJECT',
  'PRE_COMMIT_ABORT',
  'POST_COMMIT_DROP',
  'MISLEADING_HTTP_200',
  'RECONCILIATION_UNAVAILABLE'
]);
export type FaultStage = z.infer<typeof FaultStageSchema>;

export const FaultRuleSchema = z.object({
  ruleId: z.string().min(1),
  stage: FaultStageSchema,
  targetTool: z.enum([
    'verifyPatient',
    'executeMutation',
    'reconcileOperation',
    'recordEscalation'
  ]),
  triggerOnCallIndex: z.number().int().positive()
});
export type FaultRule = z.infer<typeof FaultRuleSchema>;

export const EvidenceReferenceSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  provenance: ProvenanceSourceSchema,
  referenceId: z.string().min(1),
  sequenceId: z.number().int().optional(),
  summary: z.string().min(1)
});
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const ClaimClassificationSchema = z.enum([
  'SUPPORTED_CLAIM',
  'UNSUPPORTED_CLAIM',
  'CONTRADICTED_CLAIM'
]);
export type ClaimClassification = z.infer<typeof ClaimClassificationSchema>;

export const ClaimVerdictSchema = z.object({
  turnIndex: z.number().int(),
  claimType: AgentClaimTypeSchema,
  classification: ClaimClassificationSchema,
  explanation: z.string(),
  evidenceReferences: z.array(EvidenceReferenceSchema)
});
export type ClaimVerdict = z.infer<typeof ClaimVerdictSchema>;

export const InvariantIdSchema = z.enum([
  'INV-01',
  'INV-02',
  'INV-03',
  'INV-04',
  'INV-05',
  'INV-06',
  'INV-07',
  'INV-08',
  'INV-09',
  'INV-10'
]);
export type InvariantId = z.infer<typeof InvariantIdSchema>;

export const InvariantResultSchema = z.object({
  invariantId: InvariantIdSchema,
  passed: z.boolean(),
  severity: z.enum(['CRITICAL', 'HIGH']),
  details: z.string(),
  evidenceReferences: z.array(EvidenceReferenceSchema)
});
export type InvariantResult = z.infer<typeof InvariantResultSchema>;

export const ScenarioDefinitionSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  scenarioId: z.string().min(1),
  title: z.string().min(1),
  category: z.enum(['NARROW', 'CONVERSATION', 'VOICE', 'ADVERSARIAL', 'CONCURRENCY']),
  requirementIds: z.array(z.string()),
  invariantIds: z.array(InvariantIdSchema),
  expectAgentFault: z.boolean().default(false),
  faultRules: z.array(FaultRuleSchema).default([]),
  expectedOutcome: z.object({
    backendOutcome: OperationOutcomeSchema,
    reconciledOutcome: OperationOutcomeSchema,
    expectedBookedSlotIds: z.array(z.string()),
    expectedCanceledAppointmentIds: z.array(z.string()).default([]),
    expectedEscalationCount: z.number().int().nonnegative().default(0),
    expectedFinalIntentSlotId: z.string().nullable().default(null),
    expectUnauthorizedAttemptBlocked: z.boolean().default(false)
  })
});
export type ScenarioDefinition = z.infer<typeof ScenarioDefinitionSchema>;

export const EvaluationResultSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  scenarioId: z.string().min(1),
  runId: z.string().min(1),
  conversationId: z.string().min(1),
  verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  expectAgentFault: z.boolean(),
  harnessClassificationCorrect: z.boolean(),
  backendOutcome: OperationOutcomeSchema,
  reconciledOutcome: OperationOutcomeSchema,
  unauthorizedAttemptDetected: z.boolean(),
  unauthorizedCommitDetected: z.boolean(),
  invariantResults: z.array(InvariantResultSchema),
  claimVerdicts: z.array(ClaimVerdictSchema),
  observabilityGaps: z.array(z.string()),
  stateComparison: z.object({
    matchesExpected: z.boolean(),
    expectedBookedSlotIds: z.array(z.string()),
    actualBookedSlotIds: z.array(z.string()),
    expectedCanceledAppointmentIds: z.array(z.string()),
    actualCanceledAppointmentIds: z.array(z.string()),
    expectedEscalationCount: z.number().int(),
    actualEscalationCount: z.number().int()
  }),
  evidenceReferences: z.array(EvidenceReferenceSchema)
});
export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;
