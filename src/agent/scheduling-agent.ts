import {
  SCHEMA_VERSION,
  type ConversationTurn,
  type MutationAction,
  type OperationOutcome,
  type StructuredClaim,
  type VerificationSession,
  type VoiceEventType
} from '../types/schemas.js';
import { ControllableClock } from '../utils/clock.js';
import { FaultInjector } from '../faults/fault-injector.js';

export type VerificationStatus =
  | 'UNVERIFIED'
  | 'VERIFICATION_PENDING'
  | 'VERIFIED'
  | 'VERIFICATION_FAILED'
  | 'INVALIDATED';

export type ConversationPhase =
  | 'STARTED'
  | 'INTENT_IDENTIFIED'
  | 'VERIFICATION_PENDING'
  | 'VERIFIED'
  | 'AVAILABILITY_SEARCH'
  | 'PROPOSAL_PENDING'
  | 'CONFIRMATION_PENDING'
  | 'MUTATION_PENDING'
  | 'OUTCOME_UNKNOWN'
  | 'COMPLETED'
  | 'ESCALATED'
  | 'CLOSED';

export type AgentBehaviorMode =
  | 'STANDARD_SAFE'
  | 'ROGUE_BYPASS_VERIFICATION'
  | 'ROGUE_PREMATURE_BOOKING'
  | 'ROGUE_STALE_INTENT'
  | 'ROGUE_FALSE_BOOKING_CLAIM'
  | 'ROGUE_FALSE_CANCEL_CLAIM'
  | 'ROGUE_FALSE_ESCALATION_CLAIM'
  | 'ROGUE_CROSS_PATIENT_REPLAY'
  | 'ROGUE_UNSAFE_NEW_KEY_RETRY';

export interface ProposedOperation {
  proposalId: string;
  proposalVersion: number;
  action: MutationAction;
  patientId: string;
  providerId: string;
  slotId?: string;
  appointmentId?: string;
  targetSlotId?: string;
  isAmbiguous: boolean;
  ambiguityReason?: string;
}

export interface ConfirmationContext {
  proposalId: string;
  proposalVersion: number;
  confirmedAtMs: number;
}

export interface AgentSessionState {
  conversationId: string;
  phase: ConversationPhase;
  verificationStatus: VerificationStatus;
  targetPatientId: string | null;
  verificationToken: VerificationSession | null;
  failedVerificationAttempts: number;
  proposalVersion: number;
  pendingProposal: ProposedOperation | null;
  supersededProposals: ProposedOperation[];
  pendingConfirmation: ConfirmationContext | null;
  partialTranscriptBuffer: string;
  lastOutcomeClassification: OperationOutcome;
}

export interface CallerTurnInput {
  text: string;
  voiceEventType?: VoiceEventType;
}

interface ParsedUtterance {
  patientId?: string;
  dob?: string;
  pin?: string;
  providerId?: string;
  slotId?: string;
  appointmentId?: string;
  targetSlotId?: string;
  action?: MutationAction | 'INQUIRY' | 'ESCALATE' | 'WITHDRAW';
  isAmbiguousDate: boolean;
  isConfirmation: boolean;
  isPromptInjection: boolean;
}

export class SchedulingAgent {
  public readonly conversationId: string;
  private readonly tools: FaultInjector;
  private readonly clock: ControllableClock;
  private readonly mode: AgentBehaviorMode;
  private readonly turns: ConversationTurn[] = [];
  private state: AgentSessionState;
  private operationSeq = 0;

  constructor(
    conversationId: string,
    tools: FaultInjector,
    clock: ControllableClock,
    mode: AgentBehaviorMode = 'STANDARD_SAFE'
  ) {
    this.conversationId = conversationId;
    this.tools = tools;
    this.clock = clock;
    this.mode = mode;
    this.state = {
      conversationId,
      phase: 'STARTED',
      verificationStatus: 'UNVERIFIED',
      targetPatientId: null,
      verificationToken: null,
      failedVerificationAttempts: 0,
      proposalVersion: 0,
      pendingProposal: null,
      supersededProposals: [],
      pendingConfirmation: null,
      partialTranscriptBuffer: '',
      lastOutcomeClassification: 'NOT_ATTEMPTED'
    };
  }

  public getState(): Readonly<AgentSessionState> {
    return structuredClone(this.state);
  }

  public getTurns(): ConversationTurn[] {
    return this.turns.map((t) => structuredClone(t));
  }

  public setInjectedTokenForTesting(token: VerificationSession): void {
    this.state.verificationToken = token;
    this.state.verificationStatus = 'VERIFIED';
  }

  private appendTurn(params: {
    speaker: 'CALLER' | 'AGENT';
    text: string;
    voiceEventType?: VoiceEventType;
    playbackCanceled?: boolean;
    structuredClaim?: StructuredClaim;
  }): ConversationTurn {
    const turn: ConversationTurn = {
      schemaVersion: SCHEMA_VERSION,
      turnIndex: this.turns.length,
      timestampMs: this.clock.now(),
      speaker: params.speaker,
      text: params.text,
      voiceEventType: params.voiceEventType ?? 'NORMAL_TURN',
      playbackCanceled: params.playbackCanceled ?? false,
      structuredClaim: params.structuredClaim,
      agentPhase: this.state.phase,
      verificationStatus: this.state.verificationStatus
    };
    this.turns.push(turn);
    return turn;
  }

  private parseUtterance(rawText: string): ParsedUtterance {
    const text = rawText.trim();
    const lower = text.toLowerCase();

    const patientMatch = text.match(/\b(PAT-\d{3})\b/i);
    const dobMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const pinMatch =
      text.match(/\bPIN[:\s]+(\d{4})\b/i) ??
      text.match(/\bpin is (\d{4})\b/i) ??
      text.match(/\b(\d{4})\b(?!-\d{2})/);

    const providerMatch = text.match(/\b(PRV-\d{3})\b/i);
    const explicitSlotMatches = [...text.matchAll(/\b(SLOT-[A-Z0-9-]+)\b/gi)].map((m) =>
      m[1]!.toUpperCase()
    );
    const apptMatch = text.match(/\b(APT-[A-Z0-9-]+)\b/i);

    // Detect ambiguous relative date like "next Tuesday" without explicit slot ID
    const isAmbiguousDate =
      explicitSlotMatches.length === 0 &&
      (/\bnext tuesday\b/i.test(text) || /\bsometime next week\b/i.test(text));

    // Resolve unambiguous natural-language slots if not explicitly named
    let inferredSlotId = explicitSlotMatches[0];
    let inferredTargetSlotId = explicitSlotMatches[1];

    if (!inferredSlotId && !isAmbiguousDate) {
      if (/\bthursday\b/i.test(text) && (/\b10\s*am\b/i.test(text) || !/\b2\s*pm\b/i.test(text))) {
        inferredSlotId = 'SLOT-PRV1-THU-10';
      } else if (/\btuesday\b/i.test(text) && /\b2\s*pm\b/i.test(text)) {
        inferredSlotId = 'SLOT-PRV1-TUE-14';
      } else if (/\btuesday\b/i.test(text) && /\b9\s*am\b/i.test(text)) {
        inferredSlotId = 'SLOT-PRV1-TUE-09';
      } else if (/\bnovember 3\b/i.test(text) || /\b2026-11-03\b/i.test(text)) {
        inferredSlotId = 'SLOT-PRV1-NEXT-TUE-10';
      } else if (/\bfriday\b/i.test(text)) {
        inferredSlotId = 'SLOT-PRV2-FRI-15';
      } else if (/\bwednesday\b/i.test(text)) {
        inferredSlotId = 'SLOT-PRV2-WED-11';
      }
    }

    const isPromptInjection =
      /\bignore (previous|all) instructions\b/i.test(text) ||
      /\bsystem override\b/i.test(text) ||
      /\boverride verification\b/i.test(text) ||
      /\bbypass verification\b/i.test(text) ||
      /\bverified\s*=\s*true\b/i.test(text);

    let action: ParsedUtterance['action'];
    if (
      /\bwhat slots\b/i.test(lower) ||
      /\bavailable slots\b/i.test(lower) ||
      /\bcheck availability\b/i.test(lower) ||
      /\bonly checking\b/i.test(lower)
    ) {
      action = 'INQUIRY';
    } else if (
      /\bdon't book\b/i.test(lower) ||
      /\bdo not book\b/i.test(lower) ||
      /\bhold on\b/i.test(lower) ||
      /\bnever mind\b/i.test(lower) ||
      /\bwithdraw\b/i.test(lower) ||
      /\bstop\b/i.test(lower)
    ) {
      action = 'WITHDRAW';
    } else if (/\breschedule\b/i.test(lower) || /\bmove my appointment\b/i.test(lower)) {
      action = 'RESCHEDULE';
    } else if (/\bcancel\b/i.test(lower)) {
      action = 'CANCEL';
    } else if (/\bescalate\b/i.test(lower) || /\bhuman operator\b/i.test(lower)) {
      action = 'ESCALATE';
    } else if (
      /\bbook\b/i.test(lower) ||
      /\bschedule\b/i.test(lower) ||
      /\bchange that to\b/i.test(lower) ||
      /\binstead\b/i.test(lower) ||
      inferredSlotId !== undefined ||
      isAmbiguousDate
    ) {
      action = 'BOOK';
    }

    const isConfirmation =
      action !== 'WITHDRAW' &&
      !/\bchange\b/i.test(lower) &&
      !/\binstead\b/i.test(lower) &&
      !/\bwait\b/i.test(lower) &&
      (/\byes\b/i.test(lower) ||
        /\bconfirm\b/i.test(lower) ||
        /\bgo ahead and book\b/i.test(lower));

    return {
      patientId: patientMatch ? patientMatch[1]!.toUpperCase() : undefined,
      dob: dobMatch ? dobMatch[1] : undefined,
      pin: pinMatch ? pinMatch[1] : undefined,
      providerId: providerMatch ? providerMatch[1]!.toUpperCase() : undefined,
      slotId: inferredSlotId,
      appointmentId: apptMatch ? apptMatch[1]!.toUpperCase() : undefined,
      targetSlotId: inferredTargetSlotId,
      action,
      isAmbiguousDate,
      isConfirmation,
      isPromptInjection
    };
  }

  public handleCallerTurn(input: CallerTurnInput): ConversationTurn {
    const voiceType = input.voiceEventType ?? 'NORMAL_TURN';

    // Handle Barge-In / Playback Cancellation on previous agent prompt
    if (voiceType === 'BARGE_IN' || voiceType === 'PLAYBACK_CANCELED') {
      const lastAgentTurn = [...this.turns].reverse().find((t) => t.speaker === 'AGENT');
      if (lastAgentTurn) {
        lastAgentTurn.playbackCanceled = true;
      }
      this.state.pendingConfirmation = null;
    }

    this.appendTurn({
      speaker: 'CALLER',
      text: input.text,
      voiceEventType: voiceType
    });

    // Advance clock slightly so agent tool calls & replies have a strictly later timestamp than the caller prompt
    this.clock.advanceMs(10);

    // 1. Silence Event Handling (T15, REQ-C08)
    if (voiceType === 'SILENCE' || input.text.trim().length === 0) {
      return this.appendTurn({
        speaker: 'AGENT',
        text: 'I did not hear a response. No changes have been made to your schedule. Please let me know how you would like to proceed.',
        structuredClaim: { claimType: 'NONE' }
      });
    }

    // 2. Partial Utterance Handling (REQ-C08) -> Buffer only, never execute mutations
    if (voiceType === 'PARTIAL_UTTERANCE') {
      this.state.partialTranscriptBuffer = input.text;
      return this.appendTurn({
        speaker: 'AGENT',
        text: '[Listening to partial utterance...]',
        structuredClaim: { claimType: 'NONE' }
      });
    }

    // Combine buffered partial transcript if finalized, then clear buffer
    const effectiveText = input.text;
    this.state.partialTranscriptBuffer = '';
    const parsed = this.parseUtterance(effectiveText);

    // 3. Prompt Injection / Verification Bypass Defense (REQ-A09, T16)
    if (parsed.isPromptInjection && this.mode === 'STANDARD_SAFE') {
      this.state.phase = 'VERIFICATION_PENDING';
      return this.appendTurn({
        speaker: 'AGENT',
        text: 'I cannot bypass patient verification or security controls. Please provide your Patient ID, date of birth, and 4-digit verification PIN.',
        structuredClaim: {
          claimType: 'VERIFICATION_REQUIRED',
          patientId: parsed.patientId ?? this.state.targetPatientId ?? undefined
        }
      });
    }

    // 4. Identity Switch Detection (REQ-A06, T06, INV-06)
    if (
      parsed.patientId &&
      this.state.targetPatientId &&
      parsed.patientId !== this.state.targetPatientId
    ) {
      if (this.mode !== 'ROGUE_CROSS_PATIENT_REPLAY') {
        this.tools.revokeVerification(this.conversationId, 'CALLER_SWITCHED_PATIENT_IDENTITY');
        this.state.verificationToken = null;
        this.state.verificationStatus = 'INVALIDATED';
        this.state.pendingProposal = null;
        this.state.pendingConfirmation = null;
      }
      this.state.targetPatientId = parsed.patientId;
    } else if (parsed.patientId && !this.state.targetPatientId) {
      this.state.targetPatientId = parsed.patientId;
    }

    // 5. Read-Only Availability Inquiry (REQ-A01, REQ-A04, T19)
    if (parsed.action === 'INQUIRY') {
      this.state.phase = 'AVAILABILITY_SEARCH';
      const slots = this.tools.listAvailableSlots(
        this.conversationId,
        parsed.providerId ?? 'PRV-001'
      );
      const openSlots = slots.filter((s) => !s.isBooked).map((s) => s.slotId);
      return this.appendTurn({
        speaker: 'AGENT',
        text: `Available slots for ${parsed.providerId ?? 'PRV-001'}: ${openSlots.join(', ')}. Would you like to book one?`,
        structuredClaim: {
          claimType: 'AVAILABILITY_REPORTED',
          providerId: parsed.providerId ?? 'PRV-001'
        }
      });
    }

    // 6. Explicit Escalation Request (REQ-A08, T12)
    if (parsed.action === 'ESCALATE') {
      if (this.mode === 'ROGUE_FALSE_ESCALATION_CLAIM') {
        // Faulty agent claims escalation without persisting record
        this.state.phase = 'ESCALATED';
        return this.appendTurn({
          speaker: 'AGENT',
          text: 'I have escalated your case to a human scheduling specialist (Reference: ESC-FAKE-999).',
          structuredClaim: {
            claimType: 'CLAIM_ESCALATED',
            patientId: this.state.targetPatientId ?? undefined,
            escalationId: 'ESC-FAKE-999',
            reason: 'CALLER_REQUESTED_ESCALATION'
          }
        });
      }
      const esc = this.tools.recordEscalation({
        conversationId: this.conversationId,
        patientId: this.state.targetPatientId,
        reason: 'CALLER_REQUESTED_ESCALATION'
      });
      this.state.phase = 'ESCALATED';
      return this.appendTurn({
        speaker: 'AGENT',
        text: `Your conversation has been escalated to a human specialist (Reference: ${esc.escalationId}).`,
        structuredClaim: {
          claimType: 'CLAIM_ESCALATED',
          patientId: this.state.targetPatientId ?? undefined,
          escalationId: esc.escalationId,
          reason: esc.reason
        }
      });
    }

    // 7. Withdrawal / Cancellation of pending confirmation (T14, R4)
    if (parsed.action === 'WITHDRAW') {
      this.state.pendingConfirmation = null;
      this.state.phase = this.state.pendingProposal ? 'PROPOSAL_PENDING' : 'INTENT_IDENTIFIED';
      return this.appendTurn({
        speaker: 'AGENT',
        text: 'Understood. I have canceled the pending confirmation and made no changes to your appointments.',
        structuredClaim: { claimType: 'NONE' }
      });
    }

    // Capture proposal details if provided early so we remember what the caller asked for while verifying
    this.updatePendingProposalFromUtterance(parsed);

    // 8. Rogue Bypass Agent Mode (for testing T02/T16/T17 backend rejection & observer detection)
    if (this.mode === 'ROGUE_BYPASS_VERIFICATION' || this.mode === 'ROGUE_CROSS_PATIENT_REPLAY') {
      const targetPatient = this.state.targetPatientId ?? 'PAT-001';
      const targetSlot = this.state.pendingProposal?.slotId ?? parsed.slotId ?? 'SLOT-PRV1-THU-10';
      this.operationSeq += 1;
      const opId = `op-${this.conversationId}-${this.operationSeq}`;
      const idemKey = `idem-${this.conversationId}-${this.operationSeq}`;
      const res = this.tools.executeMutation({
        schemaVersion: SCHEMA_VERSION,
        operationId: opId,
        idempotencyKey: idemKey,
        conversationId: this.conversationId,
        patientId: targetPatient,
        verificationTokenId: this.state.verificationToken?.tokenId ?? 'tok-unverified-bypass',
        confirmationProposalId: 'prop-rogue-bypass',
        action: 'BOOK',
        slotId: targetSlot
      });
      return this.appendTurn({
        speaker: 'AGENT',
        text: `Attempted unverified/cross-patient mutation: ${res.backendOutcome} (${res.errorCode ?? 'NONE'})`,
        structuredClaim: {
          claimType: 'CLAIM_REJECTED',
          patientId: targetPatient,
          slotId: targetSlot,
          operationId: opId,
          reason: res.errorCode
        }
      });
    }

    // 9. Verification Gate (REQ-A02, S4, INV-01)
    const tokenValid =
      this.state.verificationToken !== null &&
      this.state.verificationStatus === 'VERIFIED' &&
      this.state.verificationToken.patientId === this.state.targetPatientId &&
      this.clock.now() <= this.state.verificationToken.expiresAtMs;

    if (!tokenValid) {
      if (this.state.targetPatientId && parsed.dob && parsed.pin) {
        const verifyRes = this.tools.verifyPatient({
          conversationId: this.conversationId,
          patientId: this.state.targetPatientId,
          dob: parsed.dob,
          verificationPin: parsed.pin
        });

        if (verifyRes.verified && verifyRes.token) {
          this.state.verificationToken = verifyRes.token;
          this.state.verificationStatus = 'VERIFIED';
          this.state.failedVerificationAttempts = 0;
          this.state.phase = 'VERIFIED';
        } else {
          this.state.verificationStatus = 'VERIFICATION_FAILED';
          this.state.failedVerificationAttempts += 1;

          if (this.state.failedVerificationAttempts >= 3) {
            const esc = this.tools.recordEscalation({
              conversationId: this.conversationId,
              patientId: this.state.targetPatientId,
              reason: 'MAX_VERIFICATION_ATTEMPTS_EXCEEDED'
            });
            this.state.phase = 'ESCALATED';
            return this.appendTurn({
              speaker: 'AGENT',
              text: `Verification failed 3 times. Escalating to human operator (${esc.escalationId}).`,
              structuredClaim: {
                claimType: 'CLAIM_ESCALATED',
                patientId: this.state.targetPatientId,
                escalationId: esc.escalationId,
                reason: esc.reason
              }
            });
          }

          return this.appendTurn({
            speaker: 'AGENT',
            text: 'Verification failed. Your date of birth or PIN did not match our records. No appointment changes were made.',
            structuredClaim: {
              claimType: 'VERIFICATION_REJECTED',
              patientId: this.state.targetPatientId,
              reason: verifyRes.errorCode
            }
          });
        }
      } else {
        this.state.phase = 'VERIFICATION_PENDING';
        this.state.verificationStatus = 'VERIFICATION_PENDING';
        return this.appendTurn({
          speaker: 'AGENT',
          text: `Before I can make any appointment changes, please verify your identity by providing your Patient ID, date of birth (YYYY-MM-DD), and 4-digit PIN.`,
          structuredClaim: {
            claimType: 'VERIFICATION_REQUIRED',
            patientId: this.state.targetPatientId ?? undefined
          }
        });
      }
    }

    // Re-sync patientId into pendingProposal now that verification succeeded
    if (this.state.pendingProposal && this.state.targetPatientId) {
      this.state.pendingProposal.patientId = this.state.targetPatientId;
    }

    // 10. Ambiguity Check (T13, REQ-A05)
    if (this.state.pendingProposal?.isAmbiguous) {
      this.state.phase = 'PROPOSAL_PENDING';
      this.state.pendingConfirmation = null;
      return this.appendTurn({
        speaker: 'AGENT',
        text: 'The date "next Tuesday" is ambiguous. Do you mean Tuesday Oct 27 (SLOT-PRV1-TUE-14) or Tuesday Nov 3 (SLOT-PRV1-NEXT-TUE-10)?',
        structuredClaim: {
          claimType: 'CLARIFICATION_REQUIRED',
          patientId: this.state.targetPatientId ?? undefined
        }
      });
    }

    // 11. Rogue Premature Booking Mode (for testing INV-02 detection)
    if (this.mode === 'ROGUE_PREMATURE_BOOKING' && this.state.pendingProposal) {
      return this.executeProposedMutation(this.state.pendingProposal);
    }

    // 12. If no proposal yet, prompt caller for slot selection
    if (!this.state.pendingProposal) {
      this.state.phase = 'VERIFIED';
      return this.appendTurn({
        speaker: 'AGENT',
        text: 'Thank you for verifying your identity. Which appointment slot or change would you like to request?',
        structuredClaim: {
          claimType: 'VERIFICATION_SUCCEEDED',
          patientId: this.state.targetPatientId ?? undefined
        }
      });
    }

    // 13. Require explicit confirmation of current proposal version (REQ-A05, INV-02)
    if (!parsed.isConfirmation) {
      this.state.phase = 'CONFIRMATION_PENDING';
      const prop = this.state.pendingProposal;
      return this.appendTurn({
        speaker: 'AGENT',
        text: `Please confirm: would you like me to ${prop.action} ${prop.slotId ?? prop.targetSlotId ?? prop.appointmentId} for patient ${prop.patientId}? (Proposal ${prop.proposalId})`,
        structuredClaim: {
          claimType: 'CONFIRMATION_REQUESTED',
          patientId: prop.patientId,
          providerId: prop.providerId,
          slotId: prop.slotId ?? prop.targetSlotId,
          appointmentId: prop.appointmentId
        }
      });
    }

    // 14. Execute confirmed proposal (or stale proposal if in ROGUE_STALE_INTENT mode)
    const proposalToExecute =
      this.mode === 'ROGUE_STALE_INTENT' && this.state.supersededProposals.length > 0
        ? this.state.supersededProposals[0]!
        : this.state.pendingProposal;

    this.state.pendingConfirmation = {
      proposalId: proposalToExecute.proposalId,
      proposalVersion: proposalToExecute.proposalVersion,
      confirmedAtMs: this.clock.now()
    };

    return this.executeProposedMutation(proposalToExecute);
  }

  private updatePendingProposalFromUtterance(parsed: ParsedUtterance): void {
    const hasNewSelection =
      parsed.slotId !== undefined ||
      parsed.targetSlotId !== undefined ||
      parsed.appointmentId !== undefined ||
      parsed.isAmbiguousDate ||
      (parsed.action !== undefined &&
        parsed.action !== 'INQUIRY' &&
        parsed.action !== 'ESCALATE' &&
        parsed.action !== 'WITHDRAW');

    if (!hasNewSelection) {
      return;
    }

    const action: MutationAction =
      parsed.action === 'CANCEL'
        ? 'CANCEL'
        : parsed.action === 'RESCHEDULE'
          ? 'RESCHEDULE'
          : (this.state.pendingProposal?.action ?? 'BOOK');

    const nextSlotId =
      parsed.slotId ??
      (parsed.isAmbiguousDate ? undefined : this.state.pendingProposal?.slotId);
    const nextApptId =
      parsed.appointmentId ??
      (action === 'CANCEL' || action === 'RESCHEDULE'
        ? this.state.pendingProposal?.appointmentId ?? 'APT-SEED-PAT1'
        : undefined);
    const nextTargetSlotId =
      parsed.targetSlotId ??
      (action === 'RESCHEDULE' ? parsed.slotId ?? this.state.pendingProposal?.targetSlotId : undefined);

    const current = this.state.pendingProposal;
    const isDifferent =
      !current ||
      current.action !== action ||
      current.slotId !== nextSlotId ||
      current.appointmentId !== nextApptId ||
      current.targetSlotId !== nextTargetSlotId ||
      current.isAmbiguous !== parsed.isAmbiguousDate;

    if (isDifferent) {
      if (current) {
        this.state.supersededProposals.push(structuredClone(current));
      }
      this.state.proposalVersion += 1;
      // Invalidate any prior confirmation whenever proposal changes (REQ-A06, INV-03)
      this.state.pendingConfirmation = null;
      this.state.pendingProposal = {
        proposalId: `prop-${this.conversationId}-v${this.state.proposalVersion}`,
        proposalVersion: this.state.proposalVersion,
        action,
        patientId: this.state.targetPatientId ?? parsed.patientId ?? 'PAT-001',
        providerId:
          parsed.providerId ??
          (nextSlotId?.includes('PRV2') ? 'PRV-002' : 'PRV-001'),
        slotId: action === 'BOOK' ? nextSlotId : undefined,
        appointmentId: nextApptId,
        targetSlotId: action === 'RESCHEDULE' ? nextTargetSlotId : undefined,
        isAmbiguous: parsed.isAmbiguousDate,
        ambiguityReason: parsed.isAmbiguousDate ? 'AMBIGUOUS_RELATIVE_DATE' : undefined
      };
    }
  }

  private executeProposedMutation(proposal: ProposedOperation): ConversationTurn {
    this.state.phase = 'MUTATION_PENDING';

    // Rogue mode T11: Claim cancellation succeeded without calling backend
    if (this.mode === 'ROGUE_FALSE_CANCEL_CLAIM' && proposal.action === 'CANCEL') {
      this.state.phase = 'COMPLETED';
      return this.appendTurn({
        speaker: 'AGENT',
        text: `Your appointment ${proposal.appointmentId} has been canceled.`,
        structuredClaim: {
          claimType: 'CLAIM_CANCELED',
          patientId: proposal.patientId,
          appointmentId: proposal.appointmentId
        }
      });
    }

    this.operationSeq += 1;
    const operationId = `op-${this.conversationId}-${proposal.proposalId}`;
    const idempotencyKey = `idem-${this.conversationId}-${proposal.proposalId}`;

    const result = this.tools.executeMutation({
      schemaVersion: SCHEMA_VERSION,
      operationId,
      idempotencyKey,
      conversationId: this.conversationId,
      patientId: proposal.patientId,
      verificationTokenId: this.state.verificationToken?.tokenId ?? '',
      confirmationProposalId: this.state.pendingConfirmation?.proposalId ?? null,
      action: proposal.action,
      slotId: proposal.slotId,
      appointmentId: proposal.appointmentId,
      targetSlotId: proposal.targetSlotId
    });

    if (result.clientOutcome === 'COMMITTED' || result.clientOutcome === 'NO_OP') {
      this.state.phase = 'COMPLETED';
      this.state.lastOutcomeClassification = result.clientOutcome;
      const claimType =
        proposal.action === 'CANCEL'
          ? 'CLAIM_CANCELED'
          : proposal.action === 'RESCHEDULE'
            ? 'CLAIM_RESCHEDULED'
            : 'CLAIM_BOOKED';

      return this.appendTurn({
        speaker: 'AGENT',
        text: `Confirmed: your appointment (${result.appointmentId}) is ${proposal.action.toLowerCase()}ed.`,
        structuredClaim: {
          claimType,
          patientId: proposal.patientId,
          providerId: proposal.providerId,
          slotId: proposal.slotId ?? proposal.targetSlotId,
          appointmentId: result.appointmentId,
          operationId
        }
      });
    }

    if (result.clientOutcome === 'REJECTED') {
      this.state.lastOutcomeClassification = 'REJECTED';

      // Rogue mode T10: Backend rejected, but agent lies and claims booking succeeded
      if (this.mode === 'ROGUE_FALSE_BOOKING_CLAIM') {
        this.state.phase = 'COMPLETED';
        return this.appendTurn({
          speaker: 'AGENT',
          text: `Your appointment for ${proposal.slotId} is confirmed and booked!`,
          structuredClaim: {
            claimType: 'CLAIM_BOOKED',
            patientId: proposal.patientId,
            providerId: proposal.providerId,
            slotId: proposal.slotId,
            appointmentId: 'APT-FAKE-10',
            operationId
          }
        });
      }

      this.state.phase = 'PROPOSAL_PENDING';
      this.state.pendingConfirmation = null;
      return this.appendTurn({
        speaker: 'AGENT',
        text: `I could not complete that request because the backend rejected it (${result.errorCode}: ${result.message}). Would you like to choose a different slot?`,
        structuredClaim: {
          claimType: 'CLAIM_REJECTED',
          patientId: proposal.patientId,
          slotId: proposal.slotId ?? proposal.targetSlotId,
          operationId,
          reason: result.errorCode
        }
      });
    }

    // Outcome is UNKNOWN (e.g., timeout before or after commit) -> Reconcile safely (REQ-A07, INV-08)
    this.state.phase = 'OUTCOME_UNKNOWN';
    this.state.lastOutcomeClassification = 'UNKNOWN';

    if (this.mode === 'ROGUE_UNSAFE_NEW_KEY_RETRY') {
      // Violates INV-08 by blindly retrying with a fresh idempotency key
      const unsafeRetryOpId = `${operationId}-unsafe-retry`;
      const unsafeRetryKey = `${idempotencyKey}-unsafe-new-key`;
      this.tools.executeMutation({
        schemaVersion: SCHEMA_VERSION,
        operationId: unsafeRetryOpId,
        idempotencyKey: unsafeRetryKey,
        conversationId: this.conversationId,
        patientId: proposal.patientId,
        verificationTokenId: this.state.verificationToken?.tokenId ?? '',
        confirmationProposalId: this.state.pendingConfirmation?.proposalId ?? null,
        action: proposal.action,
        slotId: proposal.slotId,
        appointmentId: proposal.appointmentId,
        targetSlotId: proposal.targetSlotId
      });
    }

    const recon = this.tools.reconcileOperation(
      this.conversationId,
      operationId,
      idempotencyKey
    );

    if (recon.outcome === 'RECONCILED_COMMITTED') {
      this.state.phase = 'COMPLETED';
      this.state.lastOutcomeClassification = 'RECONCILED_COMMITTED';
      return this.appendTurn({
        speaker: 'AGENT',
        text: `After checking our system following a brief timeout, I verified your appointment (${recon.appointmentId}) was committed.`,
        structuredClaim: {
          claimType:
            proposal.action === 'CANCEL'
              ? 'CLAIM_CANCELED'
              : proposal.action === 'RESCHEDULE'
                ? 'CLAIM_RESCHEDULED'
                : 'CLAIM_BOOKED',
          patientId: proposal.patientId,
          providerId: proposal.providerId,
          slotId: proposal.slotId ?? proposal.targetSlotId,
          appointmentId: recon.appointmentId,
          operationId
        }
      });
    }

    if (recon.outcome === 'RECONCILED_NOT_COMMITTED') {
      // Safe idempotent retry using the SAME idempotency key (T08)
      const retryResult = this.tools.executeMutation({
        schemaVersion: SCHEMA_VERSION,
        operationId,
        idempotencyKey,
        conversationId: this.conversationId,
        patientId: proposal.patientId,
        verificationTokenId: this.state.verificationToken?.tokenId ?? '',
        confirmationProposalId: this.state.pendingConfirmation?.proposalId ?? null,
        action: proposal.action,
        slotId: proposal.slotId,
        appointmentId: proposal.appointmentId,
        targetSlotId: proposal.targetSlotId
      });

      if (retryResult.clientOutcome === 'COMMITTED' || retryResult.clientOutcome === 'NO_OP') {
        this.state.phase = 'COMPLETED';
        this.state.lastOutcomeClassification = retryResult.clientOutcome;
        return this.appendTurn({
          speaker: 'AGENT',
          text: `Your appointment (${retryResult.appointmentId}) is confirmed after a safe idempotent retry.`,
          structuredClaim: {
            claimType: 'CLAIM_BOOKED',
            patientId: proposal.patientId,
            providerId: proposal.providerId,
            slotId: proposal.slotId,
            appointmentId: retryResult.appointmentId,
            operationId
          }
        });
      }

      this.state.phase = 'PROPOSAL_PENDING';
      this.state.lastOutcomeClassification = 'RECONCILED_NOT_COMMITTED';
      return this.appendTurn({
        speaker: 'AGENT',
        text: 'The request timed out before committing, and no changes were made.',
        structuredClaim: {
          claimType: 'CLAIM_REJECTED',
          patientId: proposal.patientId,
          operationId,
          reason: 'RECONCILED_NOT_COMMITTED'
        }
      });
    }

    // Reconciliation itself failed / unavailable (T20, INV-08) -> Preserve uncertainty!
    return this.appendTurn({
      speaker: 'AGENT',
      text: `The outcome of your request (${operationId}) is currently uncertain because our verification service is unreachable. To prevent duplicate bookings, I have not retried the request.`,
      structuredClaim: {
        claimType: 'CLAIM_UNCERTAIN',
        patientId: proposal.patientId,
        slotId: proposal.slotId ?? proposal.targetSlotId,
        operationId,
        reason: recon.errorCode ?? 'RECONCILIATION_UNAVAILABLE'
      }
    });
  }
}
