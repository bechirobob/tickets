// Read-only production inventory. Logs contain counts and listing identifiers only.
import { writeFile } from 'node:fs/promises';
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const headers = { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' };
const root = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;
const listing = await (await fetch(`${root}?name=becore-tickets-db`, { headers })).json();
const database = listing.result?.find(row => row.name === 'becore-tickets-db');
if (!database?.uuid) throw new Error('Production database not found.');
async function query(sql) {
  const response = await fetch(`${root}/${database.uuid}/query`, { method: 'POST', headers, body: JSON.stringify({ sql }) });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error('Inventory query failed.');
  return result.result[0].results;
}
const report = {
  revision: process.env.GITHUB_SHA,
  events: await query(`SELECT id,submission_id,slug,title,status,is_test_event,removed_at,
    (SELECT COUNT(*) FROM orders o WHERE o.event_slug=e.slug) AS orders,
    (SELECT COUNT(*) FROM orders o WHERE o.event_slug=e.slug AND payment_environment='live' AND payment_provider<>'rsvp' AND status IN ('paid','refund_pending','refunded','requires_refund','disputed')) AS live_paid_orders,
    (SELECT COUNT(*) FROM event_registrations r WHERE r.event_slug=e.slug) AS registrations
    FROM curated_event_records e ORDER BY slug`),
  submissions: await query(`SELECT id,event_slug,title,status FROM party_submissions ORDER BY created_at`),
  hosts: await query('SELECT id,slug,name FROM hosts'),
  tables: await query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"),
};
await writeFile('preview-data-inventory.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
