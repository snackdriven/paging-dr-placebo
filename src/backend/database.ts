import { DatabaseSync } from 'node:sqlite';
import {
  SCHEMA_VERSION,
  type AuditEvent,
  type DatabaseSnapshot,
  type Patient,
  type Provider,
  type ProviderSlot,
  type Appointment,
  type VerificationSession,
  type EscalationRecord,
  type OperationOutcome
} from '../types/schemas.js';
import { ControllableClock } from '../utils/clock.js';
import {
  SYNTHETIC_PATIENTS,
  SYNTHETIC_PROVIDERS,
  SYNTHETIC_SLOTS,
  INITIAL_BOOKED_APPOINTMENTS
} from './fixtures.js';

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.freeze(obj);
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const value = (obj as Record<string, unknown>)[key];
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        deepFreeze(value);
      }
    }
  }
  return obj;
}

export class SchedulingDatabase {
  public readonly sqlite: DatabaseSync;
  private readonly clock: ControllableClock;
  private eventCounter = 0;

  constructor(location: string = ':memory:', clock: ControllableClock = new ControllableClock()) {
    this.sqlite = new DatabaseSync(location);
    this.clock = clock;
    this.initializeSchema();
  }

  public initializeSchema(): void {
    this.sqlite.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS patients (
        patient_id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        dob TEXT NOT NULL,
        verification_pin TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS providers (
        provider_id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        specialty TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_slots (
        slot_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        start_time_iso TEXT NOT NULL,
        end_time_iso TEXT NOT NULL,
        day_of_week TEXT NOT NULL,
        FOREIGN KEY (provider_id) REFERENCES providers(provider_id)
      );

      CREATE TABLE IF NOT EXISTS verification_sessions (
        token_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        patient_id TEXT NOT NULL,
        issued_at_ms INTEGER NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
      );

      CREATE TABLE IF NOT EXISTS appointments (
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

      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_booked_slot
        ON appointments(slot_id)
        WHERE status = 'BOOKED';

      CREATE TABLE IF NOT EXISTS escalations (
        escalation_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        patient_id TEXT,
        reason TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS idempotency_records (
        idempotency_key TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
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
    `);
  }

  public resetAndSeed(): void {
    this.eventCounter = 0;
    this.sqlite.exec(`
      DELETE FROM audit_events;
      DELETE FROM sqlite_sequence WHERE name = 'audit_events';
      DELETE FROM idempotency_records;
      DELETE FROM escalations;
      DELETE FROM appointments;
      DELETE FROM verification_sessions;
      DELETE FROM provider_slots;
      DELETE FROM providers;
      DELETE FROM patients;
    `);

    const insertPatient = this.sqlite.prepare(`
      INSERT INTO patients (patient_id, full_name, dob, verification_pin)
      VALUES (?, ?, ?, ?)
    `);
    for (const p of SYNTHETIC_PATIENTS) {
      insertPatient.run(p.patientId, p.fullName, p.dob, p.verificationPin);
    }

    const insertProvider = this.sqlite.prepare(`
      INSERT INTO providers (provider_id, full_name, specialty)
      VALUES (?, ?, ?)
    `);
    for (const prv of SYNTHETIC_PROVIDERS) {
      insertProvider.run(prv.providerId, prv.fullName, prv.specialty);
    }

    const insertSlot = this.sqlite.prepare(`
      INSERT INTO provider_slots (slot_id, provider_id, start_time_iso, end_time_iso, day_of_week)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const slot of SYNTHETIC_SLOTS) {
      insertSlot.run(
        slot.slotId,
        slot.providerId,
        slot.startTimeIso,
        slot.endTimeIso,
        slot.dayOfWeek
      );
    }

    const insertAppt = this.sqlite.prepare(`
      INSERT INTO appointments (
        appointment_id, patient_id, provider_id, slot_id, status,
        created_at_ms, updated_at_ms, operation_id, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const appt of INITIAL_BOOKED_APPOINTMENTS) {
      insertAppt.run(
        appt.appointmentId,
        appt.patientId,
        appt.providerId,
        appt.slotId,
        appt.status,
        appt.createdAtMs,
        appt.updatedAtMs,
        appt.operationId,
        appt.idempotencyKey
      );
    }
  }

  public appendAuditEvent(params: {
    conversationId: string;
    operationId?: string | null;
    idempotencyKey?: string | null;
    patientId?: string | null;
    eventType: AuditEvent['eventType'];
    outcome: OperationOutcome;
    details: Record<string, unknown>;
  }): AuditEvent {
    this.eventCounter += 1;
    const eventId = `evt-${this.eventCounter}`;
    const timestampMs = this.clock.now();
    const stmt = this.sqlite.prepare(`
      INSERT INTO audit_events (
        event_id, timestamp_ms, conversation_id, operation_id,
        idempotency_key, patient_id, event_type, outcome, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
      eventId,
      timestampMs,
      params.conversationId,
      params.operationId ?? null,
      params.idempotencyKey ?? null,
      params.patientId ?? null,
      params.eventType,
      params.outcome,
      JSON.stringify(params.details)
    );

    return {
      schemaVersion: SCHEMA_VERSION,
      sequenceId: Number(info.lastInsertRowid),
      eventId,
      timestampMs,
      conversationId: params.conversationId,
      operationId: params.operationId ?? null,
      idempotencyKey: params.idempotencyKey ?? null,
      patientId: params.patientId ?? null,
      eventType: params.eventType,
      outcome: params.outcome,
      details: params.details
    };
  }

  public getAuditEvents(): AuditEvent[] {
    const rows = this.sqlite
      .prepare(`SELECT * FROM audit_events ORDER BY sequence_id ASC`)
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      schemaVersion: SCHEMA_VERSION,
      sequenceId: Number(r.sequence_id),
      eventId: String(r.event_id),
      timestampMs: Number(r.timestamp_ms),
      conversationId: String(r.conversation_id),
      operationId: r.operation_id ? String(r.operation_id) : null,
      idempotencyKey: r.idempotency_key ? String(r.idempotency_key) : null,
      patientId: r.patient_id ? String(r.patient_id) : null,
      eventType: String(r.event_type) as AuditEvent['eventType'],
      outcome: String(r.outcome) as OperationOutcome,
      details: JSON.parse(String(r.details_json)) as Record<string, unknown>
    }));
  }

  public captureSnapshot(): DatabaseSnapshot {
    const patientsRows = this.sqlite
      .prepare(`SELECT * FROM patients ORDER BY patient_id ASC`)
      .all() as Array<Record<string, unknown>>;
    const providersRows = this.sqlite
      .prepare(`SELECT * FROM providers ORDER BY provider_id ASC`)
      .all() as Array<Record<string, unknown>>;
    const slotsRows = this.sqlite
      .prepare(`SELECT * FROM provider_slots ORDER BY slot_id ASC`)
      .all() as Array<Record<string, unknown>>;
    const apptsRows = this.sqlite
      .prepare(`SELECT * FROM appointments ORDER BY appointment_id ASC`)
      .all() as Array<Record<string, unknown>>;
    const sessionsRows = this.sqlite
      .prepare(`SELECT * FROM verification_sessions ORDER BY token_id ASC`)
      .all() as Array<Record<string, unknown>>;
    const escalationsRows = this.sqlite
      .prepare(`SELECT * FROM escalations ORDER BY escalation_id ASC`)
      .all() as Array<Record<string, unknown>>;

    const patients: Patient[] = patientsRows.map((r) => ({
      schemaVersion: SCHEMA_VERSION,
      patientId: String(r.patient_id),
      fullName: String(r.full_name),
      dob: String(r.dob),
      verificationPin: String(r.verification_pin)
    }));

    const providers: Provider[] = providersRows.map((r) => ({
      schemaVersion: SCHEMA_VERSION,
      providerId: String(r.provider_id),
      fullName: String(r.full_name),
      specialty: String(r.specialty)
    }));

    const slots: ProviderSlot[] = slotsRows.map((r) => ({
      schemaVersion: SCHEMA_VERSION,
      slotId: String(r.slot_id),
      providerId: String(r.provider_id),
      startTimeIso: String(r.start_time_iso),
      endTimeIso: String(r.end_time_iso),
      dayOfWeek: String(r.day_of_week)
    }));

    const appointments: Appointment[] = apptsRows.map((r) => ({
      schemaVersion: SCHEMA_VERSION,
      appointmentId: String(r.appointment_id),
      patientId: String(r.patient_id),
      providerId: String(r.provider_id),
      slotId: String(r.slot_id),
      status: String(r.status) as Appointment['status'],
      createdAtMs: Number(r.created_at_ms),
      updatedAtMs: Number(r.updated_at_ms),
      operationId: String(r.operation_id),
      idempotencyKey: String(r.idempotency_key)
    }));

    const verificationSessions: VerificationSession[] = sessionsRows.map((r) => ({
      schemaVersion: SCHEMA_VERSION,
      tokenId: String(r.token_id),
      conversationId: String(r.conversation_id),
      patientId: String(r.patient_id),
      issuedAtMs: Number(r.issued_at_ms),
      expiresAtMs: Number(r.expires_at_ms),
      revoked: Number(r.revoked) === 1
    }));

    const escalations: EscalationRecord[] = escalationsRows.map((r) => ({
      schemaVersion: SCHEMA_VERSION,
      escalationId: String(r.escalation_id),
      conversationId: String(r.conversation_id),
      patientId: r.patient_id ? String(r.patient_id) : null,
      reason: String(r.reason),
      createdAtMs: Number(r.created_at_ms)
    }));

    return deepFreeze({
      schemaVersion: SCHEMA_VERSION,
      capturedAtMs: this.clock.now(),
      patients,
      providers,
      slots,
      appointments,
      verificationSessions,
      escalations
    });
  }
}
