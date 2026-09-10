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
  cleanup: await query("SELECT outcome,created_at FROM operational_audit_events WHERE id='operator:preview-cleanup-2026-09-10'"),
  cleanupAlerts: await query("SELECT source,message,detail,created_at FROM system_alerts WHERE source='preview-cleanup' ORDER BY created_at DESC LIMIT 3"),
  currentRegistration: await query("SELECT event_slug,mode,capacity,approval_required,closes_at FROM event_registration_settings WHERE event_slug='the-weekend-braai'"),
  events: await query(`SELECT id,submission_id,slug,title,status,is_test_event,removed_at,
    (SELECT COUNT(*) FROM orders o WHERE o.event_slug=e.slug) AS orders,
    (SELECT COUNT(*) FROM orders o WHERE o.event_slug=e.slug AND payment_environment='live' AND payment_provider<>'rsvp' AND status IN ('paid','refund_pending','refunded','requires_refund','disputed')) AS live_paid_orders,
    (SELECT COUNT(*) FROM event_registrations r WHERE r.event_slug=e.slug) AS registrations
    FROM curated_event_records e ORDER BY slug`),
  payments: await query(`SELECT event_slug,payment_environment,payment_provider,status,paystack_status,provider_status,COUNT(*) AS count,MIN(created_at) AS first_created,MAX(created_at) AS last_created FROM orders GROUP BY event_slug,payment_environment,payment_provider,status,paystack_status,provider_status`),
  legacyOrderEvidence: await query(`SELECT id,reference,created_at,payment_environment,payment_provider,status,paystack_transaction_id,paystack_status,provider_reference,provider_status,total_amount_minor,payment_channel FROM orders WHERE event_slug='sun-chasers-labadi'`),
  submissions: await query(`SELECT id,event_slug,title,status FROM party_submissions ORDER BY created_at`),
  hosts: await query('SELECT id,slug,name FROM hosts'),
  tables: await query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"),
};
await writeFile('preview-data-inventory.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
