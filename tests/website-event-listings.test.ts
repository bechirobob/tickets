import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getPublicEvents, findCuratedEvent, findPublicRoomEvent } from '../app/events';
import { isWebsiteListedEvent } from '../lib/website-event-listings';
import { registrationSettings } from '../lib/registrations';
import { GET as catalogue } from '../app/api/public/events/route';
import sitemap from '../app/sitemap';

const slug = 'sun-chasers-labadi';

describe('temporary website-only event unlisting', () => {
  it('excludes only the exact requested slug without mutating its source', () => {
    const events = Object.freeze([Object.freeze({ slug }), Object.freeze({ slug: 'another-event' }), Object.freeze({ slug: `${slug}-later` })]);
    expect(events.filter(isWebsiteListedEvent)).toEqual([{ slug: 'another-event' }, { slug: `${slug}-later` }]);
    expect(events).toHaveLength(3);
    expect([].filter(isWebsiteListedEvent)).toEqual([]);
  });

  it('leaves publication, registration, Room and the staff event inventory intact', async () => {
    const record = () => env.DB.prepare('SELECT * FROM curated_event_records WHERE slug = ?').bind(slug).first();
    const before = await record();
    const registrationBefore = await registrationSettings(env.DB, slug);
    const all = await getPublicEvents();
    expect(all.some(event => event.slug === slug)).toBe(true);
    expect(all.filter(isWebsiteListedEvent).some(event => event.slug === slug)).toBe(false);
    expect(all.filter(isWebsiteListedEvent).map(event => event.slug)).toEqual(['the-weekend-braai']);
    expect(await findCuratedEvent(slug)).toMatchObject({ slug, title: 'On The Guest List' });
    expect(await findPublicRoomEvent(slug)).toMatchObject({ title: 'On The Guest List' });
    expect(await registrationSettings(env.DB, slug)).toEqual(registrationBefore);
    expect(await record()).toEqual(before);
    expect(before).toMatchObject({ status: 'published', removed_at: null, archived_at: null });
  });

  it('removes website sitemap discovery but preserves the packaged-app direct-detail catalogue contract', async () => {
    expect((await sitemap()).some(item => item.url.endsWith(`/event/${slug}`))).toBe(false);
    const response = await catalogue();
    expect(response.status).toBe(200);
    const payload = await response.json() as { events: { slug: string }[]; screens: { event: { slug: string } }[] };
    expect(payload.events.some(event => event.slug === slug)).toBe(true);
    expect(payload.screens.some(screen => screen.event.slug === slug)).toBe(true);
    expect(payload.events.map(event => event.slug)).toEqual(payload.screens.map(screen => screen.event.slug));
  });
});
