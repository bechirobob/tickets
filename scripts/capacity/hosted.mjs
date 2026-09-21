// Bounded hosted read/socket rehearsal. Fresh synthetic resources only; no
// payment/email credentials, public customer routes, cron jobs or production DB.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import WebSocket from 'ws';

const statePath = 'work/hosted-capacity/private.json';
const output = 'capacity-results/hosted-measurements.json';
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const root = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const run = process.env.GITHUB_RUN_ID;
const attempt = process.env.GITHUB_RUN_ATTEMPT;
if (!/^\d+$/.test(run ?? '') || !/^\d+$/.test(attempt ?? '')) throw new Error('GitHub run identity required.');
const name = `bct-capacity-${run}-${attempt}`;
const mode = process.argv[2];
async function api(path, method = 'GET', body) {
  if (!account || !process.env.CLOUDFLARE_API_TOKEN) throw new Error('Cloudflare operator access required.');
  const response = await fetch(`${root}${path}`, {
    method, headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(`Cloudflare ${method} ${path.split('?')[0]} failed (${response.status}; codes ${data.errors?.map(e => e.code).join(',')}).`);
  return data.result;
}
function save(state) {
  mkdirSync('work/hosted-capacity', { recursive: true });
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
}
function readState() {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  if (state.name !== name || !name.startsWith('bct-capacity-')) throw new Error('Resource ownership mismatch.');
  return state;
}
function wrangler(args) {
  return execFileSync('node', ['node_modules/wrangler/bin/wrangler.js', ...args, '--config', 'dist/server/wrangler.hosted.json'], { encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] });
}
const sqlString = value => `'${String(value).replaceAll("'", "''")}'`;

if (mode === 'setup') {
  if (existsSync(statePath)) throw new Error('Existing rehearsal state must be cleaned up before provisioning.');
  // Preserve room for production. Account-wide limits apply to staging too.
  const readiness = JSON.parse(readFileSync('capacity-results/hosted-readiness.json', 'utf8'));
  const aggregates = readiness.accountD1Today?.aggregates;
  if (!readiness.accountD1Today?.available || !Array.isArray(aggregates)) throw new Error('Account-wide D1 usage must be available before hosted testing.');
  if (readiness.accountD1Today.date !== new Date().toISOString().slice(0,10) || !Number.isFinite(Date.parse(readiness.checkedAt)) || Math.abs(Date.now() - Date.parse(readiness.checkedAt)) > 10 * 60000) throw new Error('Fresh usage evidence from this UTC day is required.');
  if (aggregates.some(row => !Number.isFinite(row.sum?.rowsRead) || !Number.isFinite(row.sum?.rowsWritten) || row.sum.rowsRead < 0 || row.sum.rowsWritten < 0)) throw new Error('Invalid account usage metering.');
  const usage = aggregates.reduce((total, row) => ({ reads: total.reads + row.sum.rowsRead, writes: total.writes + row.sum.rowsWritten }), { reads: 0, writes: 0 });
  if (usage.reads > 1000000 || usage.writes > 20000) throw new Error('Insufficient conservative free-tier headroom for this hosted rehearsal.');
  const subdomain = await api('/workers/subdomain');
  if (!/^[a-z0-9-]+$/.test(subdomain.subdomain)) throw new Error('Invalid Workers subdomain.');
  const state = { name, base: `https://${name}.${subdomain.subdomain}.workers.dev`, slug: name, key: randomBytes(32).toString('hex'), tokens: [], revision: process.env.GITHUB_SHA };
  console.log(`::add-mask::${state.key}`);
  save(state);
  const database = await api('/d1/database', 'POST', { name });
  state.databaseId = database.uuid;
  save(state);
  const built = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
  if (built.main !== 'index.js') throw new Error('Unexpected compiled entry point.');
  const config = {
    name, main: 'capacity-entry.mjs', compatibility_date: built.compatibility_date,
    compatibility_flags: built.compatibility_flags, no_bundle: true, rules: built.rules,
    workers_dev: true, preview_urls: false, routes: [],
    vars: { ENVIRONMENT: 'test', RELEASE_SHA: state.revision, CAPACITY_KEY: state.key, CAPACITY_EXPIRES: String(Date.now() + 20 * 60000) },
    d1_databases: [{ binding: 'DB', database_name: name, database_id: database.uuid, migrations_dir: '../../drizzle' }],
    durable_objects: { bindings: [{ name: 'THE_ROOM', class_name: 'TheRoom' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['TheRoom'] }],
    version_metadata: { binding: 'CF_VERSION_METADATA' },
  };
  writeFileSync('dist/server/wrangler.hosted.json', JSON.stringify(config), { mode: 0o600 });
  writeFileSync('dist/server/capacity-entry.mjs', `import worker from './index.js';\nexport { TheRoom } from './index.js';\nexport default { async fetch(request,env,ctx) {\n const path=new URL(request.url).pathname;\n if(Date.now()>Number(env.CAPACITY_EXPIRES) || request.headers.get('x-capacity-key')!==env.CAPACITY_KEY || request.method!=='GET' || !['/api/version','/api/customer/my-nights','/api/room/socket'].includes(path)) return new Response('Not found',{status:404});\n return worker.fetch(request,env,ctx);\n}};\n`);
  wrangler(['d1', 'migrations', 'apply', 'DB', '--remote']);
  const now = new Date().toISOString(), future = new Date(Date.now() + 86400000).toISOString();
  const q = sqlString, slug = state.slug;
  const sql = [`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at) VALUES (${q(slug)},${q(slug)},${q(slug)},'Hosted capacity fixture','Synthetic','Accra',${q(now)},${q(future)},'Late night',10000,400,'on_sale','https://example.com/test.jpg','Synthetic isolated rehearsal.','published',${q(now)},${q(now)},${q(now)});`];
  for (let i = 0; i < 400; i++) {
    const id = `${slug}-${i}`, token = randomBytes(32).toString('base64url');
    state.tokens.push(token);
    const hash = createHash('sha256').update(token).digest('hex');
    sql.push(
      `INSERT INTO attendee_profiles(id,normalized_email,display_name,status,created_at,updated_at) VALUES (${q(id)},${q(`${id}@example.com`)},${q(`Guest ${i}`)},'active',${q(now)},${q(now)});`,
      `INSERT INTO attendee_sessions(id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES (${q(id)},${q(id)},${q(hash)},${q(future)},${q(now)},${q(now)});`,
      `INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,customer_name,payment_channel,status,created_at,paid_at) VALUES (${q(id)},${q(id)},${q(slug)},1,10000,0,10000,'GHS',${q(`${id}@example.com`)},'233000000000',${q(`Guest ${i}`)},'card','paid',${q(now)},${q(now)});`,
      `INSERT INTO tickets(id,order_id,event_slug,ticket_type,qr_token_hash,status,issued_at) VALUES (${q(id)},${q(id)},${q(slug)},'general',${q(id)},'issued',${q(now)});`,
      `INSERT INTO ticket_assignments(ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES (${q(id)},${q(id)},'fixture','active',${q(now)});`,
    );
  }
  save(state);
  writeFileSync('work/hosted-capacity/fixture.sql', sql.join('\n'), { mode: 0o600 });
  // File imports emit progress text even with --json. Exit status establishes
  // import completion; application assertions establish fixture correctness.
  wrangler(['d1', 'execute', 'DB', '--remote', '--file', 'work/hosted-capacity/fixture.sql']);
  state.seedStatements = sql.length;
  save(state);
  state.workerAttempted = true;
  save(state);
  wrangler(['deploy']);
  console.log(JSON.stringify({ phase: 'provisioned', worker: name, revision: state.revision, guests: 400, externalProviders: false }));
} else if (mode === 'test') {
  const state = readState(), base = new URL(state.base);
  if (base.protocol !== 'https:' || !base.hostname.startsWith(`${name}.`) || !base.hostname.endsWith('.workers.dev')) throw new Error('Only the owned staging Worker can be targeted.');
  const report = { revision: state.revision, environment: 'Cloudflare isolated hosted Worker and D1', guests: 400, externalProviders: false, fullEventSoak: false, seedStatements: state.seedStatements, metrics: [], passed: false };
  const sockets = [];
  let requests = 0;
  const requestHeaders = i => ({ 'x-capacity-key': state.key, cookie: `bct_attendee=${state.tokens[i % 400]}` });
  const percentile = (values, p) => Math.round([...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length*p)-1)] ?? 0);
  async function request(i) {
    if (++requests > 3500) throw new Error('Rehearsal request ceiling reached.');
    const started = performance.now();
    const response = await fetch(`${base.origin}/api/customer/my-nights`, { headers: requestHeaders(i), redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`My Nights HTTP ${response.status}`);
    const data = await response.json();
    if (data.attendee?.displayName !== `Guest ${i % 400}` || data.nights?.length !== 1 || data.nights[0].eventSlug !== state.slug || data.nights[0].ticketCount !== 1) throw new Error('Ownership or admission invariant failed.');
    return performance.now() - started;
  }
  function record(name, results, budget = 5000) {
    const times = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const errors = results.filter(r => r.status === 'rejected');
    const metric = { name, operations: results.length, failures: errors.length, p50Ms: percentile(times,.5), p95Ms: percentile(times,.95), p99Ms: percentile(times,.99), firstErrors: errors.slice(0,3).map(r => String(r.reason)) };
    report.metrics.push(metric); console.log(JSON.stringify(metric));
    if (errors.length || metric.p95Ms >= budget) throw new Error(`${name} failed its error/latency gate.`);
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    // workers.dev DNS/route registration can take a few seconds.
    let ready = false;
    for (let i = 0; i < 12; i++) { try { await request(0); ready = true; break; } catch { await pause(2000); } }
    if (!ready) throw new Error('Hosted fixture did not become ready.');
    const denied = await fetch(`${base.origin}/api/customer/my-nights`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (denied.status !== 404) throw new Error('Staging access guard failed.');
    const version = await (await fetch(`${base.origin}/api/version`, { headers: requestHeaders(0), redirect: 'error', signal: AbortSignal.timeout(15000) })).json();
    if (version.revision !== state.revision) throw new Error('Hosted revision mismatch.');
    report.version = version;
    for (const n of [50,100,200,400]) record(`my-nights-${n}-concurrent`, await Promise.allSettled(Array.from({ length: n }, (_,i) => request(i))));
    const scheduled = [], lateness = [], start = performance.now();
    for (let i = 0; i < 2400; i++) {
      await pause(Math.max(0, start + i*25 - performance.now()));
      lateness.push(Math.max(0, performance.now() - (start + i*25)));
      scheduled.push(request(i).then(value => ({ status: 'fulfilled', value }), reason => ({ status: 'rejected', reason })));
    }
    record('my-nights-40-per-second-60s', await Promise.all(scheduled), 3000);
    const schedulerP95Ms = percentile(lateness,.95);
    report.metrics.push({ name: 'scheduler', p95Ms: schedulerP95Ms });
    if (schedulerP95Ms >= 250) throw new Error('Load generator could not sustain the requested arrival rate.');
    const received = new Set(), deliveries = [], marker = `rehearsal-${run}`;
    let sentAt = 0, socketErrors = 0;
    const connected = await Promise.allSettled(Array.from({ length: 400 }, (_,i) => new Promise((resolve, reject) => {
      const started = performance.now();
      const socket = new WebSocket(`${base.origin.replace('https:', 'wss:')}/api/room/socket?event=${state.slug}`, { headers: { ...requestHeaders(i), origin: base.origin }, handshakeTimeout: 15000 });
      sockets.push(socket);
      socket.once('open', () => resolve(performance.now()-started));
      socket.on('error', () => { socketErrors++; reject(new Error('Room connection error')); });
      socket.on('message', raw => {
        const message = JSON.parse(String(raw));
        if (message.type === 'error') socketErrors++;
        if (message.type === 'message' && message.message?.content === marker && !received.has(i)) { received.add(i); deliveries.push(performance.now()-sentAt); }
      });
    })));
    record('room-connect-400', connected);
    sentAt = performance.now();
    sockets[0].send(JSON.stringify({ type: 'message', content: marker }));
    const deadline = Date.now() + 15000;
    while (received.size < 400 && Date.now() < deadline) await pause(50);
    report.metrics.push({ name: 'room-single-message-400-recipients', delivered: received.size, expected: 400, socketErrors, p95Ms: percentile(deliveries,.95) });
    if (received.size !== 400 || socketErrors || percentile(deliveries,.95) >= 5000) throw new Error('Hosted Room delivery failed.');
    record('recovery', await Promise.allSettled([request(0)]));
    report.passed = true;
  } catch (error) { report.failure = String(error); throw error; }
  finally {
    for (const socket of sockets) socket.terminate();
    report.requests = requests;
    mkdirSync('capacity-results', { recursive: true });
    writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, requests, failure: report.failure }));
  }
} else if (mode === 'verify-state') {
  const state = readState();
  const database = await api(`/d1/database/${state.databaseId}`);
  if (database.name !== name) throw new Error('Fixture database ownership mismatch.');
  let counts;
  for (let i = 0; i < 10; i++) {
    const result = await api(`/d1/database/${state.databaseId}/query`, 'POST', {
      sql: "SELECT COUNT(*) AS notifications,COUNT(DISTINCT attendee_id) AS recipients FROM attendee_notifications WHERE event_slug=? AND kind='room_message'",
      params: [state.slug],
    });
    counts = result[0].results[0];
    if (counts.notifications === 399 && counts.recipients === 399) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const passed = counts?.notifications === 399 && counts?.recipients === 399;
  writeFileSync('capacity-results/hosted-notifications.json', JSON.stringify({ passed, ...counts, expectedRecipients: 399 }, null, 2));
  if (!passed) throw new Error('Hosted notification fanout did not persist for every non-sender.');
  console.log(JSON.stringify({ notificationFanout: 'passed', ...counts }));
} else if (mode === 'cleanup') {
  if (existsSync(statePath)) {
    const state = readState(), errors = [];
    if (state.workerAttempted) try { await api(`/workers/scripts/${name}?force=true`, 'DELETE'); } catch (error) { errors.push(String(error)); }
    // A create response may be lost after the provider created the database.
    if (!state.databaseId) try {
      const matches = (await api(`/d1/database?name=${name}`)).filter(database => database.name === name);
      if (matches.length > 1) throw new Error('Ambiguous owned fixture database.');
      state.databaseId = matches[0]?.uuid;
    } catch (error) { errors.push(String(error)); }
    if (state.databaseId) try {
      const database = await api(`/d1/database/${state.databaseId}`);
      if (database.name !== name) throw new Error('Refusing to delete a database not owned by this run.');
      await api(`/d1/database/${state.databaseId}`, 'DELETE');
    } catch (error) { errors.push(String(error)); }
    mkdirSync('capacity-results', { recursive: true });
    writeFileSync('capacity-results/hosted-cleanup.json', JSON.stringify({ worker: name, completed: errors.length === 0, errors }, null, 2));
    if (errors.length) throw new Error(errors.join('\n'));
    console.log('Owned staging Worker and database removed.');
  }
} else throw new Error('Expected setup, test, verify-state or cleanup.');
