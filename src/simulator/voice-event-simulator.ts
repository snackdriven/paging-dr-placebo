import {
  SCHEMA_VERSION,
  type VoiceEvent,
  type VoiceEventType,
  type ConversationTurn
} from '../types/schemas.js';
import { ControllableClock } from '../utils/clock.js';
import { SchedulingAgent } from '../agent/scheduling-agent.js';

export type TurnOwner = 'IDLE' | 'AGENT_SPEAKING' | 'CALLER_SPEAKING' | 'BARGE_IN_INTERRUPTED';

/**
 * Optional Level 2 Acoustic Audio Provider boundary (excluded from offline mandatory execution;
 * documented per S1/A6/C6 so Level 1 deterministic event tests never claim acoustic accuracy).
 */
export interface AudioProviderAdapter {
  readonly providerName: string;
  transcribeAudioChunk(pcmBytes: Uint8Array): Promise<{ text: string; isFinal: boolean }>;
  synthesizeSpeech(text: string): Promise<Uint8Array>;
}

export class VoiceEventSimulator {
  private readonly clock: ControllableClock;
  private readonly events: VoiceEvent[] = [];
  private turnOwner: TurnOwner = 'IDLE';
  private eventSeq = 0;

  constructor(clock: ControllableClock) {
    this.clock = clock;
  }

  public getTurnOwner(): TurnOwner {
    return this.turnOwner;
  }

  public getVoiceEvents(): VoiceEvent[] {
    return this.events.map((e) => structuredClone(e));
  }

  public dispatchVoiceStep(
    agent: SchedulingAgent,
    params: {
      utterance: string;
      voiceEventType?: VoiceEventType;
      advanceClockMs?: number;
    }
  ): ConversationTurn {
    const stepAdvanceMs = params.advanceClockMs ?? 250;
    if (stepAdvanceMs > 0) {
      this.clock.advanceMs(stepAdvanceMs);
    }

    const type = params.voiceEventType ?? 'NORMAL_TURN';
    this.eventSeq += 1;

    if (type === 'BARGE_IN' || type === 'PLAYBACK_CANCELED') {
      this.turnOwner = 'BARGE_IN_INTERRUPTED';
      this.events.push({
        schemaVersion: SCHEMA_VERSION,
        eventId: `voice-${this.eventSeq}-cancel`,
        timestampMs: this.clock.now(),
        type: 'PLAYBACK_CANCELED',
        text: '[Agent playback canceled due to caller barge-in]',
        durationMs: 0
      });
    } else if (type === 'PARTIAL_UTTERANCE') {
      this.turnOwner = 'CALLER_SPEAKING';
    } else if (type === 'SILENCE') {
      this.turnOwner = 'IDLE';
    } else {
      this.turnOwner = 'CALLER_SPEAKING';
    }

    this.eventSeq += 1;
    this.events.push({
      schemaVersion: SCHEMA_VERSION,
      eventId: `voice-${this.eventSeq}`,
      timestampMs: this.clock.now(),
      type,
      text: params.utterance,
      durationMs: params.advanceClockMs ?? 250
    });

    const responseTurn = agent.handleCallerTurn({
      text: params.utterance,
      voiceEventType: type
    });

    if (type !== 'PARTIAL_UTTERANCE') {
      this.turnOwner = 'AGENT_SPEAKING';
    }

    return responseTurn;
  }
}
