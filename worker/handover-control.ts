// Dormant until an operator arms tracking. Leases never expire automatically:
// an interrupted invocation must be reconciled, not assumed to have finished.
export class HandoverPaused extends Error {
  constructor() { super('Service handover is in progress.'); }
}

export const controlSchema = [
  "CREATE TABLE IF NOT EXISTS _bct_handover_admission(id INTEGER PRIMARY KEY CHECK(id=1),phase TEXT NOT NULL CHECK(phase IN ('active','paused','frozen','transferred')),transfer_id TEXT NOT NULL,paused_at TEXT)",
  "INSERT OR IGNORE INTO _bct_handover_admission VALUES(1,'active','',NULL)",
  "CREATE TABLE IF NOT EXISTS _bct_handover_operations(id TEXT PRIMARY KEY,kind TEXT NOT NULL,started_at TEXT NOT NULL)",
];

export function requireTransfer(value: string): void {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) throw new Error('Invalid transfer identity.');
}

export async function enterHandoverOperation(env: Cloudflare.Env, kind: string): Promise<() => Promise<void>> {
  if (env.HANDOVER_TRACKING !== '1') return async () => {};
  const id = crypto.randomUUID();
  const result = await env.DB.prepare("INSERT INTO _bct_handover_operations(id,kind,started_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM _bct_handover_admission WHERE id=1 AND phase='active')")
    .bind(id, kind, new Date().toISOString()).run();
  if (result.meta.changes !== 1) throw new HandoverPaused();
  return async () => { await env.DB.prepare('DELETE FROM _bct_handover_operations WHERE id=?').bind(id).run(); };
}

export async function trackedOperation<T>(env: Cloudflare.Env, kind: string, operation: () => Promise<T>): Promise<T> {
  const release = await enterHandoverOperation(env, kind);
  try { return await operation(); } finally { await release(); }
}

export function handoverResponse(): Response {
  return Response.json({ error: 'We’re moving things over. Please try again shortly.' }, {
    status: 503, headers: { 'retry-after': '60', 'cache-control': 'no-store' },
  });
}

// Covers both deferred work and streamed responses; returning response headers
// alone is not evidence that a request has finished its database/provider work.
export async function trackedFetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext,
  handler: (request: Request, env: Cloudflare.Env, ctx: ExecutionContext) => Promise<Response>): Promise<Response> {
  if (env.HANDOVER_TRACKING !== '1') return handler(request, env, ctx);
  let release: () => Promise<void>;
  try { release = await enterHandoverOperation(env, 'http'); }
  catch (error) { if (error instanceof HandoverPaused) return handoverResponse(); throw error; }
  const pending: Promise<unknown>[] = [];
  const trackedContext = new Proxy(ctx, { get(target, key) {
    if (key === 'waitUntil') return (promise: Promise<unknown>) => { pending.push(Promise.resolve(promise)); target.waitUntil(promise); };
    const value = Reflect.get(target, key, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const finish = async () => {
    // A deferred task can schedule additional deferred work.
    for (let offset = 0; offset < pending.length;) {
      const end = pending.length; await Promise.allSettled(pending.slice(offset, end)); offset = end;
    }
    await release();
  };
  try {
    const response = await handler(request, env, trackedContext);
    if (!response.body || response.status === 101) { ctx.waitUntil(finish()); return response; }
    const reader = response.body.getReader();
    let finished = false;
    const complete = () => { if (!finished) { finished = true; ctx.waitUntil(finish()); } };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) { controller.close(); complete(); } else controller.enqueue(next.value);
        } catch (error) { controller.error(error); complete(); }
      },
      async cancel(reason) { try { await reader.cancel(reason); } finally { complete(); } },
    });
    return new Response(body, response);
  } catch (error) { ctx.waitUntil(finish()); throw error; }
}
