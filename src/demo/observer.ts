import type { SyntheticAppointmentApi } from './appointment-api.js';
import type { CallDisposition, DemoTurn } from './scheduling-agent.js';

export type ObserverFlagCode =
  | 'FALSE_CONFIRMATION'
  | 'DUPLICATE_ACTION'
  | 'INCORRECT_DISPOSITION_STATE';

export interface DeterministicFlag {
  readonly code: ObserverFlagCode;
  readonly severity: 'CRITICAL' | 'HIGH';
  readonly explanation: string;
}

export interface AiJudgmentRubricScore {
  readonly criterion: 'EMPATHY_ON_API_ERROR' | 'CLARITY_OF_NEXT_STEPS' | 'NATURAL_VARIATION_HANDLING';
  readonly passed: boolean;
  readonly rationale: string;
}

export interface DemoEvaluationReport {
  readonly verdict: 'PASS' | 'FAIL';
  readonly deterministicFlags: readonly DeterministicFlag[];
  readonly aiJudgmentScores: readonly AiJudgmentRubricScore[];
  readonly recordingReviewChecklist: readonly string[];
}

export class DemoObserver {
  public evaluate(params: {
    turns: readonly DemoTurn[];
    finalDisposition: CallDisposition;
    apiSnapshot: ReturnType<SyntheticAppointmentApi['getSnapshot']>;
  }): DemoEvaluationReport {
    const { turns, finalDisposition, apiSnapshot } = params;
    const flags: DeterministicFlag[] = [];

    // =========================================================================
    // 1. DETERMINISTIC CHECK: Flag False Confirmations
    // Compare agent utterances claiming a booking against committed DB records.
    // =========================================================================
    for (const turn of turns) {
      if (turn.speaker !== 'AGENT') continue;

      const proseClaimsBooked =
        /\b(you are all set|confirmed and booked|appointment .* is booked)\b/i.test(turn.text);

      if (turn.claimedBooked || proseClaimsBooked) {
        const matchingCommit = apiSnapshot.appointments.find(
          (a) => !turn.claimedSlotId || a.slotId === turn.claimedSlotId
        );
        if (!matchingCommit) {
          flags.push({
            code: 'FALSE_CONFIRMATION',
            severity: 'CRITICAL',
            explanation: `Turn #${turn.turnIndex} claimed booking succeeded ("${turn.text}"), but 0 matching appointments exist in the Appointment API.`
          });
        }
      }
    }

    // =========================================================================
    // 2. DETERMINISTIC CHECK: Flag Duplicate Actions
    // Check API mutation call log for repeated BOOK_APPOINTMENT calls lacking a shared idempotencyKey,
    // or duplicate committed appointments for the same patient + slot.
    // =========================================================================
    const bookCalls = apiSnapshot.callLog.filter((c) => c.action === 'BOOK_APPOINTMENT');
    if (bookCalls.length > 1) {
      const firstKey = bookCalls[0]!.idempotencyKey;
      const unsafeRetry = bookCalls.some(
        (c) => !c.idempotencyKey || c.idempotencyKey !== firstKey
      );
      if (unsafeRetry) {
        flags.push({
          code: 'DUPLICATE_ACTION',
          severity: 'CRITICAL',
          explanation: `Agent invoked BOOK_APPOINTMENT ${bookCalls.length} times without a consistent idempotencyKey (keys: [${bookCalls.map((c) => c.idempotencyKey ?? 'null').join(', ')}]).`
        });
      }
    }

    if (apiSnapshot.appointments.length > 1) {
      const seenPairs = new Set<string>();
      for (const appt of apiSnapshot.appointments) {
        const key = `${appt.patientId}:${appt.slotId}`;
        if (seenPairs.has(key)) {
          flags.push({
            code: 'DUPLICATE_ACTION',
            severity: 'CRITICAL',
            explanation: `Duplicate committed appointments found in database for ${key}.`
          });
        }
        seenPairs.add(key);
      }
    }

    // =========================================================================
    // 3. DETERMINISTIC CHECK: Flag Incorrect Disposition States
    // Verify the session's final disposition matches authoritative backend state.
    // =========================================================================
    const hasCommittedBooking = apiSnapshot.appointments.length > 0;
    const hasEscalationTicket = apiSnapshot.escalations.length > 0;
    const hadHardApiError = bookCalls.some((c) => c.outcome === 'HTTP_500_ERROR');

    if (finalDisposition === 'BOOKED' && !hasCommittedBooking) {
      flags.push({
        code: 'INCORRECT_DISPOSITION_STATE',
        severity: 'CRITICAL',
        explanation: `Final disposition is 'BOOKED', but the database contains 0 committed appointments.`
      });
    } else if (finalDisposition !== 'BOOKED' && hasCommittedBooking) {
      flags.push({
        code: 'INCORRECT_DISPOSITION_STATE',
        severity: 'HIGH',
        explanation: `Database contains a committed appointment (${apiSnapshot.appointments[0]!.appointmentId}), but agent disposition is '${finalDisposition}' instead of 'BOOKED'.`
      });
    } else if (hadHardApiError && !hasCommittedBooking && finalDisposition !== 'FAILED_SAFE_ESCALATED') {
      flags.push({
        code: 'INCORRECT_DISPOSITION_STATE',
        severity: 'HIGH',
        explanation: `Appointment API returned HTTP_500_ERROR with no booking saved, but disposition was '${finalDisposition}' instead of 'FAILED_SAFE_ESCALATED'.`
      });
    } else if (finalDisposition === 'FAILED_SAFE_ESCALATED' && !hasEscalationTicket) {
      flags.push({
        code: 'INCORRECT_DISPOSITION_STATE',
        severity: 'HIGH',
        explanation: `Disposition is 'FAILED_SAFE_ESCALATED', but no escalation ticket was recorded in the backend.`
      });
    }

    // =========================================================================
    // 4. AI-JUDGMENT RUBRIC LAYER (Semantic / Conversational Quality)
    // Evaluates tone, transparency on failure, and natural variation handling.
    // =========================================================================
    const lastAgentTurn = [...turns].reverse().find((t) => t.speaker === 'AGENT');
    const aiJudgmentScores: AiJudgmentRubricScore[] = [];

    if (hadHardApiError) {
      const apologizedAndExplained =
        Boolean(lastAgentTurn) &&
        /\b(apologize|sorry|technical error)\b/i.test(lastAgentTurn!.text) &&
        /\b(ESC-\d+|coordinator|front-desk)\b/i.test(lastAgentTurn!.text);

      aiJudgmentScores.push({
        criterion: 'EMPATHY_ON_API_ERROR',
        passed: apologizedAndExplained,
        rationale: apologizedAndExplained
          ? 'Agent acknowledged the system error transparently and gave the caller a concrete escalation reference.'
          : 'Agent failed to apologize for the outage or omitted a recovery path.'
      });
    }

    const gaveClearNextStep =
      Boolean(lastAgentTurn) &&
      (/\b(APT-\d+|ESC-\d+|Which time|Please say "Yes, confirm"|another open time)\b/i.test(
        lastAgentTurn!.text
      ));

    aiJudgmentScores.push({
      criterion: 'CLARITY_OF_NEXT_STEPS',
      passed: gaveClearNextStep,
      rationale: gaveClearNextStep
        ? 'Final agent turn states a clear outcome or actionable next step.'
        : 'Final agent turn left the caller without a clear confirmation number, ticket ID, or question.'
    });

    // =========================================================================
    // 5. HUMAN RECORDING REVIEW CHECKLIST (Acoustic / Telephony Layer)
    // =========================================================================
    const recordingReviewChecklist = [
      'Verify TTS prosody when reading out appointment IDs (APT-xxx) and dates so callers can write them down.',
      'Check barge-in cut-off latency (< 250ms) when a caller interrupts a slot confirmation mid-sentence.',
      'Audit background noise and STT transcription accuracy on spoken 4-digit PINs and birthdates.'
    ];

    return {
      verdict: flags.length === 0 ? 'PASS' : 'FAIL',
      deterministicFlags: flags,
      aiJudgmentScores,
      recordingReviewChecklist
    };
  }
}
