import {
  SCHEMA_VERSION,
  type Provider,
  type ProviderSlot,
  type OperationRequest,
  type OperationResult,
  type EscalationRecord
} from '../types/schemas.js';
import { ControllableClock } from '../utils/clock.js';
import { SchedulingDatabase } from './database.js';
import {
  VerificationService,
  type VerifyPatientInput,
  type VerifyPatientOutput
} from './verification-service.js';
import { AppointmentRepository } from './appointment-repository.js';

export interface SlotAvailabilityView extends ProviderSlot {
  isBooked: boolean;
}

export class SchedulingApi {
  public readonly db: SchedulingDatabase;
  public readonly verificationService: VerificationService;
  public readonly repository: AppointmentRepository;
  public readonly clock: ControllableClock;

  constructor(
    db: SchedulingDatabase,
    verificationService: VerificationService,
    repository: AppointmentRepository,
    clock: ControllableClock
  ) {
    this.db = db;
    this.verificationService = verificationService;
    this.repository = repository;
    this.clock = clock;
  }

  public listProviders(): Provider[] {
    const rows = this.db.sqlite
      .prepare(`SELECT * FROM providers ORDER BY provider_id ASC`)
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      schemaVersion: SCHEMA_VERSION,
      providerId: String(r.provider_id),
      fullName: String(r.full_name),
      specialty: String(r.specialty)
    }));
  }

  public listAvailableSlots(providerId?: string, dayOfWeek?: string): SlotAvailabilityView[] {
    const rows = this.db.sqlite
      .prepare(
        `SELECT s.*,
                CASE WHEN a.appointment_id IS NOT NULL THEN 1 ELSE 0 END AS is_booked
         FROM provider_slots s
         LEFT JOIN appointments a
           ON s.slot_id = a.slot_id AND a.status = 'BOOKED'
         ORDER BY s.slot_id ASC`
      )
      .all() as Array<Record<string, unknown>>;

    return rows
      .map((r) => ({
        schemaVersion: SCHEMA_VERSION,
        slotId: String(r.slot_id),
        providerId: String(r.provider_id),
        startTimeIso: String(r.start_time_iso),
        endTimeIso: String(r.end_time_iso),
        dayOfWeek: String(r.day_of_week),
        isBooked: Number(r.is_booked) === 1
      }))
      .filter((s) => (!providerId || s.providerId === providerId))
      .filter(
        (s) => (!dayOfWeek || s.dayOfWeek.toLowerCase() === dayOfWeek.toLowerCase())
      );
  }

  public verifyPatient(input: VerifyPatientInput): VerifyPatientOutput {
    return this.verificationService.verifyPatient(input);
  }

  public revokeVerification(conversationId: string, reason?: string): void {
    this.verificationService.revokeVerification(conversationId, reason);
  }

  public executeMutation(request: OperationRequest): OperationResult {
    return this.repository.executeTransactionalMutation(request);
  }

  public reconcileOperation(
    conversationId: string,
    operationId: string,
    idempotencyKey: string
  ): {
    outcome: 'RECONCILED_COMMITTED' | 'RECONCILED_NOT_COMMITTED' | 'UNKNOWN';
    appointmentId?: string;
    errorCode?: string;
  } {
    return this.repository.reconcileOperation(conversationId, operationId, idempotencyKey);
  }

  public recordEscalation(params: {
    conversationId: string;
    patientId: string | null;
    reason: string;
  }): EscalationRecord {
    return this.repository.recordEscalation(params);
  }
}
