import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { get } from 'node:http';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { SqliteDatabase } from '../runtime/vps/database.mjs';

process.umask(0o077);
const directory = mkdtempSync(path.join(tmpdir(), 'tickets-vps-network-'));
const db = new SqliteDatabase(path.join(directory, 'tickets.sqlite'));
const host = '127.0.0.1:3218', base = `http://${host}`;
let child, socket, output = '';
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
  writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ ENVIRONMENT: 'test', STAFF_LOGIN_DECOY_SECRET: 'isolated-vps-network-test-key-with-no-production-access' }));
  child = spawn(process.execPath, ['dist-vps/server.mjs'], { env: { ...process.env, TICKETS_CONFIG: path.join(directory, 'config.json'), TICKETS_STATE: directory, TICKETS_HOST: host, TICKETS_PORT: '3218', TICKETS_ACTIVE: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { output = (output + data).slice(-10000); });
  child.stderr.on('data', data => { output = (output + data).slice(-10000); });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error('Server exited during startup.');
    try { const response = await fetch(base + '/healthz'); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'Server did not become ready.');
  for (const route of ['/', '/my-nights', '/api/public/events', '/api/version']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.ok(response.headers.get('content-security-policy'), `${route} security headers`);
    await response.arrayBuffer();
  }
  const invalidHost = await new Promise((resolve, reject) => {
    get(base + '/healthz', { headers: { host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }).once('error', reject);
  });
  assert.equal(invalidHost, 421);
  assert.equal((await fetch(base + '/api/admin/accounts')).status, 403);
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
  await db.prepare('UPDATE attendee_sessions SET revoked_at=? WHERE id=?').bind(now,id).run();
  const closed = once(socket, 'close');
  socket.send(JSON.stringify({ type: 'reaction', messageId: 'does-not-matter', emoji: '🔥' }));
  const close = await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('Revoked socket remained open.')), 8000).unref())]);
  assert.equal(close[0], 4003);
  console.log('VPS HTTP, SSR, private access, QR wallet, real Room WebSocket and session revocation passed.');
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
