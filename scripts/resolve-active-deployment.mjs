// A normal Worker release must never reclaim a VPS-owned public hostname or
// rebind an old database after a verified reverse transfer.
import { readFile, writeFile } from 'node:fs/promises';
import { cloudflare, account } from '../ops/handover/control-client.mjs';
import { query } from '../ops/handover/database-transfer.mjs';
const root = '/accounts/' + account;
const settings = await cloudflare(root + '/workers/scripts/becore-tickets/settings');
const database = settings.bindings.find(b => b.name === 'DB' && b.type === 'd1')?.id;
if (!database) throw new Error('The active source database is unavailable.');
const domains = await cloudflare(root + '/workers/domains');
if (!domains.some(d => d.hostname === 'tickets.becoreops.com' && d.service === 'becore-tickets')) throw new Error('Tickets routing is managed by the dual-host release path; ordinary Cloudflare deployment is blocked.');
const present = await query(database, "SELECT name FROM sqlite_master WHERE name='_bct_handover_admission'");
if (present.length) {
  const rows = await query(database, 'SELECT phase FROM _bct_handover_admission WHERE id=1');
  if (rows[0]?.phase !== 'active') throw new Error('The source writer is paused or transferred; ordinary deployment is blocked.');
}
const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
config.d1_databases[0].database_id = database;
await writeFile('wrangler.jsonc', JSON.stringify(config, null, 2) + '\n');
console.log('Active Cloudflare writer and current database binding verified.');
