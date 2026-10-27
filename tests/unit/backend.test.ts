import { describe, it, expect, beforeEach } from 'vitest';
import { ControllableClock } from '../../src/utils/clock.js';
import { SchedulingDatabase } from '../../src/backend/database.js';
import { VerificationService } from '../../src/backend/verification-service.js';
import { AppointmentRepository } from '../../src/backend/appointment-repository.js';
import { SchedulingApi } from '../../src/backend/scheduling-api.js';
import { FaultInjector } from '../../src/faults/fault-injector.js';

describe('Increment 1: Trusted Backend & Invariants (REQ-B01..B10, INV-01..INV-06)', () => {
  let clock: ControllableClock;
  let db: SchedulingDatabase;
  let verificationService: VerificationService;
  let repository: AppointmentRepository;
  let api: SchedulingApi;

  beforeEach(() => {
    clock = new ControllableClock('2026-10-27T09:00:00.000Z');
    db = new SchedulingDatabase(':memory:', clock);
    db.resetAndSeed();
    verificationService = new VerificationService(db, clock);
    repository = new AppointmentRepository(db, clock, verificationService);
    api = new SchedulingApi(db, verificationService, repository, clock);
  });

  it('REQ-B01 & REQ-B02: seeds synthetic patients, providers, and availability without mutating state', () => {
    const preSnap = db.captureSnapshot();
    const providers = api.listProviders();
    expect(providers.length).toBeGreaterThanOrEqual(2);

    const slots = api.listAvailableSlots('PRV-001');
    const tue09 = slots.find((s) => s.slotId === 'SLOT-PRV1-TUE-09');
    const thu10 = slots.find((s) => s.slotId === 'SLOT-PRV1-THU-10');
    expect(tue09?.isBooked).toBe(true); // Seeded for PAT-002
    expect(thu10?.isBooked).toBe(false);

    const postSnap = db.captureSnapshot();
    expect(postSnap.appointments).toEqual(preSnap.appointments);
  });

  it('REQ-B03 & INV-01: blocks booking mutation when verification token is missing or invalid', () => {
    const res = api.executeMutation({
      schemaVersion: '1.0.0',
      operationId: 'op-unauth-1',
      idempotencyKey: 'idem-unauth-1',
      conversationId: 'conv-1',
      patientId: 'PAT-001',
      verificationTokenId: 'tok-non-existent',
      confirmationProposalId: 'prop-1',
      action: 'BOOK',
      slotId: 'SLOT-PRV1-THU-10'
    });

    expect(res.backendOutcome).toBe('REJECTED');
    expect(res.errorCode).toBe('UNAUTHORIZED_NO_VALID_TOKEN');

    const snap = db.captureSnapshot();
    expect(snap.appointments.find((a) => a.slotId === 'SLOT-PRV1-THU-10')).toBeUndefined();
  });

  it('REQ-B03 & S4: blocks mutation when verification token has expired', () => {
    const auth = api.verifyPatient({
      conversationId: 'conv-exp',
      patientId: 'PAT-001',
      dob: '1985-04-12',
      verificationPin: '4821'
    });
    expect(auth.verified).toBe(true);

    // Advance clock 30 minutes past expiration
    clock.advanceMs(30 * 60 * 1000);

    const res = api.executeMutation({
      schemaVersion: '1.0.0',
      operationId: 'op-exp-1',
      idempotencyKey: 'idem-exp-1',
      conversationId: 'conv-exp',
      patientId: 'PAT-001',
      verificationTokenId: auth.token!.tokenId,
      confirmationProposalId: 'prop-1',
      action: 'BOOK',
      slotId: 'SLOT-PRV1-THU-10'
    });

    expect(res.backendOutcome).toBe('REJECTED');
    expect(res.errorCode).toBe('TOKEN_EXPIRED');
  });

  it('REQ-B09 & INV-06: enforces patient isolation (rejects Patient A token replayed for Patient B)', () => {
    const authA = api.verifyPatient({
      conversationId: 'conv-iso',
      patientId: 'PAT-001',
      dob: '1985-04-12',
      verificationPin: '4821'
    });
    expect(authA.verified).toBe(true);

    const res = api.executeMutation({
      schemaVersion: '1.0.0',
      operationId: 'op-iso-1',
      idempotencyKey: 'idem-iso-1',
      conversationId: 'conv-iso',
      patientId: 'PAT-002', // Different patient!
      verificationTokenId: authA.token!.tokenId,
      confirmationProposalId: 'prop-1',
      action: 'BOOK',
      slotId: 'SLOT-PRV1-THU-10'
    });

    expect(res.backendOutcome).toBe('REJECTED');
    expect(res.errorCode).toBe('PATIENT_MISMATCH');
  });

  it('INV-02: blocks mutation when explicit confirmation context is missing', () => {
    const auth = api.verifyPatient({
      conversationId: 'conv-noconf',
      patientId: 'PAT-001',
      dob: '1985-04-12',
      verificationPin: '4821'
    });

    const res = api.executeMutation({
      schemaVersion: '1.0.0',
      operationId: 'op-noconf-1',
      idempotencyKey: 'idem-noconf-1',
      conversationId: 'conv-noconf',
      patientId: 'PAT-001',
      verificationTokenId: auth.token!.tokenId,
      confirmationProposalId: null,
      action: 'BOOK',
      slotId: 'SLOT-PRV1-THU-10'
    });

    expect(res.backendOutcome).toBe('REJECTED');
    expect(res.errorCode).toBe('MISSING_CONFIRMATION');
  });

  it('REQ-B04 & REQ-B05 & INV-04: commits valid booking atomically and prevents conflicting booking on same slot', () => {
    const auth1 = api.verifyPatient({
      conversationId: 'conv-c1',
      patientId: 'PAT-001',
      dob: '1985-04-12',
      verificationPin: '4821'
    });
    const auth2 = api.verifyPatient({
      conversationId: 'conv-c2',
      patientId: 'PAT-003',
      dob: '1992-07-22',
      verificationPin: '3350'
    });

    const firstBook = api.executeMutation({
      schemaVersion: '1.0.0',
      operationId: 'op-c1',
      idempotencyKey: 'idem-c1',
      conversationId: 'conv-c1',
      patientId: 'PAT-001',
      verificationTokenId: auth1.token!.tokenId,
      confirmationProposalId: 'prop-c1',
      action: 'BOOK',
      slotId: 'SLOT-PRV1-THU-10'
    });
    expect(firstBook.backendOutcome).toBe('COMMITTED');

    const secondBook = api.executeMutation({
      schemaVersion: '1.0.0',
      operationId: 'op-c2',
      idempotencyKey: 'idem-c2',
      conversationId: 'conv-c2',
      patientId: 'PAT-003',
      verificationTokenId: auth2.token!.tokenId,
      confirmationProposalId: 'prop-c2',
      action: 'BOOK',
      slotId: 'SLOT-PRV1-THU-10'
    });
    expect(secondBook.backendOutcome).toBe('REJECTED');
    expect(secondBook.errorCode).toBe('SLOT_CONFLICT');

    const snap = db.captureSnapshot();
    const activeForSlot = snap.appointments.filter(
      (a) => a.slotId === 'SLOT-PRV1-THU-10' && a.status === 'BOOKED'
    );
    expect(activeForSlot).toHaveLength(1);
    expect(activeForSlot[0]?.patientId).toBe('PAT-001');
  });

  it('REQ-B06 & INV-05: supports idempotent replay with identical parameters and rejects reuse with different parameters', () => {
    const auth = api.verifyPatient({
      conversationId: 'conv-idem',
      patientId: 'PAT-001',
      dob: '1985-04-12',
      verificationPin: '4821'
    });

    const req = {
      schemaVersion: '1.0.0' as const,
      operationId: 'op-idem-1',
      idempotencyKey: 'idem-key-100',
      conversationId: 'conv-idem',
      patientId: 'PAT-001',
      verificationTokenId: auth.token!.tokenId,
      confirmationProposalId: 'prop-100',
      action: 'BOOK' as const,
      slotId: 'SLOT-PRV1-THU-10'
    };

    const first = api.executeMutation(req);
    expect(first.backendOutcome).toBe('COMMITTED');

    const replay = api.executeMutation(req);
    expect(replay.backendOutcome).toBe('NO_OP');
    expect(replay.appointmentId).toBe(first.appointmentId);

    // Reusing same idempotency key with different slot must be rejected
    const mismatch = api.executeMutation({
      ...req,
      slotId: 'SLOT-PRV1-TUE-14'
    });
    expect(mismatch.backendOutcome).toBe('REJECTED');
    expect(mismatch.errorCode).toBe('IDEMPOTENCY_PARAMETER_MISMATCH');
  });

  it('REQ-B10: FaultInjector POST_COMMIT_DROP commits in DB while returning UNKNOWN to caller, and reconcileOperation recovers state', () => {
    const auth = api.verifyPatient({
      conversationId: 'conv-drop',
      patientId: 'PAT-001',
      dob: '1985-04-12',
      verificationPin: '4821'
    });

    const injector = new FaultInjector(api, clock, [
      {
        ruleId: 'fault-post-commit-1',
        stage: 'POST_COMMIT_DROP',
        targetTool: 'executeMutation',
        triggerOnCallIndex: 1
      }
    ]);

    const res = injector.executeMutation({
      schemaVersion: '1.0.0',
      operationId: 'op-drop-1',
      idempotencyKey: 'idem-drop-1',
      conversationId: 'conv-drop',
      patientId: 'PAT-001',
      verificationTokenId: auth.token!.tokenId,
      confirmationProposalId: 'prop-drop-1',
      action: 'BOOK',
      slotId: 'SLOT-PRV1-THU-10'
    });

    // Agent sees UNKNOWN (timeout after commit)
    expect(res.clientOutcome).toBe('UNKNOWN');
    expect(res.errorCode).toBe('TRANSPORT_TIMEOUT_AFTER_COMMIT');

    // Yet DB has the committed booking
    const snap = db.captureSnapshot();
    expect(
      snap.appointments.some((a) => a.slotId === 'SLOT-PRV1-THU-10' && a.status === 'BOOKED')
    ).toBe(true);

    // Reconciliation resolves the actual state
    const recon = injector.reconcileOperation('conv-drop', 'op-drop-1', 'idem-drop-1');
    expect(recon.outcome).toBe('RECONCILED_COMMITTED');
    expect(recon.appointmentId).toBeDefined();
  });
});
