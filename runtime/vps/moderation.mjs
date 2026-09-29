import { createHash, createHmac } from 'node:crypto';
export function createModerationBinding(values) {
  return { async run(model, input) {
    if (values.VPS_AI_URL && values.VPS_AI_SIGNING_KEY) {
      if (model !== '@cf/meta/llama-3.2-11b-vision-instruct' || !Array.isArray(input?.image) || !input.image.length || input.image.length > 512 * 1024 || input.image.some(value => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error('Invalid photo safety request.');
      const url = new URL(values.VPS_AI_URL);
      if (url.protocol !== 'https:' || url.username || url.password || url.hostname !== 'becore-tickets-moderation.becoreops.workers.dev' || url.pathname !== '/moderate' || url.search || url.hash) throw new Error('Invalid photo safety destination.');
      const bytes = Buffer.from(input.image);
      const timestamp = Date.now().toString();
      const digest = createHash('sha256').update(bytes).digest('hex');
      const signature = createHmac('sha256', values.VPS_AI_SIGNING_KEY).update(`tickets-moderation-v1\n${timestamp}\n${digest}`).digest('hex');
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-bct-timestamp': timestamp, 'x-bct-signature': signature }, body: bytes, signal: AbortSignal.timeout(20000), redirect: 'error' });
      if (!response.ok) throw new Error('Photo safety provider is unavailable.');
      const result = await response.json();
      if (!['ALLOW', 'BLOCK'].includes(result?.response)) throw new Error('Photo safety provider returned an invalid response.');
      return result;
    }
    if (!values.CLOUDFLARE_AI_TOKEN || !values.CLOUDFLARE_ACCOUNT_ID) throw new Error('Photo safety provider is unavailable.');
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${values.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`, {
      method: 'POST', headers: { authorization: `Bearer ${values.CLOUDFLARE_AI_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(input), signal: AbortSignal.timeout(20000), redirect: 'error',
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error('Photo safety provider is unavailable.');
    return result.result;
  } };
}
