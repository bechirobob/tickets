// Owner-authorized reset, 22 September 2026. One atomic, idempotent baseline
// insert clears counters through a trigger; no booking or payment is deleted.
import { readFile, writeFile } from 'node:fs/promises';
const resetKey = 'owner-event-analytics-2026-09-22';
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' };
const root = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;
const listing = await (await fetch(`${root}?name=becore-tickets-db`, { headers })).json();
const database = listing.result?.find(row => row.name === 'becore-tickets-db');
if (!database?.uuid) throw new Error('Production database not found.');
async function query(sql, params = []) {
  const response = await fetch(`${root}/${database.uuid}/query`, { method:'POST', headers, body:JSON.stringify({sql,params}) });
  const payload = await response.json();
  if (!response.ok || !payload.success) throw new Error('Analytics reset query failed.');
  return payload.result[0].results;
}
const counts = () => query(`SELECT
  (SELECT COUNT(*) FROM orders) AS orders,
  (SELECT COUNT(*) FROM tickets) AS tickets,
  (SELECT COUNT(*) FROM event_registrations) AS registrations,
  (SELECT COUNT(*) FROM ticket_assignments) AS assignments,
  (SELECT COUNT(*) FROM product_metrics_daily) AS metricRows,
  (SELECT COALESCE(SUM(count),0) FROM product_metrics_daily) AS trackedActivity`);
let [baseline] = await query('SELECT reset_key AS resetKey,started_at AS startedAt FROM analytics_baseline WHERE id=1');
const [before] = await counts();
let applied = false;
if (!baseline) {
  const bookmark = JSON.parse(await readFile('d1-pre-migration-bookmark.json','utf8'));
  if (!bookmark.bookmark) throw new Error('A verified D1 recovery bookmark is required before resetting analytics.');
  const response = await fetch('https://tickets.becoreops.com/api/version', {signal:AbortSignal.timeout(30000)});
  if (!response.ok || (await response.json()).revision !== process.env.GITHUB_SHA) throw new Error('Deploy this revision before resetting analytics.');
  await query("INSERT OR IGNORE INTO analytics_baseline(id,reset_key,started_at) VALUES(1,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))", [resetKey]);
  [baseline] = await query('SELECT reset_key AS resetKey,started_at AS startedAt FROM analytics_baseline WHERE id=1');
  applied = true;
}
if (baseline?.resetKey !== resetKey) throw new Error('Another analytics baseline exists; no data was changed.');
const [after] = await counts();
for (const key of ['orders','tickets','registrations','assignments']) {
  if (after[key] < before[key]) throw new Error(`Booking invariant changed during analytics reset: ${key}`);
}
const [oldCounters] = await query('SELECT COUNT(*) AS count FROM product_metrics_daily WHERE updated_at<?',[baseline.startedAt]);
if (oldCounters.count) throw new Error('Pre-reset counters remain.');
await query(`INSERT OR IGNORE INTO operational_audit_events(id,actor_role,action,target_type,target_id,outcome,detail,created_at)
  VALUES(?,'owner','analytics.reset','analytics','all-events','success',?,?)`,[resetKey,JSON.stringify({baseline,before,after}),baseline.startedAt]);
const report = {revision:process.env.GITHUB_SHA,applied,baseline,before,after,oldCounters:oldCounters.count,bookingsPreserved:true};
await writeFile('event-analytics-reset.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
