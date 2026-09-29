import { describe, it, expect, vi } from 'vitest';
import worker from '../ops/moderation/worker';

async function signed(bytes: Uint8Array<ArrayBuffer>, secret: string, timestamp = Date.now().toString()) {
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`tickets-moderation-v1\n${timestamp}\n${digest}`))), byte => byte.toString(16).padStart(2, '0')).join('');
  return new Request('https://example.test/moderate', { method: 'POST', headers: { 'x-bct-timestamp': timestamp, 'x-bct-signature': signature }, body: bytes });
}
describe('restricted VPS photo safety connection', () => {
  const secret = 'synthetic-moderation-secret';
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1]);
  it('rejects unsigned, wrong-key, expired and oversized requests before calling AI', async () => {
    const run = vi.fn(); const env = { AI: { run } as unknown as Ai, VPS_AI_SIGNING_KEY: secret };
    expect((await worker.fetch(new Request('https://example.test/moderate', { method: 'POST' }), env)).status).toBe(404);
    expect((await worker.fetch(await signed(bytes, 'wrong-key'), env)).status).toBe(404);
    expect((await worker.fetch(await signed(bytes, secret, String(Date.now() - 120000)), env)).status).toBe(404);
    expect((await worker.fetch(await signed(new Uint8Array(512 * 1024 + 1), secret), env)).status).toBe(413);
    expect(run).not.toHaveBeenCalled();
  });
  it('uses the existing fixed moderation policy and preserves allow/block/fail-closed decisions', async () => {
    const run = vi.fn().mockResolvedValue({ response: 'ALLOW' }); const env = { AI: { run } as unknown as Ai, VPS_AI_SIGNING_KEY: secret };
    const response = await worker.fetch(await signed(bytes, secret), env);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ response: 'ALLOW' });
    expect(run.mock.calls[0][0]).toBe('@cf/meta/llama-3.2-11b-vision-instruct');
    expect(run.mock.calls[0][1].max_tokens).toBe(4);
    run.mockResolvedValue({ response: 'BLOCK' });
    expect(await (await worker.fetch(await signed(bytes, secret), env)).json()).toEqual({ response: 'BLOCK' });
    run.mockResolvedValue({ response: 'unknown' });
    expect((await worker.fetch(await signed(bytes, secret), env)).status).toBe(503);
  });
});
