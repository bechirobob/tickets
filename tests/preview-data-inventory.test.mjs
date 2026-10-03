import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runInventory } from '../scripts/inspect-preview-data.mjs';

const privateValue = 'SYNTHETIC_PRIVATE_SENTINEL';
const privateFields = { detail: privateValue, reference: privateValue, name: privateValue, title: privateValue, id: privateValue, total_amount_minor: 123456789 };
function harness({ failAt = -1, failure, value } = {}) {
  const output = [], errors = [], files = [], queries = [];
  let calls = 0;
  return {
    output, errors, files, queries,
    options: {
      env: { CLOUDFLARE_ACCOUNT_ID: 'synthetic-account', CLOUDFLARE_API_TOKEN: privateValue, GITHUB_SHA: privateValue },
      async fetchImpl(_url, options) {
        const call = calls++;
        if (call === failAt) return failure();
        if (!options.body) return { ok: true, json: async () => ({ success: true, result: [{ name: 'becore-tickets-db', uuid: privateValue, extra: privateFields }] }) };
        const sql = JSON.parse(options.body).sql;
        queries.push(sql);
        return { ok: true, json: async () => ({ success: true, result: [{ success: true, results: [{ value: typeof value === 'function' ? value(sql) : value === undefined ? (sql.includes('EXISTS') ? 1 : 3) : value, ...privateFields }], meta: privateFields }], errors: [privateFields] }) };
      },
      writeReport: async (path, data) => files.push({ path, data }),
      log: value => output.push(value),
      error: value => errors.push(value),
    },
  };
}
function assertPrivateAbsent(h) {
  const serialized = JSON.stringify([h.output, h.errors, h.files]);
  assert.ok(!serialized.includes(privateValue));
  assert.ok(!serialized.includes('123456789'));
  assert.doesNotMatch(serialized, /total_amount_minor|provider_reference|payment_channel/);
}

test('public stdout and JSON contain only allowlisted health booleans and operational counts', async () => {
  const h = harness();
  assert.equal(await runInventory(h.options), true);
  assert.deepEqual(JSON.parse(h.output[0]), {
    health: { inventoryReadSucceeded: true, cleanupRecorded: true, cleanupSucceeded: true, cleanupAlertsPresent: true, currentRegistrationConfigured: true },
    counts: { events: 3, testEvents: 3, removedEvents: 3, submissions: 3, hosts: 3, tables: 3 },
  });
  assert.equal(h.files[0].path, 'preview-data-inventory.json');
  assert.equal(h.files[0].data.trim(), h.output[0]);
  assert.equal(h.errors.length, 0);
  assertPrivateAbsent(h);
  assert.equal(h.queries.length, 10);
  for (const sql of h.queries) {
    assert.match(sql, /^SELECT (EXISTS\(|COUNT\(\*\))/);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|PRAGMA|SUM|orders|payments|amount|revenue|reference|detail|title)\b/i);
  }
});

test('zero health checks become booleans rather than source values', async () => {
  const h = harness({ value: 0 });
  assert.equal(await runInventory(h.options), true);
  assert.equal(JSON.parse(h.output[0]).health.cleanupSucceeded, false);
});

for (const [label, failure] of [
  ['transport rejection', () => { throw new Error(privateValue); }],
  ['JSON parsing', () => ({ ok: true, json: async () => { throw new Error(privateValue); } })],
  ['HTTP error', () => ({ ok: false, json: async () => ({ success: false, errors: [privateFields] }) })],
  ['provider error', () => ({ ok: true, json: async () => ({ success: false, errors: [privateFields] }) })],
  ['query error', () => ({ ok: true, json: async () => ({ success: true, result: [{ success: false, results: [{ value: 0 }], errors: [privateFields] }] }) })],
  ['unexpected row', () => ({ ok: true, json: async () => ({ success: true, result: [{ success: true, results: [{ value: 0 }, privateFields] }] }) })],
]) {
  test(`${label} never exports payload or partial inventory`, async () => {
    const h = harness({ failAt: 3, failure });
    assert.equal(await runInventory(h.options), false);
    assert.deepEqual(h.output, []);
    assert.deepEqual(JSON.parse(h.files.at(-1).data), { health: { inventoryReadSucceeded: false } });
    assertPrivateAbsent(h);
  });
}
for (const value of [privateValue, { detail: privateValue }, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, 2]) {
  test(`invalid scalar ${typeof value} fails closed`, async () => {
    const h = harness({ value });
    assert.equal(await runInventory(h.options), false);
    assertPrivateAbsent(h);
  });
}
test('filesystem failure never leaks exception or emits success', async () => {
  const h = harness();
  h.options.writeReport = async () => { throw new Error(privateValue); };
  assert.equal(await runInventory(h.options), false);
  assert.deepEqual(h.output, []);
  assertPrivateAbsent(h);
});

test('CLI failure exits nonzero and replaces stale report without exposing error', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'inventory-privacy-'));
  try {
    await writeFile(join(cwd, 'preview-data-inventory.json'), privateValue);
    await writeFile(join(cwd, 'mock.mjs'), `globalThis.fetch = async () => { throw new Error(${JSON.stringify(privateValue)}); };`);
    const result = spawnSync(process.execPath, ['--import', join(cwd, 'mock.mjs'), new URL('../scripts/inspect-preview-data.mjs', import.meta.url).pathname], {
      cwd, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: 'synthetic', CLOUDFLARE_API_TOKEN: privateValue },
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes(privateValue));
    assert.deepEqual(JSON.parse(await readFile(join(cwd, 'preview-data-inventory.json'), 'utf8')), { health: { inventoryReadSucceeded: false } });
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

for (const value of [privateValue, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid operational count ${typeof value} fails closed`, async () => {
    const h = harness({ value: sql => sql.includes('EXISTS') ? 1 : value });
    assert.equal(await runInventory(h.options), false);
    assertPrivateAbsent(h);
  });
}
test('database discovery failure does not leak provider details', async () => {
  const h = harness({ failAt: 0, failure: () => ({ ok: false, json: async () => ({ success: false, errors: [privateFields] }) }) });
  assert.equal(await runInventory(h.options), false);
  assertPrivateAbsent(h);
});
