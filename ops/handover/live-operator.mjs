// Root-only, explicit-stage live handover. Never infer activation from rehearsal.
import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, rmSync, chmodSync, chownSync, lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import path from 'node:path';
import { withControl, cloudflare, account } from './control-client.mjs';
import { captureFrozenDatabase, createVerifiedReturnDatabase, removeDisposableDatabase, replaceDatabaseBinding, query } from './database-transfer.mjs';
import { exportDatabase } from './sqlite-export.mjs';
import { restoreRoomEnvelope } from './sqlite-snapshot.mjs';
import { openEnvelope } from './open-envelope.mjs';
import { privateJson, checkpoint, reconciliation, roomReturn, assertNoVpsQueue, hash } from './live-state.mjs';
import { controlSchema } from '../../worker/handover-control.ts';
process.umask(0o077);
const root = '/accounts/' + account;
const worker = root + '/workers/scripts/becore-tickets';
const zone = '/zones/bbf0174f839a0d22dbf6d9f4bd3cf53d';
const queue = root + '/queues/4bcab6ba4d2447efa852e83c9091906c';
const hostname = 'tickets.becoreops.com';
const home = '/var/lib/becore-tickets-handover';
const journal = home + '/live-transfer.json';
const liveState = '/var/lib/becore-tickets';
const origin = '/etc/caddy/becore-tickets-origin.caddy';
const keyFile = '/etc/becore-tickets/handover/recipient.pem';
const modes = ['prepare', 'capture', 'activate', 'rollback', 'abort', 'status'];
const [mode, revision] = process.argv.slice(2);
assert.ok(process.getuid() === 0 && modes.includes(mode) && /^[a-f0-9]{40}$/.test(revision ?? ''), 'Root and exact release identity required.');
assert.ok(/^\d+$/.test(process.env.GITHUB_RUN_ID ?? ''), 'Authorized operator run identity required.');
const credentials = '/etc/becore-tickets-fallback.env';
assert.ok(lstatSync(credentials).isFile() && !(lstatSync(credentials).mode & 0o077));
const settings = Object.fromEntries(readFileSync(credentials, 'utf8').split('\n').filter(line => line.includes('=') && !line.startsWith('#')).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')]; }));
process.env.CLOUDFLARE_API_TOKEN = settings.CLOUDFLARE_API_TOKEN;
mkdirSync(home, { recursive: true, mode: 0o700 });
let record = existsSync(journal) ? privateJson(journal) : null;
const save = () => checkpoint(journal, record);
const run = (...args) => execFileSync(args[0], args.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 });
const log = stage => console.log(JSON.stringify({ stage, transferId: record?.transferId, revision, phase: record?.phase }));
const key = readFileSync(keyFile);
assert.ok(lstatSync(keyFile).isFile() && !(lstatSync(keyFile).mode & 0o077));
async function currentDatabase() {
  const s = await cloudflare(worker + '/settings');
  const binding = s.bindings.find(b => b.name === 'DB' && b.type === 'd1');
  assert.ok(binding?.id); return binding.id;
}
async function pauseQueue(paused) {
  await cloudflare(queue, 'PATCH', { settings: { delivery_paused: paused } });
  assert.equal(Boolean((await cloudflare(queue)).settings.delivery_paused), paused);
}
async function emptyQueue() {
  const peek = await cloudflare(queue + '/messages/peek', 'POST', { batch_size: 100 });
  assert.ok(Array.isArray(peek.messages) && peek.messages.length === 0, 'Source queue must drain before transfer.');
}
async function inventory() {
  const rows = await cloudflare(root + '/workers/durable_objects/namespaces/683655a4b4924e54b31b9b7aad6e2e27/objects?limit=1000');
  assert.ok(rows.length < 1000, 'Room inventory requires pagination.');
  const ids = rows.filter(r => r.hasStoredData !== false && r.has_stored_data !== false).map(r => r.id).sort();
  assert.ok(ids.every(id => /^[a-f0-9]{64}$/.test(id)) && new Set(ids).size === ids.length);
  return ids;
}
function setOrigin(text) {
  const previous = readFileSync(origin, 'utf8');
  writeFileSync(origin, text, { mode: 0o644 }); chmodSync(origin, 0o644);
  try { run('caddy', 'validate', '--config', '/etc/caddy/Caddyfile'); run('systemctl', 'reload', 'caddy'); }
  catch (error) { writeFileSync(origin, previous); run('systemctl', 'reload', 'caddy'); throw error; }
}
function maintenance() {
  setOrigin(`${hostname} {\n tls /etc/caddy/certs/becore-tickets/origin.pem /etc/caddy/certs/becore-tickets/origin.key\n header Cache-Control "no-store"\n header Retry-After "60"\n respond "Tickets service is moving. Please retry shortly." 503\n}\n`);
}
async function proxyOrigin() {
  const ranges = await cloudflare('/ips');
  const ips = [...ranges.ipv4_cidrs, ...ranges.ipv6_cidrs];
  assert.ok(ips.length > 10 && ips.every(ip => /^[a-f0-9:./]+$/i.test(ip)));
  setOrigin(`${hostname} {\n tls /etc/caddy/certs/becore-tickets/origin.pem /etc/caddy/certs/becore-tickets/origin.key\n @blocked not remote_ip ${ips.join(' ')} 127.0.0.1 ::1\n respond @blocked 403\n reverse_proxy 127.0.0.1:3119 {\n  header_up Host ${hostname}\n  header_up X-Forwarded-Proto https\n  header_up X-Forwarded-Host ${hostname}\n  header_up X-Forwarded-For {http.request.header.Cf-Connecting-Ip}\n  header_up X-Real-IP {http.request.header.Cf-Connecting-Ip}\n }\n}\n`);
}
async function localHealth(active) {
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch('http://127.0.0.1:3119/healthz', { headers: { host: hostname }, signal: AbortSignal.timeout(3000) });
      const value = await response.json();
      if (response.ok && value.revision === revision && value.active === active) return;
    } catch { /* Read-only readiness retry. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('VPS readiness failed; source remains locked.');
}
function installService(state, active) {
  const release = '/srv/becore-tickets/releases/' + revision;
  const identity = JSON.parse(readFileSync(release + '/release.json', 'utf8'));
  assert.equal(identity.revision, revision); assert.equal(identity.dirty, false);
  const uid = Number(run('id', '-u', 'becore-tickets').trim()), gid = Number(run('id', '-g', 'becore-tickets').trim());
  function own(dir) { chownSync(dir, uid, gid); for (const item of readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, item.name); assert.ok(!item.isSymbolicLink()); if (item.isDirectory()) own(file); else chownSync(file, uid, gid); } }
  own(state);
  const unit = `[Unit]\nDescription=BeCore Tickets production runtime\nAfter=network-online.target\nWants=network-online.target\nStartLimitIntervalSec=300\nStartLimitBurst=5\n[Service]\nType=simple\nUser=becore-tickets\nGroup=becore-tickets\nWorkingDirectory=${release}\nEnvironment=NODE_ENV=production\nEnvironment=TICKETS_ACTIVE=${active ? 1 : 0}\nEnvironment=TICKETS_CONFIG=%d/runtime.json\nEnvironment=TICKETS_STATE=${state}\nEnvironment=TICKETS_HOST=${hostname}\nEnvironment=TICKETS_PORT=3119\nLoadCredential=runtime.json:/etc/becore-tickets/runtime.json\nExecStart=/usr/bin/flock --nonblock ${state}/instance.lock ${release}/bin/node ${release}/server.mjs\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=60\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nPrivateDevices=true\nProtectSystem=strict\nProtectHome=true\nProtectKernelTunables=true\nProtectKernelModules=true\nProtectControlGroups=true\nRestrictSUIDSGID=true\nRestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX\nLockPersonality=true\nCapabilityBoundingSet=\nReadWritePaths=${state}\nMemoryHigh=768M\nMemoryMax=1G\nCPUQuota=200%\nTasksMax=128\nLimitNOFILE=4096\nLogNamespace=becore-tickets\nLogRateLimitIntervalSec=60\nLogRateLimitBurst=120\n[Install]\nWantedBy=multi-user.target\n`;
  writeFileSync('/etc/systemd/system/becore-tickets.service', unit, { mode: 0o644 });
  run('systemctl', 'daemon-reload');
}
async function routeToVps() {
  const domains = (await cloudflare(root + '/workers/domains')).filter(d => d.hostname === hostname);
  assert.ok(domains.length <= 1);
  if (domains.length) { assert.equal(domains[0].service, 'becore-tickets'); await cloudflare(root + '/workers/domains/' + domains[0].id, 'DELETE'); }
  const records = await cloudflare(zone + '/dns_records?name=' + hostname);
  assert.ok(records.length <= 1);
  const desired = { name: hostname, type: 'A', content: '51.195.20.137', proxied: true, ttl: 1, comment: 'Tickets active VPS origin; Cloudflare remains TLS edge.' };
  if (records.length) await cloudflare(zone + '/dns_records/' + records[0].id, 'PUT', desired);
  else await cloudflare(zone + '/dns_records', 'POST', desired);
}
async function routeToCloudflare() {
  const domains = (await cloudflare(root + '/workers/domains')).filter(d => d.hostname === hostname);
  if (!domains.length) await cloudflare(root + '/workers/domains', 'PUT', { hostname, service: 'becore-tickets', environment: 'production', zone_id: zone.split('/')[2] });
}
async function resumeBeforeActivation(rpc) {
  assert.ok(!['transferred','active','returning','returned'].includes(record.phase));
  for (const objectId of record.roomIds ?? []) {
    const encrypted = await rpc('roomSnapshot', objectId);
    if (encrypted?.header && JSON.parse(encrypted.header).purpose === 'room-cutover') {
      const snapshot = openEnvelope(encrypted, key, 'room-cutover');
      assert.equal(snapshot.transferId, record.transferId);
      await rpc('resumeRoom', objectId, record.transferId);
    }
  }
  await rpc('resumeSource', record.transferId); await pauseQueue(false);
  record.phase = 'aborted'; save();
}
async function prepare() {
  assert.ok(!record || ['aborted','returned'].includes(record.phase), 'An existing transfer requires explicit recovery.');
  assert.ok(!existsSync(liveState), 'Existing live state requires review.');
  const release = JSON.parse(readFileSync('/srv/becore-tickets/releases/' + revision + '/release.json', 'utf8'));
  assert.equal(release.revision, revision); assert.equal(release.dirty, false);
  run('openssl', 'x509', '-in', '/etc/caddy/certs/becore-tickets/origin.pem', '-checkhost', hostname, '-checkend', '2592000', '-noout');
  const database = await currentDatabase();
  for (const sql of controlSchema) await query(database, sql);
  const status = (await query(database, 'SELECT phase FROM _bct_handover_admission WHERE id=1'))[0];
  assert.equal(status.phase, 'active');
  await cloudflare(worker + '/secrets', 'PUT', { name: 'HANDOVER_TRACKING', text: '1', type: 'secret_text' });
  await withControl(revision, async rpc => {
    const current = await rpc('sourceStatus'); assert.equal(current.tracking, true);
    const backupFile = '/etc/becore-tickets/backup.key';
    const secrets = await cloudflare(worker + '/secrets');
    if (!secrets.some(s => s.name === 'VPS_BACKUP_RECOVERY_KEY')) {
      assert.ok(!existsSync(backupFile));
      const backupKey = randomBytes(32);
      await cloudflare(worker + '/secrets', 'PUT', { name: 'VPS_BACKUP_RECOVERY_KEY', text: backupKey.toString('hex'), type: 'secret_text' });
      writeFileSync(backupFile, backupKey, { mode: 0o600, flag: 'wx' });
    }
    const recovery = openEnvelope(await rpc('backupRecovery'), key, 'backup-recovery');
    if (!existsSync(backupFile)) writeFileSync(backupFile, Buffer.from(recovery.key, 'hex'), { mode: 0o600, flag: 'wx' });
    assert.equal(readFileSync(backupFile).toString('hex'), recovery.key);
    const fresh = openEnvelope(await rpc('configuration'), key, 'configuration'); assert.equal(fresh.revision, revision);
    const pending = privateJson('/etc/becore-tickets/runtime.pending.json');
    const values = { ...fresh.values, ...Object.fromEntries(Object.entries(pending).filter(([k]) => ['VPS_AI_URL','VPS_AI_SIGNING_KEY'].includes(k))) };
    assert.ok(values.VPS_AI_URL && values.VPS_AI_SIGNING_KEY && values.STAFF_LOGIN_DECOY_SECRET && values.VAPID_PRIVATE_KEY && values.APPLE_WALLET_AUTH_SECRET && values.ENVIRONMENT === 'production');
    checkpoint('/etc/becore-tickets/runtime.json', values);
    record = { version: 1, transferId: randomUUID(), revision, database, phase: 'prepared', preparedAt: new Date().toISOString(), configurationHash: hash(values), roomIds: [], rooms: [] };
    save(); log('tracking-armed-live-source-unchanged');
  });
}
async function capture() {
  assert.equal(record?.phase, 'prepared'); assert.equal(record.revision, revision);
  assert.ok(Date.now() - Date.parse(record.preparedAt) >= 16 * 60000, 'Allow previous scheduled/queue invocations to finish before pausing.');
  assert.equal(await currentDatabase(), record.database);
  const stage = home + '/live-' + record.transferId;
  assert.ok(!existsSync(stage)); mkdirSync(stage, { mode: 0o700 }); mkdirSync(stage + '/rooms'); mkdirSync(stage + '/unmapped-rooms');
  await withControl(revision, async rpc => {
    let sourcePaused = false;
    try {
      await pauseQueue(true); record.phase = 'pausing'; save();
      await rpc('pauseSource', record.transferId); sourcePaused = true;
      let status;
      for (let i = 0; i < 60; i++) {
        status = await rpc('sourceStatus');
        assert.equal(status.admission.transfer_id, record.transferId);
        if (status.operations.length === 0) break;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      assert.equal(status.operations.length, 0, 'Source work did not drain; no leases were expired.');
      await emptyQueue();
      record.roomIds = await inventory(); record.phase = 'freezing'; save();
      for (const objectId of record.roomIds) await rpc('freezeRoom', objectId, record.transferId);
      await rpc('freezeSource', record.transferId);
      record.phase = 'frozen'; save(); log('source-frozen');
      const snapshot = await captureFrozenDatabase(record.database, stage + '/tickets.sqlite', record.transferId);
      const db = new DatabaseSync(stage + '/tickets.sqlite');
      try { record.reconciliation = reconciliation(db); } finally { db.close(); }
      for (const objectId of record.roomIds) {
        const snapshot = openEnvelope(await rpc('roomSnapshot', objectId), key, 'room-cutover');
        assert.equal(snapshot.objectId, objectId); assert.equal(snapshot.sourceRevision, revision);
        const temporary = stage + '/unmapped-rooms/' + objectId + '.sqlite';
        const restored = restoreRoomEnvelope(snapshot, temporary, record.transferId);
        const nodeFile = restored.eventSlug ? createHash('sha256').update(restored.eventSlug).digest('hex') + '.sqlite' : null;
        assert.ok(!nodeFile || !existsSync(stage + '/rooms/' + nodeFile), 'Duplicate Room name.');
        if (nodeFile) renameSync(temporary, stage + '/rooms/' + nodeFile);
        const payload = { tables: snapshot.tables, sequences: snapshot.sequences, alarm: snapshot.alarm };
        // Actual DO reverse import is tested while both source stores remain frozen.
        const returned = openEnvelope(await rpc('restoreRoom', objectId, record.transferId, payload), key, 'room-cutover');
        assert.deepEqual({ tables: returned.tables, sequences: returned.sequences, alarm: returned.alarm }, payload);
        record.rooms.push({ objectId, nodeFile, eventSlug: restored.eventSlug }); save();
      }
      assert.deepEqual(await inventory(), record.roomIds);
      const test = await createVerifiedReturnDatabase(snapshot, 'tickets-reverse-test-' + process.env.GITHUB_RUN_ID);
      record.disposableDatabase = test; save();
      await removeDisposableDatabase(test); delete record.disposableDatabase;
      record.evidence = { tables: Object.keys(snapshot.evidence).length, rows: Object.values(snapshot.evidence).reduce((n,r) => n + r.rows, 0), digest: hash(snapshot.evidence), rooms: record.rooms.length, d1ReturnVerified: true, roomReturnVerified: true };
      record.stage = stage; record.capturedAt = new Date().toISOString(); record.phase = 'verified'; save(); log('fresh-state-and-reverse-transfer-verified');
    } catch (error) {
      if (sourcePaused) await resumeBeforeActivation(rpc); else await pauseQueue(false);
      if (record.phase === 'aborted' || !sourcePaused) rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  });
}
async function activate() {
  assert.equal(record?.phase, 'verified'); assert.equal(record.revision, revision);
  assert.ok(Date.now() - Date.parse(record.capturedAt) < 15 * 60000, 'Transfer activation window expired.');
  assert.equal(hash(privateJson('/etc/becore-tickets/runtime.json')), record.configurationHash);
  assert.ok(record.evidence.d1ReturnVerified && record.evidence.roomReturnVerified);
  await withControl(revision, async rpc => {
    const status = await rpc('sourceStatus'); assert.equal(status.admission.phase, 'frozen'); assert.equal(status.admission.transfer_id, record.transferId); assert.equal(status.operations.length, 0);
    await emptyQueue();
    const db = new DatabaseSync(record.stage + '/tickets.sqlite');
    try { assert.equal(hash(exportDatabase(db).evidence), record.evidence.digest); } finally { db.close(); }
    assert.ok(!existsSync(liveState)); renameSync(record.stage, liveState); record.stage = liveState; save();
    // Prove the exact service and credentials can start with its database still frozen.
    installService(liveState, false); run('systemctl', 'start', 'becore-tickets.service');
    await localHealth(false); run('systemctl', 'stop', 'becore-tickets.service');
    run('systemctl', 'disable', '--now', 'becore-tickets-fallback.timer');
    await cloudflare(zone + '/rulesets/' + settings.CLOUDFLARE_FALLBACK_RULESET_ID + '/rules/' + settings.CLOUDFLARE_FALLBACK_RULE_ID, 'PATCH', { enabled: false });
    // Persist the irreversible boundary before requesting it; recovery inspects RPC state.
    record.phase = 'transferred'; save();
    await rpc('markTransferred', record.transferId);
    const live = new DatabaseSync(liveState + '/tickets.sqlite');
    try { live.prepare('UPDATE _bct_handover_state SET frozen=0 WHERE id=1 AND transfer_id=?').run(record.transferId); live.prepare("UPDATE _bct_handover_admission SET phase='active',paused_at=NULL WHERE id=1 AND transfer_id=?").run(record.transferId); } finally { live.close(); }
    checkpoint(liveState + '/handoff.json', { source: 'cloudflare', writer: 'vps', revision, transferId: record.transferId, sourceWritesStopped: true, roomsVerified: true, credentialsVerified: true, capturedAt: record.capturedAt });
    installService(liveState, true); run('systemctl', 'enable', '--now', 'becore-tickets.service');
    await localHealth(true); await proxyOrigin(); await routeToVps();
    record.phase = 'active'; record.activatedAt = new Date().toISOString(); save(); log('vps-active');
  });
}
async function rollback() {
  assert.ok(['active','transferred','returning'].includes(record?.phase)); assert.equal(record.revision, revision);
  maintenance(); run('systemctl', 'disable', '--now', 'becore-tickets.service');
  assert.ok(run('systemctl', 'show', 'becore-tickets.service', '--property=ActiveState', '--value').trim() === 'inactive');
  assertNoVpsQueue(liveState);
  const returnedFile = home + '/return-' + record.transferId + '.sqlite';
  assert.ok(!existsSync(returnedFile), 'An interrupted reverse transfer requires journal inspection.');
  const source = new DatabaseSync(liveState + '/tickets.sqlite', { readOnly: true });
  try { await backup(source, returnedFile); } finally { source.close(); }
  const db = new DatabaseSync(returnedFile);
  let snapshot;
  try {
    reconciliation(db);
    db.prepare("UPDATE _bct_handover_admission SET phase='frozen',transfer_id=? WHERE id=1").run(record.transferId);
    db.prepare('UPDATE _bct_handover_state SET frozen=1,transfer_id=? WHERE id=1').run(record.transferId);
    snapshot = exportDatabase(db);
  } finally { db.close(); }
  record.phase = 'returning'; save();
  const database = await createVerifiedReturnDatabase(snapshot, 'tickets-live-return-' + process.env.GITHUB_RUN_ID);
  record.returnDatabase = database; save();
  await replaceDatabaseBinding('becore-tickets', database);
  await withControl(revision, async rpc => {
    const status = await rpc('sourceStatus'); assert.equal(status.admission.phase, 'frozen'); assert.equal(status.admission.transfer_id, record.transferId);
    const rooms = new Map(record.rooms.filter(r => r.nodeFile).map(r => [r.nodeFile, r]));
    for (const name of readdirSync(liveState + '/rooms').filter(n => /^[a-f0-9]{64}\.sqlite$/.test(n))) {
      const payload = roomReturn(liveState + '/rooms/' + name);
      let room = rooms.get(name);
      if (!room) {
        const slug = payload.tables.room_config.find(row => row.id === 1)?.event_slug;
        assert.ok(typeof slug === 'string' && createHash('sha256').update(slug).digest('hex') + '.sqlite' === name);
        const identity = await rpc('roomIdentity', slug); room = { objectId: identity.objectId, nodeFile: name };
        await rpc('freezeRoom', room.objectId, record.transferId); record.rooms.push(room); save();
      }
      const result = openEnvelope(await rpc('restoreRoom', room.objectId, record.transferId, payload), key, 'room-cutover');
      assert.deepEqual({ tables: result.tables, sequences: result.sequences, alarm: result.alarm }, payload);
    }
    await routeToCloudflare();
    for (const room of record.rooms) await rpc('resumeRoom', room.objectId, record.transferId);
    await rpc('resumeSource', record.transferId); await pauseQueue(false);
    record.phase = 'returned'; record.returnedAt = new Date().toISOString(); save();
    rmSync(returnedFile); log('fresh-vps-state-returned-to-cloudflare');
  });
}
try {
  if (mode === 'prepare') await prepare();
  else if (mode === 'capture') await capture();
  else if (mode === 'activate') await activate();
  else if (mode === 'rollback') await rollback();
  else if (mode === 'abort') await withControl(revision, async rpc => { if (existsSync('/etc/systemd/system/becore-tickets.service')) run('systemctl', 'disable', '--now', 'becore-tickets.service'); await resumeBeforeActivation(rpc); if (record.stage) rmSync(record.stage, { recursive: true, force: true }); });
  else log('operator-status');
} catch {
  // Provider errors may quote SQL rows or credentials. Only the durable phase is public.
  console.error(JSON.stringify({ handoverFailed: true, mode, phase: record?.phase ?? 'not-started', transferId: record?.transferId ?? null, automaticFailback: false }));
  process.exitCode = 1;
}
