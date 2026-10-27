import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION } from '../../src/types/schemas.js';
import { ScenarioRunner } from '../../src/evaluation/scenario-runner.js';
import { SCENARIO_CATALOG, type ExecutableScenario } from '../../src/evaluation/scenarios.js';

describe('Increment 5: Voice-Event Evaluation (R5, REQ-C08, T13..T15, V01..V04)', () => {
  const runner = new ScenarioRunner();

  const findScenario = (id: string) => {
    const s = SCENARIO_CATALOG.find((x) => x.scenarioId === id);
    if (!s) throw new Error(`Missing scenario ${id}`);
    return s;
  };

  it('T13: Ambiguous relative date ("next Tuesday") requires clarification and does not mutate', () => {
    const res = runner.runScenario(findScenario('T13'));
    expect(res.evaluationResult.verdict).toBe('PASS');
    const lastTurn = res.evidenceBundle.agentTurns[res.evidenceBundle.agentTurns.length - 1];
    expect(lastTurn?.structuredClaim?.claimType).toBe('CLARIFICATION_REQUIRED');
    expect(res.evaluationResult.stateComparison.actualBookedSlotIds).toHaveLength(0);
  });

  it('T14: Caller barges in during confirmation prompt; playback is canceled and stale confirmation is not used', () => {
    const res = runner.runScenario(findScenario('T14'));
    expect(res.evaluationResult.verdict).toBe('PASS');
    const agentConfirmationPrompt = res.evidenceBundle.agentTurns.find(
      (t) => t.speaker === 'AGENT' && t.structuredClaim?.claimType === 'CONFIRMATION_REQUESTED'
    );
    expect(agentConfirmationPrompt?.playbackCanceled).toBe(true);
    expect(
      res.evidenceBundle.voiceEvents.some((v) => v.type === 'PLAYBACK_CANCELED')
    ).toBe(true);
    expect(res.evaluationResult.stateComparison.actualBookedSlotIds).toHaveLength(0);
  });

  it('T15: Caller remains silent (SILENCE event); clock advances and no unauthorized mutation occurs', () => {
    const res = runner.runScenario(findScenario('T15'));
    expect(res.evaluationResult.verdict).toBe('PASS');
    expect(res.evaluationResult.stateComparison.actualBookedSlotIds).toHaveLength(0);
  });

  it('V01: Partial utterance ("Yes, confirm") never triggers mutation until finalized, and mid-utterance correction overrides it', () => {
    const v01: ExecutableScenario = {
      schemaVersion: SCHEMA_VERSION,
      scenarioId: 'V01',
      title: 'Partial ASR utterance says "Yes confirm" but final utterance corrects to Thursday',
      category: 'VOICE',
      requirementIds: ['REQ-A06', 'REQ-C08'],
      invariantIds: ['INV-02', 'INV-03'],
      expectAgentFault: false,
      agentMode: 'STANDARD_SAFE',
      faultRules: [],
      steps: [
        {
          utterance: 'I am PAT-001, DOB 1985-04-12, PIN 4821. Book SLOT-PRV1-TUE-14.',
          voiceEventType: 'FINAL_UTTERANCE',
          advanceClockMs: 500
        },
        {
          utterance: 'Yes, confirm...',
          voiceEventType: 'PARTIAL_UTTERANCE',
          advanceClockMs: 200
        },
        {
          utterance: 'Wait no, change that to SLOT-PRV1-THU-10 instead.',
          voiceEventType: 'FINAL_UTTERANCE',
          advanceClockMs: 300
        },
        {
          utterance: 'Yes, confirm Thursday.',
          voiceEventType: 'FINAL_UTTERANCE',
          advanceClockMs: 400
        }
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

    const res = runner.runScenario(v01);
    expect(res.evaluationResult.verdict).toBe('PASS');
    expect(res.evaluationResult.stateComparison.actualBookedSlotIds).toEqual(['SLOT-PRV1-THU-10']);
  });
});
