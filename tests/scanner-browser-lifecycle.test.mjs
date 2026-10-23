import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./e2e/operations.spec.ts', import.meta.url), 'utf8');
const start = source.indexOf('for (const newerScanner of [false, true])');
const end = source.indexOf("\ntest('scanner preserves mixed offline conflicts", start);
const scenario = source.slice(start, end);
const cleanup = scenario.match(/\} finally \{([\s\S]*?)\n  \}/u)?.[1];
assert.ok(cleanup, 'Cross-tab scanner fixture must drain routes even after failed assertions');
const run = new Function('context', 'otherTab', 'body', `return (async () => { try { await body(); } finally { ${cleanup} } })();`);

for (const fails of [false, true]) test(`scanner fixture drains pending handlers before closing its tab after ${fails ? 'failure' : 'success'}`, async () => {
  const events = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const failure = new Error('Original scanner assertion');
  const result = run({ unrouteAll: async options => {
    assert.deepEqual(options, { behavior: 'wait' });
    events.push('draining');
    await pending;
    events.push('drained');
  } }, { close: async () => { events.push('closed'); } }, async () => {
    if (fails) throw failure;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['draining']);
  release();
  if (fails) await assert.rejects(result, error => error === failure);
  else await result;
  assert.deepEqual(events, ['draining', 'drained', 'closed']);
});

test('scanner fixture also drains when its second tab was never created', async () => {
  let drained = false;
  await run({ unrouteAll: async () => { drained = true; } }, undefined, async () => {});
  assert.equal(drained, true);
});

test('scanner fixture does not suppress a route-handler failure', async () => {
  const failure = new Error('Real handler assertion');
  await assert.rejects(run({ unrouteAll: async () => { throw failure; } }, undefined, async () => {}), error => error === failure);
});
