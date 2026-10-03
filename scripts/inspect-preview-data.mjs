// Read-only inventory safe for public CI logs/artifacts. Never serialize provider rows.
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const checks = Object.freeze({
  cleanupRecorded: "SELECT EXISTS(SELECT 1 FROM operational_audit_events WHERE id='operator:preview-cleanup-2026-09-10') AS value",
  cleanupSucceeded: "SELECT EXISTS(SELECT 1 FROM operational_audit_events WHERE id='operator:preview-cleanup-2026-09-10' AND outcome='success') AS value",
  cleanupAlertsPresent: "SELECT EXISTS(SELECT 1 FROM system_alerts WHERE source='preview-cleanup') AS value",
  currentRegistrationConfigured: "SELECT EXISTS(SELECT 1 FROM event_registration_settings WHERE event_slug='the-weekend-braai') AS value",
});
const counts = Object.freeze({
  events: 'SELECT COUNT(*) AS value FROM curated_event_records',
  testEvents: 'SELECT COUNT(*) AS value FROM curated_event_records WHERE is_test_event=1',
  removedEvents: 'SELECT COUNT(*) AS value FROM curated_event_records WHERE removed_at IS NOT NULL',
  submissions: 'SELECT COUNT(*) AS value FROM party_submissions',
  hosts: 'SELECT COUNT(*) AS value FROM hosts',
  tables: "SELECT COUNT(*) AS value FROM sqlite_master WHERE type='table'",
});
const reportPath = 'preview-data-inventory.json';

export async function runInventory({
  env = process.env,
  fetchImpl = globalThis.fetch,
  writeReport = writeFile,
  log = console.log,
  error = console.error,
} = {}) {
  try {
    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) throw new Error();
    const headers = { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' };
    const root = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/d1/database`;
    const response = await fetchImpl(`${root}?name=becore-tickets-db`, { headers });
    const listing = await response.json();
    if (!response.ok || listing.success !== true || !Array.isArray(listing.result)) throw new Error();
    const database = listing.result.find(row => row?.name === 'becore-tickets-db');
    if (typeof database?.uuid !== 'string' || !database.uuid) throw new Error();
    async function scalar(sql, boolean = false) {
      const response = await fetchImpl(`${root}/${encodeURIComponent(database.uuid)}/query`, {
        method: 'POST', headers, body: JSON.stringify({ sql }),
      });
      const payload = await response.json();
      const result = payload?.result?.[0];
      if (!response.ok || payload.success !== true || payload.result.length !== 1 ||
          result?.success !== true || !Array.isArray(result.results) || result.results.length !== 1) throw new Error();
      const value = result.results[0]?.value;
      if (!Number.isSafeInteger(value) || value < 0 || (boolean && value > 1)) throw new Error();
      return boolean ? value === 1 : value;
    }
    // Build only fixed keys and validated scalars; ignore all other response fields.
    const health = { inventoryReadSucceeded: true };
    const inventory = {};
    for (const [name, sql] of Object.entries(checks)) health[name] = await scalar(sql, true);
    for (const [name, sql] of Object.entries(counts)) inventory[name] = await scalar(sql);
    const report = JSON.stringify({ health, counts: inventory });
    await writeReport(reportPath, report + '\n');
    log(report);
    return true;
  } catch {
    // Provider/network/filesystem exceptions can contain private rows, URLs, or credentials.
    // Replace any stale artifact with a fixed failure status. Never log the exception.
    const report = JSON.stringify({ health: { inventoryReadSucceeded: false } });
    try { await writeReport(reportPath, report + '\n'); } catch { /* Fixed stderr below only. */ }
    error('Preview inventory failed; private diagnostics were not exported.');
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!await runInventory()) process.exitCode = 1;
}
