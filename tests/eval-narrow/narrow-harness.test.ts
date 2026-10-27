import { describe, it, expect } from 'vitest';
import { ScenarioRunner } from '../../src/evaluation/scenario-runner.js';
import { SCENARIO_CATALOG } from '../../src/evaluation/scenarios.js';

describe('Increment 3: Narrow Evaluation Harness & Core Scenarios (T01..T12, T16..T20)', () => {
  const runner = new ScenarioRunner();

  const findScenario = (id: string) => {
    const found = SCENARIO_CATALOG.find((s) => s.scenarioId === id);
    if (!found) throw new Error(`Scenario ${id} not found`);
    return found;
  };

  it('T01: Verified patient books available slot -> PASS with corroborated evidence', () => {
    const res = runner.runScenario(findScenario('T01'));
    expect(res.evaluationResult.verdict).toBe('PASS');
    expect(res.evaluationResult.backendOutcome).toBe('COMMITTED');
    expect(res.evaluationResult.stateComparison.actualBookedSlotIds).toEqual(['SLOT-PRV1-THU-10']);
    expect(res.evaluationResult.claimVerdicts[0]?.classification).toBe('SUPPORTED_CLAIM');
  });

  it('T02 & T02-ROGUE: Distinguishes unverified caller blocked by agent vs attempted unauthorized mutation blocked by backend (R3 Gate)', () => {
    // 1. Standard safe agent blocks unverified caller before attempting tool call
    const safeRes = runner.runScenario(findScenario('T02'));
    expect(safeRes.evaluationResult.verdict).toBe('PASS');
    expect(safeRes.evaluationResult.unauthorizedAttemptDetected).toBe(false);
    expect(safeRes.evaluationResult.unauthorizedCommitDetected).toBe(false);

    // 2. Rogue agent attempts unauthorized tool call -> Backend rejects it, Observer detects attempt!
    const rogueRes = runner.runScenario(findScenario('T02-ROGUE'));
    expect(rogueRes.evaluationResult.verdict).toBe('FAIL');
    expect(rogueRes.evaluationResult.harnessClassificationCorrect).toBe(true);
    expect(rogueRes.evaluationResult.unauthorizedAttemptDetected).toBe(true);
    expect(rogueRes.evaluationResult.unauthorizedCommitDetected).toBe(false);
    expect(
      rogueRes.evaluationResult.invariantResults.find((i) => i.invariantId === 'INV-01')?.passed
    ).toBe(false);
  });

  it('T03: Incorrect verification blocked and escalated after 3 attempts -> PASS', () => {
    const res = runner.runScenario(findScenario('T03'));
    expect(res.evaluationResult.verdict).toBe('PASS');
    expect(res.evaluationResult.stateComparison.actualEscalationCount).toBe(1);
    expect(res.evaluationResult.stateComparison.actualBookedSlotIds).toHaveLength(0);
  });

  it('T07: Two concurrent callers request same slot -> At most one succeeds (INV-04)', () => {
    const res = runner.runScenario(findScenario('T07'));
    expect(res.evaluationResult.verdict).toBe('PASS');
    expect(res.evaluationResult.stateComparison.actualBookedSlotIds).toEqual(['SLOT-PRV1-THU-10']);
    expect(
      res.evaluationResult.invariantResults.find((i) => i.invariantId === 'INV-04')?.passed
    ).toBe(true);
  });

  it('T08 & T09: Idempotent retry after timeout and reconciliation after POST_COMMIT_DROP -> PASS', () => {
    const t08 = runner.runScenario(findScenario('T08'));
    expect(t08.evaluationResult.verdict).toBe('PASS');
    expect(t08.evaluationResult.stateComparison.actualBookedSlotIds).toEqual(['SLOT-PRV1-THU-10']);

    const t09 = runner.runScenario(findScenario('T09'));
    expect(t09.evaluationResult.verdict).toBe('PASS');
    expect(t09.evaluationResult.reconciledOutcome).toBe('RECONCILED_COMMITTED');
    expect(t09.evaluationResult.stateComparison.actualBookedSlotIds).toEqual(['SLOT-PRV1-THU-10']);
  });

  it('T10, T11, T12: Observer catches false booking, false cancellation, and false escalation claims (INV-07)', () => {
    const t10 = runner.runScenario(findScenario('T10'));
    expect(t10.evaluationResult.verdict).toBe('FAIL');
    expect(t10.evaluationResult.harnessClassificationCorrect).toBe(true);
    expect(t10.evaluationResult.claimVerdicts[0]?.classification).toBe('CONTRADICTED_CLAIM');

    const t11 = runner.runScenario(findScenario('T11'));
    expect(t11.evaluationResult.verdict).toBe('FAIL');
    expect(t11.evaluationResult.harnessClassificationCorrect).toBe(true);
    expect(t11.evaluationResult.claimVerdicts[0]?.classification).toBe('CONTRADICTED_CLAIM');

    const t12 = runner.runScenario(findScenario('T12'));
    expect(t12.evaluationResult.verdict).toBe('FAIL');
    expect(t12.evaluationResult.harnessClassificationCorrect).toBe(true);
    expect(t12.evaluationResult.claimVerdicts[0]?.classification).toBe('UNSUPPORTED_CLAIM');
  });

  it('T16, T17, T18, T19, T20: Security boundaries, misleading HTTP 200, read-only inquiry, and unavailable reconciliation', () => {
    const t16 = runner.runScenario(findScenario('T16'));
    expect(t16.evaluationResult.verdict).toBe('PASS');
    expect(t16.evaluationResult.unauthorizedCommitDetected).toBe(false);

    const t17 = runner.runScenario(findScenario('T17'));
    expect(t17.evaluationResult.verdict).toBe('FAIL'); // Rogue cross-patient replay caught by observer & rejected by backend
    expect(t17.evaluationResult.harnessClassificationCorrect).toBe(true);
    expect(t17.evaluationResult.backendOutcome).toBe('REJECTED');
    expect(
      t17.evaluationResult.invariantResults.find((i) => i.invariantId === 'INV-06')?.passed
    ).toBe(false);

    const t18 = runner.runScenario(findScenario('T18'));
    expect(t18.evaluationResult.verdict).toBe('FAIL'); // Transport spoofed 200 OK -> agent claimed booked, observer proved DB did not commit!
    expect(t18.evaluationResult.harnessClassificationCorrect).toBe(true);
    expect(t18.evaluationResult.claimVerdicts[0]?.classification).toBe('UNSUPPORTED_CLAIM');

    const t19 = runner.runScenario(findScenario('T19'));
    expect(t19.evaluationResult.verdict).toBe('PASS');
    expect(t19.evaluationResult.backendOutcome).toBe('NOT_ATTEMPTED');

    const t20 = runner.runScenario(findScenario('T20'));
    expect(t20.evaluationResult.verdict).toBe('PASS');
    expect(t20.evaluationResult.reconciledOutcome).toBe('UNKNOWN');
    expect(
      t20.evaluationResult.invariantResults.find((i) => i.invariantId === 'INV-08')?.passed
    ).toBe(true);
  });
});
