import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { load } from 'js-yaml';
import { runInNewContext } from 'node:vm';
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
  assert.equal(commands.length, 3);
  for (const command of commands.slice(0, 2)) {
    assert.match(command, /--workers=1 --retries=0 --repeat-each=5 --trace=retain-on-failure/);
    assert.doesNotMatch(command, /--trace=(on|on-first-retry)(?: |$)/);
  }
  assert.match(commands[0], /navigation-audit\.spec\.ts member-navigation\.spec\.ts public-journey\.spec\.ts --project mobile-chromium/);
  assert.match(commands[1], /discovery-pass-access\.spec\.ts --project desktop-chromium/);
  assert.match(commands[1], /--output=test-results-pass-access$/);
  assert.match(commands[2], /room-identity\.spec\.ts --grep 'support email stays intact through hydration' --project desktop-chromium --project mobile-chromium --project mobile-webkit --workers=1 --retries=0 --output=test-results-privacy$/);
  const upload = workflow.split('      - uses: actions/upload-artifact@').at(-1);
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

test('privacy follow-up rejects a changed production identity and records both source revisions', async () => {
  const workflow = load(readFileSync(new URL('../.github/workflows/browser-followup.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const steps = workflow.jobs.verify.steps;
  const before = steps.find(step => step.id === 'privacy_baseline');
  assert.equal(before.if, "env.PRIVACY_FOLLOWUP == 'true'");
  assert.match(before.run, /git diff --exit-code "\$expected" HEAD -- \. ':!tests\/e2e\/room-identity.spec.ts' ':!tests\/browser-environment.test.mjs' ':!\.github\/workflows\/browser-followup.yml' ':!ops\/vps\/test_code_release.py'\n/);
  assert.match(before.run, /git merge-base --is-ancestor "\$expected" refs\/remotes\/origin\/main/);
  const script = before.run.split("<<'JS'\n")[1].split('\nJS\n')[0].replace(/^import .*;\n/gm, '');
  const revision = '6e0e718d9d183072968433eef42cdad090545213';
  async function run(changes = {}, phase = 'before') {
    const saved = [];
    await runInNewContext(`(async () => {${script}})()`, {
      assert, AbortSignal, Date, console: { log() {} },
      process: { argv: ['', '', phase], env: { TEST_SOURCE: 'a'.repeat(40), RUNNER_TEMP: '/tmp' } },
      writeFile: async (path, value) => saved.push(JSON.parse(value)),
      fetch: async url => {
        assert.match(url, /^https:\/\/tickets\.becoreops\.com\/(healthz|api\/version)$/);
        return { status: changes.status ?? 200, json: async () => ({ service: 'becore-tickets', revision, runtime: 'vps', active: true, ...changes }) };
      },
    });
    return saved;
  }
  for (const phase of ['before', 'after']) {
    const [evidence] = await run({}, phase);
    assert.equal(evidence.productionRevision, revision);
    assert.equal(evidence.testRevision, 'a'.repeat(40));
    assert.equal(evidence.phase, phase);
  }
  for (const change of [{ status: 403 }, { service: 'other' }, { revision: 'b'.repeat(40) }, { runtime: 'worker' }, { active: false }]) await assert.rejects(run(change));
  await assert.rejects(run({}, 'invalid'));
  const after = steps.find(step => step.name === 'Confirm the application stayed on the activated revision');
  assert.equal(after.if, "${{ always() && steps.privacy_baseline.outcome == 'success' }}");
});


test('ordinary deployment excludes only the finite reviewed tooling paths without changing its guards', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const added = [
    '.github/workflows/tickets-release-operator-checks.yml',
    '.github/workflows/browser-followup.yml',
    'tests/browser-environment.test.mjs',
    'tests/test_operator_retry_workflow.py',
    'ops/vps/test_code_release.py',
    '.github/workflows/candidate-parallel-checks.yml',
    '.github/workflows/tickets-code-release.yml',
    'ops/vps/candidate_build.py',
    'ops/vps/code-release.py',
    'ops/vps/parallel_candidate_retry.py',
    'ops/vps/parallel_candidate_retry_control.py',
    'ops/vps/test_candidate_build.py',
    'ops/vps/test_parallel_candidate_retry.py',
    'ops/vps/test_parallel_candidate_retry_control.py',
    'ops/vps/test_parallel_retry_admission.py',
    'tests/test_candidate_parallel_workflow.py',
    'ops/vps/test_yorkeway_release.py',
  ];
  const addition = added.map(path => `      - '${path}'\n`).join('');
  assert.equal(workflow.split(addition).length, 2);
  assert.ok(workflow.includes(`${addition}  workflow_dispatch:\n`));
  const hygiene = ['.gitignore', 'tests/staff-app-launch.test.mjs'];
  const hygieneAddition = hygiene.map(path => `      - '${path}'\n`).join('');
  assert.equal(workflow.split(hygieneAddition).length, 2);
  assert.ok(workflow.includes(`    paths-ignore:\n${hygieneAddition}`));
  const evidence = ['ops/vps/operator_evidence.py', 'ops/vps/test_operator_evidence.py'];
  const evidenceAddition = evidence.map(path => `      - '${path}'\n`).join('');
  assert.equal(workflow.split(evidenceAddition).length, 2);
  // Exact reconstruction preserves every old ignore, manual input, permission,
  // concurrency setting and deployment/audit/source-verification command.
  const original = workflow.replace(addition, '').replace(hygieneAddition, '').replace(evidenceAddition, '');
  const digest = createHash('sha1').update(`blob ${Buffer.byteLength(original)}\0`).update(original).digest('hex');
  assert.equal(digest, 'b18eb81d65fd5a93fabebe7ae98c6cf99067076e');
  // These reviewed entries are literal files, not directories/globs. GitHub skips
  // paths-ignore only if every changed path matches; mixed changes still run.
  const passesNewFilter = paths => paths.some(path => ![...added, ...hygiene, ...evidence].includes(path));
  for (const path of evidence) assert.equal(passesNewFilter([path]), false);
  for (const path of hygiene) assert.equal(passesNewFilter([path]), false);
  for (const path of added) assert.equal(passesNewFilter([path]), false);
  assert.equal(passesNewFilter(added), false);
  for (const path of ['app/api/example/route.ts', 'package-lock.json', 'runtime/vps/server.mjs',
    'ops/vps/unreviewed-operator.py', 'scripts/build-vps.mjs', '.github/workflows/new-check.yml',
    'tests/new-runtime-fixture.mjs', 'ops/vps/test_code_release.py/extra']) {
    assert.equal(passesNewFilter([...added, path]), true);
    // Includes rename destinations and deletion paths outside the exact list.
    assert.equal(passesNewFilter([path]), true);
  }
  const runtime = readFileSync(new URL('../.github/workflows/vps-runtime.yml', import.meta.url), 'utf8');
  assert.match(runtime, /      - 'tests\/\*\*'/);
  assert.match(runtime, /      - 'ops\/vps\/\*\*'/);
});


test('existing maintenance covers both npm locks and pinned actions without automatic adoption', () => {
  const updates = readFileSync(new URL('../.github/dependabot.yml', import.meta.url), 'utf8');
  const entries = updates.split('  - package-ecosystem: ').slice(1);
  assert.equal(entries.length, 2);
  const [npm, actions] = entries;
  assert.ok(npm.startsWith('npm\n    directories: [/, /mobile]\n'));
  assert.ok(actions.startsWith('github-actions\n    directory: /\n'));
  for (const entry of entries) {
    assert.match(entry, /schedule:\n      interval: weekly\n      day: monday\n      time: "05:00"\n      timezone: Africa\/Accra\n/);
  }
  assert.match(npm, /open-pull-requests-limit: 5\n/);
  assert.match(actions, /open-pull-requests-limit: 2\n/);
  for (const type of ['production', 'development']) {
    assert.ok(npm.includes(`      ${type}-minor-and-patch:\n        dependency-type: ${type}\n        update-types: [minor, patch]\n`));
  }
  assert.doesNotMatch(updates, /registries:|token:|password:|ignore:|auto-merge|insecure-external-code-execution/);
  // Version proposals do not update image pins. Existing readiness checks must
  // still reject a lock/image mismatch until the matching image is reviewed.
  const mismatch = structuredClone(lock);
  mismatch.packages['node_modules/@playwright/test'].version = '99.0.0';
  assert.throws(() => check({ lock: mismatch }));
  assert.match(config.image, /@sha256:[a-f0-9]{64}$/);
});
