import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Agent, get, request } from 'node:http';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { SqliteDatabase } from '../runtime/vps/database.mjs';

process.umask(0o077);
const distribution = path.resolve(process.env.TICKETS_VERIFY_DISTRIBUTION ?? 'dist-vps');
const directory = mkdtempSync(path.join(process.env.TICKETS_VERIFY_TEMP_ROOT ?? tmpdir(), 'tickets-vps-network-'));
const db = new SqliteDatabase(path.join(directory, 'tickets.sqlite'));
const host = '127.0.0.1:3218', base = `http://${host}`;
let child, socket, output = '';
async function sameConnectionRequest(agent, route, method, headers, body = '') {
  console.log(JSON.stringify({ probe: 'same-connection-body-boundary', route, method, bodyBytes: Buffer.byteLength(body) }));
  return new Promise((resolve, reject) => {
    const req = request(base + route, { agent, method, headers: { ...headers, 'content-length': Buffer.byteLength(body) } }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.once('end', () => resolve({ status: response.statusCode, body: text, reusedSocket: req.reusedSocket }));
      response.once('error', reject);
    });
    req.setTimeout(8000, () => req.destroy(new Error(`${method} ${route} stalled after body rejection`)));
    req.once('error', reject);
    req.end(body);
  });
}
async function start() {
  const { NODE_PATH: nodePath, NODE_OPTIONS: nodeOptions, ...environment } = process.env;
  void nodePath; void nodeOptions;
  child = spawn(path.join(distribution, 'bin/node'), [path.join(distribution, 'server.mjs')], { cwd: distribution, env: { ...environment, TICKETS_CONFIG: path.join(directory, 'config.json'), TICKETS_STATE: directory, TICKETS_HOST: host, TICKETS_PORT: '3218', TICKETS_ACTIVE: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { output = (output + data).slice(-10000); });
  child.stderr.on('data', data => { output = (output + data).slice(-10000); });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error('Server exited during startup.');
    try { const response = await fetch(base + '/healthz'); if (response.ok) return; } catch { /* Startup is asynchronous. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Server did not become ready.');
}
try {
  for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) await db.exec(readFileSync(path.join('drizzle', file), 'utf8'));
  const id = randomUUID(), slug = `vps-network-${id}`, session = randomBytes(32).toString('base64url');
  const now = new Date().toISOString(), future = new Date(Date.now() + 86400000).toISOString();
  await db.batch([
    db.prepare("INSERT INTO curated_event_records (id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,capacity,event_state,image_url,curation_note,status,published_at,created_at,updated_at) SELECT ?,?,?,title,venue,area,starts_at,?,vibe,price_from_minor,capacity,'on_sale',image_url,curation_note,'published',published_at,created_at,updated_at FROM curated_event_records WHERE slug='after-dark-osu'").bind(id,id,slug,future),
    db.prepare("INSERT INTO attendee_profiles (id,normalized_email,display_name,email_verified_at,status,created_at,updated_at) VALUES (?,?,'VPS test guest',?,'active',?,?)").bind(id,`${id}@example.com`,now,now,now),
    db.prepare('INSERT INTO attendee_sessions (id,attendee_id,token_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?)').bind(id,id,createHash('sha256').update(session).digest('hex'),future,now,now),
    db.prepare("INSERT INTO orders (id,reference,event_slug,ticket_type,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,created_at,paid_at) VALUES (?,?,?,'general',1,10000,0,10000,'GHS',?,'233000000000','mobile_money:mtn','paid',?,?)").bind(id,`BCT-${id}`,slug,`${id}@example.com`,now,now),
    db.prepare("INSERT INTO tickets (id,order_id,event_slug,ticket_type,admission_number,qr_token_hash,status,issued_at) VALUES (?,?,?,'general',1,?,'issued',?)").bind(id,id,slug,id,now),
    db.prepare("INSERT INTO ticket_assignments (ticket_id,attendee_id,assigned_by,status,assigned_at) VALUES (?,?,'fixture','active',?)").bind(id,id,now),
  ]);
  writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ ENVIRONMENT: 'test', STAFF_LOGIN_DECOY_SECRET: 'isolated-vps-network-test-key-with-no-production-access', PAYSTACK_SECRET_KEY: 'sk_test_isolated_unsigned_webhook_no_provider_access' }));
  await start();
  for (const route of ['/', '/my-nights', '/api/public/events', '/api/version']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.ok(response.headers.get('content-security-policy'), `${route} security headers`);
    const text = await response.text();
    if (route === '/') {
      const nonce = response.headers.get('content-security-policy').match(/'nonce-([^']+)'/)[1];
      assert.ok(text.includes(`nonce="${nonce}"`), 'SSR script nonce matches the response security policy');
    }
  }
  for (const artwork of ['/hosts/kofi-bills.webp', '/events/on-the-guest-list.webp']) {
    const response = await fetch(base + artwork);
    assert.equal(response.status, 200, 'public artwork exists');
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin', 'native public artwork embedding');
    await response.arrayBuffer();
  }
  const privateMedia = await fetch(base + '/api/media/isolated-not-a-public-poster');
  assert.equal(privateMedia.status, 404);
  assert.equal(privateMedia.headers.get('cross-origin-resource-policy'), 'same-origin');
  const invalidHost = await new Promise((resolve, reject) => {
    get(base + '/healthz', { headers: { host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }).once('error', reject);
  });
  assert.equal(invalidHost, 421);
  assert.equal((await fetch(base + '/api/admin/accounts')).status, 403);
  for (const [route, method] of [['/api/customer/tickets', 'POST'], ['/api/customer/my-nights', 'GET'], ['/api/admin/check-in', 'POST']]) {
    const rejected = await fetch(base + route, { method, headers: { origin: base } });
    assert.equal(rejected.status, 401);
    assert.ok(rejected.headers.get('cache-control').includes('no-store'));
    assert.ok(rejected.headers.get('content-security-policy'));
  }
  assert.equal((await fetch(base + '/api/customer/tickets', { method: 'POST', headers: { origin: 'https://untrusted.example', cookie: `bct_attendee=${session}` } })).status, 403);
  assert.equal((await fetch(base + '/api/admin/check-in', { method: 'POST', headers: { origin: base }, body: 'x'.repeat(32769) })).status, 413);
  // Exercise a compiled Vinext route outside the three direct fast APIs. Its
  // Request wrapper crosses a realm boundary that native handler unit tests do
  // not reproduce; body limits must preserve URL, method, cookies and origin.
  const privateHeaders = { origin: base, cookie: `bct_attendee=${session}`, 'content-type': 'application/json' };
  const privacy = await fetch(base + '/api/customer/privacy', { method: 'PUT', headers: privateHeaders,
    body: JSON.stringify({ defaultAttendeeVisible: true, allowHostUpdates: false }) });
  assert.equal(privacy.status, 200, 'compiled generic route accepts bounded JSON');
  assert.equal((await privacy.json()).saved, true);
  const persistedPrivacy = await fetch(base + '/api/customer/privacy', { headers: privateHeaders });
  assert.equal(persistedPrivacy.status, 200);
  assert.equal(persistedPrivacy.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.deepEqual(await persistedPrivacy.json(), { defaultAttendeeVisible: true, allowHostUpdates: false });
  assert.equal((await fetch(base + '/api/customer/privacy', { method: 'PUT',
    headers: { ...privateHeaders, origin: 'https://untrusted.example' },
    body: JSON.stringify({ defaultAttendeeVisible: false, allowHostUpdates: true }) })).status, 403);
  // Pin both calls to one socket. A declared-length rejection must release the
  // incoming stream so a subsequent valid request cannot stall or reset.
  const boundaryAgent = new Agent({ keepAlive: true, maxSockets: 1 });
  try {
    const oversized = await sameConnectionRequest(boundaryAgent, '/api/customer/privacy', 'PUT', privateHeaders, 'x'.repeat(1024 * 1024 + 1));
    assert.equal(oversized.status, 413, 'declared oversize remains rejected');
    const afterRejection = await sameConnectionRequest(boundaryAgent, '/api/customer/privacy', 'GET', privateHeaders);
    assert.equal(afterRejection.reusedSocket, true, 'follow-up exercises the rejected request connection');
    assert.equal(afterRejection.status, 200, 'connection remains usable after rejection');
    assert.deepEqual(JSON.parse(afterRejection.body), { defaultAttendeeVisible: true, allowHostUpdates: false }, 'oversize rejection cannot mutate saved privacy');
  } finally {
    boundaryAgent.destroy();
  }
  const unsignedWebhook = await fetch(base + '/api/payments/webhook', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: '{"event":"charge.success","data":{}}' });
  assert.equal(unsignedWebhook.status, 401, 'unsigned compiled webhook is denied rather than crashing');
  const wallet = await fetch(base + '/api/customer/tickets', { method: 'POST', headers: { origin: base, cookie: `bct_attendee=${session}` } });
  assert.equal(wallet.status, 200);
  const walletBody = await wallet.json();
  assert.equal(walletBody.orders[0].tickets.length, 1);
  assert.ok(walletBody.orders[0].tickets[0].qrPayload);
  socket = new WebSocket(`ws://${host}/api/room/socket?event=${slug}`, { headers: { origin: `https://${host}`, cookie: `bct_attendee=${session}` } });
  const snapshot = await Promise.race([once(socket, 'message'), new Promise((_, reject) => setTimeout(() => reject(new Error('Room snapshot timed out.')), 8000).unref())]);
  assert.equal(JSON.parse(snapshot[0].toString()).type, 'snapshot');
  const incoming = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Room message timed out.')), 8000);
    socket.on('message', data => {
      const value = JSON.parse(data.toString());
      if (value.type === 'error') { clearTimeout(timeout); reject(new Error(value.error)); }
      if (value.type === 'message') { clearTimeout(timeout); resolve(value); }
    });
  });
  socket.send(JSON.stringify({ type: 'message', content: 'Isolated VPS connection test.' }));
  const messageBody = await incoming;
  assert.equal(messageBody.message.content, 'Isolated VPS connection test.');
  socket.close();
  await once(socket, 'close');
  const stopped = once(child, 'exit');
  child.kill('SIGTERM');
  const exit = await Promise.race([stopped, new Promise((_, reject) => setTimeout(() => reject(new Error('Graceful restart timed out.')), 25000).unref())]);
  assert.equal(exit[0], 0);
  await start();
  socket = new WebSocket(`ws://${host}/api/room/socket?event=${slug}`, { headers: { origin: `https://${host}`, cookie: `bct_attendee=${session}` } });
  const restored = await Promise.race([once(socket, 'message'), new Promise((_, reject) => setTimeout(() => reject(new Error('Restarted Room timed out.')), 8000).unref())]);
  const restoredBody = JSON.parse(restored[0].toString());
  assert.equal(restoredBody.type, 'snapshot');
  assert.ok(restoredBody.messages.some(message => message.id === messageBody.message.id && message.content === messageBody.message.content), 'Room history survives a server restart');
  await db.prepare('UPDATE attendee_sessions SET revoked_at=? WHERE id=?').bind(now,id).run();
  const closed = once(socket, 'close');
  socket.send(JSON.stringify({ type: 'reaction', messageId: 'does-not-matter', emoji: '🔥' }));
  const close = await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('Revoked socket remained open.')), 8000).unref())]);
  assert.equal(close[0], 4003);
  console.log('VPS HTTP, SSR/CSP, generic bounded JSON, unsigned webhook denial, private access, QR wallet, real Room WebSocket, restart persistence and session revocation passed.');
} catch (error) {
  console.error(output);
  throw error;
} finally {
  socket?.terminate();
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  db.close();
  rmSync(directory, { recursive: true, force: true });
}
