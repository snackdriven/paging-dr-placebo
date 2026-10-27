import type { VoiceEventType } from '../types/schemas.js';

export interface ScriptedCallerStep {
  utterance: string;
  voiceEventType?: VoiceEventType;
  advanceClockMs?: number;
  injectCrossPatientTokenFromPatientId?: string;
}

export class CallerSimulator {
  private readonly steps: readonly ScriptedCallerStep[];
  private cursor = 0;

  constructor(steps: readonly ScriptedCallerStep[]) {
    this.steps = Object.freeze(steps.map((s) => ({ ...s })));
  }

  public hasNextStep(): boolean {
    return this.cursor < this.steps.length;
  }

  public nextStep(): ScriptedCallerStep | null {
    if (this.cursor >= this.steps.length) {
      return null;
    }
    const step = this.steps[this.cursor]!;
    this.cursor += 1;
    return { ...step };
  }

  public reset(): void {
    this.cursor = 0;
  }
}
