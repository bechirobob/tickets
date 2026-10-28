import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateVersions } from '../scripts/verify-browser-environment.mjs';

const config = JSON.parse(readFileSync(new URL('../scripts/browser-environment.json', import.meta.url)));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
const os = 'ID=ubuntu\nVERSION_ID="24.04"\n';
const check = (changes = {}) => validateVersions(changes.config ?? config, changes.lock ?? lock,
  changes.installed ?? config.playwrightVersion, changes.node ?? config.nodeVersion, changes.os ?? os);

test('prepared image matches the root and mobile locked Playwright versions', () => {
  check();
  check({ lock: JSON.parse(readFileSync(new URL('../mobile/package-lock.json', import.meta.url))) });
});
for (const [name, changes] of Object.entries({
  'mutable image tag': { config: { ...config, image: config.image.split('@')[0] } },
  'wrong image version': { config: { ...config, image: config.image.replace(`v${config.playwrightVersion}`, 'v0.0.0') } },
  'installed package mismatch': { installed: '0.0.0' },
  'unreviewed Node runtime': { node: '0.0.0' },
  'wrong Linux distribution': { os: 'ID=debian\nVERSION_ID="24.04"\n' },
  'wrong Ubuntu release': { os: 'ID=ubuntu\nVERSION_ID="22.04"\n' },
  'changed dependency lock': { lock: { packages: { 'node_modules/@playwright/test': { version: '1.63.0' }, 'node_modules/playwright': { version: '1.63.0' } } } },
})) test(`readiness rejects ${name}`, () => assert.throws(() => check(changes)));

const jobs = {
  'candidate-checks.yml': ['verify'],
  'candidate-parallel-checks.yml': ['desktop_chromium', 'mobile_chromium', 'mobile_webkit'],
  'tickets-code-release.yml': ['retired_preview'],
  'booking-consent-previews.yml': ['preview'],
  'customer-email-previews.yml': ['preview'],
  'yorkeway-previews.yml': ['preview'],
  'browser-followup.yml': ['verify'],
  'input-modality-checks.yml': ['browser'],
  'native-apps.yml': ['web-client'],

};
for (const [filename, names] of Object.entries(jobs)) {
  const workflow = readFileSync(new URL(`../.github/workflows/${filename}`, import.meta.url), 'utf8');
  for (const name of names) test(`${filename}/${name} uses prepared browsers without installation`, () => {
    const job = workflow.slice(workflow.indexOf(`\n  ${name}:\n`) + 1).split(/\n  [\w-]+:\n/)[0];
    assert.ok(job.startsWith(`  ${name}:\n`));
    assert.ok(job.includes(`      image: ${config.image}\n`));
    assert.match(job, /runs-on: ubuntu-24\.04/);
    assert.match(job, /shell: bash/);
    assert.match(job, /node-version: 22\.23\.4/);
    assert.match(job, /node (?:(?:\.\.|\.prepared-browser-tools)\/)?scripts\/verify-browser-environment\.mjs/);
    assert.doesNotMatch(job, /playwright install|apt-get|--privileged|SYS_ADMIN/);
  });
}


test('focused browser diagnostics retain first failures without uploading green-run traces', () => {
  const workflow = readFileSync(new URL('../.github/workflows/browser-followup.yml', import.meta.url), 'utf8');
  const commands = [...workflow.matchAll(/^        run: (npx playwright test .+)$/gm)].map(match => match[1]);
  assert.equal(commands.length, 2);
  for (const command of commands) {
    assert.match(command, /--workers=1 --retries=0 --repeat-each=5 --trace=retain-on-failure/);
    assert.doesNotMatch(command, /--trace=(on|on-first-retry)(?: |$)/);
  }
  assert.match(commands[0], /navigation-audit\.spec\.ts member-navigation\.spec\.ts public-journey\.spec\.ts --project mobile-chromium/);
  assert.match(commands[1], /discovery-pass-access\.spec\.ts --project desktop-chromium/);
  assert.match(commands[1], /--output=test-results-pass-access$/);
  const upload = workflow.split('      - uses: actions/upload-artifact@')[1];
  assert.ok(upload?.startsWith('ea165f8d65b6e75b540449e92b4886f43607fa02'));
  // failure() overrides the implicit success condition, including when the
  // first test step failed and the second was skipped. No live retry needed.
  assert.match(upload, /        if: failure\(\)\n/);
  assert.match(upload, /name: focused-production-browser-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(upload, /path: \|\n            playwright-report\n            test-results\n            test-results-pass-access\n          retention-days: 14/);
  assert.doesNotMatch(workflow, /continue-on-error|if: always\(\)|actions: write|contents: write/);
  const base = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
  assert.match(base, /screenshot: "only-on-failure"/);
});


test('ordinary deployment excludes only five known tooling paths without changing its guards', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const added = [
    '.github/workflows/tickets-release-operator-checks.yml',
    '.github/workflows/browser-followup.yml',
    'tests/browser-environment.test.mjs',
    'tests/test_operator_retry_workflow.py',
    'ops/vps/test_code_release.py',
  ];
  const addition = added.map(path => `      - '${path}'\n`).join('');
  assert.equal(workflow.split(addition).length, 2);
  assert.ok(workflow.includes(`${addition}  workflow_dispatch:\n`));
  // Exact reconstruction preserves every old ignore, manual input, permission,
  // concurrency setting and deployment/audit/source-verification command.
  const original = workflow.replace(addition, '');
  const digest = createHash('sha1').update(`blob ${Buffer.byteLength(original)}\0`).update(original).digest('hex');
  assert.equal(digest, 'b18eb81d65fd5a93fabebe7ae98c6cf99067076e');
  // These five entries are literal files, not directories/globs. GitHub skips
  // paths-ignore only if every changed path matches; mixed changes still run.
  const passesNewFilter = paths => paths.some(path => !added.includes(path));
  for (const path of added) assert.equal(passesNewFilter([path]), false);
  assert.equal(passesNewFilter(added), false);
  for (const path of ['app/api/example/route.ts', 'package-lock.json', 'runtime/vps/server.mjs',
    'ops/vps/code-release.py', 'scripts/build-vps.mjs', '.github/workflows/new-check.yml',
    'tests/new-runtime-fixture.mjs', 'ops/vps/test_code_release.py/extra']) {
    assert.equal(passesNewFilter([...added, path]), true);
    // Includes rename destinations and deletion paths outside the exact list.
    assert.equal(passesNewFilter([path]), true);
  }
  const runtime = readFileSync(new URL('../.github/workflows/vps-runtime.yml', import.meta.url), 'utf8');
  assert.match(runtime, /      - 'tests\/\*\*'/);
  assert.match(runtime, /      - 'ops\/vps\/\*\*'/);
});
