import { describe, it, expect } from 'vitest';
import { SyntheticAppointmentApi } from '../../src/demo/appointment-api.js';
import { DemoSchedulingAgent } from '../../src/demo/scheduling-agent.js';
import { DemoObserver } from '../../src/demo/observer.js';

describe('Persuasive Demo: Synthetic Scheduling Agent, Observer & Defect Lifecycle', () => {
  const observer = new DemoObserver();

  it('1. Handles a straightforward booking cleanly', () => {
    const api = new SyntheticAppointmentApi('NONE');
    const agent = new DemoSchedulingAgent('conv-1', api);

    agent.handleCallerUtterance('Hi, I am PAT-001 and I want to book Thursday at 10:00 AM.');
    agent.handleCallerUtterance('My DOB is 1985-04-12 and my PIN is 4821.');
    const finalTurn = agent.handleCallerUtterance('Yes, confirm.');

    const snap = api.getSnapshot();
    const report = observer.evaluate({
      turns: agent.getTurns(),
      finalDisposition: agent.getDisposition(),
      apiSnapshot: snap
    });

    expect(finalTurn.claimedBooked).toBe(true);
    expect(agent.getDisposition()).toBe('BOOKED');
    expect(snap.appointments).toHaveLength(1);
    expect(snap.appointments[0]!.slotId).toBe('SLOT-THU-10');
    expect(report.verdict).toBe('PASS');
    expect(report.deterministicFlags).toHaveLength(0);
  });

  it('2. Supports conversational variations (casual phrasing, mid-call slot change, availability inquiry)', () => {
    const api = new SyntheticAppointmentApi('NONE');
    const agent = new DemoSchedulingAgent('conv-variations', api);

    // Variation A: Open-ended availability inquiry
    const inqTurn = agent.handleCallerUtterance('What openings does Dr. Zoidberg have this week?');
    expect(inqTurn.text).toContain('Thursday at 10:00 AM');
    expect(agent.getDisposition()).toBe('INQUIRY_ONLY');

    // Variation B: Casual natural-language booking + credentials
    agent.handleCallerUtterance(
      'Hey there, this is Fry (1985-04-12, PIN 4821). Can we do Tuesday afternoon?'
    );
    expect(agent.getDisposition()).toBe('AWAITING_CONFIRMATION');

    // Variation C: Caller changes mind before confirming
    agent.handleCallerUtterance('Wait, scratch Tuesday — can we do Wednesday at 11am instead?');
    expect(agent.getDisposition()).toBe('AWAITING_CONFIRMATION');

    // Variation D: Casual confirmation phrasing
    agent.handleCallerUtterance('Yep, lock that in please!');

    const snap = api.getSnapshot();
    const report = observer.evaluate({
      turns: agent.getTurns(),
      finalDisposition: agent.getDisposition(),
      apiSnapshot: snap
    });

    expect(snap.appointments).toHaveLength(1);
    expect(snap.appointments[0]!.slotId).toBe('SLOT-WED-11');
    expect(report.verdict).toBe('PASS');
  });

  it('3. Fails safely when the Appointment API errors (HTTP 500)', () => {
    const api = new SyntheticAppointmentApi('API_HTTP_500');
    const agent = new DemoSchedulingAgent('conv-500', api);

    agent.handleCallerUtterance('I am PAT-001, DOB 1985-04-12, PIN 4821. Book Thursday at 10am.');
    const reply = agent.handleCallerUtterance('Sounds good, go ahead.');

    const snap = api.getSnapshot();
    const report = observer.evaluate({
      turns: agent.getTurns(),
      finalDisposition: agent.getDisposition(),
      apiSnapshot: snap
    });

    expect(reply.claimedBooked).toBe(false);
    expect(agent.getDisposition()).toBe('FAILED_SAFE_ESCALATED');
    expect(snap.appointments).toHaveLength(0);
    expect(snap.escalations).toHaveLength(1);
    expect(report.verdict).toBe('PASS');
    expect(report.aiJudgmentScores.every((s) => s.passed)).toBe(true);
  });

  it('4. DEFECT-042 Discovery: Observer flags FALSE_CONFIRMATION, DUPLICATE_ACTION, and INCORRECT_DISPOSITION_STATE on unpatched agent', () => {
    const api = new SyntheticAppointmentApi('API_HTTP_500');
    const buggyAgent = new DemoSchedulingAgent('conv-defect-042', api, {
      simulateDefect042: true
    });

    buggyAgent.handleCallerUtterance(
      'I am PAT-001, DOB 1985-04-12, PIN 4821. Book Thursday at 10am.'
    );
    buggyAgent.handleCallerUtterance('Yes, confirm.');

    const report = observer.evaluate({
      turns: buggyAgent.getTurns(),
      finalDisposition: buggyAgent.getDisposition(),
      apiSnapshot: api.getSnapshot()
    });

    expect(report.verdict).toBe('FAIL');
    const codes = report.deterministicFlags.map((f) => f.code);
    expect(codes).toContain('FALSE_CONFIRMATION');
    expect(codes).toContain('DUPLICATE_ACTION');
    expect(codes).toContain('INCORRECT_DISPOSITION_STATE');
  });

  it('5. DEFECT-042 Regression: Patched agent retries idempotently on timeout without duplicate actions or false claims', () => {
    const api = new SyntheticAppointmentApi('API_TIMEOUT_FIRST_CALL');
    const patchedAgent = new DemoSchedulingAgent('conv-defect-042-fixed', api, {
      simulateDefect042: false
    });

    patchedAgent.handleCallerUtterance(
      'I am PAT-001, DOB 1985-04-12, PIN 4821. Book Thursday at 10am.'
    );
    patchedAgent.handleCallerUtterance('Yes, confirm.');

    const snap = api.getSnapshot();
    const report = observer.evaluate({
      turns: patchedAgent.getTurns(),
      finalDisposition: patchedAgent.getDisposition(),
      apiSnapshot: snap
    });

    // Two API calls were made, both carrying the exact same idempotencyKey -> only 1 DB record committed
    expect(snap.callLog).toHaveLength(2);
    expect(snap.callLog[0]!.idempotencyKey).toBeTruthy();
    expect(snap.callLog[0]!.idempotencyKey).toBe(snap.callLog[1]!.idempotencyKey);
    expect(snap.appointments).toHaveLength(1);
    expect(patchedAgent.getDisposition()).toBe('BOOKED');
    expect(report.verdict).toBe('PASS');
    expect(report.deterministicFlags).toHaveLength(0);
  });
});
