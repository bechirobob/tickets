import { POST as wallet } from '../../app/api/customer/tickets/route.ts';
import { GET as nights } from '../../app/api/customer/my-nights/route.ts';
import { POST as checkIn } from '../../app/api/admin/check-in/route.ts';

// Reuse the exact authenticated application handlers without page-renderer
// dispatch for the event's busiest APIs. No identity or response is cached.
const routes = new Map([
  ['POST /api/customer/tickets', wallet],
  ['GET /api/customer/my-nights', nights],
  ['POST /api/admin/check-in', checkIn],
]);

function body(incoming) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, exceeded = false;
    incoming.on('data', chunk => {
      if (exceeded) return;
      size += chunk.length;
      if (size > 32768) {
        exceeded = true; chunks.length = 0;
        reject(Object.assign(new Error('Request too large.'), { status: 413 }));
      } else chunks.push(chunk);
    });
    incoming.on('end', () => { if (!exceeded) resolve(Buffer.concat(chunks)); });
    incoming.on('aborted', () => reject(Object.assign(new Error('Request aborted.'), { status: 400 })));
    incoming.on('error', reject);
  });
}

export function dispatchPrivateApi(incoming, outgoing, host) {
  const route = routes.get(`${incoming.method} ${(incoming.url ?? '').split('?')[0]}`);
  if (!route) return false;
  if (incoming.method === 'GET') incoming.resume();
  void (async () => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(key === 'cookie' ? '; ' : ', ') : value);
    }
    const protocol = incoming.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const request = new Request(`${protocol}://${host}${incoming.url}`, {
      method: incoming.method, headers,
      ...(incoming.method === 'POST' ? { body: await body(incoming) } : {}),
    });
    const response = await route(request);
    outgoing.statusCode = response.status;
    for (const [key, value] of response.headers) outgoing.setHeader(key, value);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  })().catch(error => {
    if (outgoing.destroyed || outgoing.writableEnded) return;
    outgoing.statusCode = error.status === 413 ? 413 : error instanceof SyntaxError || error.status === 400 ? 400 : 500;
    outgoing.setHeader('content-type', 'application/json');
    outgoing.setHeader('cache-control', 'no-store, private');
    outgoing.end(JSON.stringify({ error: outgoing.statusCode === 413 ? 'Request too large.' : 'Request could not be completed.' }));
  });
  return true;
}
