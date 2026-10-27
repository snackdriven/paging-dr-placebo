import type { EvaluationResult } from '../types/schemas.js';
import { ControllableClock } from '../utils/clock.js';
import { SchedulingDatabase } from '../backend/database.js';
import { VerificationService } from '../backend/verification-service.js';
import { AppointmentRepository } from '../backend/appointment-repository.js';
import { SchedulingApi } from '../backend/scheduling-api.js';
import { FaultInjector } from '../faults/fault-injector.js';
import { SchedulingAgent } from '../agent/scheduling-agent.js';
import { CallerSimulator } from '../simulator/caller-simulator.js';
import { VoiceEventSimulator } from '../simulator/voice-event-simulator.js';
import { EvidenceCollector, type EvidenceBundle } from './evidence-collector.js';
import { IndependentObserver } from './independent-observer.js';
import type { ExecutableScenario } from './scenarios.js';

export interface ScenarioExecutionArtifact {
  readonly scenario: ExecutableScenario;
  readonly evidenceBundle: EvidenceBundle;
  readonly evaluationResult: EvaluationResult;
}

export class ScenarioRunner {
  private readonly observer = new IndependentObserver();

  public runScenario(
    scenario: ExecutableScenario,
    runSeed: string = 'seed-default'
  ): ScenarioExecutionArtifact {
    const clock = new ControllableClock('2026-10-27T09:00:00.000Z');
    const db = new SchedulingDatabase(':memory:', clock);
    db.resetAndSeed();

    const verificationService = new VerificationService(db, clock);
    const repository = new AppointmentRepository(db, clock, verificationService);
    const api = new SchedulingApi(db, verificationService, repository, clock);

    const collector = new EvidenceCollector();
    collector.recordPreSnapshot(db.captureSnapshot());

    const conversationId = `conv-${scenario.scenarioId.toLowerCase()}-${runSeed}`;
    const runId = `run-${scenario.scenarioId.toLowerCase()}-${runSeed}`;

    const injector = new FaultInjector(api, clock, scenario.faultRules);
    const agent = new SchedulingAgent(conversationId, injector, clock, scenario.agentMode);
    const caller = new CallerSimulator(scenario.steps);
    const voiceSim = new VoiceEventSimulator(clock);

    // Optional secondary concurrent caller session sharing the same database & slot contention (T07)
    let partnerAgent: SchedulingAgent | null = null;
    let partnerCaller: CallerSimulator | null = null;
    if (scenario.concurrentPartnerSteps && scenario.concurrentPartnerSteps.length > 0) {
      const partnerInjector = new FaultInjector(api, clock, []);
      partnerAgent = new SchedulingAgent(
        `${conversationId}-partner`,
        partnerInjector,
        clock,
        'STANDARD_SAFE'
      );
      partnerCaller = new CallerSimulator(scenario.concurrentPartnerSteps);
    }

    while (caller.hasNextStep()) {
      const step = caller.nextStep()!;

      if (step.injectCrossPatientTokenFromPatientId) {
        // Issue a legitimate token for Patient A in this session, then let rogue agent replay it for Patient B (T17)
        const issued = api.verifyPatient({
          conversationId,
          patientId: step.injectCrossPatientTokenFromPatientId,
          dob: '1985-04-12',
          verificationPin: '4821'
        });
        if (issued.token) {
          agent.setInjectedTokenForTesting(issued.token);
        }
      }

      voiceSim.dispatchVoiceStep(agent, {
        utterance: step.utterance,
        voiceEventType: step.voiceEventType,
        advanceClockMs: step.advanceClockMs
      });

      if (partnerAgent && partnerCaller?.hasNextStep()) {
        const pStep = partnerCaller.nextStep()!;
        partnerAgent.handleCallerTurn({
          text: pStep.utterance,
          voiceEventType: pStep.voiceEventType
        });
      }
    }

    collector.recordPostSnapshot(db.captureSnapshot());

    const evidenceBundle = collector.buildFrozenBundle({
      runId,
      conversationId,
      scenario,
      agentTurns: agent.getTurns(),
      toolEvents: injector.getToolEvents(),
      voiceEvents: voiceSim.getVoiceEvents(),
      auditEvents: db.getAuditEvents()
    });

    const evaluationResult = this.observer.evaluate(evidenceBundle);

    return {
      scenario,
      evidenceBundle,
      evaluationResult
    };
  }

  public runAll(
    scenarios: readonly ExecutableScenario[],
    runSeed: string = 'seed-1'
  ): ScenarioExecutionArtifact[] {
    return scenarios.map((s) => this.runScenario(s, runSeed));
  }
}
