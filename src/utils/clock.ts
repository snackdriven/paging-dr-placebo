export class ControllableClock {
  private currentMs: number;

  constructor(initialIsoOrMs: string | number = '2026-10-27T09:00:00.000Z') {
    this.currentMs =
      typeof initialIsoOrMs === 'number'
        ? initialIsoOrMs
        : new Date(initialIsoOrMs).getTime();
  }

  public now(): number {
    return this.currentMs;
  }

  public isoNow(): string {
    return new Date(this.currentMs).toISOString();
  }

  public advanceMs(ms: number): number {
    if (ms < 0) {
      throw new Error(`ControllableClock cannot advance backwards by ${ms}ms`);
    }
    this.currentMs += ms;
    return this.currentMs;
  }

  public set(isoOrMs: string | number): void {
    this.currentMs =
      typeof isoOrMs === 'number' ? isoOrMs : new Date(isoOrMs).getTime();
  }
}
