// Owner-authorized removal of this exact listing. The deployed worker owns cleanup.
import { pathToFileURL } from 'node:url';
export const slug = 'the-weekend-braai';
export const requestId = 'operator:remove-weekend-braai-2026-09-19';
export const paidGuard = `NOT EXISTS (SELECT 1 FROM orders WHERE event_slug = curated_event_records.slug AND payment_provider <> 'rsvp' AND total_amount_minor > refunded_amount_minor AND status IN ('paid','refund_pending','requires_refund','disputed','payment_pending'))`;
export function removalBatch(now) {
  return [
    { sql: `UPDATE curated_event_records SET removed_at=COALESCE(removed_at,?),status='unpublished',scheduled_publish_at=NULL,updated_at=? WHERE slug=? AND ${paidGuard}`, params: [now, now, slug] },
    { sql: `INSERT OR IGNORE INTO event_removal_cleanup(event_slug,created_at) SELECT slug,? FROM curated_event_records WHERE slug=? AND removed_at IS NOT NULL`, params: [now, slug] },
    { sql: `INSERT OR IGNORE INTO operational_audit_events(id,actor_role,action,target_type,target_id,outcome,detail,created_at) SELECT ?,'owner','event.removed','event',slug,'success','Owner explicitly requested complete removal from the site; existing worker cleanup queued. Financial records retained.',? FROM curated_event_records WHERE slug=? AND removed_at IS NOT NULL`, params: [requestId, now, slug] },
  ];
}
async function main() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error('The existing Cloudflare operator connection is required.');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const root = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`;
  const response = await fetch(`${root}?name=becore-tickets-db`, { headers });
  const listing = await response.json();
  const matches = listing.result?.filter(row => row.name === 'becore-tickets-db');
  if (!response.ok || !listing.success || matches?.length !== 1) throw new Error('Production database could not be resolved.');
  const db = matches[0].uuid;
  async function query(body) {
    const response = await fetch(`${root}/${db}/query`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok || !data.success || !data.result?.length || data.result.some(row => !row.success)) throw new Error('Event removal database operation failed.');
    return data.result;
  }
  async function rows(sql, params = []) { return (await query({ sql, params }))[0].results; }
  const [event] = await rows(`SELECT slug,title,status,removed_at FROM curated_event_records WHERE slug=?`, [slug]);
  if (!event || event.title !== 'The Weekend Braai') throw new Error('Exact listing identity did not match.');
  const [impact] = await rows(`SELECT COUNT(*) AS paidBookings FROM orders WHERE event_slug=? AND payment_provider<>'rsvp' AND total_amount_minor>refunded_amount_minor AND status IN ('paid','refund_pending','requires_refund','disputed','payment_pending')`, [slug]);
  const otherListings = await rows(`SELECT slug,status,removed_at FROM curated_event_records WHERE slug<>? ORDER BY slug`, [slug]);
  const registrations = await rows(`SELECT status,COUNT(*) AS count FROM event_registrations WHERE event_slug=? GROUP BY status`, [slug]);
  console.log(JSON.stringify({ before: event, impact, registrations }));
  if (impact.paidBookings) throw new Error('Paid or pending paid bookings require the existing cancellation approval flow. Nothing was removed.');
  await query({ batch: removalBatch(new Date().toISOString()) });
  const [removed] = await rows(`SELECT slug,status,removed_at FROM curated_event_records WHERE slug=?`, [slug]);
  if (!removed?.removed_at || removed.status !== 'unpublished') throw new Error('Removal guard prevented mutation.');
  console.log(JSON.stringify({ removed, cleanup: 'queued' }));
  for (let attempt = 0; attempt < 24; attempt++) {
    const pending = await rows('SELECT event_slug FROM event_removal_cleanup WHERE event_slug=?', [slug]);
    if (!pending.length) {
      const remaining = await rows(`SELECT 'registrations' AS kind,COUNT(*) AS count FROM event_registrations WHERE event_slug=? AND status NOT IN ('cancelled','declined') UNION ALL SELECT 'issuedTickets',COUNT(*) FROM tickets WHERE event_slug=? AND status='issued' UNION ALL SELECT 'visibleTiers',COUNT(*) FROM event_ticket_tiers WHERE event_slug=? AND status<>'hidden' UNION ALL SELECT 'roomSettings',COUNT(*) FROM room_settings WHERE event_slug=? UNION ALL SELECT 'roomFlashes',COUNT(*) FROM room_flashes WHERE event_slug=? AND status<>'deleted'`, [slug,slug,slug,slug,slug]);
      if (remaining.some(row => row.count)) throw new Error('Some event content remains active.');
      const afterOtherListings = await rows(`SELECT slug,status,removed_at FROM curated_event_records WHERE slug<>? ORDER BY slug`, [slug]);
      if (JSON.stringify(otherListings) !== JSON.stringify(afterOtherListings)) throw new Error('Another listing changed during removal. Inspect before concluding.');
      console.log(JSON.stringify({ removal: 'complete', slug, remaining, otherListingsUnchanged: true }));
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 20000));
  }
  throw new Error('Listing removed; worker cleanup is still pending. Inspect before retrying.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
