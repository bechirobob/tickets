import { moderateFlashImage, FLASH_MAX_STORED_BYTES, hasValidFlashSignature } from '../../lib/flashes';

type Environment = { AI: Ai; VPS_AI_SIGNING_KEY: string };
export default {
  async fetch(request: Request, env: Environment): Promise<Response> {
    const reject = (status = 404) => new Response('Unavailable', { status, headers: { 'cache-control': 'no-store' } });
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/moderate' || !env.VPS_AI_SIGNING_KEY) return reject();
    const timestamp = request.headers.get('x-bct-timestamp') ?? '';
    const signature = request.headers.get('x-bct-signature') ?? '';
    if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60000 || !/^[a-f0-9]{64}$/.test(signature)) return reject();
    const declared = Number(request.headers.get('content-length'));
    if (declared > FLASH_MAX_STORED_BYTES) return reject(413);
    const reader = request.body?.getReader();
    if (!reader) return reject(400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > FLASH_MAX_STORED_BYTES) { await reader.cancel(); return reject(413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (!size) return reject(400);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.VPS_AI_SIGNING_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify('HMAC', key, Uint8Array.from(signature.match(/../g)!, pair => parseInt(pair, 16)), new TextEncoder().encode(`tickets-moderation-v1\n${timestamp}\n${digest}`));
    if (!valid) return reject();
    if (!['image/jpeg','image/png','image/webp'].some(type => hasValidFlashSignature(bytes, type))) return reject(415);
    // No caller-supplied model, prompt, token limit or provider credential.
    const outcome = await moderateFlashImage(env.AI, bytes);
    if (outcome === 'unavailable') return reject(503);
    return Response.json({ response: outcome === 'allowed' ? 'ALLOW' : 'BLOCK' }, { headers: { 'cache-control': 'no-store' } });
  },
};
