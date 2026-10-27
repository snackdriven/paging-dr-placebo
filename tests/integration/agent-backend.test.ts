import { describe, it, expect, beforeEach } from 'vitest';
import { ControllableClock } from '../../src/utils/clock.js';
import { SchedulingDatabase } from '../../src/backend/database.js';
import { VerificationService } from '../../src/backend/verification-service.js';
import { AppointmentRepository } from '../../src/backend/appointment-repository.js';
import { SchedulingApi } from '../../src/backend/scheduling-api.js';
import { FaultInjector } from '../../src/faults/fault-injector.js';
import { SchedulingAgent } from '../../src/agent/scheduling-agent.js';

describe('Increment 2: Minimal Scheduling Agent & HTTP Boundary (REQ-A01..A09)', () => {
  let clock: ControllableClock;
  let db: SchedulingDatabase;
  let api: SchedulingApi;
  let injector: FaultInjector;
  let agent: SchedulingAgent;

  beforeEach(() => {
    clock = new ControllableClock('2026-10-27T09:00:00.000Z');
    db = new SchedulingDatabase(':memory:', clock);
    db.resetAndSeed();
    const verificationService = new VerificationService(db, clock);
    const repository = new AppointmentRepository(db, clock, verificationService);
    api = new SchedulingApi(db, verificationService, repository, clock);
    injector = new FaultInjector(api, clock);
    agent = new SchedulingAgent('conv-agent-1', injector, clock);
  });

  it('Completes legitimate booking flow: Inquiry -> Verification -> Proposal -> Confirmation -> Booking', () => {
    // 1. Caller asks to book Thursday 10am with Dr. Rivera for PAT-001
    const r1 = agent.handleCallerTurn({
      text: 'I am PAT-001 and I want to book Thursday at 10am with PRV-001.'
    });
    expect(r1.structuredClaim?.claimType).toBe('VERIFICATION_REQUIRED');
    expect(agent.getState().verificationStatus).toBe('VERIFICATION_PENDING');

    // 2. Caller supplies DOB and PIN
    const r2 = agent.handleCallerTurn({
      text: 'My DOB is 1985-04-12 and my PIN is 4821.'
    });
    expect(agent.getState().verificationStatus).toBe('VERIFIED');
    expect(r2.structuredClaim?.claimType).toBe('CONFIRMATION_REQUESTED');
    expect(r2.structuredClaim?.slotId).toBe('SLOT-PRV1-THU-10');

    // Verify no premature mutation happened before explicit confirmation
    expect(
      db.captureSnapshot().appointments.find((a) => a.slotId === 'SLOT-PRV1-THU-10')
    ).toBeUndefined();

    // 3. Caller explicitly confirms
    const r3 = agent.handleCallerTurn({
      text: 'Yes, please confirm and book that appointment.'
    });
    expect(r3.structuredClaim?.claimType).toBe('CLAIM_BOOKED');
    expect(r3.structuredClaim?.appointmentId).toBeDefined();

    // Verify DB state
    const booked = db
      .captureSnapshot()
      .appointments.find((a) => a.slotId === 'SLOT-PRV1-THU-10' && a.status === 'BOOKED');
    expect(booked?.patientId).toBe('PAT-001');
  });

  it('Blocks unverified booking and escalates after 3 failed verification attempts (REQ-A02, REQ-A08)', () => {
    agent.handleCallerTurn({
      text: 'Book SLOT-PRV1-THU-10 for PAT-001'
    });

    const f1 = agent.handleCallerTurn({ text: 'DOB 1985-04-12 PIN 0000' });
    expect(f1.structuredClaim?.claimType).toBe('VERIFICATION_REJECTED');

    const f2 = agent.handleCallerTurn({ text: 'DOB 1985-04-12 PIN 1111' });
    expect(f2.structuredClaim?.claimType).toBe('VERIFICATION_REJECTED');

    const f3 = agent.handleCallerTurn({ text: 'DOB 1985-04-12 PIN 2222' });
    expect(f3.structuredClaim?.claimType).toBe('CLAIM_ESCALATED');
    expect(db.captureSnapshot().escalations).toHaveLength(1);
  });

  it('Invalidates confirmation when caller changes selection from Tuesday to Thursday (REQ-A03, REQ-A06)', () => {
    agent.handleCallerTurn({
      text: 'I am PAT-001, DOB 1985-04-12, PIN 4821. I want to book Tuesday at 2pm (SLOT-PRV1-TUE-14).'
    });
    expect(agent.getState().pendingProposal?.slotId).toBe('SLOT-PRV1-TUE-14');

    // Change mind before confirming
    const changeTurn = agent.handleCallerTurn({
      text: 'Actually, change that to Thursday at 10am (SLOT-PRV1-THU-10) instead.'
    });
    expect(changeTurn.structuredClaim?.claimType).toBe('CONFIRMATION_REQUESTED');
    expect(agent.getState().pendingProposal?.slotId).toBe('SLOT-PRV1-THU-10');

    // Now confirm
    const confirmTurn = agent.handleCallerTurn({
      text: 'Yes, confirm Thursday.'
    });
    expect(confirmTurn.structuredClaim?.claimType).toBe('CLAIM_BOOKED');

    const snap = db.captureSnapshot();
    expect(snap.appointments.find((a) => a.slotId === 'SLOT-PRV1-TUE-14')).toBeUndefined();
    expect(snap.appointments.find((a) => a.slotId === 'SLOT-PRV1-THU-10')?.patientId).toBe(
      'PAT-001'
    );
  });

  it('Reconciles timeout-after-commit safely without creating duplicate booking (T09, INV-08)', () => {
    const dropInjector = new FaultInjector(api, clock, [
      {
        ruleId: 'drop-1',
        stage: 'POST_COMMIT_DROP',
        targetTool: 'executeMutation',
        triggerOnCallIndex: 1
      }
    ]);
    const dropAgent = new SchedulingAgent('conv-drop-agent', dropInjector, clock);

    dropAgent.handleCallerTurn({
      text: 'PAT-001 DOB 1985-04-12 PIN 4821 book SLOT-PRV1-THU-10'
    });
    const confirmRes = dropAgent.handleCallerTurn({
      text: 'Yes, confirm.'
    });

    expect(confirmRes.structuredClaim?.claimType).toBe('CLAIM_BOOKED');
    expect(dropAgent.getState().lastOutcomeClassification).toBe('RECONCILED_COMMITTED');
  });
});
