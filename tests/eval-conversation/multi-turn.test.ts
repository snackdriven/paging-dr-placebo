import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION } from '../../src/types/schemas.js';
import { ScenarioRunner } from '../../src/evaluation/scenario-runner.js';
import { SCENARIO_CATALOG, type ExecutableScenario } from '../../src/evaluation/scenarios.js';

describe('Increment 4: Multi-Turn Conversational Simulations (R4, T04..T06, M01..M05)', () => {
  const runner = new ScenarioRunner();

  const findScenario = (id: string) => {
    const s = SCENARIO_CATALOG.find((x) => x.scenarioId === id);
    if (!s) throw new Error(`Missing scenario ${id}`);
    return s;
  };

  it('T04: Caller changes Tuesday to Thursday -> Only Thursday is booked (INV-03)', () => {
    const res = runner.runScenario(findScenario('T04'));
    expect(res.evaluationResult.verdict).toBe('PASS');
    expect(res.evaluationResult.stateComparison.actualBookedSlotIds).toEqual(['SLOT-PRV1-THU-10']);
  });

  it('T05: Caller changes date before confirmation and ends conversation -> Zero mutations (INV-02)', () => {
    const res = runner.runScenario(findScenario('T05'));
    expect(res.evaluationResult.verdict).toBe('PASS');
    expect(res.evaluationResult.stateComparison.actualBookedSlotIds).toHaveLength(0);
  });

  it('T06: Caller switches patient identity from PAT-001 to PAT-002 -> Reverification enforced (INV-06)', () => {
    const res = runner.runScenario(findScenario('T06'));
    expect(res.evaluationResult.verdict).toBe('PASS');
    const newlyBooked = res.evidenceBundle.postSnapshot?.appointments.find(
      (a) => a.slotId === 'SLOT-PRV1-THU-10' && a.status === 'BOOKED'
    );
    expect(newlyBooked?.patientId).toBe('PAT-002');
  });

  it('M01: Caller switches from booking a new appointment to rescheduling an existing appointment (APT-SEED-PAT1)', () => {
    const m01: ExecutableScenario = {
      schemaVersion: SCHEMA_VERSION,
      scenarioId: 'M01',
      title: 'Caller starts booking Tuesday, then switches to rescheduling APT-SEED-PAT1 to Friday',
      category: 'CONVERSATION',
      requirementIds: ['REQ-A01', 'REQ-A03', 'REQ-A06', 'REQ-B04', 'REQ-C01'],
      invariantIds: ['INV-02', 'INV-03'],
      expectAgentFault: false,
      agentMode: 'STANDARD_SAFE',
      faultRules: [],
      steps: [
        {
          utterance:
            'I am PAT-001, DOB 1985-04-12, PIN 4821. I want to book SLOT-PRV1-TUE-14.'
        },
        {
          utterance:
            'Wait, instead of a new booking, please reschedule my existing appointment APT-SEED-PAT1 to SLOT-PRV2-FRI-15.'
        },
        {
          utterance: 'Yes, confirm that reschedule.'
        }
      ],
      expectedOutcome: {
        backendOutcome: 'COMMITTED',
        reconciledOutcome: 'COMMITTED',
        expectedBookedSlotIds: [],
        expectedCanceledAppointmentIds: [],
        expectedEscalationCount: 0,
        expectedFinalIntentSlotId: 'SLOT-PRV2-FRI-15',
        expectUnauthorizedAttemptBlocked: false
      }
    };

    const res = runner.runScenario(m01);
    expect(res.evaluationResult.verdict).toBe('PASS');
    const updatedAppt = res.evidenceBundle.postSnapshot?.appointments.find(
      (a) => a.appointmentId === 'APT-SEED-PAT1'
    );
    expect(updatedAppt?.slotId).toBe('SLOT-PRV2-FRI-15');
    expect(
      res.evidenceBundle.postSnapshot?.appointments.find((a) => a.slotId === 'SLOT-PRV1-TUE-14')
    ).toBeUndefined();
  });

  it('M02: Caller proposes booking, withdraws confirmation ("never mind"), then confirms a cancellation instead', () => {
    const m02: ExecutableScenario = {
      schemaVersion: SCHEMA_VERSION,
      scenarioId: 'M02',
      title: 'Caller withdraws pending booking confirmation and switches to canceling APT-SEED-PAT1',
      category: 'CONVERSATION',
      requirementIds: ['REQ-A03', 'REQ-A06', 'REQ-B04'],
      invariantIds: ['INV-02', 'INV-03'],
      expectAgentFault: false,
      agentMode: 'STANDARD_SAFE',
      faultRules: [],
      steps: [
        {
          utterance:
            'I am PAT-001, DOB 1985-04-12, PIN 4821. I want to book SLOT-PRV1-THU-10.'
        },
        {
          utterance: 'Never mind, do not book that.'
        },
        {
          utterance: 'Please cancel my appointment APT-SEED-PAT1.'
        },
        {
          utterance: 'Yes, confirm.'
        }
      ],
      expectedOutcome: {
        backendOutcome: 'COMMITTED',
        reconciledOutcome: 'COMMITTED',
        expectedBookedSlotIds: [],
        expectedCanceledAppointmentIds: ['APT-SEED-PAT1'],
        expectedEscalationCount: 0,
        expectedFinalIntentSlotId: null,
        expectUnauthorizedAttemptBlocked: false
      }
    };

    const res = runner.runScenario(m02);
    expect(res.evaluationResult.verdict).toBe('PASS');
    expect(res.evaluationResult.stateComparison.actualCanceledAppointmentIds).toEqual([
      'APT-SEED-PAT1'
    ]);
  });

  it('M03: Caller repeatedly requests an already-booked slot (SLOT-PRV1-TUE-09), gets rejected, then selects available SLOT-PRV1-THU-10', () => {
    const m03: ExecutableScenario = {
      schemaVersion: SCHEMA_VERSION,
      scenarioId: 'M03',
      title: 'Caller requests unavailable slot twice, then switches to available Thursday slot',
      category: 'CONVERSATION',
      requirementIds: ['REQ-A03', 'REQ-A07', 'REQ-B05'],
      invariantIds: ['INV-04', 'INV-07'],
      expectAgentFault: false,
      agentMode: 'STANDARD_SAFE',
      faultRules: [],
      steps: [
        {
          utterance:
            'I am PAT-001, DOB 1985-04-12, PIN 4821. Book SLOT-PRV1-TUE-09.'
        },
        { utterance: 'Yes, confirm.' },
        { utterance: 'Try SLOT-PRV1-TUE-09 again please.' },
        { utterance: 'Yes, confirm.' },
        { utterance: 'Okay, change to SLOT-PRV1-THU-10 instead.' },
        { utterance: 'Yes, confirm.' }
      ],
      expectedOutcome: {
        backendOutcome: 'COMMITTED',
        reconciledOutcome: 'COMMITTED',
        expectedBookedSlotIds: ['SLOT-PRV1-THU-10'],
        expectedCanceledAppointmentIds: [],
        expectedEscalationCount: 0,
        expectedFinalIntentSlotId: 'SLOT-PRV1-THU-10',
        expectUnauthorizedAttemptBlocked: false
      }
    };

    const res = runner.runScenario(m03);
    expect(res.evaluationResult.verdict).toBe('PASS');
    expect(res.evaluationResult.stateComparison.actualBookedSlotIds).toEqual(['SLOT-PRV1-THU-10']);
  });
});
