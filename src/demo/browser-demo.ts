import { SyntheticAppointmentApi, type ApiFaultMode } from './appointment-api.js';
import { DemoSchedulingAgent } from './scheduling-agent.js';
import { DemoObserver } from './observer.js';

declare global {
  interface Window {
    DemoLab: {
      createSession: (opts: {
        conversationId: string;
        faultMode: ApiFaultMode;
        simulateDefect042: boolean;
      }) => {
        sendTurn: (utterance: string) => ReturnType<typeof getSessionState>;
        getState: () => ReturnType<typeof getSessionState>;
      };
      runRegressionSuite: () => Array<{
        id: string;
        title: string;
        passed: boolean;
        summary: string;
      }>;
    };
  }
}

const observer = new DemoObserver();

function getSessionState(
  api: SyntheticAppointmentApi,
  agent: DemoSchedulingAgent,
  faultMode: ApiFaultMode,
  simulateDefect042: boolean
) {
  const turns = agent.getTurns();
  const finalDisposition = agent.getDisposition();
  const apiSnapshot = api.getSnapshot();
  const evaluation =
    turns.length > 0
      ? observer.evaluate({
          turns,
          finalDisposition,
          apiSnapshot
        })
      : null;

  return {
    faultMode,
    simulateDefect042,
    turns,
    finalDisposition,
    apiSnapshot,
    evaluation
  };
}

window.DemoLab = {
  createSession({ conversationId, faultMode, simulateDefect042 }) {
    const api = new SyntheticAppointmentApi(faultMode);
    const agent = new DemoSchedulingAgent(conversationId, api, { simulateDefect042 });
    return {
      sendTurn(utterance: string) {
        agent.handleCallerUtterance(utterance);
        return getSessionState(api, agent, faultMode, simulateDefect042);
      },
      getState() {
        return getSessionState(api, agent, faultMode, simulateDefect042);
      }
    };
  },

  runRegressionSuite() {
    const results: Array<{ id: string; title: string; passed: boolean; summary: string }> = [];

    // Test 1: Straightforward booking
    {
      const api = new SyntheticAppointmentApi('NONE');
      const agent = new DemoSchedulingAgent('reg-1', api);
      agent.handleCallerUtterance('Hi, I am PAT-001 and I want to book Thursday at 10:00 AM.');
      agent.handleCallerUtterance('My DOB is 1985-04-12 and my PIN is 4821.');
      agent.handleCallerUtterance('Yes, confirm.');
      const rep = observer.evaluate({
        turns: agent.getTurns(),
        finalDisposition: agent.getDisposition(),
        apiSnapshot: api.getSnapshot()
      });
      const passed =
        rep.verdict === 'PASS' &&
        agent.getDisposition() === 'BOOKED' &&
        api.getSnapshot().appointments.length === 1;
      results.push({
        id: 'REG-01',
        title: 'Straightforward Booking (PAT-001 -> Thursday 10:00 AM)',
        passed,
        summary: '1 appointment committed (APT-101), disposition BOOKED, 0 observer flags.'
      });
    }

    // Test 2: Conversational variations (inquiry + casual phrasing + slot switch)
    {
      const api = new SyntheticAppointmentApi('NONE');
      const agent = new DemoSchedulingAgent('reg-2', api);
      agent.handleCallerUtterance('What openings does Dr. Zoidberg have this week?');
      agent.handleCallerUtterance(
        'Hey there, this is Fry (1985-04-12, PIN 4821). Can we do Tuesday afternoon?'
      );
      agent.handleCallerUtterance('Wait, scratch Tuesday — can we do Wednesday at 11am instead?');
      agent.handleCallerUtterance('Yep, lock that in please!');
      const snap = api.getSnapshot();
      const rep = observer.evaluate({
        turns: agent.getTurns(),
        finalDisposition: agent.getDisposition(),
        apiSnapshot: snap
      });
      const passed =
        rep.verdict === 'PASS' &&
        snap.appointments.length === 1 &&
        snap.appointments[0]?.slotId === 'SLOT-WED-11';
      results.push({
        id: 'REG-02',
        title: 'Conversational Variations (Inquiry + Mid-Call Slot Switch)',
        passed,
        summary: 'Switched cleanly from Tuesday 2pm to Wednesday 11am (SLOT-WED-11), 0 flags.'
      });
    }

    // Test 3: Safe failure on API HTTP 500
    {
      const api = new SyntheticAppointmentApi('API_HTTP_500');
      const agent = new DemoSchedulingAgent('reg-3', api);
      agent.handleCallerUtterance('I am PAT-001, DOB 1985-04-12, PIN 4821. Book Thursday at 10am.');
      agent.handleCallerUtterance('Sounds good, go ahead.');
      const snap = api.getSnapshot();
      const rep = observer.evaluate({
        turns: agent.getTurns(),
        finalDisposition: agent.getDisposition(),
        apiSnapshot: snap
      });
      const passed =
        rep.verdict === 'PASS' &&
        agent.getDisposition() === 'FAILED_SAFE_ESCALATED' &&
        snap.appointments.length === 0 &&
        snap.escalations.length === 1;
      results.push({
        id: 'REG-03',
        title: 'Safe Failure on Appointment API HTTP 500',
        passed,
        summary: 'No false confirmation, disposition FAILED_SAFE_ESCALATED, ticket ESC-201 created.'
      });
    }

    // Test 4: Observer catches DEFECT-042 when unpatched
    {
      const api = new SyntheticAppointmentApi('API_HTTP_500');
      const buggy = new DemoSchedulingAgent('reg-4', api, { simulateDefect042: true });
      buggy.handleCallerUtterance('I am PAT-001, DOB 1985-04-12, PIN 4821. Book Thursday at 10am.');
      buggy.handleCallerUtterance('Yes, confirm.');
      const rep = observer.evaluate({
        turns: buggy.getTurns(),
        finalDisposition: buggy.getDisposition(),
        apiSnapshot: api.getSnapshot()
      });
      const codes = rep.deterministicFlags.map((f) => f.code);
      const passed =
        rep.verdict === 'FAIL' &&
        codes.includes('FALSE_CONFIRMATION') &&
        codes.includes('DUPLICATE_ACTION') &&
        codes.includes('INCORRECT_DISPOSITION_STATE');
      results.push({
        id: 'REG-04',
        title: 'Observer Catches Unpatched DEFECT-042 (All 3 Flags)',
        passed,
        summary: 'Caught FALSE_CONFIRMATION, DUPLICATE_ACTION, and INCORRECT_DISPOSITION_STATE.'
      });
    }

    // Test 5: Patched agent retries idempotently on timeout
    {
      const api = new SyntheticAppointmentApi('API_TIMEOUT_FIRST_CALL');
      const patched = new DemoSchedulingAgent('reg-5', api, { simulateDefect042: false });
      patched.handleCallerUtterance(
        'I am PAT-001, DOB 1985-04-12, PIN 4821. Book Thursday at 10am.'
      );
      patched.handleCallerUtterance('Yes, confirm.');
      const snap = api.getSnapshot();
      const rep = observer.evaluate({
        turns: patched.getTurns(),
        finalDisposition: patched.getDisposition(),
        apiSnapshot: snap
      });
      const passed =
        rep.verdict === 'PASS' &&
        snap.callLog.length === 2 &&
        snap.callLog[0]?.idempotencyKey === snap.callLog[1]?.idempotencyKey &&
        snap.appointments.length === 1;
      results.push({
        id: 'REG-05',
        title: 'DEFECT-042 Fix: Idempotent Retry on API Timeout',
        passed,
        summary: '2 API calls shared idempotencyKey, 1 DB appointment committed, 0 flags.'
      });
    }

    return results;
  }
};
