import { SyntheticAppointmentApi } from './appointment-api.js';
import { DemoSchedulingAgent } from './scheduling-agent.js';
import { DemoObserver } from './observer.js';

const observer = new DemoObserver();

function printSection(title: string) {
  console.log(`\n================================================================================`);
  console.log(`  ${title}`);
  console.log(`================================================================================`);
}

// -----------------------------------------------------------------------------
// Part 1: Straightforward Booking, Conversational Variations, and Safe Failure
// -----------------------------------------------------------------------------
printSection('PART 1: CORE AGENT CAPABILITIES (BOOKING, VARIATIONS & SAFE FAILURE)');

// 1A. Straightforward Booking
{
  const api = new SyntheticAppointmentApi('NONE');
  const agent = new DemoSchedulingAgent('conv-straightforward', api);
  agent.handleCallerUtterance('Hi, I am PAT-001 and I want to book Thursday at 10:00 AM.');
  agent.handleCallerUtterance('My DOB is 1985-04-12 and my PIN is 4821.');
  const finalTurn = agent.handleCallerUtterance('Yes, confirm.');
  const report = observer.evaluate({
    turns: agent.getTurns(),
    finalDisposition: agent.getDisposition(),
    apiSnapshot: api.getSnapshot()
  });
  console.log(
    `[1A. Straightforward Booking] Verdict: ${report.verdict} | Disposition: ${agent.getDisposition()} | Reply: "${finalTurn.text}"`
  );
}

// 1B. Conversational Variation: Casual Phrasing + Mid-Call Slot Change
{
  const api = new SyntheticAppointmentApi('NONE');
  const agent = new DemoSchedulingAgent('conv-variation-switch', api);
  agent.handleCallerUtterance(
    'Hey there, this is Fry (1985-04-12, PIN 4821). Can we do Tuesday afternoon with Dr. Zoidberg?'
  );
  agent.handleCallerUtterance('Wait, scratch Tuesday — can we do Wednesday at 11am instead?');
  const finalTurn = agent.handleCallerUtterance('Yep, lock that in please!');
  const report = observer.evaluate({
    turns: agent.getTurns(),
    finalDisposition: agent.getDisposition(),
    apiSnapshot: api.getSnapshot()
  });
  console.log(
    `[1B. Variation: Slot Switch]  Verdict: ${report.verdict} | Booked Slot: ${api.getSnapshot().appointments[0]?.slotId} | Reply: "${finalTurn.text}"`
  );
}

// 1C. Safe Failure When Appointment API Errors (HTTP 500)
{
  const api = new SyntheticAppointmentApi('API_HTTP_500');
  const agent = new DemoSchedulingAgent('conv-safe-500', api);
  agent.handleCallerUtterance('I am PAT-001, DOB 1985-04-12, PIN 4821. Book Thursday at 10am.');
  const finalTurn = agent.handleCallerUtterance('Sounds good, go ahead.');
  const report = observer.evaluate({
    turns: agent.getTurns(),
    finalDisposition: agent.getDisposition(),
    apiSnapshot: api.getSnapshot()
  });
  console.log(
    `[1C. Safe API 500 Handling]   Verdict: ${report.verdict} | Disposition: ${agent.getDisposition()} | Reply: "${finalTurn.text}"`
  );
}

// -----------------------------------------------------------------------------
// Part 2: Complete Defect Lifecycle (DEFECT-042)
// -----------------------------------------------------------------------------
printSection('PART 2: COMPLETE DEFECT LIFECYCLE (DEFECT-042)');

// Stage 1: Failure Discovered
console.log('\n--- STAGE 1: FAILURE DISCOVERED (simulateDefect042 = true) ---');
{
  const api = new SyntheticAppointmentApi('API_HTTP_500');
  const buggyAgent = new DemoSchedulingAgent('conv-defect-500', api, { simulateDefect042: true });
  buggyAgent.handleCallerUtterance('I am PAT-001, DOB 1985-04-12, PIN 4821. Book Thursday at 10am.');
  const buggyReply = buggyAgent.handleCallerUtterance('Yes, confirm.');
  const buggyReport = observer.evaluate({
    turns: buggyAgent.getTurns(),
    finalDisposition: buggyAgent.getDisposition(),
    apiSnapshot: api.getSnapshot()
  });

  console.log(`Agent Utterance  : "${buggyReply.text}"`);
  console.log(`Agent Disposition: ${buggyAgent.getDisposition()}`);
  console.log(`DB Appointments  : ${api.getSnapshot().appointments.length}`);
  console.log(`Observer Verdict : ${buggyReport.verdict}`);
  for (const flag of buggyReport.deterministicFlags) {
    console.log(`  [FLAGGED] ${flag.code} (${flag.severity}): ${flag.explanation}`);
  }
}

// Stage 2: Root Cause Identified
console.log('\n--- STAGE 2: ROOT CAUSE IDENTIFIED ---');
console.log(`1. Missing Idempotency Key on Retry: DemoSchedulingAgent called api.bookAppointment() twice with idempotencyKey: null.`);
console.log(`2. Optimistic Confirmation Claim   : Agent emitted "You are all set! I have confirmed and booked..." without checking res.ok.`);
console.log(`3. Unconditional Disposition State : Agent assigned this.disposition = 'BOOKED' before verifying backend commit.`);

// Stage 3: Fix Applied & Stage 5: Outcome Verified
console.log('\n--- STAGE 3 & 5: FIX APPLIED & OUTCOME VERIFIED (simulateDefect042 = false) ---');
{
  // Verify under HTTP 500 outage
  const api500 = new SyntheticAppointmentApi('API_HTTP_500');
  const fixedAgent500 = new DemoSchedulingAgent('conv-fixed-500', api500, {
    simulateDefect042: false
  });
  fixedAgent500.handleCallerUtterance(
    'I am PAT-001, DOB 1985-04-12, PIN 4821. Book Thursday at 10am.'
  );
  const fixedReply500 = fixedAgent500.handleCallerUtterance('Yes, confirm.');
  const fixedReport500 = observer.evaluate({
    turns: fixedAgent500.getTurns(),
    finalDisposition: fixedAgent500.getDisposition(),
    apiSnapshot: api500.getSnapshot()
  });

  console.log(`[Fixed under HTTP 500]`);
  console.log(`  Agent Utterance  : "${fixedReply500.text}"`);
  console.log(`  Agent Disposition: ${fixedAgent500.getDisposition()}`);
  console.log(`  Observer Verdict : ${fixedReport500.verdict} (${fixedReport500.deterministicFlags.length} flags)`);

  // Verify under transient timeout (idempotent retry succeeds with 1 appointment)
  const apiTimeout = new SyntheticAppointmentApi('API_TIMEOUT_FIRST_CALL');
  const fixedAgentTimeout = new DemoSchedulingAgent('conv-fixed-timeout', apiTimeout, {
    simulateDefect042: false
  });
  fixedAgentTimeout.handleCallerUtterance(
    'I am PAT-001, DOB 1985-04-12, PIN 4821. Book Thursday at 10am.'
  );
  const fixedReplyTimeout = fixedAgentTimeout.handleCallerUtterance('Yes, confirm.');
  const fixedReportTimeout = observer.evaluate({
    turns: fixedAgentTimeout.getTurns(),
    finalDisposition: fixedAgentTimeout.getDisposition(),
    apiSnapshot: apiTimeout.getSnapshot()
  });

  console.log(`[Fixed under Transient Timeout]`);
  console.log(`  Agent Utterance  : "${fixedReplyTimeout.text}"`);
  console.log(`  API Calls Made   : ${apiTimeout.getSnapshot().callLog.length} (shared key: ${apiTimeout.getSnapshot().callLog[0]?.idempotencyKey})`);
  console.log(`  DB Appointments  : ${apiTimeout.getSnapshot().appointments.length} (zero duplicates)`);
  console.log(`  Observer Verdict : ${fixedReportTimeout.verdict} (${fixedReportTimeout.deterministicFlags.length} flags)`);
}
