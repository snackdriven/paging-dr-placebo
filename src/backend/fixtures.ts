import {
  SCHEMA_VERSION,
  type Patient,
  type Provider,
  type ProviderSlot,
  type Appointment
} from '../types/schemas.js';

export const SYNTHETIC_PATIENTS: readonly Patient[] = Object.freeze([
  {
    schemaVersion: SCHEMA_VERSION,
    patientId: 'PAT-001',
    fullName: 'Elena Vance (Synthetic)',
    dob: '1985-04-12',
    verificationPin: '4821'
  },
  {
    schemaVersion: SCHEMA_VERSION,
    patientId: 'PAT-002',
    fullName: 'Marcus Sterling (Synthetic)',
    dob: '1978-11-03',
    verificationPin: '9104'
  },
  {
    schemaVersion: SCHEMA_VERSION,
    patientId: 'PAT-003',
    fullName: 'Clara Lin (Synthetic)',
    dob: '1992-07-22',
    verificationPin: '3350'
  }
]);

export const SYNTHETIC_PROVIDERS: readonly Provider[] = Object.freeze([
  {
    schemaVersion: SCHEMA_VERSION,
    providerId: 'PRV-001',
    fullName: 'Dr. Mateo Rivera (Synthetic Cardiology)',
    specialty: 'Cardiology'
  },
  {
    schemaVersion: SCHEMA_VERSION,
    providerId: 'PRV-002',
    fullName: 'Dr. Hannah Okafor (Synthetic Primary Care)',
    specialty: 'Primary Care'
  }
]);

export const SYNTHETIC_SLOTS: readonly ProviderSlot[] = Object.freeze([
  {
    schemaVersion: SCHEMA_VERSION,
    slotId: 'SLOT-PRV1-TUE-09',
    providerId: 'PRV-001',
    startTimeIso: '2026-10-27T09:00:00.000Z',
    endTimeIso: '2026-10-27T09:30:00.000Z',
    dayOfWeek: 'Tuesday'
  },
  {
    schemaVersion: SCHEMA_VERSION,
    slotId: 'SLOT-PRV1-TUE-14',
    providerId: 'PRV-001',
    startTimeIso: '2026-10-27T14:00:00.000Z',
    endTimeIso: '2026-10-27T14:30:00.000Z',
    dayOfWeek: 'Tuesday'
  },
  {
    schemaVersion: SCHEMA_VERSION,
    slotId: 'SLOT-PRV1-THU-10',
    providerId: 'PRV-001',
    startTimeIso: '2026-10-29T10:00:00.000Z',
    endTimeIso: '2026-10-29T10:30:00.000Z',
    dayOfWeek: 'Thursday'
  },
  {
    schemaVersion: SCHEMA_VERSION,
    slotId: 'SLOT-PRV1-NEXT-TUE-10',
    providerId: 'PRV-001',
    startTimeIso: '2026-11-03T10:00:00.000Z',
    endTimeIso: '2026-11-03T10:30:00.000Z',
    dayOfWeek: 'Tuesday'
  },
  {
    schemaVersion: SCHEMA_VERSION,
    slotId: 'SLOT-PRV2-WED-11',
    providerId: 'PRV-002',
    startTimeIso: '2026-10-28T11:00:00.000Z',
    endTimeIso: '2026-10-28T11:30:00.000Z',
    dayOfWeek: 'Wednesday'
  },
  {
    schemaVersion: SCHEMA_VERSION,
    slotId: 'SLOT-PRV2-FRI-15',
    providerId: 'PRV-002',
    startTimeIso: '2026-10-30T15:00:00.000Z',
    endTimeIso: '2026-10-30T15:30:00.000Z',
    dayOfWeek: 'Friday'
  }
]);

export const INITIAL_BOOKED_APPOINTMENTS: readonly Appointment[] = Object.freeze([
  {
    schemaVersion: SCHEMA_VERSION,
    appointmentId: 'APT-SEED-001',
    patientId: 'PAT-002',
    providerId: 'PRV-001',
    slotId: 'SLOT-PRV1-TUE-09',
    status: 'BOOKED',
    createdAtMs: new Date('2026-10-26T12:00:00.000Z').getTime(),
    updatedAtMs: new Date('2026-10-26T12:00:00.000Z').getTime(),
    operationId: 'op-seed-001',
    idempotencyKey: 'idem-seed-001'
  },
  {
    schemaVersion: SCHEMA_VERSION,
    appointmentId: 'APT-SEED-PAT1',
    patientId: 'PAT-001',
    providerId: 'PRV-002',
    slotId: 'SLOT-PRV2-WED-11',
    status: 'BOOKED',
    createdAtMs: new Date('2026-10-26T13:00:00.000Z').getTime(),
    updatedAtMs: new Date('2026-10-26T13:00:00.000Z').getTime(),
    operationId: 'op-seed-pat1',
    idempotencyKey: 'idem-seed-pat1'
  }
]);
