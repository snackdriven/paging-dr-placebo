import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
import { PLAYGROUND_HTML } from './playground-html.js';

export type PlaygroundEngineType =
  | 'DETERMINISTIC'
  | 'LMSTUDIO_GUARDED'
  | 'LMSTUDIO_RAW_UNGUARDED';

export class PlaygroundServer {
  private server: Server | null = null;
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
  private lmStudioModel: string = 'hermes-3-llama-3.1-8b';
  private faultRules: FaultRule[] = [];
  private conversationId = 'conv-interactive-1';
  private expectedFinalIntentSlotId: string | null = null;

  constructor() {
    this.resetInteractiveSession();
  }

  public resetInteractiveSession(options?: {
    engineType?: PlaygroundEngineType;
    agentMode?: AgentBehaviorMode;
    lmStudioModel?: string;
    faultStage?: FaultStage | 'NONE';
    expectedFinalIntentSlotId?: string | null;
  }): void {
    if (options?.engineType) this.engineType = options.engineType;
    if (options?.agentMode) this.agentMode = options.agentMode;
    if (options?.lmStudioModel) this.lmStudioModel = options.lmStudioModel;
    if (options?.expectedFinalIntentSlotId !== undefined) {
      this.expectedFinalIntentSlotId = options.expectedFinalIntentSlotId;
    }

    if (options?.faultStage !== undefined) {
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

  public getInteractiveState() {
    const postSnapshot = this.db.captureSnapshot();
    this.collector.recordPostSnapshot(postSnapshot);

    const activeTurns =
      this.engineType === 'DETERMINISTIC'
        ? this.deterministicAgent.getTurns()
        : this.llmAgent.getTurns();

    // Derive dynamic expected outcome for live interactive session so stateComparison reflects actual commits unless user overrides
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
      scenarioId: 'INTERACTIVE-SANDBOX',
      title: 'Interactive UI Playground Session',
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
        expectedFinalIntentSlotId: this.expectedFinalIntentSlotId,
        expectUnauthorizedAttemptBlocked: false
      }
    };

    const bundle = this.collector.buildFrozenBundle({
      runId: 'run-interactive-sandbox',
      conversationId: this.conversationId,
      scenario: dynamicScenario,
      agentTurns: activeTurns,
      toolEvents: this.injector.getToolEvents(),
      voiceEvents: this.voiceSim.getVoiceEvents(),
      auditEvents: this.db.getAuditEvents()
    });

    const evaluation =
      activeTurns.length > 0 ? this.observer.evaluate(bundle) : null;

    return {
      config: {
        engineType: this.engineType,
        agentMode: this.agentMode,
        lmStudioModel: this.lmStudioModel,
        faultRules: this.faultRules,
        clockIso: this.clock.isoNow()
      },
      agentInternalState:
        this.engineType === 'DETERMINISTIC' ? this.deterministicAgent.getState() : null,
      llmTelemetry: this.llmAdapter.getTotalTokenSummary(),
      snapshot: postSnapshot,
      turns: activeTurns,
      toolEvents: this.injector.getToolEvents(),
      voiceEvents: this.voiceSim.getVoiceEvents(),
      auditEvents: this.db.getAuditEvents(),
      evaluation
    };
  }

  public async start(port: number = 4321): Promise<string> {
    return new Promise((resolve) => {
      this.server = createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (err) {
          this.sendJson(res, 500, {
            error: err instanceof Error ? err.message : 'INTERNAL_SERVER_ERROR'
          });
        }
      });
      this.server.listen(port, '127.0.0.1', () => {
        const addr = this.server!.address() as AddressInfo;
        resolve(`http://127.0.0.1:${addr.port}`);
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
      this.server = null;
    });
  }

  private async readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PLAYGROUND_HTML);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/playground/state') {
      this.sendJson(res, 200, this.getInteractiveState());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/playground/scenarios') {
      this.sendJson(res, 200, { scenarios: SCENARIO_CATALOG });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/playground/reset') {
      const body = await this.readBody(req);
      this.resetInteractiveSession({
        engineType: body.engineType as PlaygroundEngineType | undefined,
        agentMode: body.agentMode as AgentBehaviorMode | undefined,
        lmStudioModel: body.lmStudioModel as string | undefined,
        faultStage: body.faultStage as FaultStage | 'NONE' | undefined,
        expectedFinalIntentSlotId: (body.expectedFinalIntentSlotId as string | null) ?? null
      });
      this.sendJson(res, 200, this.getInteractiveState());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/playground/turn') {
      const body = await this.readBody(req);
      const text = String(body.text ?? '');
      const voiceEventType = (body.voiceEventType as VoiceEventType | undefined) ?? 'NORMAL_TURN';
      const advanceClockMs = Number(body.advanceClockMs ?? 500);

      if (this.engineType === 'DETERMINISTIC') {
        this.voiceSim.dispatchVoiceStep(this.deterministicAgent, {
          utterance: text,
          voiceEventType,
          advanceClockMs
        });
      } else {
        this.clock.advanceMs(advanceClockMs);
        await this.llmAgent.handleCallerTurnAsync(text);
      }

      this.sendJson(res, 200, this.getInteractiveState());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/playground/run-scenario') {
      const body = await this.readBody(req);
      const scenarioId = String(body.scenarioId ?? 'T01');
      const found = SCENARIO_CATALOG.find((s) => s.scenarioId === scenarioId);
      if (!found) {
        this.sendJson(res, 404, { error: `Scenario ${scenarioId} not found` });
        return;
      }
      const artifact = this.runner.runScenario(found, 'ui-run');
      this.sendJson(res, 200, artifact);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/playground/run-all') {
      const artifacts = this.runner.runAll(SCENARIO_CATALOG, 'ui-batch');
      this.sendJson(res, 200, { artifacts });
      return;
    }

    this.sendJson(res, 404, { error: 'NOT_FOUND' });
  }
}
