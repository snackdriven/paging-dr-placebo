/**
 * Minimal Synthetic Appointment API for the Persuasive Demo branch.
 *
 * Models a clinic scheduling backend with:
 * - Patient identity verification (DOB + 4-digit PIN)
 * - Slot availability lookup
 * - Idempotent appointment booking
 * - Human escalation recording
 * - Injectable API failure modes (HTTP 500 error, transient timeout, slot conflict)
 */

export type ApiFaultMode =
  | 'NONE'
  | 'API_HTTP_500'
  | 'API_TIMEOUT_FIRST_CALL'
  | 'SLOT_TAKEN';

export interface PatientRecord {
  readonly patientId: string;
  readonly fullName: string;
  readonly dob: string;
  readonly pin: string;
}

export interface SlotRecord {
  readonly slotId: string;
  readonly providerName: string;
  readonly label: string;
  bookedByPatientId: string | null;
}

export interface CommittedAppointment {
  readonly appointmentId: string;
  readonly patientId: string;
  readonly slotId: string;
  readonly idempotencyKey: string | null;
  readonly createdAtIso: string;
}

export interface EscalationTicket {
  readonly ticketId: string;
  readonly patientId: string | null;
  readonly reason: string;
}

export interface ApiMutationCallLog {
  readonly callIndex: number;
  readonly action: 'BOOK_APPOINTMENT' | 'RECORD_ESCALATION';
  readonly patientId: string | null;
  readonly slotId: string | null;
  readonly idempotencyKey: string | null;
  readonly outcome: 'COMMITTED' | 'IDEMPOTENT_REPLAY' | 'HTTP_500_ERROR' | 'TIMEOUT_ERROR' | 'CONFLICT';
}

export interface BookAppointmentResult {
  readonly ok: boolean;
  readonly status: 'COMMITTED' | 'IDEMPOTENT_REPLAY' | 'HTTP_500_ERROR' | 'TIMEOUT_ERROR' | 'CONFLICT';
  readonly appointmentId?: string;
  readonly errorMessage?: string;
}

export class SyntheticAppointmentApi {
  private faultMode: ApiFaultMode;
  private bookCallCounter = 0;

  private readonly patients: Map<string, PatientRecord> = new Map([
    [
      'PAT-001',
      { patientId: 'PAT-001', fullName: 'Philip J. Fry', dob: '1985-04-12', pin: '4821' }
    ],
    [
      'PAT-002',
      { patientId: 'PAT-002', fullName: 'Turanga Leela', dob: '1978-11-03', pin: '9104' }
    ],
    [
      'PAT-003',
      { patientId: 'PAT-003', fullName: 'Bender Rodriguez', dob: '1992-07-22', pin: '3350' }
    ]
  ]);

  private readonly slots: Map<string, SlotRecord> = new Map([
    [
      'SLOT-TUE-09',
      {
        slotId: 'SLOT-TUE-09',
        providerName: 'Dr. Zoidberg',
        label: 'Tuesday at 9:00 AM',
        bookedByPatientId: 'PAT-002' // Pre-booked by Leela
      }
    ],
    [
      'SLOT-TUE-14',
      {
        slotId: 'SLOT-TUE-14',
        providerName: 'Dr. Zoidberg',
        label: 'Tuesday at 2:00 PM',
        bookedByPatientId: null
      }
    ],
    [
      'SLOT-THU-10',
      {
        slotId: 'SLOT-THU-10',
        providerName: 'Dr. Zoidberg',
        label: 'Thursday at 10:00 AM',
        bookedByPatientId: null
      }
    ],
    [
      'SLOT-WED-11',
      {
        slotId: 'SLOT-WED-11',
        providerName: 'Prof. Wernstrom',
        label: 'Wednesday at 11:00 AM',
        bookedByPatientId: null
      }
    ]
  ]);

  private readonly appointments: CommittedAppointment[] = [];
  private readonly escalations: EscalationTicket[] = [];
  private readonly callLog: ApiMutationCallLog[] = [];

  constructor(faultMode: ApiFaultMode = 'NONE') {
    this.faultMode = faultMode;
  }

  public setFaultMode(mode: ApiFaultMode): void {
    this.faultMode = mode;
  }

  public verifyPatient(patientId: string, dob: string, pin: string): boolean {
    const p = this.patients.get(patientId);
    return Boolean(p && p.dob === dob && p.pin === pin);
  }

  public listOpenSlots(): SlotRecord[] {
    return Array.from(this.slots.values())
      .filter((s) => s.bookedByPatientId === null)
      .map((s) => ({ ...s }));
  }

  public bookAppointment(params: {
    patientId: string;
    slotId: string;
    idempotencyKey?: string | null;
  }): BookAppointmentResult {
    this.bookCallCounter += 1;
    const idemKey = params.idempotencyKey ?? null;

    // 1. Check idempotent replay first (prevents duplicate bookings when retrying safely)
    if (idemKey) {
      const existing = this.appointments.find((a) => a.idempotencyKey === idemKey);
      if (existing) {
        this.callLog.push({
          callIndex: this.bookCallCounter,
          action: 'BOOK_APPOINTMENT',
          patientId: params.patientId,
          slotId: params.slotId,
          idempotencyKey: idemKey,
          outcome: 'IDEMPOTENT_REPLAY'
        });
        return {
          ok: true,
          status: 'IDEMPOTENT_REPLAY',
          appointmentId: existing.appointmentId
        };
      }
    }

    // 2. Simulate hard API HTTP 500 outage
    if (this.faultMode === 'API_HTTP_500') {
      this.callLog.push({
        callIndex: this.bookCallCounter,
        action: 'BOOK_APPOINTMENT',
        patientId: params.patientId,
        slotId: params.slotId,
        idempotencyKey: idemKey,
        outcome: 'HTTP_500_ERROR'
      });
      return {
        ok: false,
        status: 'HTTP_500_ERROR',
        errorMessage: '500 Internal Server Error: Calendar database unreachable'
      };
    }

    // 3. Simulate a transient network timeout on the first call AFTER the DB actually commits,
    //    or allow duplicate records if the caller retries without an idempotency key!
    const slot = this.slots.get(params.slotId);
    if (!slot) {
      return {
        ok: false,
        status: 'HTTP_500_ERROR',
        errorMessage: `Unknown slot ${params.slotId}`
      };
    }

    if (
      this.faultMode === 'SLOT_TAKEN' ||
      (slot.bookedByPatientId !== null && this.faultMode !== 'API_TIMEOUT_FIRST_CALL')
    ) {
      this.callLog.push({
        callIndex: this.bookCallCounter,
        action: 'BOOK_APPOINTMENT',
        patientId: params.patientId,
        slotId: params.slotId,
        idempotencyKey: idemKey,
        outcome: 'CONFLICT'
      });
      return {
        ok: false,
        status: 'CONFLICT',
        errorMessage: `Slot ${params.slotId} is already booked`
      };
    }

    // Commit appointment record
    const apptId = `APT-${100 + this.appointments.length + 1}`;
    slot.bookedByPatientId = params.patientId;
    this.appointments.push({
      appointmentId: apptId,
      patientId: params.patientId,
      slotId: params.slotId,
      idempotencyKey: idemKey,
      createdAtIso: '2026-10-27T09:00:00.000Z'
    });

    if (this.faultMode === 'API_TIMEOUT_FIRST_CALL' && this.bookCallCounter === 1) {
      this.callLog.push({
        callIndex: this.bookCallCounter,
        action: 'BOOK_APPOINTMENT',
        patientId: params.patientId,
        slotId: params.slotId,
        idempotencyKey: idemKey,
        outcome: 'TIMEOUT_ERROR'
      });
      return {
        ok: false,
        status: 'TIMEOUT_ERROR',
        errorMessage: '504 Gateway Timeout: Upstream response dropped after write'
      };
    }

    this.callLog.push({
      callIndex: this.bookCallCounter,
      action: 'BOOK_APPOINTMENT',
      patientId: params.patientId,
      slotId: params.slotId,
      idempotencyKey: idemKey,
      outcome: 'COMMITTED'
    });

    return {
      ok: true,
      status: 'COMMITTED',
      appointmentId: apptId
    };
  }

  public recordEscalation(params: { patientId: string | null; reason: string }): EscalationTicket {
    const ticket: EscalationTicket = {
      ticketId: `ESC-${200 + this.escalations.length + 1}`,
      patientId: params.patientId,
      reason: params.reason
    };
    this.escalations.push(ticket);
    this.callLog.push({
      callIndex: this.callLog.length + 1,
      action: 'RECORD_ESCALATION',
      patientId: params.patientId,
      slotId: null,
      idempotencyKey: null,
      outcome: 'COMMITTED'
    });
    return ticket;
  }

  public getSnapshot() {
    return Object.freeze({
      appointments: this.appointments.map((a) => Object.freeze({ ...a })),
      escalations: this.escalations.map((e) => Object.freeze({ ...e })),
      callLog: this.callLog.map((c) => Object.freeze({ ...c }))
    });
  }
}
