import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { load } from 'js-yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const workflow = load(await readFile(new URL('../.github/workflows/d1-recovery-rehearsal.yml', import.meta.url), 'utf8'));
import { checkD1RecoveryRuntime } from '../scripts/check-d1-recovery-runtime.mjs';
const sentinels = [
  'https://export.invalid/fake.sql?signature=FAKE_SIGNED_URL_SENTINEL',
  "INSERT INTO customers VALUES ('FAKE_CUSTOMER_ROW_SENTINEL');",
];

async function fixture(t, command, body) {
  const directory = await mkdtemp(join(tmpdir(), 'tickets-recovery-privacy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  const temporary = join(directory, 'temporary');
  await mkdir(bin);
  await mkdir(temporary);
  await writeFile(join(bin, command), `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o700 });
  const exportFile = join(directory, 'fake-export.sql');
  await writeFile(exportFile, '-- Fake offline export; no customer data.\n');
  return {
    directory,
    temporary,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      TMPDIR: temporary,
      D1_EXPORT_FILE: exportFile,
      RECOVERY_REPORT_FILE: join(directory, 'report.json'),
      TEST_CAPTURE_MODE: join(directory, 'capture-mode.txt'),
      TEST_STDOUT: sentinels[0],
      TEST_STDERR: sentinels[1],
    },
  };
}

const privateOutput = `
stat -Lc '%a' "/proc/$$/fd/1" >"$TEST_CAPTURE_MODE"
printf '%s\\n' "$TEST_STDOUT"
printf '%s\\n' "$TEST_STDERR" >&2
exit "$TEST_EXIT_STATUS"
`;

async function assertPrivate(result, fixture, status) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, status, 'Preserve the original command exit status');
  for (const sentinel of sentinels) {
    assert.ok(!`${result.stdout}${result.stderr}`.includes(sentinel), 'Private diagnostics must not reach either output stream');
  }
  assert.equal((await readFile(fixture.env.TEST_CAPTURE_MODE, 'utf8')).trim(), '600');
  assert.deepEqual(await readdir(fixture.temporary), [], 'Remove private diagnostics and restore files on every exit');
}

for (const status of [0, 7]) {
  test(`SQLite import with status ${status} keeps both output streams private and removes diagnostics`, async t => {
    const files = await fixture(t, 'sqlite3', `
if [[ "$2" == .read* ]]; then
  touch "$1"
  ${privateOutput}
fi
case "$2" in
  'PRAGMA quick_check;'|'PRAGMA integrity_check;') printf 'ok\\n' ;;
  'SELECT COUNT(*) FROM sqlite_master'*) printf '1\\n' ;;
  *) [[ "$1" == '-json' ]]; printf '[{"events":0,"orders":0,"tickets":0}]\\n' ;;
esac`);
    const result = spawnSync('bash', ['--noprofile', '--norc', '-x', 'scripts/rehearse-d1-recovery.sh'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...files.env, TEST_EXIT_STATUS: String(status) },
      timeout: 10_000,
    });
    await assertPrivate(result, files, status);
    assert.equal(result.stderr, `+ set +x\n${status ? 'The isolated SQLite restore failed; private diagnostics have been withheld.\n' : ''}`);
    if (status) {
      assert.equal(result.stdout, '');
      await assert.rejects(readFile(files.env.RECOVERY_REPORT_FILE), { code: 'ENOENT' });
    } else {
      const report = JSON.parse(await readFile(files.env.RECOVERY_REPORT_FILE, 'utf8'));
      assert.deepEqual(JSON.parse(result.stdout), report);
      assert.equal(report.result, 'passed');
      assert.equal(report.productionChanged, false);
      assert.equal(report.restore.quickCheck, 'ok');
      assert.equal(report.restore.integrityCheck, 'ok');
      assert.equal(report.restore.requiredTables, 'present');
      assert.deepEqual(report.restore.rowCounts, { events: 0, orders: 0, tickets: 0 });
    }
  });
}

test('Legacy applicability workflow cannot export customer data or claim restore proof', () => {
  const steps = workflow.jobs.rehearse.steps;
  const uploads = steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].with.path, 'd1-recovery-rehearsal-report.json');
  assert.equal(workflow.jobs.rehearse.env, undefined);
  assert.deepEqual(steps.filter(step => step.run).map(step => step.run), ['node scripts/check-d1-recovery-runtime.mjs']);
});

const revision = 'a'.repeat(40);
const health = { service: 'becore-tickets', runtime: 'vps', active: true, revision };
const version = { service: 'becore-tickets', revision };
function identityFetcher(h = health, v = version, status = 200) {
  return async (url, options) => {
    assert.equal(new URL(url).origin, 'https://tickets.becoreops.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['Cache-Control'], 'no-cache');
    return { status, json: async () => url.endsWith('/healthz') ? h : v };
  };
}

test('Verified active VPS classifies legacy D1 without claiming a restore', async () => {
  const report = await checkD1RecoveryRuntime(identityFetcher());
  assert.equal(report.result, 'not-applicable');
  assert.equal(report.restoreTested, false);
  assert.equal(report.legacyTarget, 'becore-tickets-db');
  assert.equal(report.activeRecoveryWorkflow, 'tickets-backup.yml');
  assert.equal(report.revision, revision);
});

for (const [name, h, v, status] of [
  ['inactive VPS', { ...health, active: false }, version, 200],
  ['unknown runtime', { ...health, runtime: 'unknown' }, version, 200],
  ['active D1 requires a new explicit target/schema contract', { ...health, runtime: 'cloudflare' }, version, 200],
  ['unexpected service', { ...health, service: 'other' }, version, 200],
  ['unexpected application', health, { ...version, service: 'other' }, 200],
  ['revision mismatch', health, { ...version, revision: 'b'.repeat(40) }, 200],
  ['missing identity', {}, {}, 200],
  ['invalid revision', { ...health, revision: 'main' }, { ...version, revision: 'main' }, 200],
  ['unavailable endpoint', health, version, 503],
  ['null identity', null, null, 200],
]) {
  test(`Runtime check fails closed: ${name}`, async () => {
    await assert.rejects(checkD1RecoveryRuntime(identityFetcher(h, v, status)));
  });
}

test('Network failures do not count as inactive D1', async () => {
  await assert.rejects(checkD1RecoveryRuntime(async () => { throw new Error('offline'); }));
});

// Exercise the shell against real SQLite via Python's standard-library engine;
// no provider access or sqlite3 CLI installation is needed for these fixtures.
const sqliteShim = `exec python3 - "$@" <<'PYSQL'
import json, sqlite3, sys
args = sys.argv[1:]
json_mode = args[0] == '-json'
if json_mode: args = args[1:]
connection = sqlite3.connect(args[0])
try:
    sql = args[1]
    if sql.startswith('.read '):
        with open(sql[6:]) as source: connection.executescript(source.read())
    else:
        cursor = connection.execute(sql)
        rows = cursor.fetchall()
        if json_mode:
            print(json.dumps([dict(zip([c[0] for c in cursor.description], row)) for row in rows]))
        else:
            for row in rows: print('|'.join(map(str, row)))
finally:
    connection.close()
PYSQL`;
const tables = ['curated_event_records', 'orders', 'tickets', 'staff_accounts', 'consent_records',
  'delivery_events', 'product_metrics_daily', 'platform_announcement_subscriptions',
  'platform_announcement_choices', 'platform_announcement_unsubscribe_tokens', 'platform_announcement_verifications'];
for (const missing of [null, ...tables]) {
  test(`Real SQLite schema: ${missing ? `reject missing ${missing}` : 'complete required schema passes'}`, async t => {
    const files = await fixture(t, 'sqlite3', sqliteShim);
    await writeFile(files.env.D1_EXPORT_FILE, tables.filter(table => table !== missing)
      .map(table => `CREATE TABLE ${table} (id INTEGER);`).join('\n'));
    const result = spawnSync('bash', ['scripts/rehearse-d1-recovery.sh'], {
      cwd: root, encoding: 'utf8', env: files.env, timeout: 10_000,
    });
    assert.equal(result.status, missing ? 1 : 0, result.stderr);
    assert.deepEqual(await readdir(files.temporary), []);
    if (missing) {
      assert.match(result.stderr, new RegExp(`missing required table: ${missing}`));
      await assert.rejects(readFile(files.env.RECOVERY_REPORT_FILE), { code: 'ENOENT' });
    } else {
      const report = JSON.parse(await readFile(files.env.RECOVERY_REPORT_FILE, 'utf8'));
      assert.equal(report.restore.integrityCheck, 'ok');
      assert.equal(report.restore.requiredTables, 'present');
    }
  });
}

test('Integrity mismatch fails without proof and cleans temporary restore', async t => {
  const files = await fixture(t, 'sqlite3', `
case "$2" in
  .read*) touch "$1" ;;
  'PRAGMA quick_check;') printf 'ok\\n' ;;
  *) printf 'corrupt\\n' ;;
esac`);
  const result = spawnSync('bash', ['scripts/rehearse-d1-recovery.sh'], {
    cwd: root, encoding: 'utf8', env: files.env, timeout: 10_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not pass SQLite integrity checks/);
  assert.deepEqual(await readdir(files.temporary), []);
  await assert.rejects(readFile(files.env.RECOVERY_REPORT_FILE), { code: 'ENOENT' });
});

for (const mode of ['success', 'network-error', 'invalid-json']) {
  test(`Runtime CLI ${mode}: private diagnostics and stale report handling`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'tickets-runtime-check-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const preload = join(directory, 'fetch.mjs');
    await writeFile(preload, `globalThis.fetch = async url => {
      ${mode === 'network-error' ? `throw new Error(${JSON.stringify(sentinels[0])});` : `return {
        status: 200,
        json: async () => { ${mode === 'invalid-json' ? `throw new Error(${JSON.stringify(sentinels[1])});` : `return url.endsWith('/healthz') ? ${JSON.stringify(health)} : ${JSON.stringify(version)};`} }
      };`}
    };`);
    const reportPath = join(directory, 'd1-recovery-rehearsal-report.json');
    await writeFile(reportPath, '{"result":"stale"}');
    const result = spawnSync(process.execPath, ['--import', preload, join(root, 'scripts/check-d1-recovery-runtime.mjs')], {
      cwd: directory, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 10_000,
    });
    assert.equal(result.status, mode === 'success' ? 0 : 1);
    for (const sentinel of sentinels) assert.ok(!`${result.stdout}${result.stderr}`.includes(sentinel));
    if (mode === 'success') {
      assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).restoreTested, false);
      assert.match(result.stdout, /not recovery proof/);
    } else {
      await assert.rejects(readFile(reportPath), { code: 'ENOENT' });
    }
  });
}

const recoveryMaintenancePaths = [
  '.github/workflows/d1-recovery-rehearsal.yml',
  'scripts/check-d1-recovery-runtime.mjs',
  'tests/d1-recovery-privacy.test.mjs',
  'docs/runbooks/d1-recovery.md',
];
const releaseWorkflows = await Promise.all(['deploy', 'vps-runtime'].map(async name => [name,
  load(await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), 'utf8'))]));

// These existing filters use only literals, * and **; fail rather than silently
// approximating any future unsupported pattern syntax.
function matchesPath(path, pattern) {
  assert.ok(!/[?\[\]{}+]/.test(pattern), 'Extend the test matcher for new pattern syntax');
  const regex = pattern.split('**').map(part => part.split('*')
    .map(literal => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${regex}$`).test(path);
}
function triggersPush(workflow, paths) {
  const push = workflow.on.push;
  if (push['paths-ignore']) return paths.some(path => !push['paths-ignore'].some(pattern => matchesPath(path, pattern)));
  return paths.some(path => {
    let selected = false;
    for (const pattern of push.paths) {
      const excluded = pattern.startsWith('!');
      if (matchesPath(path, excluded ? pattern.slice(1) : pattern)) selected = !excluded;
    }
    return selected;
  });
}

for (const [name, current] of releaseWorkflows) {
  test(`${name}: only the four recovery paths are excluded; safety checks stay byte-equivalent`, () => {
    const previous = spawnSync('git', ['show', `63f2ead2fb3eaae03696f408b12e9e18cfcee265:.github/workflows/${name}.yml`], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(previous.status, 0);
    const expected = load(previous.stdout);
    if (name === 'deploy') expected.on.push['paths-ignore'].unshift(...recoveryMaintenancePaths);
    else expected.on.push.paths.push(...recoveryMaintenancePaths.map(path => `!${path}`));
    const reconstructed = structuredClone(current);
    for (const job of Object.values(reconstructed.jobs)) {
      if (job.steps?.some(step => step.id === 'recovery_maintenance')) {
        job.steps = job.steps.filter(step => step.id !== 'recovery_maintenance');
        for (const step of job.steps) {
          if (step.if === "steps.recovery_maintenance.outputs.matches != 'true'") delete step.if;
        }
        delete job.outputs;
      }
    }
    if (name === 'vps-runtime') delete reconstructed.jobs.handoff.if;
    assert.deepEqual(reconstructed, expected, 'No manual dispatch, jobs, permissions, admission or other trigger changes');
  });
  test(`${name}: recovery-only pushes do not release; mixed application and control changes still run`, () => {
    for (const path of recoveryMaintenancePaths) assert.equal(triggersPush(current, [path]), false, path);
    assert.equal(triggersPush(current, recoveryMaintenancePaths), false);
    for (const path of ['app/page.tsx', 'worker/index.ts', 'lib/new.ts', 'drizzle/9999_new.sql',
      'package.json', 'scripts/other.mjs', 'tests/other.test.mjs', '.github/workflows/vps-runtime.yml']) {
      assert.equal(triggersPush(current, [...recoveryMaintenancePaths, path]), true, path);
    }
    assert.equal(triggersPush(current, ['scripts/check-d1-recovery-runtime.mjs.extra']), true);
  });
}
