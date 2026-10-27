import { SyntheticAppointmentApi } from './appointment-api.js';

export type CallDisposition =
  | 'IN_PROGRESS'
  | 'INQUIRY_ONLY'
  | 'AWAITING_CONFIRMATION'
  | 'BOOKED'
  | 'REJECTED_CONFLICT'
  | 'FAILED_SAFE_ESCALATED';

export interface DemoTurn {
  readonly turnIndex: number;
  readonly speaker: 'CALLER' | 'AGENT';
  readonly text: string;
  readonly claimedBooked: boolean;
  readonly claimedSlotId: string | null;
  readonly dispositionAfterTurn: CallDisposition;
}

export interface DemoAgentOptions {
  /**
   * When true, reproduces historical DEFECT-042:
   * 1. Retries failed/timed-out API calls without an idempotencyKey (causing DUPLICATE_ACTION).
   * 2. Optimistically tells the caller their appointment is booked even on HTTP 500 (causing FALSE_CONFIRMATION).
   * 3. Sets call disposition to 'BOOKED' regardless of API error (causing INCORRECT_DISPOSITION_STATE).
   */
  readonly simulateDefect042?: boolean;
}

export class DemoSchedulingAgent {
  private readonly api: SyntheticAppointmentApi;
  private readonly conversationId: string;
  private readonly simulateDefect042: boolean;

  private verifiedPatientId: string | null = null;
  private pendingPatientId: string | null = null;
  private proposedSlotId: string | null = null;
  private proposalVersion = 0;
  private disposition: CallDisposition = 'IN_PROGRESS';
  private readonly turns: DemoTurn[] = [];

  constructor(
    conversationId: string,
    api: SyntheticAppointmentApi,
    options: DemoAgentOptions = {}
  ) {
    this.conversationId = conversationId;
    this.api = api;
    this.simulateDefect042 = options.simulateDefect042 ?? false;
  }

  public getDisposition(): CallDisposition {
    return this.disposition;
  }

  public getTurns(): readonly DemoTurn[] {
    return this.turns;
  }

  public handleCallerUtterance(rawText: string): DemoTurn {
    const text = rawText.trim();
    this.turns.push({
      turnIndex: this.turns.length + 1,
      speaker: 'CALLER',
      text,
      claimedBooked: false,
      claimedSlotId: null,
      dispositionAfterTurn: this.disposition
    });

    // 1. Parse patient identity & credentials across conversational variations
    const patientMatch = text.match(/\b(PAT-\d{3})\b/i);
    if (patientMatch) {
      this.pendingPatientId = patientMatch[1]!.toUpperCase();
    } else if (/\bfry\b/i.test(text) && !this.pendingPatientId) {
      this.pendingPatientId = 'PAT-001';
    } else if (/\bleela\b/i.test(text) && !this.pendingPatientId) {
      this.pendingPatientId = 'PAT-002';
    } else if (/\bbender\b/i.test(text) && !this.pendingPatientId) {
      this.pendingPatientId = 'PAT-003';
    }

    const dobMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const pinMatch =
      text.match(/\bpin(?:\s+is)?[:\s]+(\d{4})\b/i) ??
      text.match(/\b(\d{4})\b(?!-\d{2})/);

    if (this.pendingPatientId && dobMatch && pinMatch) {
      const ok = this.api.verifyPatient(this.pendingPatientId, dobMatch[1]!, pinMatch[1]!);
      if (ok) {
        this.verifiedPatientId = this.pendingPatientId;
      } else {
        const ticket = this.api.recordEscalation({
          patientId: this.pendingPatientId,
          reason: 'VERIFICATION_FAILED'
        });
        this.disposition = 'FAILED_SAFE_ESCALATED';
        return this.appendAgentTurn(
          `I could not verify your date of birth and PIN. For your security, I am transferring you to our front desk (${ticket.ticketId}).`,
          false,
          null
        );
      }
    }

    // 2. Parse slot intent across natural conversational variations
    const detectedSlot = this.extractSlotFromVariations(text);
    if (detectedSlot) {
      this.proposedSlotId = detectedSlot;
      this.proposalVersion += 1;
    }

    // 3. Handle open-availability browsing variation
    if (
      /\b(what times|what openings|available|open slots|any openings)\b/i.test(text) &&
      !detectedSlot
    ) {
      const open = this.api.listOpenSlots();
      this.disposition = 'INQUIRY_ONLY';
      const summary = open.map((s) => `${s.label} (${s.providerName})`).join(', ');
      return this.appendAgentTurn(
        `Here are the open appointment times: ${summary}. Which time works best for you?`,
        false,
        null
      );
    }

    // 4. Require identity verification before confirming or booking
    if (!this.verifiedPatientId) {
      this.disposition = 'IN_PROGRESS';
      return this.appendAgentTurn(
        'I can help with that appointment. First, please share your date of birth (YYYY-MM-DD) and 4-digit PIN.',
        false,
        null
      );
    }

    // 5. Check if the caller is confirming the proposed slot (supports natural confirmation variations)
    const isSlotSwitch = /\b(wait|scratch|instead|actually|change)\b/i.test(text);
    const isConfirmation =
      !isSlotSwitch &&
      /\b(yes|yep|yeah|confirm|lock that in|sounds good|go ahead|book it|please book)\b/i.test(
        text
      ) &&
      !detectedSlot;

    if (!isConfirmation) {
      if (this.proposedSlotId) {
        this.disposition = 'AWAITING_CONFIRMATION';
        return this.appendAgentTurn(
          `Just to confirm: would you like me to book ${this.proposedSlotId} for ${this.verifiedPatientId}? Please say "Yes, confirm" to finalize.`,
          false,
          null
        );
      }
      return this.appendAgentTurn(
        'Thank you for verifying. Which appointment time would you like to book?',
        false,
        null
      );
    }

    // 6. Execute the booking against the Appointment API
    const targetSlot = this.proposedSlotId!;
    const targetPatient = this.verifiedPatientId;

    if (this.simulateDefect042) {
      // =========================================================================
      // BUGGY PATH (DEFECT-042):
      // - No idempotencyKey passed, and blindly retries on error/timeout -> DUPLICATE_ACTION
      // - Optimistically claims the booking succeeded without checking res.ok -> FALSE_CONFIRMATION
      // - Unconditionally sets disposition = 'BOOKED' -> INCORRECT_DISPOSITION_STATE
      // =========================================================================
      let res = this.api.bookAppointment({
        patientId: targetPatient,
        slotId: targetSlot,
        idempotencyKey: null
      });
      if (!res.ok) {
        res = this.api.bookAppointment({
          patientId: targetPatient,
          slotId: targetSlot,
          idempotencyKey: null
        });
      }

      this.disposition = 'BOOKED';
      return this.appendAgentTurn(
        `You are all set! I have confirmed and booked ${targetSlot} for ${targetPatient}.`,
        true,
        targetSlot
      );
    }

    // =========================================================================
    // FIXED SAFE PATH:
    // - Uses deterministic conversation + proposal idempotencyKey across retries
    // - Only claims booking when API returns ok (COMMITTED or IDEMPOTENT_REPLAY)
    // - Fails safely + escalates to a human with FAILED_SAFE_ESCALATED on API error
    // =========================================================================
    const idempotencyKey = `idem-${this.conversationId}-${targetPatient}-${targetSlot}-v${this.proposalVersion}`;
    let res = this.api.bookAppointment({
      patientId: targetPatient,
      slotId: targetSlot,
      idempotencyKey
    });

    if (res.status === 'TIMEOUT_ERROR') {
      // Safe retry using the exact same idempotencyKey
      res = this.api.bookAppointment({
        patientId: targetPatient,
        slotId: targetSlot,
        idempotencyKey
      });
    }

    if (res.ok && (res.status === 'COMMITTED' || res.status === 'IDEMPOTENT_REPLAY')) {
      this.disposition = 'BOOKED';
      return this.appendAgentTurn(
        `Confirmed! Your appointment (${res.appointmentId}) for ${targetSlot} is booked.`,
        true,
        targetSlot
      );
    }

    if (res.status === 'CONFLICT') {
      this.disposition = 'REJECTED_CONFLICT';
      return this.appendAgentTurn(
        `I'm sorry, ${targetSlot} was just taken by another patient. Would you like to pick another open time?`,
        false,
        null
      );
    }

    // Hard API failure (HTTP_500_ERROR or unrecovered timeout) -> Fail safely & escalate
    const ticket = this.api.recordEscalation({
      patientId: targetPatient,
      reason: `APPOINTMENT_API_FAILURE_${res.status}`
    });
    this.disposition = 'FAILED_SAFE_ESCALATED';
    return this.appendAgentTurn(
      `I apologize, our scheduling system encountered a technical error (${res.status}) so I could not save your booking for ${targetSlot}. I have opened front-desk escalation ticket ${ticket.ticketId} so a coordinator can complete your booking right away.`,
      false,
      null
    );
  }

  private extractSlotFromVariations(text: string): string | null {
    const explicit = text.match(/\b(SLOT-[A-Z0-9-]+)\b/i);
    if (explicit) return explicit[1]!.toUpperCase();

    if (/\bthursday\b/i.test(text)) return 'SLOT-THU-10';
    if (/\btuesday\b/i.test(text) && /\b(2\s*pm|afternoon)\b/i.test(text)) return 'SLOT-TUE-14';
    if (/\btuesday\b/i.test(text) && /\b(9\s*am|morning)\b/i.test(text)) return 'SLOT-TUE-09';
    if (/\bwednesday\b/i.test(text)) return 'SLOT-WED-11';
    return null;
  }

  private appendAgentTurn(
    text: string,
    claimedBooked: boolean,
    claimedSlotId: string | null
  ): DemoTurn {
    const turn: DemoTurn = {
      turnIndex: this.turns.length + 1,
      speaker: 'AGENT',
      text,
      claimedBooked,
      claimedSlotId,
      dispositionAfterTurn: this.disposition
    };
    this.turns.push(turn);
    return turn;
  }
}
