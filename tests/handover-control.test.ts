import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { controlSchema, enterHandoverOperation, HandoverPaused, trackedFetch, trackedOperation } from '../worker/handover-control';

const tracked = { ...env, HANDOVER_TRACKING: '1' } as Cloudflare.Env;
beforeEach(async () => {
  await env.DB.batch(controlSchema.map(sql => env.DB.prepare(sql)));
  await env.DB.prepare('DELETE FROM _bct_handover_operations').run();
  await env.DB.prepare("UPDATE _bct_handover_admission SET phase='active',transfer_id='',paused_at=NULL").run();
});
async function count() { return (await env.DB.prepare('SELECT COUNT(*) AS n FROM _bct_handover_operations').first<{ n: number }>())!.n; }
async function pause() { await env.DB.prepare("UPDATE _bct_handover_admission SET phase='paused'").run(); }

describe('handover admission and drain', () => {
  it('stops new operations atomically while preserving outstanding work without automatic expiry', async () => {
    const release = await enterHandoverOperation(tracked, 'existing');
    await pause();
    await expect(enterHandoverOperation(tracked, 'late')).rejects.toBeInstanceOf(HandoverPaused);
    await env.DB.prepare("UPDATE _bct_handover_operations SET started_at='2000-01-01T00:00:00Z'").run();
    expect(await count()).toBe(1);
    await release(); expect(await count()).toBe(0);
  });
  it('releases failed operations and never executes denied side effects', async () => {
    await expect(trackedOperation(tracked, 'failure', async () => { throw new Error('synthetic'); })).rejects.toThrow('synthetic');
    expect(await count()).toBe(0);
    await pause(); let called = false;
    await expect(trackedOperation(tracked, 'denied', async () => { called = true; })).rejects.toBeInstanceOf(HandoverPaused);
    expect(called).toBe(false);
  });
  it('holds HTTP admission through streaming and deferred work', async () => {
    const waits: Promise<unknown>[] = [];
    const ctx = { waitUntil(promise: Promise<unknown>) { waits.push(promise); } } as ExecutionContext;
    let finishBackground!: () => void;
    const background = new Promise<void>(resolve => { finishBackground = resolve; });
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const response = await trackedFetch(new Request('https://test/'), tracked, ctx, async (_request, _env, trackedCtx) => {
      trackedCtx.waitUntil(background);
      return new Response(new ReadableStream({ start(controller) { stream = controller; } }));
    });
    expect(await count()).toBe(1);
    await pause();
    const denied = await trackedFetch(new Request('https://test/'), tracked, ctx, async () => { throw new Error('must not run'); });
    expect(denied.status).toBe(503); expect(denied.headers.get('retry-after')).toBe('60');
    stream.enqueue(new TextEncoder().encode('complete')); stream.close();
    expect(await response.text()).toBe('complete');
    expect(await count()).toBe(1);
    finishBackground(); await Promise.all(waits);
    expect(await count()).toBe(0);
  });
  it('does not access handover tables when dormant', async () => {
    await pause();
    expect(await trackedOperation({ ...tracked, HANDOVER_TRACKING: undefined }, 'normal', async () => 'ok')).toBe('ok');
    expect(await count()).toBe(0);
  });
});
