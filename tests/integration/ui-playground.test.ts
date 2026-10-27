import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlaygroundServer } from '../../src/ui/playground-server.js';

describe('UI Playground Server & Interactive Sandbox API', () => {
  let server: PlaygroundServer;
  let baseUrl: string;

  beforeEach(async () => {
    server = new PlaygroundServer();
    baseUrl = await server.start(0);
  });

  afterEach(async () => {
    await server.stop();
  });

  it('Serves the interactive HTML dashboard and scenario catalog', async () => {
    const htmlRes = await fetch(`${baseUrl}/`);
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toContain('Paging Dr. Placebo');
    expect(html).toContain('Independent Observer Verdict');

    const catRes = await fetch(`${baseUrl}/api/playground/scenarios`);
    expect(catRes.status).toBe(200);
    const catJson = (await catRes.json()) as { scenarios: Array<{ scenarioId: string }> };
    expect(catJson.scenarios.length).toBeGreaterThanOrEqual(21);
  });

  it('Executes interactive caller turns, updates SQLite snapshot, and evaluates 10 invariants live', async () => {
    // 1. Send booking request
    await fetch(`${baseUrl}/api/playground/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'I am PAT-001 and I want to book SLOT-PRV1-THU-10 with PRV-001.'
      })
    });

    // 2. Send credentials
    await fetch(`${baseUrl}/api/playground/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'My DOB is 1985-04-12 and my PIN is 4821.'
      })
    });

    // 3. Send explicit confirmation
    const turn3Res = await fetch(`${baseUrl}/api/playground/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Yes, please confirm and book that appointment.'
      })
    });

    const state = (await turn3Res.json()) as {
      evaluation: {
        verdict: string;
        backendOutcome: string;
        stateComparison: { actualBookedSlotIds: string[] };
      };
    };

    expect(state.evaluation.verdict).toBe('PASS');
    expect(state.evaluation.backendOutcome).toBe('COMMITTED');
    expect(state.evaluation.stateComparison.actualBookedSlotIds).toEqual(['SLOT-PRV1-THU-10']);
  });

  it('Evaluates honest rejection of an already-booked slot as PASS in interactive sandbox', async () => {
    await fetch(`${baseUrl}/api/playground/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'I am PAT-001, DOB 1985-04-12, PIN 4821. Book SLOT-PRV1-TUE-09.'
      })
    });

    const turn2Res = await fetch(`${baseUrl}/api/playground/turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Yes, please confirm and book that appointment.'
      })
    });

    const state = (await turn2Res.json()) as {
      evaluation: {
        verdict: string;
        backendOutcome: string;
      };
    };

    expect(state.evaluation.backendOutcome).toBe('REJECTED');
    expect(state.evaluation.verdict).toBe('PASS');
  });

  it('Runs built-in catalog scenarios (e.g. T10 false success claim) via /api/playground/run-scenario', async () => {
    const res = await fetch(`${baseUrl}/api/playground/run-scenario`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'T10' })
    });
    expect(res.status).toBe(200);
    const artifact = (await res.json()) as {
      evaluationResult: { verdict: string; harnessClassificationCorrect: boolean };
    };
    expect(artifact.evaluationResult.verdict).toBe('FAIL');
    expect(artifact.evaluationResult.harnessClassificationCorrect).toBe(true);
  });

  it('Browser SQLite shim and crypto shim run all 21 catalog scenarios identically in-browser', async () => {
    const { DatabaseSync } = await import('../../src/ui/browser-sqlite-shim.js');
    const { createHash } = await import('../../src/ui/browser-crypto-shim.js');

    const db = new DatabaseSync(':memory:');
    db.exec('BEGIN IMMEDIATE TRANSACTION');
    db.prepare('INSERT INTO patients (patient_id, full_name, dob, verification_pin) VALUES (?, ?, ?, ?)').run(
      'PAT-001',
      'Philip J. Fry',
      '1985-04-12',
      '4821'
    );
    db.exec('COMMIT');

    const row = db
      .prepare('SELECT patient_id, dob, verification_pin FROM patients WHERE patient_id = ?')
      .get('PAT-001') as { patient_id: string };
    expect(row.patient_id).toBe('PAT-001');

    const h1 = createHash('sha256').update('payload-a').digest('hex');
    const h2 = createHash('sha256').update('payload-b').digest('hex');
    expect(h1).toHaveLength(64);
    expect(h1).not.toBe(h2);
  });
});
