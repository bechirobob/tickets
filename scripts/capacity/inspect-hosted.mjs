// Read-only account and aggregate application evidence. Never sends email,
// changes a plan, or loads production with synthetic guests.
import { mkdir, writeFile } from 'node:fs/promises';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('Existing Cloudflare operator connection required.');
const root = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
async function read(path, body) {
  const response = await fetch(path.startsWith('https:') ? path : `${root}${path}`, {
    headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok || data.success === false || data.errors?.length) {
    // Error messages can echo query text; retain only machine codes.
    return { available: false, status: response.status, codes: data.errors?.map(e => e.code ?? 'graphql-error') };
  }
  return { available: true, result: data.result ?? data.data };
}
const report = { sourceRevision: process.env.GITHUB_SHA, checkedAt: new Date().toISOString(), readOnly: true };
const settings = await read('/workers/account-settings');
report.accountSettings = settings.available ? { available: true, defaultUsageModel: settings.result.default_usage_model } : settings;
const subscriptions = await read('/subscriptions');
report.subscriptions = subscriptions.available ? { available: true, plans: subscriptions.result.map(s => ({ name: s.rate_plan?.public_name, id: s.rate_plan?.id, scope: s.rate_plan?.scope, state: s.state })) } : subscriptions;
const worker = await read('/workers/scripts/becore-tickets/settings');
report.worker = worker.available ? {
  available: true, usageModel: worker.result.usage_model, limits: worker.result.limits,
  providerSecretNames: worker.result.bindings?.filter(b => b.type === 'secret_text' && /^(RESEND|SEEV|PAYSTACK)_/.test(b.name)).map(b => b.name),
} : worker;
const listed = await read('/d1/database?name=becore-tickets-db');
const databases = listed.result?.filter(d => d.name === 'becore-tickets-db');
if (!listed.available || databases?.length !== 1) throw new Error('Production database could not be uniquely resolved.');
async function query(sql) {
  if (!sql.startsWith('SELECT ') || sql.includes(';')) throw new Error('Only one read-only SELECT is allowed.');
  const value = await read(`/d1/database/${databases[0].uuid}/query`, { sql });
  if (!value.available || !value.result?.[0]?.success) return { available: false, status: value.status };
  return { available: true, rows: value.result[0].results, rowsRead: value.result[0].meta?.rows_read, rowsWritten: value.result[0].meta?.rows_written };
}
report.events = await query("SELECT e.slug,e.status,e.event_state,e.schedule_status,r.mode,r.capacity,r.approval_required,r.room_access,r.closes_at FROM curated_event_records e LEFT JOIN event_registration_settings r ON r.event_slug=e.slug WHERE e.removed_at IS NULL AND e.is_test_event=0 ORDER BY e.slug LIMIT 20");
report.deliveries = await query("SELECT kind,status,COUNT(*) AS count FROM delivery_events WHERE created_at>=datetime('now','-7 days') GROUP BY kind,status");
report.marketing = await query("SELECT status,contact_count,reserved_count,checked_at FROM marketing_state WHERE id='resend'");
report.notificationIndexes = await query("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='attendee_notifications'");
const date = new Date().toISOString().slice(0,10);
const analytics = await read('https://api.cloudflare.com/client/v4/graphql', {
  query: `query($account: string!, $date: Date!) { viewer { accounts(filter: {accountTag: $account}) { d1AnalyticsAdaptiveGroups(limit: 100, filter: {date_geq: $date, date_leq: $date}) { sum { rowsRead rowsWritten readQueries writeQueries } } } } }`,
  variables: { account, date },
});
report.accountD1Today = analytics.available ? { available: true, date, aggregates: analytics.result?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups } : analytics;
report.resendPlan = { verified: false, reason: 'Worker secret presence and delivery counts do not establish the Resend billing plan or remaining quota.' };
const version = await fetch('https://tickets.becoreops.com/api/version', { signal: AbortSignal.timeout(30000) });
report.production = version.ok ? await version.json() : { status: version.status };
await mkdir('capacity-results', { recursive: true });
await writeFile('capacity-results/hosted-readiness.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
