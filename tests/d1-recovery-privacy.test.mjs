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
const exportStep = workflow.jobs.rehearse.steps.find(step => step.name === 'Export production for isolated restore');
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
  test(`D1 export with status ${status} keeps both output streams private and removes diagnostics`, async t => {
    const files = await fixture(t, 'npx', `
[[ "$*" == "wrangler d1 export DB --remote --output $D1_EXPORT_FILE --skip-confirmation" ]]
${privateOutput}`);
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-x', '-c', exportStep.run], {
      cwd: root,
      encoding: 'utf8',
      env: { ...files.env, TEST_EXIT_STATUS: String(status) },
      timeout: 10_000,
    });
    await assertPrivate(result, files, status);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `+ set +x\n${status ? 'D1 export failed; private diagnostics have been withheld.\n' : ''}`);
  });

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

test('D1 rehearsal uploads only existing non-sensitive proof and always removes the export', () => {
  const steps = workflow.jobs.rehearse.steps;
  const uploads = steps.filter(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(uploads.length, 1);
  assert.deepEqual(uploads[0].with.path.trim().split('\n'), ['d1-recovery-bookmark.json', 'd1-recovery-rehearsal-report.json']);
  const cleanup = steps.find(step => step.name === 'Remove customer-data export');
  assert.equal(cleanup.if, 'always()');
  assert.equal(cleanup.run, 'rm -f -- /tmp/becore-tickets-recovery-export.sql');
});
