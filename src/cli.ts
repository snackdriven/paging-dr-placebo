import { resolve } from 'node:path';
import { ControllableClock } from './utils/clock.js';
import { SchedulingDatabase } from './backend/database.js';
import { ScenarioRunner } from './evaluation/scenario-runner.js';
import { SCENARIO_CATALOG } from './evaluation/scenarios.js';
import { EvaluationReporter } from './evaluation/evaluation-reporter.js';

const command = process.argv[2] ?? 'report:generate';

if (command === 'db:setup') {
  const clock = new ControllableClock('2026-10-27T09:00:00.000Z');
  const db = new SchedulingDatabase(':memory:', clock);
  db.resetAndSeed();
  const snap = db.captureSnapshot();
  console.log(
    JSON.stringify({
      status: 'DB_SETUP_OK',
      patients: snap.patients.length,
      providers: snap.providers.length,
      slots: snap.slots.length,
      seededAppointments: snap.appointments.length
    })
  );
  process.exit(0);
}

if (command === 'report:generate') {
  const runner = new ScenarioRunner();
  const artifacts = runner.runAll(SCENARIO_CATALOG, 'report-seed-1');
  const reporter = new EvaluationReporter();
  const report = reporter.generateReport(artifacts);

  const jsonPath = resolve(process.cwd(), 'reports/latest-evaluation.json');
  const mdPath = resolve(process.cwd(), 'reports/latest-evaluation.md');
  reporter.writeReportFiles(report, jsonPath, mdPath);

  console.log(
    JSON.stringify({
      status: 'REPORT_GENERATED',
      overallLabVerdict: report.overallLabVerdict,
      totalScenarios: report.summaryCounts.totalScenarios,
      standardAgentPassCount: report.summaryCounts.standardAgentPassCount,
      negativeAdversarialCaughtCount: report.summaryCounts.negativeAdversarialCaughtCount,
      unexpectedHarnessFailures: report.summaryCounts.unexpectedHarnessFailures,
      jsonPath,
      mdPath
    })
  );

  if (report.overallLabVerdict !== 'COMPLETE_VERIFIED') {
    process.exit(1);
  }
  process.exit(0);
}

console.error(`Unknown CLI command: ${command}`);
process.exit(1);
