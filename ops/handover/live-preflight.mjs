import { cloudflare, account } from './control-client.mjs';
const root = '/accounts/' + account;
const settings = await cloudflare(root + '/workers/scripts/becore-tickets/settings');
const database = settings.bindings.find(binding => binding.type === 'd1' && binding.name === 'DB')?.id;
if (database !== '8f8723c2-673a-4aba-b025-83c05d67d075') throw new Error('Unexpected source database.');
const tables = (await cloudflare(root + '/d1/database/' + database + '/query', 'POST', { sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name" }))[0].results.map(row => row.name);
const counts = {};
for (const name of ['orders','payments','payment_attempts','event_registrations','email_deliveries','room_announcement_deliveries','event_announcement_deliveries','refund_batches','payout_transfers']) {
  if (!tables.includes(name)) continue;
  const columns = (await cloudflare(root + '/d1/database/' + database + '/query', 'POST', { sql: `PRAGMA table_info("${name}")` }))[0].results.map(row => row.name);
  const sql = columns.includes('status') ? `SELECT status,COUNT(*) AS count FROM "${name}" GROUP BY status` : `SELECT COUNT(*) AS count FROM "${name}"`;
  counts[name] = (await cloudflare(root + '/d1/database/' + database + '/query', 'POST', { sql }))[0].results;
}
const queues = await cloudflare(root + '/queues');
const queue = queues.find(row => row.queue_name === 'becore-tickets-email-delivery');
if (!queue) throw new Error('Expected source queue is missing.');
const consumers = await cloudflare(root + '/queues/' + queue.queue_id + '/consumers');
const domains = (await cloudflare(root + '/workers/domains')).filter(row => row.hostname === 'tickets.becoreops.com');
const dns = await cloudflare('/zones/bbf0174f839a0d22dbf6d9f4bd3cf53d/dns_records?name=tickets.becoreops.com');
console.log(JSON.stringify({ readOnly: true, database, counts, queue: { id: queue.queue_id, name: queue.queue_name, settings: queue.settings, consumers }, domains, dns: dns.map(row => ({ id: row.id, type: row.type, name: row.name, content: row.content, proxied: row.proxied, ttl: row.ttl })) }, null, 2));
