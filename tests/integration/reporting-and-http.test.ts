import { describe, it, expect } from 'vitest';
import { ScenarioRunner } from '../../src/evaluation/scenario-runner.js';
import { SCENARIO_CATALOG } from '../../src/evaluation/scenarios.js';
import { EvaluationReporter } from '../../src/evaluation/evaluation-reporter.js';
import { ControllableClock } from '../../src/utils/clock.js';
import { SchedulingDatabase } from '../../src/backend/database.js';
import { VerificationService } from '../../src/backend/verification-service.js';
import { AppointmentRepository } from '../../src/backend/appointment-repository.js';
import { SchedulingApi } from '../../src/backend/scheduling-api.js';
import { SchedulingHttpServer } from '../../src/backend/http-server.js';

describe('Increment 7 & 8: Reporting, Repeated Seeded Reproducibility, and HTTP Server Contract', () => {
  const runner = new ScenarioRunner();
  const reporter = new EvaluationReporter();

  it('RPT-01: Generates COMPLETE_VERIFIED report with explicit metric formulas and critical invariant gating', () => {
    const artifacts = runner.runAll(SCENARIO_CATALOG, 'seed-rpt-1');
    const report = reporter.generateReport(artifacts);

    expect(report.overallLabVerdict).toBe('COMPLETE_VERIFIED');
    expect(report.criticalInvariantGateTriggered).toBe(false);
    expect(report.summaryCounts.unexpectedHarnessFailures).toBe(0);
    expect(report.metrics).toHaveLength(3);
    expect(report.requirementCoverage.every((r) => r.allScenariosClassifiedCorrectly)).toBe(
      true
    );

    // Verify critical invariant gate prevents aggregate score from concealing a patient isolation failure
    const tamperedArtifacts = structuredClone(artifacts);
    const t01Artifact = tamperedArtifacts.find((a) => a.scenario.scenarioId === 'T01')!;
    const inv06 = t01Artifact.evaluationResult.invariantResults.find(
      (i) => i.invariantId === 'INV-06'
    )!;
    inv06.passed = false;
    t01Artifact.evaluationResult.verdict = 'FAIL';
    t01Artifact.evaluationResult.harnessClassificationCorrect = false;

    const failedReport = reporter.generateReport(tamperedArtifacts);
    expect(failedReport.criticalInvariantGateTriggered).toBe(true);
    expect(failedReport.overallLabVerdict).toBe('FAILED_VERIFICATION');
  });

  it('R8: Repeated seeded runs across all catalog scenarios produce identical deterministic verdicts and snapshots', () => {
    const runA = runner.runAll(SCENARIO_CATALOG, 'deterministic-seed-alpha');
    const runB = runner.runAll(SCENARIO_CATALOG, 'deterministic-seed-alpha');

    expect(runA.map((a) => a.evaluationResult.verdict)).toEqual(
      runB.map((b) => b.evaluationResult.verdict)
    );
    expect(runA.map((a) => a.evaluationResult.stateComparison)).toEqual(
      runB.map((b) => b.evaluationResult.stateComparison)
    );
    expect(runA.map((a) => a.evidenceBundle.auditEvents)).toEqual(
      runB.map((b) => b.evidenceBundle.auditEvents)
    );
  });

  it('A1 & A2: Lightweight HTTP API server enforces verification and commits booking over real HTTP transport', async () => {
    const clock = new ControllableClock('2026-10-27T09:00:00.000Z');
    const db = new SchedulingDatabase(':memory:', clock);
    db.resetAndSeed();
    const verifySvc = new VerificationService(db, clock);
    const repo = new AppointmentRepository(db, clock, verifySvc);
    const api = new SchedulingApi(db, verifySvc, repo, clock);
    const server = new SchedulingHttpServer(api);

    const baseUrl = await server.start(0);
    try {
      // 1. Unauthorized HTTP POST /api/mutations must return 400 REJECTED
      const unauthRes = await fetch(`${baseUrl}/api/mutations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationId: 'op-http-1',
          idempotencyKey: 'idem-http-1',
          conversationId: 'conv-http-1',
          patientId: 'PAT-001',
          verificationTokenId: 'tok-invalid',
          confirmationProposalId: 'prop-http-1',
          action: 'BOOK',
          slotId: 'SLOT-PRV1-THU-10'
        })
      });
      expect(unauthRes.status).toBe(400);
      const unauthJson = (await unauthRes.json()) as { errorCode: string };
      expect(unauthJson.errorCode).toBe('UNAUTHORIZED_NO_VALID_TOKEN');

      // 2. Verify patient via HTTP POST /api/verify
      const verifyRes = await fetch(`${baseUrl}/api/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: 'conv-http-1',
          patientId: 'PAT-001',
          dob: '1985-04-12',
          verificationPin: '4821'
        })
      });
      expect(verifyRes.status).toBe(200);
      const verifyJson = (await verifyRes.json()) as {
        verified: boolean;
        token: { tokenId: string };
      };
      expect(verifyJson.verified).toBe(true);

      // 3. Authorized HTTP POST /api/mutations succeeds
      const bookRes = await fetch(`${baseUrl}/api/mutations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationId: 'op-http-2',
          idempotencyKey: 'idem-http-2',
          conversationId: 'conv-http-1',
          patientId: 'PAT-001',
          verificationTokenId: verifyJson.token.tokenId,
          confirmationProposalId: 'prop-http-2',
          action: 'BOOK',
          slotId: 'SLOT-PRV1-THU-10'
        })
      });
      expect(bookRes.status).toBe(200);
      const bookJson = (await bookRes.json()) as {
        backendOutcome: string;
        appointmentId: string;
      };
      expect(bookJson.backendOutcome).toBe('COMMITTED');

      // 4. Reconcile over HTTP GET /api/operations/reconcile
      const reconRes = await fetch(
        `${baseUrl}/api/operations/reconcile?conversationId=conv-http-1&operationId=op-http-2&idempotencyKey=idem-http-2`
      );
      expect(reconRes.status).toBe(200);
      const reconJson = (await reconRes.json()) as { outcome: string; appointmentId: string };
      expect(reconJson.outcome).toBe('RECONCILED_COMMITTED');
      expect(reconJson.appointmentId).toBe(bookJson.appointmentId);
    } finally {
      await server.stop();
    }
  });
});
