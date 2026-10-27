import {
  SCHEMA_VERSION,
  type FaultRule,
  type FaultStage,
  type OperationOutcome,
  type ScenarioDefinition,
  type VoiceEventType
} from '../types/schemas.js';
import { ControllableClock } from '../utils/clock.js';
import { SchedulingDatabase } from '../backend/database.js';
import { VerificationService } from '../backend/verification-service.js';
import { AppointmentRepository } from '../backend/appointment-repository.js';
import { SchedulingApi } from '../backend/scheduling-api.js';
import { FaultInjector } from '../faults/fault-injector.js';
import { SchedulingAgent, type AgentBehaviorMode } from '../agent/scheduling-agent.js';
import { LmStudioModelAdapter, LiveLlmSchedulingAgent } from '../agent/llm-adapter.js';
import { VoiceEventSimulator } from '../simulator/voice-event-simulator.js';
import { EvidenceCollector } from '../evaluation/evidence-collector.js';
import { IndependentObserver } from '../evaluation/independent-observer.js';
import { ScenarioRunner } from '../evaluation/scenario-runner.js';
import { SCENARIO_CATALOG } from '../evaluation/scenarios.js';

type PlaygroundEngineType =
  | 'DETERMINISTIC'
  | 'LMSTUDIO_GUARDED'
  | 'LMSTUDIO_RAW_UNGUARDED';

class BrowserPlaygroundController {
  private clock!: ControllableClock;
  private db!: SchedulingDatabase;
  private verifySvc!: VerificationService;
  private repo!: AppointmentRepository;
  private api!: SchedulingApi;
  private injector!: FaultInjector;
  private deterministicAgent!: SchedulingAgent;
  private llmAdapter!: LmStudioModelAdapter;
  private llmAgent!: LiveLlmSchedulingAgent;
  private voiceSim!: VoiceEventSimulator;
  private collector!: EvidenceCollector;
  private readonly observer = new IndependentObserver();
  private readonly runner = new ScenarioRunner();

  private engineType: PlaygroundEngineType = 'DETERMINISTIC';
  private agentMode: AgentBehaviorMode = 'STANDARD_SAFE';
  private lmStudioModel = 'hermes-3-llama-3.1-8b';
  private faultRules: FaultRule[] = [];
  private readonly conversationId = 'conv-browser-1';

  constructor() {
    this.reset({});
  }

  public reset(options: {
    engineType?: PlaygroundEngineType;
    agentMode?: AgentBehaviorMode;
    lmStudioModel?: string;
    faultStage?: FaultStage | 'NONE';
  }): void {
    if (options.engineType) this.engineType = options.engineType;
    if (options.agentMode) this.agentMode = options.agentMode;
    if (options.lmStudioModel) this.lmStudioModel = options.lmStudioModel;

    if (options.faultStage !== undefined) {
      if (options.faultStage === 'NONE') {
        this.faultRules = [];
      } else {
        this.faultRules = [
          {
            ruleId: `ui-fault-${options.faultStage.toLowerCase()}`,
            stage: options.faultStage,
            targetTool:
              options.faultStage === 'RECONCILIATION_UNAVAILABLE'
                ? 'reconcileOperation'
                : 'executeMutation',
            triggerOnCallIndex: 1
          }
        ];
      }
    }

    this.clock = new ControllableClock('2026-10-27T09:00:00.000Z');
    this.db = new SchedulingDatabase(':memory:', this.clock);
    this.db.resetAndSeed();

    this.verifySvc = new VerificationService(this.db, this.clock);
    this.repo = new AppointmentRepository(this.db, this.clock, this.verifySvc);
    this.api = new SchedulingApi(this.db, this.verifySvc, this.repo, this.clock);

    this.collector = new EvidenceCollector();
    this.collector.recordPreSnapshot(this.db.captureSnapshot());

    this.injector = new FaultInjector(this.api, this.clock, this.faultRules);
    this.deterministicAgent = new SchedulingAgent(
      this.conversationId,
      this.injector,
      this.clock,
      this.agentMode
    );
    this.llmAdapter = new LmStudioModelAdapter({
      modelId: this.lmStudioModel,
      temperature: 0
    });
    this.llmAgent = new LiveLlmSchedulingAgent(
      this.conversationId,
      this.injector,
      this.clock,
      this.llmAdapter,
      this.engineType !== 'LMSTUDIO_RAW_UNGUARDED'
    );
    this.voiceSim = new VoiceEventSimulator(this.clock);
  }

  public async sendTurn(params: {
    text: string;
    voiceEventType: VoiceEventType;
    advanceClockMs: number;
  }) {
    if (this.engineType === 'DETERMINISTIC') {
      this.voiceSim.dispatchVoiceStep(this.deterministicAgent, {
        utterance: params.text,
        voiceEventType: params.voiceEventType,
        advanceClockMs: params.advanceClockMs
      });
    } else {
      this.clock.advanceMs(params.advanceClockMs);
      await this.llmAgent.handleCallerTurnAsync(params.text);
    }
    return this.getState();
  }

  public getState() {
    const postSnapshot = this.db.captureSnapshot();
    this.collector.recordPostSnapshot(postSnapshot);

    const activeTurns =
      this.engineType === 'DETERMINISTIC'
        ? this.deterministicAgent.getTurns()
        : this.llmAgent.getTurns();

    const preBookedIds = new Set(['APT-SEED-001', 'APT-SEED-PAT1']);
    const newlyBookedSlotIds = postSnapshot.appointments
      .filter((a) => a.status === 'BOOKED' && !preBookedIds.has(a.appointmentId))
      .map((a) => a.slotId);
    const newlyCanceledIds = postSnapshot.appointments
      .filter((a) => a.status === 'CANCELED')
      .map((a) => a.appointmentId);

    const audits = this.db.getAuditEvents();
    const tools = this.injector.getToolEvents();
    const commitAudits = audits.filter((a) => a.eventType === 'MUTATION_COMMITTED');
    const replayAudits = audits.filter((a) => a.eventType === 'MUTATION_IDEMPOTENT_REPLAY');
    const rejectAudits = audits.filter((a) => a.eventType === 'MUTATION_REJECTED');

    const derivedBackendOutcome: OperationOutcome =
      commitAudits.length > 0
        ? 'COMMITTED'
        : replayAudits.length > 0
          ? 'NO_OP'
          : rejectAudits.length > 0
            ? 'REJECTED'
            : 'NOT_ATTEMPTED';

    const reconEvents = tools.filter((t) => t.toolName === 'reconcileOperation');
    const lastMutationTool = [...tools].reverse().find((t) => t.toolName === 'executeMutation');
    let derivedReconciledOutcome: OperationOutcome = derivedBackendOutcome;
    if (reconEvents.length > 0) {
      derivedReconciledOutcome = String(
        reconEvents[reconEvents.length - 1]!.response.outcome ?? 'UNKNOWN'
      ) as OperationOutcome;
    } else if (lastMutationTool?.transportOutcome === 'UNKNOWN') {
      derivedReconciledOutcome = 'UNKNOWN';
    } else if (replayAudits.length > 0 && commitAudits.length > 0) {
      derivedReconciledOutcome = 'COMMITTED';
    }

    const dynamicScenario: ScenarioDefinition = {
      schemaVersion: SCHEMA_VERSION,
      scenarioId: 'BROWSER-SANDBOX',
      title: 'In-Browser Interactive Playground Session',
      category: 'CONVERSATION',
      requirementIds: ['REQ-C02', 'REQ-C04', 'REQ-C05'],
      invariantIds: [
        'INV-01',
        'INV-02',
        'INV-03',
        'INV-04',
        'INV-05',
        'INV-06',
        'INV-07',
        'INV-08',
        'INV-09',
        'INV-10'
      ],
      expectAgentFault:
        this.agentMode !== 'STANDARD_SAFE' || this.engineType === 'LMSTUDIO_RAW_UNGUARDED',
      faultRules: this.faultRules,
      expectedOutcome: {
        backendOutcome: derivedBackendOutcome,
        reconciledOutcome: derivedReconciledOutcome,
        expectedBookedSlotIds: newlyBookedSlotIds,
        expectedCanceledAppointmentIds: newlyCanceledIds,
        expectedEscalationCount: postSnapshot.escalations.length,
        expectedFinalIntentSlotId: null,
        expectUnauthorizedAttemptBlocked: false
      }
    };

    const bundle = this.collector.buildFrozenBundle({
      runId: 'run-browser-sandbox',
      conversationId: this.conversationId,
      scenario: dynamicScenario,
      agentTurns: activeTurns,
      toolEvents: this.injector.getToolEvents(),
      voiceEvents: this.voiceSim.getVoiceEvents(),
      auditEvents: this.db.getAuditEvents()
    });

    const evaluation = activeTurns.length > 0 ? this.observer.evaluate(bundle) : null;

    return {
      config: {
        engineType: this.engineType,
        agentMode: this.agentMode,
        lmStudioModel: this.lmStudioModel,
        faultRules: this.faultRules,
        clockIso: this.clock.isoNow()
      },
      llmTelemetry: this.llmAdapter.getTotalTokenSummary(),
      snapshot: postSnapshot,
      turns: activeTurns,
      toolEvents: this.injector.getToolEvents(),
      voiceEvents: this.voiceSim.getVoiceEvents(),
      auditEvents: this.db.getAuditEvents(),
      evaluation
    };
  }

  public runScenario(scenarioId: string) {
    const found = SCENARIO_CATALOG.find((s) => s.scenarioId === scenarioId);
    if (!found) throw new Error(`Scenario ${scenarioId} not found`);
    return this.runner.runScenario(found, 'gh-pages');
  }

  public runAll() {
    return this.runner.runAll(SCENARIO_CATALOG, 'gh-pages-batch');
  }
}

// Intercept window.fetch when running as a static GitHub Pages site so the exact same UI works serverless!
const controller = new BrowserPlaygroundController();
const originalFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  if (urlStr.startsWith('/api/playground/')) {
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (urlStr === '/api/playground/state') {
      return new Response(JSON.stringify(controller.getState()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (urlStr === '/api/playground/scenarios') {
      return new Response(JSON.stringify({ scenarios: SCENARIO_CATALOG }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (urlStr === '/api/playground/reset') {
      controller.reset(body);
      return new Response(JSON.stringify(controller.getState()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (urlStr === '/api/playground/turn') {
      const state = await controller.sendTurn({
        text: String(body.text ?? ''),
        voiceEventType: body.voiceEventType ?? 'NORMAL_TURN',
        advanceClockMs: Number(body.advanceClockMs ?? 500)
      });
      return new Response(JSON.stringify(state), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (urlStr === '/api/playground/run-scenario') {
      const artifact = controller.runScenario(String(body.scenarioId ?? 'T01'));
      return new Response(JSON.stringify(artifact), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (urlStr === '/api/playground/run-all') {
      const artifacts = controller.runAll();
      return new Response(JSON.stringify({ artifacts }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  return originalFetch(input, init);
};
