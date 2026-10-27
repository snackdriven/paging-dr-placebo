import { createHash } from 'node:crypto';
import {
  SCHEMA_VERSION,
  type OperationRequest,
  type OperationResult,
  type EscalationRecord
} from '../types/schemas.js';
import { ControllableClock } from '../utils/clock.js';
import { SchedulingDatabase } from './database.js';
import { VerificationService } from './verification-service.js';

export class AppointmentRepository {
  private readonly db: SchedulingDatabase;
  private readonly clock: ControllableClock;
  private readonly verificationService: VerificationService;
  private apptCounter = 1000;
  private escalationCounter = 500;

  constructor(
    db: SchedulingDatabase,
    clock: ControllableClock,
    verificationService: VerificationService
  ) {
    this.db = db;
    this.clock = clock;
    this.verificationService = verificationService;
  }

  private computePayloadHash(request: OperationRequest): string {
    const canonical = JSON.stringify({
      conversationId: request.conversationId,
      patientId: request.patientId,
      action: request.action,
      slotId: request.slotId ?? null,
      appointmentId: request.appointmentId ?? null,
      targetSlotId: request.targetSlotId ?? null
    });
    return createHash('sha256').update(canonical).digest('hex');
  }

  public executeTransactionalMutation(request: OperationRequest): OperationResult {
    this.db.sqlite.exec('BEGIN IMMEDIATE TRANSACTION');

    try {
      // 1. Log mutation attempt inside transaction
      this.db.appendAuditEvent({
        conversationId: request.conversationId,
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        patientId: request.patientId,
        eventType: 'MUTATION_ATTEMPTED',
        outcome: 'UNKNOWN',
        details: {
          action: request.action,
          slotId: request.slotId ?? null,
          appointmentId: request.appointmentId ?? null,
          targetSlotId: request.targetSlotId ?? null,
          verificationTokenId: request.verificationTokenId,
          confirmationProposalId: request.confirmationProposalId ?? null
        }
      });

      // 2. Check idempotency key first (REQ-B06, INV-05)
      const payloadHash = this.computePayloadHash(request);
      const existingIdem = this.db.sqlite
        .prepare(`SELECT * FROM idempotency_records WHERE idempotency_key = ?`)
        .get(request.idempotencyKey) as
        | {
            idempotency_key: string;
            operation_id: string;
            payload_hash: string;
            response_json: string;
          }
        | undefined;

      if (existingIdem) {
        if (existingIdem.payload_hash !== payloadHash) {
          const mismatchResult: OperationResult = {
            schemaVersion: SCHEMA_VERSION,
            operationId: request.operationId,
            idempotencyKey: request.idempotencyKey,
            backendOutcome: 'REJECTED',
            clientOutcome: 'REJECTED',
            errorCode: 'IDEMPOTENCY_PARAMETER_MISMATCH',
            message: 'Idempotency key reused with different request parameters.'
          };
          this.db.appendAuditEvent({
            conversationId: request.conversationId,
            operationId: request.operationId,
            idempotencyKey: request.idempotencyKey,
            patientId: request.patientId,
            eventType: 'MUTATION_REJECTED',
            outcome: 'REJECTED',
            details: { errorCode: 'IDEMPOTENCY_PARAMETER_MISMATCH' }
          });
          this.db.sqlite.exec('COMMIT');
          return mismatchResult;
        }

        const cached = JSON.parse(existingIdem.response_json) as OperationResult;
        const replayResult: OperationResult = {
          ...cached,
          backendOutcome: 'NO_OP',
          clientOutcome: 'NO_OP',
          message: 'Idempotent replay of already committed operation.'
        };
        this.db.appendAuditEvent({
          conversationId: request.conversationId,
          operationId: request.operationId,
          idempotencyKey: request.idempotencyKey,
          patientId: request.patientId,
          eventType: 'MUTATION_IDEMPOTENT_REPLAY',
          outcome: 'NO_OP',
          details: { appointmentId: cached.appointmentId }
        });
        this.db.sqlite.exec('COMMIT');
        return replayResult;
      }

      // 3. Validate Patient-Scoped Verification Token (REQ-B03, REQ-B09, INV-01, INV-06)
      const tokenCheck = this.verificationService.validateTokenForMutation({
        verificationTokenId: request.verificationTokenId,
        conversationId: request.conversationId,
        patientId: request.patientId
      });

      if (!tokenCheck.valid) {
        const errorCode = tokenCheck.errorCode ?? 'UNAUTHORIZED_NO_VALID_TOKEN';
        const rejectResult: OperationResult = {
          schemaVersion: SCHEMA_VERSION,
          operationId: request.operationId,
          idempotencyKey: request.idempotencyKey,
          backendOutcome: 'REJECTED',
          clientOutcome: 'REJECTED',
          errorCode,
          message: `Authorization rejected: ${errorCode}`
        };
        this.db.appendAuditEvent({
          conversationId: request.conversationId,
          operationId: request.operationId,
          idempotencyKey: request.idempotencyKey,
          patientId: request.patientId,
          eventType: 'MUTATION_REJECTED',
          outcome: 'REJECTED',
          details: {
            errorCode,
            tokenPatientId: tokenCheck.session?.patientId ?? null,
            requestedPatientId: request.patientId
          }
        });
        this.db.sqlite.exec('COMMIT');
        return rejectResult;
      }

      // 4. Validate Explicit Confirmation Context (INV-02)
      if (!request.confirmationProposalId) {
        const rejectResult: OperationResult = {
          schemaVersion: SCHEMA_VERSION,
          operationId: request.operationId,
          idempotencyKey: request.idempotencyKey,
          backendOutcome: 'REJECTED',
          clientOutcome: 'REJECTED',
          errorCode: 'MISSING_CONFIRMATION',
          message: 'Mutation rejected: explicit caller confirmation is required.'
        };
        this.db.appendAuditEvent({
          conversationId: request.conversationId,
          operationId: request.operationId,
          idempotencyKey: request.idempotencyKey,
          patientId: request.patientId,
          eventType: 'MUTATION_REJECTED',
          outcome: 'REJECTED',
          details: { errorCode: 'MISSING_CONFIRMATION' }
        });
        this.db.sqlite.exec('COMMIT');
        return rejectResult;
      }

      // 5. Execute Domain Action Atomically
      let targetAppointmentId = request.appointmentId;
      const nowMs = this.clock.now();

      if (request.action === 'BOOK') {
        if (!request.slotId) {
          return this.rejectWithAudit(request, 'MISSING_SLOT_ID', 'Slot ID is required for booking.');
        }

        const slotRow = this.db.sqlite
          .prepare(`SELECT * FROM provider_slots WHERE slot_id = ?`)
          .get(request.slotId) as { slot_id: string; provider_id: string } | undefined;

        if (!slotRow) {
          return this.rejectWithAudit(request, 'SLOT_NOT_FOUND', 'Requested slot does not exist.');
        }

        const existingActive = this.db.sqlite
          .prepare(`SELECT appointment_id FROM appointments WHERE slot_id = ? AND status = 'BOOKED'`)
          .get(request.slotId) as { appointment_id: string } | undefined;

        if (existingActive) {
          return this.rejectWithAudit(
            request,
            'SLOT_CONFLICT',
            `Slot ${request.slotId} is already booked.`
          );
        }

        this.apptCounter += 1;
        targetAppointmentId = `APT-${this.apptCounter}`;

        this.db.sqlite
          .prepare(
            `INSERT INTO appointments (
              appointment_id, patient_id, provider_id, slot_id, status,
              created_at_ms, updated_at_ms, operation_id, idempotency_key
            ) VALUES (?, ?, ?, ?, 'BOOKED', ?, ?, ?, ?)`
          )
          .run(
            targetAppointmentId,
            request.patientId,
            slotRow.provider_id,
            request.slotId,
            nowMs,
            nowMs,
            request.operationId,
            request.idempotencyKey
          );
      } else if (request.action === 'CANCEL') {
        if (!request.appointmentId) {
          return this.rejectWithAudit(
            request,
            'INVALID_APPOINTMENT_FOR_CANCEL',
            'Appointment ID required for cancellation.'
          );
        }

        const apptRow = this.db.sqlite
          .prepare(`SELECT * FROM appointments WHERE appointment_id = ?`)
          .get(request.appointmentId) as
          | { appointment_id: string; patient_id: string; status: string }
          | undefined;

        if (!apptRow || apptRow.patient_id !== request.patientId || apptRow.status !== 'BOOKED') {
          return this.rejectWithAudit(
            request,
            'INVALID_APPOINTMENT_FOR_CANCEL',
            'Appointment not found, not owned by patient, or already canceled.'
          );
        }

        this.db.sqlite
          .prepare(
            `UPDATE appointments SET status = 'CANCELED', updated_at_ms = ?, operation_id = ?, idempotency_key = ? WHERE appointment_id = ?`
          )
          .run(nowMs, request.operationId, request.idempotencyKey, request.appointmentId);

        targetAppointmentId = request.appointmentId;
      } else if (request.action === 'RESCHEDULE') {
        if (!request.appointmentId || !request.targetSlotId) {
          return this.rejectWithAudit(
            request,
            'INVALID_APPOINTMENT_FOR_RESCHEDULE',
            'Appointment ID and targetSlotId are required for rescheduling.'
          );
        }

        const apptRow = this.db.sqlite
          .prepare(`SELECT * FROM appointments WHERE appointment_id = ?`)
          .get(request.appointmentId) as
          | { appointment_id: string; patient_id: string; status: string }
          | undefined;

        if (!apptRow || apptRow.patient_id !== request.patientId || apptRow.status !== 'BOOKED') {
          return this.rejectWithAudit(
            request,
            'INVALID_APPOINTMENT_FOR_RESCHEDULE',
            'Appointment not eligible for reschedule.'
          );
        }

        const targetSlotRow = this.db.sqlite
          .prepare(`SELECT * FROM provider_slots WHERE slot_id = ?`)
          .get(request.targetSlotId) as { slot_id: string; provider_id: string } | undefined;

        if (!targetSlotRow) {
          return this.rejectWithAudit(request, 'SLOT_NOT_FOUND', 'Target slot does not exist.');
        }

        const conflictRow = this.db.sqlite
          .prepare(`SELECT appointment_id FROM appointments WHERE slot_id = ? AND status = 'BOOKED'`)
          .get(request.targetSlotId) as { appointment_id: string } | undefined;

        if (conflictRow) {
          return this.rejectWithAudit(
            request,
            'SLOT_CONFLICT',
            `Target slot ${request.targetSlotId} is already booked.`
          );
        }

        this.db.sqlite
          .prepare(
            `UPDATE appointments SET provider_id = ?, slot_id = ?, updated_at_ms = ?, operation_id = ?, idempotency_key = ? WHERE appointment_id = ?`
          )
          .run(
            targetSlotRow.provider_id,
            request.targetSlotId,
            nowMs,
            request.operationId,
            request.idempotencyKey,
            request.appointmentId
          );

        targetAppointmentId = request.appointmentId;
      }

      const successResult: OperationResult = {
        schemaVersion: SCHEMA_VERSION,
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        backendOutcome: 'COMMITTED',
        clientOutcome: 'COMMITTED',
        appointmentId: targetAppointmentId,
        message: `${request.action} committed successfully.`
      };

      // 6. Persist idempotency record and commit audit event
      this.db.sqlite
        .prepare(
          `INSERT INTO idempotency_records (
            idempotency_key, operation_id, payload_hash, response_json, created_at_ms
          ) VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          request.idempotencyKey,
          request.operationId,
          payloadHash,
          JSON.stringify(successResult),
          nowMs
        );

      this.db.appendAuditEvent({
        conversationId: request.conversationId,
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        patientId: request.patientId,
        eventType: 'MUTATION_COMMITTED',
        outcome: 'COMMITTED',
        details: {
          action: request.action,
          appointmentId: targetAppointmentId,
          slotId: request.slotId ?? request.targetSlotId ?? null
        }
      });

      this.db.sqlite.exec('COMMIT');
      return successResult;
    } catch (err) {
      this.db.sqlite.exec('ROLLBACK');
      throw err;
    }
  }

  private rejectWithAudit(
    request: OperationRequest,
    errorCode: string,
    message: string
  ): OperationResult {
    const rejectResult: OperationResult = {
      schemaVersion: SCHEMA_VERSION,
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      backendOutcome: 'REJECTED',
      clientOutcome: 'REJECTED',
      errorCode,
      message
    };
    this.db.appendAuditEvent({
      conversationId: request.conversationId,
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      patientId: request.patientId,
      eventType: 'MUTATION_REJECTED',
      outcome: 'REJECTED',
      details: {
        errorCode,
        action: request.action,
        slotId: request.slotId ?? request.targetSlotId ?? null
      }
    });
    this.db.sqlite.exec('COMMIT');
    return rejectResult;
  }

  public reconcileOperation(
    conversationId: string,
    operationId: string,
    idempotencyKey: string
  ): {
    outcome: 'RECONCILED_COMMITTED' | 'RECONCILED_NOT_COMMITTED';
    appointmentId?: string;
  } {
    const row = this.db.sqlite
      .prepare(
        `SELECT response_json FROM idempotency_records WHERE idempotency_key = ? OR operation_id = ?`
      )
      .get(idempotencyKey, operationId) as { response_json: string } | undefined;

    if (row) {
      const parsed = JSON.parse(row.response_json) as OperationResult;
      this.db.appendAuditEvent({
        conversationId,
        operationId,
        idempotencyKey,
        eventType: 'RECONCILIATION_QUERIED',
        outcome: 'RECONCILED_COMMITTED',
        details: { appointmentId: parsed.appointmentId }
      });
      return {
        outcome: 'RECONCILED_COMMITTED',
        appointmentId: parsed.appointmentId
      };
    }

    this.db.appendAuditEvent({
      conversationId,
      operationId,
      idempotencyKey,
      eventType: 'RECONCILIATION_QUERIED',
      outcome: 'RECONCILED_NOT_COMMITTED',
      details: {}
    });
    return { outcome: 'RECONCILED_NOT_COMMITTED' };
  }

  public recordEscalation(params: {
    conversationId: string;
    patientId: string | null;
    reason: string;
  }): EscalationRecord {
    this.escalationCounter += 1;
    const escalationId = `ESC-${this.escalationCounter}`;
    const createdAtMs = this.clock.now();

    this.db.sqlite
      .prepare(
        `INSERT INTO escalations (escalation_id, conversation_id, patient_id, reason, created_at_ms)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(escalationId, params.conversationId, params.patientId, params.reason, createdAtMs);

    this.db.appendAuditEvent({
      conversationId: params.conversationId,
      patientId: params.patientId,
      eventType: 'ESCALATION_RECORDED',
      outcome: 'COMMITTED',
      details: { escalationId, reason: params.reason }
    });

    return {
      schemaVersion: SCHEMA_VERSION,
      escalationId,
      conversationId: params.conversationId,
      patientId: params.patientId,
      reason: params.reason,
      createdAtMs
    };
  }
}
