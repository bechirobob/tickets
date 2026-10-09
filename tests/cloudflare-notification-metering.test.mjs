import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('isolated D1 measures the index-inclusive acknowledgement saving, without live usage', async () => {
  const migration = await readFile(new URL('../drizzle/0013_little_sandman.sql', import.meta.url), 'utf8');
  const source = await readFile(new URL('../app/api/customer/notifications/route.ts', import.meta.url), 'utf8');
  const guardedSql = source.match(/env\.DB\.prepare\("(UPDATE attendee_notifications[^"\n]+WHERE attendee_id = \?[^"\n]*)"\)/)?.[1];
  assert.ok(guardedSql?.endsWith('AND read_at IS NULL'));
  const baselineSql = guardedSql.replace(' AND read_at IS NULL', '');
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: 'export default { fetch() { return new Response("isolated"); } }',
    compatibilityDate: '2026-08-11', d1Databases: { DB: 'notification-budget-local' },
  }));
  try {
    const db = await runtime.getD1Database('DB');
    // Use the real notification table and its two explicit indexes; the TEXT
    // primary key adds the third index. No counting trigger affects this meter.
    for (const statement of migration.split('--> statement-breakpoint').slice(0, 3)) await db.prepare(statement).run();
    const rows = JSON.stringify(Array.from({ length: 1000 }, (_, id) => ({ id: String(id), readAt: id < 980 ? '2026-01-01' : null })));
    await db.prepare(`INSERT INTO attendee_notifications(id,attendee_id,kind,title,body,url,source_id,created_at,read_at)
      SELECT json_extract(value,'$.id'),'guest','room_message','Synthetic','Test','/room/test',json_extract(value,'$.id'),'2026-01-01',json_extract(value,'$.readAt') FROM json_each(?)`).bind(rows).run();
    const baseline = await db.prepare(baselineSql).bind('2026-10-08', 'guest').run();
    const before = await db.prepare('SELECT id,read_at FROM attendee_notifications ORDER BY id').all();
    await db.prepare('UPDATE attendee_notifications SET read_at=NULL WHERE CAST(id AS INTEGER)>=980').run();
    const guarded = await db.prepare(guardedSql).bind('2026-10-08', 'guest').run();
    const after = await db.prepare('SELECT id,read_at FROM attendee_notifications ORDER BY id').all();
    const replay = await db.prepare(guardedSql).bind('2026-10-09', 'guest').run();
    assert.deepEqual(after.results, before.results);
    assert.equal(baseline.meta.changes, 1000);
    assert.equal(guarded.meta.changes, 20);
    assert.equal(baseline.meta.rows_written, 2000);
    assert.equal(guarded.meta.rows_written, 40);
    assert.equal(replay.meta.rows_written, 0);
    assert.ok(guarded.meta.rows_read < baseline.meta.rows_read);
    console.log(JSON.stringify({ measurement: 'isolated D1, not live billing',
      baseline: { rowsRead: baseline.meta.rows_read, rowsWritten: baseline.meta.rows_written },
      guarded: { rowsRead: guarded.meta.rows_read, rowsWritten: guarded.meta.rows_written },
      replay: { rowsRead: replay.meta.rows_read, rowsWritten: replay.meta.rows_written } }));
  } finally { await runtime.dispose(); }
});
