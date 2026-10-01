import { expect, it } from 'vitest';
import { publicArtworkPath, securityResponse } from '../worker/security-response';

it('allows packaged clients to embed only flat public event and host artwork', () => {
  for (const path of ['/events/on-the-guest-list.webp', '/events/the-weekend-braai.jpeg', '/events/future-event-12.png', '/hosts/kofi-bills.webp', '/hosts/new-host.jpg']) {
    expect(publicArtworkPath(path), path).toBe(true);
    const response = securityResponse(new Response(null), 'isolated-nonce', path);
    expect(response.headers.get('cross-origin-resource-policy'), path).toBe('cross-origin');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  }
});

it('keeps private, draft, nested, encoded and traversal-looking paths same-origin', () => {
  for (const path of ['', '/', '/api/media/private-photo', '/api/rooms/night/flashes/private', '/api/customer/tickets', '/uploads/drafts/art.webp', '/events/drafts/art.webp', '/hosts/private/avatar.webp', '/events/../api/media/photo.webp', '/events/%2e%2e%2fapi%2fmedia%2fphoto.webp', '/events/%2e%2e/photo.webp', '/events/.private.webp', '/events/photo.webp/extra', '/events/photo.svg', '/events/photo.html', '/events/photo.webp?x=1', '//events/photo.webp', '/not-events/photo.webp']) {
    expect(publicArtworkPath(path), path).toBe(false);
    expect(securityResponse(new Response(null), 'isolated-nonce', path).headers.get('cross-origin-resource-policy'), path).toBe('same-origin');
  }
});


it('preserves only an explicitly published image response at the media route', () => {
  const headers = { 'content-type': 'image/webp', 'cache-control': 'public, max-age=0, must-revalidate', 'cross-origin-resource-policy': 'cross-origin' };
  expect(securityResponse(new Response(null, { headers }), 'fixture', '/api/media/published-id').headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  for (const [path, changes, status] of [
    ['/api/customer/tickets', {}, 200], ['/api/media/id/extra', {}, 200], ['/api/media/%2e%2e', {}, 200],
    ['/api/media/draft-id', { 'cache-control': 'private, no-store' }, 200],
    ['/api/media/denied-id', {}, 404], ['/api/media/json-id', { 'content-type': 'application/json' }, 200],
    ['/api/media/private-id', { 'cross-origin-resource-policy': 'same-origin' }, 200],
    ['/api/media/session-id', { 'set-cookie': 'isolated=fixture' }, 200],
  ] as const) {
    const responseHeaders: Record<string, string> = { ...headers };
    for (const [key, value] of Object.entries(changes)) if (typeof value === 'string') responseHeaders[key] = value;
    expect(securityResponse(new Response(null, { status, headers: responseHeaders }), 'fixture', path).headers.get('cross-origin-resource-policy'), path).toBe('same-origin');
  }
});
