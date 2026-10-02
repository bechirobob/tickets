import { expect, test } from './analytics-fixture';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

test.use({ serviceWorkers: 'block' });
test.skip(Boolean(process.env.E2E_BASE_URL) && process.env.GITHUB_EVENT_NAME === 'pull_request', 'Cross-origin artwork is verified against the candidate before the deployed release.');

test('public catalogue artwork genuinely loads from a separate browser origin without opening private APIs', async ({ page, request, baseURL }, info) => {
  const paths = ['/events/on-the-guest-list.webp', '/hosts/kofi-bills.webp'];
  for (const path of paths) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toMatch(/^image\//);
    // Cloudflare's static asset layer may bypass the Worker; an absent CORP
    // header is already embeddable. The VPS wrapper's exact policy has its own gate.
    expect([undefined, 'cross-origin']).toContain(response.headers()['cross-origin-resource-policy']);
    expect(response.headers()['access-control-allow-credentials']).toBeUndefined();
  }
  for (const path of ['/api/customer/tickets', '/api/media/isolated-audit-no-such-image']) {
    const response = await request.get(path);
    expect(response.headers()['cross-origin-resource-policy']).toBe('same-origin');
  }
  const images = paths.map((path, i) => `<img src="${new URL(path, baseURL!).href}" alt="Public artwork ${i + 1}" width="220">`).join('');
  // Serve a real loopback document on a distinct port. A route.fulfill-only
  // localhost document has no resolved address space; Chromium correctly blocks
  // its attempt to reach loopback before CORP can be exercised. Keep browser
  // security unchanged and let the actual candidate serve every image byte.
  const fixture = createServer((incoming, response) => {
    if (incoming.method !== 'GET' || incoming.url !== '/') { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`<!doctype html><html lang="en"><title>Public artwork contract</title><body><h1>Public artwork from a separate origin</h1>${images}</body></html>`);
  });
  await new Promise<void>((resolve, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', resolve); });
  try {
    const fixtureOrigin = `http://127.0.0.1:${(fixture.address() as AddressInfo).port}`;
    expect(fixtureOrigin).not.toBe(new URL(baseURL!).origin);
    await page.goto(fixtureOrigin);
    await expect(page.locator('img')).toHaveCount(2);
    await expect.poll(() => page.locator('img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.screenshot({ path: info.outputPath('cross-origin-public-artwork.png'), fullPage: true });
  } finally {
    fixture.closeAllConnections();
    await new Promise<void>((resolve, reject) => fixture.close(error => error ? reject(error) : resolve()));
  }
});
