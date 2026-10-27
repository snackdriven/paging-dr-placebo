import type {
  AuditEvent,
  ConversationTurn,
  DatabaseSnapshot,
  ScenarioDefinition,
  ToolEvent,
  VoiceEvent
} from '../types/schemas.js';

export interface EvidenceBundle {
  readonly runId: string;
  readonly conversationId: string;
  readonly scenario: ScenarioDefinition;
  readonly preSnapshot: DatabaseSnapshot | null;
  readonly postSnapshot: DatabaseSnapshot | null;
  readonly agentTurns: readonly ConversationTurn[];
  readonly toolEvents: readonly ToolEvent[];
  readonly voiceEvents: readonly VoiceEvent[];
  readonly auditEvents: readonly AuditEvent[];
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.freeze(obj);
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const val = (obj as Record<string, unknown>)[key];
      if (val && typeof val === 'object' && !Object.isFrozen(val)) {
        deepFreeze(val);
      }
    }
  }
  return obj;
}

export class EvidenceCollector {
  private preSnapshot: DatabaseSnapshot | null = null;
  private postSnapshot: DatabaseSnapshot | null = null;

  public recordPreSnapshot(snapshot: DatabaseSnapshot): void {
    this.preSnapshot = structuredClone(snapshot);
  }

  public recordPostSnapshot(snapshot: DatabaseSnapshot): void {
    this.postSnapshot = structuredClone(snapshot);
  }

  public buildFrozenBundle(params: {
    runId: string;
    conversationId: string;
    scenario: ScenarioDefinition;
    agentTurns: ConversationTurn[];
    toolEvents: ToolEvent[];
    voiceEvents: VoiceEvent[];
    auditEvents: AuditEvent[];
  }): EvidenceBundle {
    return deepFreeze({
      runId: params.runId,
      conversationId: params.conversationId,
      scenario: structuredClone(params.scenario),
      preSnapshot: this.preSnapshot ? structuredClone(this.preSnapshot) : null,
      postSnapshot: this.postSnapshot ? structuredClone(this.postSnapshot) : null,
      agentTurns: structuredClone(params.agentTurns),
      toolEvents: structuredClone(params.toolEvents),
      voiceEvents: structuredClone(params.voiceEvents),
      auditEvents: structuredClone(params.auditEvents)
    });
  }
}
