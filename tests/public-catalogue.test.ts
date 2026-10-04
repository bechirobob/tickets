import { env } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { GET } from '../app/api/public/events/route';
import type { PublicCatalogue } from '../lib/public-event';

describe('packaged app public catalogue', () => {
  it('returns only real listings, redacts pending dates and excludes private inventory', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.has('access-control-allow-credentials')).toBe(false);
    expect(response.headers.has('set-cookie')).toBe(false);
    const catalogue = await response.json() as PublicCatalogue;
    expect(catalogue.version).toBe(1);
    expect(catalogue.events.map(event => event.slug)).toEqual(['the-weekend-braai', 'sun-chasers-labadi']);
    expect(catalogue.events.every(event => event.isVerified)).toBe(true);
    expect(catalogue.events[1]).toMatchObject({ startsAt: null, fullDate: 'October · Coming soon', ticketsAvailable: false });
    expect(catalogue.events[0]).toMatchObject({ priceFromMinor: 35000, ticketsAvailable: false });
    expect(JSON.stringify(catalogue)).not.toMatch(/bookingFeeBasisPoints|remainingAdmissions|capacity|customer|token_hash/);
    expect(JSON.stringify({ events: catalogue.events, screens: catalogue.screens })).not.toContain('2026-10-04');
  });
  it('keeps a pending event date private when the catalogue refreshes on that date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T12:00:00.000Z'));
    try {
      const catalogue = await (await GET()).json() as PublicCatalogue;
      expect(catalogue.updatedAt).toBe('2026-10-04T12:00:00.000Z');
      expect(catalogue.events.find(event => event.slug === 'sun-chasers-labadi')).toMatchObject({
        startsAt: null, fullDate: 'October · Coming soon', time: 'Time to be announced', scheduleStatus: 'coming_soon',
      });
      expect(catalogue.screens?.find(screen => screen.event.slug === 'sun-chasers-labadi')?.event).toMatchObject({
        startsAt: null, endsAt: null, fullDate: 'October · Coming soon', shortDate: 'October · Coming soon', time: 'Time to be announced', scheduleStatus: 'coming_soon',
      });
      expect(JSON.stringify({ events: catalogue.events, screens: catalogue.screens })).not.toContain('2026-10-04');
    } finally { vi.useRealTimers(); }
  });
  it('excludes test events even when explicitly published', async () => {
    await env.DB.prepare("UPDATE curated_event_records SET status = 'published' WHERE slug = 'after-dark-osu'").run();
    const data = await (await GET()).json() as PublicCatalogue;
    expect(data.events.some(event => event.slug === 'after-dark-osu')).toBe(false);
  });
  it('reports an unavailable database as an error, not an empty catalogue', async () => {
    const db = vi.spyOn(env.DB, 'prepare').mockImplementation(() => { throw new Error('offline'); });
    try {
      const response = await GET();
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('no-store');
    } finally { db.mockRestore(); }
  });
});
