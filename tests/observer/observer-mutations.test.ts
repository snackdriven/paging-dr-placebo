import { describe, it, expect } from 'vitest';
import { ScenarioRunner } from '../../src/evaluation/scenario-runner.js';
import { SCENARIO_CATALOG } from '../../src/evaluation/scenarios.js';
import { IndependentObserver } from '../../src/evaluation/independent-observer.js';
import type { EvidenceBundle } from '../../src/evaluation/evidence-collector.js';

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.freeze(obj);
    for (const k of Object.keys(obj as Record<string, unknown>)) {
      const v = (obj as Record<string, unknown>)[k];
      if (v && typeof v === 'object' && !Object.isFrozen(v)) {
        deepFreeze(v);
      }
    }
  }
  return obj;
}

describe('Increment 6: Independent Observer Mutation Testing (REQ-C10, R6, OBS-01..OBS-09)', () => {
  const runner = new ScenarioRunner();
  const observer = new IndependentObserver();

  function getBaselinePassingBundle(): EvidenceBundle {
    const t01 = SCENARIO_CATALOG.find((s) => s.scenarioId === 'T01')!;
    return runner.runScenario(t01, 'obs-baseline').evidenceBundle;
  }

  it('Baseline T01 bundle passes all 10 invariants cleanly', () => {
    const base = getBaselinePassingBundle();
    const res = observer.evaluate(base);
    expect(res.verdict).toBe('PASS');
    expect(res.invariantResults.every((i) => i.passed)).toBe(true);
  });

  it('OBS-01 (False success message): Planted CLAIM_BOOKED for unbooked slot is caught as UNSUPPORTED_CLAIM (INV-07)', () => {
    const base = getBaselinePassingBundle();
    const mutated: EvidenceBundle = deepFreeze({
      ...structuredClone(base),
      agentTurns: [
        ...structuredClone(base.agentTurns),
        {
          schemaVersion: '1.0.0',
          turnIndex: base.agentTurns.length,
          timestampMs: base.postSnapshot!.capturedAtMs,
          speaker: 'AGENT',
          text: 'I also booked Tuesday at 2pm for you!',
          voiceEventType: 'NORMAL_TURN',
          playbackCanceled: false,
          structuredClaim: {
            claimType: 'CLAIM_BOOKED',
            patientId: 'PAT-001',
            slotId: 'SLOT-PRV1-TUE-14',
            appointmentId: 'APT-GHOST-999'
          }
        }
      ]
    });

    const res = observer.evaluate(mutated);
    expect(res.verdict).toBe('FAIL');
    expect(res.invariantResults.find((i) => i.invariantId === 'INV-07')?.passed).toBe(false);
    expect(
      res.claimVerdicts.some((c) => c.classification === 'UNSUPPORTED_CLAIM')
    ).toBe(true);
  });

  it('OBS-02 (Incorrect operation ID / audit mismatch): Planted mismatch between audit appointmentId and DB snapshot fails INV-10', () => {
    const base = getBaselinePassingBundle();
    const cloned = structuredClone(base);
    const commitEvt = cloned.auditEvents.find((e) => e.eventType === 'MUTATION_COMMITTED')!;
    commitEvt.details.appointmentId = 'APT-TAMPERED-ID';

    const res = observer.evaluate(deepFreeze(cloned));
    expect(res.verdict).toBe('FAIL');
    expect(res.invariantResults.find((i) => i.invariantId === 'INV-10')?.passed).toBe(false);
  });

  it('OBS-03 (Missing audit events): Deleting backend audit event for executed mutation yields INCONCLUSIVE and fails INV-10', () => {
    const base = getBaselinePassingBundle();
    const cloned = structuredClone(base);
    // Remove the commit audit event so sequence or operation coverage is broken
    const mutated: EvidenceBundle = deepFreeze({
      ...cloned,
      auditEvents: cloned.auditEvents.filter((e) => e.eventType !== 'MUTATION_COMMITTED')
    });

    const res = observer.evaluate(mutated);
    expect(['FAIL', 'INCONCLUSIVE']).toContain(res.verdict);
    expect(res.invariantResults.find((i) => i.invariantId === 'INV-10')?.passed).toBe(false);
  });

  it('OBS-04 (Duplicate mutations): Planting duplicate BOOKED appointments with same idempotencyKey fails INV-05', () => {
    const base = getBaselinePassingBundle();
    const cloned = structuredClone(base);
    const existingNewAppt = cloned.postSnapshot!.appointments.find(
      (a) => a.slotId === 'SLOT-PRV1-THU-10'
    )!;
    cloned.postSnapshot!.appointments.push({
      ...existingNewAppt,
      appointmentId: 'APT-DUPLICATE-1002',
      slotId: 'SLOT-PRV1-TUE-14'
    });

    const res = observer.evaluate(deepFreeze(cloned));
    expect(res.verdict).toBe('FAIL');
    expect(res.invariantResults.find((i) => i.invariantId === 'INV-05')?.passed).toBe(false);
  });

  it('OBS-05 (Incorrect appointment ownership): Planting appointment owned by unverified patient PAT-003 fails INV-06', () => {
    const base = getBaselinePassingBundle();
    const cloned = structuredClone(base);
    const booked = cloned.postSnapshot!.appointments.find(
      (a) => a.slotId === 'SLOT-PRV1-THU-10'
    )!;
    booked.patientId = 'PAT-003'; // PAT-001 was verified, not PAT-003!

    const res = observer.evaluate(deepFreeze(cloned));
    expect(res.verdict).toBe('FAIL');
    expect(res.invariantResults.find((i) => i.invariantId === 'INV-06')?.passed).toBe(false);
  });

  it('OBS-06 (Incorrect final-state snapshot): Tampering with postSnapshot to remove expected booking fails state comparison', () => {
    const base = getBaselinePassingBundle();
    const cloned = structuredClone(base);
    cloned.postSnapshot!.appointments = cloned.postSnapshot!.appointments.filter(
      (a) => a.slotId !== 'SLOT-PRV1-THU-10'
    );

    const res = observer.evaluate(deepFreeze(cloned));
    expect(res.verdict).toBe('FAIL');
    expect(res.stateComparison.matchesExpected).toBe(false);
  });

  it('OBS-07 (Misleading HTTP 200 response): Tool event claims 200 OK COMMITTED while DB/Audit show no commit -> Observer flags failure', () => {
    const t18 = SCENARIO_CATALOG.find((s) => s.scenarioId === 'T18')!;
    const res = runner.runScenario(t18, 'obs-07').evaluationResult;
    expect(res.verdict).toBe('FAIL');
    expect(res.invariantResults.find((i) => i.invariantId === 'INV-07')?.passed).toBe(false);
  });

  it('OBS-08 (Corrupted or missing snapshot): Missing postSnapshot returns INCONCLUSIVE, never PASS', () => {
    const base = getBaselinePassingBundle();
    const corrupted: EvidenceBundle = deepFreeze({
      ...structuredClone(base),
      postSnapshot: null
    });

    const res = observer.evaluate(corrupted);
    expect(res.verdict).toBe('INCONCLUSIVE');
    expect(res.observabilityGaps).toContain('MISSING_DATABASE_SNAPSHOT');
  });

  it('OBS-09 (Observer immutability): Attempting to pass unfrozen snapshot fails INV-09', () => {
    const base = getBaselinePassingBundle();
    const unfrozenClone = structuredClone(base); // Not frozen!
    const res = observer.evaluate(unfrozenClone);
    expect(res.verdict).toBe('FAIL');
    expect(res.invariantResults.find((i) => i.invariantId === 'INV-09')?.passed).toBe(false);
  });
});
