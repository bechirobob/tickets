import { mkdirSync, writeFileSync } from 'node:fs';
import type { Reporter, TestCase } from 'vitest/node';

export default class CapacityReporter implements Reporter {
  onTestCaseResult(test: TestCase) {
    const report = (test.meta() as { capacity?: unknown }).capacity;
    if (!report) return;
    mkdirSync('capacity-results', { recursive: true });
    writeFileSync('capacity-results/measurements.json', JSON.stringify({ revision: process.env.GITHUB_SHA ?? 'local-uncommitted', state: test.result().state, report }, null, 2));
    console.log(`CAPACITY_MEASUREMENTS ${JSON.stringify(report)}`);
  }
}
