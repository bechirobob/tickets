import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { createEnvironment, loadPrivateConfiguration } from './environment.mjs';
import { authorizeRoomSocket } from '../../worker/room-socket.ts';
import { requestNonce, contentSecurityPolicy, securityResponse } from '../../worker/security-response.ts';
import { processQueue, runScheduledOperations } from '../../worker/background.ts';

process.umask(0o077);
const distribution = path.dirname(fileURLToPath(import.meta.url));
const release = JSON.parse(readFileSync(path.join(distribution, 'release.json'), 'utf8'));
const revision = release.revision;
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid release identity.');
const values = loadPrivateConfiguration(process.env.TICKETS_CONFIG ?? '/etc/becore-tickets/runtime.json');
const directory = process.env.TICKETS_STATE ?? '/var/lib/becore-tickets';
const host = process.env.TICKETS_HOST ?? 'tickets.becoreops.com';
if (!/^[a-z0-9.-]+(?::[0-9]+)?$/.test(host)) throw new Error('Invalid application hostname.');
const port = Number(process.env.TICKETS_PORT ?? 3118);
const active = process.env.TICKETS_ACTIVE === '1';
if (active && values.ENVIRONMENT !== 'production') throw new Error('Active runtime requires production configuration.');
if (active && !values.STAFF_LOGIN_DECOY_SECRET) throw new Error('Private authentication configuration is missing.');
if (active) {
  if (release.dirty) throw new Error('An uncommitted build cannot accept live traffic.');
  const handoff = JSON.parse(readFileSync(path.join(directory, 'handoff.json'), 'utf8'));
  if (handoff.source !== 'cloudflare' || handoff.writer !== 'vps' || handoff.sourceWritesStopped !== true || handoff.roomsVerified !== true || handoff.credentialsVerified !== true) throw new Error('The verified, single-writer production handoff is missing.');
}
const runtime = createEnvironment({ directory, values, revision });
const env = runtime.environment;
// A deployed application must never silently create an empty live database.
await env.DB.prepare('SELECT id FROM orders LIMIT 1').all();
process.env.VINEXT_TRUSTED_HOSTS = host;
process.env.VINEXT_TRUST_PROXY = '1';
const { startProdServer } = await import('vinext/server/prod-server');
const { server } = await startProdServer({ host: '127.0.0.1', port, outDir: distribution, silent: true });
const handlers = server.listeners('request');
server.removeAllListeners('request');
server.on('request', (request, response) => {
  if (request.headers.host !== host) { response.writeHead(421); response.end(); return; }
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ service: 'becore-tickets', revision, runtime: 'vps', active })); return;
  }
  if (request.url?.startsWith('/__vinext/')) { response.writeHead(404); response.end(); return; }
  const nonce = requestNonce();
  request.headers['content-security-policy'] = contentSecurityPolicy(nonce);
  const headers = securityResponse(new Response(null), nonce, (request.url ?? '/').split('?')[0]).headers;
  for (const [key, value] of headers) response.setHeader(key, value);
  for (const handler of handlers) handler.call(server, request, response);
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
server.on('upgrade', (incoming, socket, head) => {
  void (async () => {
    if (incoming.headers.host !== host || (incoming.url ?? '').split('?')[0] !== '/api/room/socket') throw new Error('Invalid upgrade.');
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    const request = new Request(`https://${host}${incoming.url}`, { headers });
    const authorized = await authorizeRoomSocket(request, env);
    if (authorized instanceof Response) { socket.end(`HTTP/1.1 ${authorized.status} Rejected\r\nConnection: close\r\n\r\n`); return; }
    const name = new URL(request.url).searchParams.get('event');
    sockets.handleUpgrade(incoming, socket, head, connection => {
      void env.THE_ROOM.accept(name, authorized, connection).catch(() => connection.close(1008, 'Room access unavailable'));
    });
  })().catch(() => socket.destroy());
});

let jobsBusy = false, closing = false, lastMinute = -1;
const liveConnections = new Set();
server.on('connection', socket => { liveConnections.add(socket); socket.on('close', () => liveConnections.delete(socket)); });
const timer = setInterval(() => {
  if (!active || closing || jobsBusy) return;
  jobsBusy = true;
  void (async () => {
    const minute = Math.floor(Date.now() / 60000);
    if (minute !== lastMinute) {
      lastMinute = minute;
      await env.THE_ROOM.runAlarms();
      await runScheduledOperations({ cron: '* * * * *', scheduledTime: minute * 60000 }, env);
      if (minute % 5 === 0) await runScheduledOperations({ cron: '*/5 * * * *', scheduledTime: minute * 60000 }, env);
      const date = new Date();
      if (date.getUTCHours() === 3 && date.getUTCMinutes() === 15) await runScheduledOperations({ cron: '15 3 * * *', scheduledTime: minute * 60000 }, env);
    }
    await env.EMAIL_DELIVERY_QUEUE.process(batch => processQueue(batch, env));
  })().catch(() => console.error('Scheduled Tickets operation failed; persistent tasks remain queued.')).finally(() => { jobsBusy = false; });
}, 1000);
timer.unref();

async function shutdown() {
  if (closing) return;
  closing = true; clearInterval(timer);
  const drained = new Promise(resolve => server.close(resolve));
  for (const client of sockets.clients) client.close(1012, 'Service restarting');
  const forceClose = setTimeout(() => { for (const socket of liveConnections) socket.destroy(); }, 20000);
  forceClose.unref();
  await drained;
  clearTimeout(forceClose);
  const deadline = Date.now() + 25000;
  while (jobsBusy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  if (jobsBusy) process.exit(1); // Persisted leases recover after restart.
  await runtime.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
console.log(JSON.stringify({ service: 'becore-tickets', revision, runtime: 'vps', active, listening: `127.0.0.1:${port}` }));
