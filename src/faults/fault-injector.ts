import {
  SCHEMA_VERSION,
  type FaultRule,
  type OperationRequest,
  type OperationResult,
  type ToolEvent,
  type Provider,
  type EscalationRecord
} from '../types/schemas.js';
import { ControllableClock } from '../utils/clock.js';
import { SchedulingApi, type SlotAvailabilityView } from '../backend/scheduling-api.js';
import type {
  VerifyPatientInput,
  VerifyPatientOutput
} from '../backend/verification-service.js';

export class FaultInjector {
  private readonly api: SchedulingApi;
  private readonly clock: ControllableClock;
  private readonly rules: FaultRule[];
  private readonly callCounters = new Map<string, number>();
  private readonly toolEvents: ToolEvent[] = [];
  private sequenceCounter = 0;

  constructor(api: SchedulingApi, clock: ControllableClock, rules: FaultRule[] = []) {
    this.api = api;
    this.clock = clock;
    this.rules = [...rules];
  }

  private nextCallIndex(toolName: string): number {
    const next = (this.callCounters.get(toolName) ?? 0) + 1;
    this.callCounters.set(toolName, next);
    return next;
  }

  private findMatchingRule(
    toolName: FaultRule['targetTool'],
    callIndex: number
  ): FaultRule | undefined {
    return this.rules.find(
      (r) => r.targetTool === toolName && r.triggerOnCallIndex === callIndex
    );
  }

  private recordToolEvent(params: Omit<ToolEvent, 'schemaVersion' | 'sequenceId' | 'timestampMs'>): void {
    this.sequenceCounter += 1;
    this.toolEvents.push({
      schemaVersion: SCHEMA_VERSION,
      sequenceId: this.sequenceCounter,
      timestampMs: this.clock.now(),
      ...params
    });
  }

  public getToolEvents(): ToolEvent[] {
    return this.toolEvents.map((e) => structuredClone(e));
  }

  public listProviders(conversationId: string = 'system'): Provider[] {
    const providers = this.api.listProviders();
    this.recordToolEvent({
      conversationId,
      toolName: 'listProviders',
      operationId: null,
      idempotencyKey: null,
      request: {},
      transportOutcome: 'NO_OP',
      response: { count: providers.length }
    });
    return providers;
  }

  public listAvailableSlots(
    conversationId: string,
    providerId?: string,
    dayOfWeek?: string
  ): SlotAvailabilityView[] {
    const slots = this.api.listAvailableSlots(providerId, dayOfWeek);
    this.recordToolEvent({
      conversationId,
      toolName: 'listAvailableSlots',
      operationId: null,
      idempotencyKey: null,
      request: { providerId: providerId ?? null, dayOfWeek: dayOfWeek ?? null },
      transportOutcome: 'NO_OP',
      response: { slotIds: slots.filter((s) => !s.isBooked).map((s) => s.slotId) }
    });
    return slots;
  }

  public verifyPatient(input: VerifyPatientInput): VerifyPatientOutput {
    const callIdx = this.nextCallIndex('verifyPatient');
    const rule = this.findMatchingRule('verifyPatient', callIdx);

    if (rule?.stage === 'PRE_AUTH_REJECT') {
      const faultOut: VerifyPatientOutput = {
        verified: false,
        errorCode: 'AUTH_SERVICE_UNAVAILABLE'
      };
      this.recordToolEvent({
        conversationId: input.conversationId,
        toolName: 'verifyPatient',
        operationId: null,
        idempotencyKey: null,
        request: { patientId: input.patientId },
        transportOutcome: 'REJECTED',
        response: { ...faultOut },
        injectedFaultRuleId: rule.ruleId
      });
      return faultOut;
    }

    const res = this.api.verifyPatient(input);
    this.recordToolEvent({
      conversationId: input.conversationId,
      toolName: 'verifyPatient',
      operationId: null,
      idempotencyKey: null,
      request: { patientId: input.patientId },
      transportOutcome: res.verified ? 'COMMITTED' : 'REJECTED',
      response: {
        verified: res.verified,
        tokenId: res.token?.tokenId ?? null,
        errorCode: res.errorCode ?? null
      }
    });
    return res;
  }

  public revokeVerification(conversationId: string, reason: string = 'IDENTITY_SWITCH'): void {
    this.api.revokeVerification(conversationId, reason);
    this.recordToolEvent({
      conversationId,
      toolName: 'revokeVerification',
      operationId: null,
      idempotencyKey: null,
      request: { reason },
      transportOutcome: 'COMMITTED',
      response: { revoked: true }
    });
  }

  public executeMutation(request: OperationRequest): OperationResult {
    const callIdx = this.nextCallIndex('executeMutation');
    const rule = this.findMatchingRule('executeMutation', callIdx);

    if (rule?.stage === 'PRE_AUTH_REJECT') {
      const out: OperationResult = {
        schemaVersion: SCHEMA_VERSION,
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        backendOutcome: 'NOT_ATTEMPTED',
        clientOutcome: 'REJECTED',
        errorCode: 'AUTH_BOUNDARY_REJECTED',
        message: 'FaultInjector rejected request before backend authorization.'
      };
      this.recordToolEvent({
        conversationId: request.conversationId,
        toolName: 'executeMutation',
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        request: { ...request },
        transportOutcome: 'REJECTED',
        response: { ...out },
        injectedFaultRuleId: rule.ruleId
      });
      return out;
    }

    if (rule?.stage === 'PRE_COMMIT_ABORT') {
      // Aborted before reaching SQLite commit -> backend state unchanged, client sees UNKNOWN
      const out: OperationResult = {
        schemaVersion: SCHEMA_VERSION,
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        backendOutcome: 'NOT_ATTEMPTED',
        clientOutcome: 'UNKNOWN',
        errorCode: 'TRANSPORT_TIMEOUT_BEFORE_COMMIT',
        message: 'Request timed out before backend commit.'
      };
      this.recordToolEvent({
        conversationId: request.conversationId,
        toolName: 'executeMutation',
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        request: { ...request },
        transportOutcome: 'UNKNOWN',
        response: { ...out },
        injectedFaultRuleId: rule.ruleId
      });
      return out;
    }

    if (rule?.stage === 'MISLEADING_HTTP_200') {
      // Do NOT commit in DB (or backend rejects), but spoof HTTP 200 COMMITTED to caller/transport
      const spoofed: OperationResult = {
        schemaVersion: SCHEMA_VERSION,
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        backendOutcome: 'NOT_ATTEMPTED',
        clientOutcome: 'COMMITTED',
        appointmentId: 'APT-SPOOFED-200',
        message: 'HTTP 200 OK (Spoofed transport response; no DB commit occurred).'
      };
      this.recordToolEvent({
        conversationId: request.conversationId,
        toolName: 'executeMutation',
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        request: { ...request },
        transportOutcome: 'COMMITTED',
        response: { ...spoofed, httpStatus: 200 },
        injectedFaultRuleId: rule.ruleId
      });
      return spoofed;
    }

    // Execute real backend mutation
    const realResult = this.api.executeMutation(request);

    if (rule?.stage === 'POST_COMMIT_DROP') {
      // Backend committed durably, but response is lost in transit!
      const droppedResult: OperationResult = {
        schemaVersion: SCHEMA_VERSION,
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        backendOutcome: realResult.backendOutcome,
        clientOutcome: 'UNKNOWN',
        errorCode: 'TRANSPORT_TIMEOUT_AFTER_COMMIT',
        message: 'Response lost after backend commit (timeout).'
      };
      this.recordToolEvent({
        conversationId: request.conversationId,
        toolName: 'executeMutation',
        operationId: request.operationId,
        idempotencyKey: request.idempotencyKey,
        request: { ...request },
        transportOutcome: 'UNKNOWN',
        response: { ...droppedResult },
        injectedFaultRuleId: rule.ruleId
      });
      return droppedResult;
    }

    this.recordToolEvent({
      conversationId: request.conversationId,
      toolName: 'executeMutation',
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      request: { ...request },
      transportOutcome: realResult.clientOutcome,
      response: { ...realResult }
    });
    return realResult;
  }

  public reconcileOperation(
    conversationId: string,
    operationId: string,
    idempotencyKey: string
  ): {
    outcome: 'RECONCILED_COMMITTED' | 'RECONCILED_NOT_COMMITTED' | 'UNKNOWN';
    appointmentId?: string;
    errorCode?: string;
  } {
    const callIdx = this.nextCallIndex('reconcileOperation');
    const rule = this.findMatchingRule('reconcileOperation', callIdx);

    if (rule?.stage === 'RECONCILIATION_UNAVAILABLE') {
      const out = {
        outcome: 'UNKNOWN' as const,
        errorCode: 'RECONCILIATION_SERVICE_UNAVAILABLE'
      };
      this.recordToolEvent({
        conversationId,
        toolName: 'reconcileOperation',
        operationId,
        idempotencyKey,
        request: { operationId, idempotencyKey },
        transportOutcome: 'UNKNOWN',
        response: { ...out },
        injectedFaultRuleId: rule.ruleId
      });
      return out;
    }

    const res = this.api.reconcileOperation(conversationId, operationId, idempotencyKey);
    this.recordToolEvent({
      conversationId,
      toolName: 'reconcileOperation',
      operationId,
      idempotencyKey,
      request: { operationId, idempotencyKey },
      transportOutcome: res.outcome,
      response: { ...res }
    });
    return res;
  }

  public recordEscalation(params: {
    conversationId: string;
    patientId: string | null;
    reason: string;
  }): EscalationRecord {
    const rec = this.api.recordEscalation(params);
    this.recordToolEvent({
      conversationId: params.conversationId,
      toolName: 'recordEscalation',
      operationId: null,
      idempotencyKey: null,
      request: { ...params },
      transportOutcome: 'COMMITTED',
      response: { ...rec }
    });
    return rec;
  }
}
