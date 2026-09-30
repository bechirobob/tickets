import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { GET } from '../app/api/public/events/route';
import { eventArtworkPath, eventSpecialGuest } from '../lib/event-guest';
import { rsvpGuestGuidance } from '../lib/registration-guidance';
import { createRegistrationDraftStore } from '../lib/registration-draft';
import type { PublicCatalogue } from '../lib/public-event';

describe('guest expectations follow event state', () => {
  it('keeps drafts scoped to the exact event and mode, without storing consent', () => {
    const drafts = createRegistrationDraftStore();
    const input = { guestName: 'Ama', email: 'ama@example.com', phone: '', partySize: '2', acceptedTerms: true, announcementsOptIn: true };
    drafts.save('night-one', 'rsvp', input);
    expect(drafts.read('night-one', 'rsvp')).toEqual({ guestName: 'Ama', email: 'ama@example.com', phone: '', partySize: '2' });
    expect(drafts.read('night-two', 'rsvp')).toBeUndefined();
    expect(drafts.read('night-one', 'interest')).toBeUndefined();
    const restored = drafts.read('night-one', 'rsvp')!;
    restored.email = 'different@example.com';
    expect(drafts.read('night-one', 'rsvp')?.email).toBe('ama@example.com');
    drafts.clear('night-one', 'rsvp');
    expect(drafts.read('night-one', 'rsvp')).toBeUndefined();
  });
  it('bounds the number of drafts kept in tab memory', () => {
    const drafts = createRegistrationDraftStore();
    for (let index = 0; index < 11; index++) drafts.save(`night-${index}`, 'rsvp', { guestName: '', email: '', phone: '', partySize: '1' });
    expect(drafts.read('night-0', 'rsvp')).toBeUndefined();
    expect(drafts.read('night-10', 'rsvp')).toBeDefined();
  });
  it('keeps host approval and an unpublished date explicit without granting a place or Room', () => {
    const guidance = rsvpGuestGuidance({ approvalRequired: true, schedulePending: true, roomAccess: false });
    expect(guidance.beforeRequest).toContain('host reviews each request');
    expect(guidance.form).toContain('isn’t confirmed yet');
    expect(guidance.schedule).toContain('still to be announced');
    expect(guidance.schedule).not.toMatch(/2 PM|10 PM|October \d/);
    expect(guidance.room).toBe('The Room isn’t included with this RSVP.');
  });
  it('explains capacity and only promises enabled Room access after confirmation', () => {
    const guidance = rsvpGuestGuidance({ approvalRequired: false, schedulePending: false, roomAccess: true });
    expect(guidance.beforeRequest).toContain('waitlist');
    expect(guidance.schedule).toBeNull();
    expect(guidance.room).toContain('confirmed RSVP');
    expect(guidance.room).toContain('when it’s open');
  });
  it('does not guess Room entitlement for an older cached app projection', () => {
    expect(rsvpGuestGuidance({ approvalRequired: true, schedulePending: true }).room).toBeNull();
  });
  it('uses the existing approved guest treatment only for its matching event and artwork', () => {
    expect(eventSpecialGuest({ slug: 'sun-chasers-labadi', image: '/events/on-the-guest-list.webp' })).toEqual({ name: 'Cuppy', role: 'Special Guest DJ' });
    expect(eventSpecialGuest({ slug: 'another-night', image: '/events/on-the-guest-list.webp' })).toBeNull();
    expect(eventSpecialGuest({ slug: 'sun-chasers-labadi', image: '/events/replacement.webp' })).toBeNull();
    expect(eventSpecialGuest({ slug: 'sun-chasers-labadi', image: 'https://tickets.becoreops.com/events/on-the-guest-list.webp' })).toEqual({ name: 'Cuppy', role: 'Special Guest DJ' });
    expect(eventSpecialGuest({ slug: 'sun-chasers-labadi', image: 'https://elsewhere.example/events/on-the-guest-list.webp' })).toBeNull();
    expect(eventArtworkPath('https://tickets.becoreops.com/events/the-weekend-braai.jpeg')).toBe('/events/the-weekend-braai.jpeg');
    expect(eventArtworkPath('https://images.unsplash.com/photo')).toBeNull();
  });
  it.each([0, 1])('projects the saved Room flag %i for web and app without exposing private settings', async roomAccess => {
    await env.DB.prepare(`INSERT INTO event_registration_settings (event_slug, mode, capacity, max_party_size, room_access, updated_at)
      VALUES ('sun-chasers-labadi', 'rsvp', 25, 1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(event_slug) DO UPDATE SET room_access = excluded.room_access`).bind(roomAccess).run();
    const response = await GET();
    expect(response.status).toBe(200);
    const catalogue = await response.json() as PublicCatalogue;
    const screen = catalogue.screens?.find(screen => screen.event.slug === 'sun-chasers-labadi');
    expect(screen?.registration?.roomAccess).toBe(Boolean(roomAccess));
    expect(screen?.event.startsAt).toBeNull();
    expect(screen?.event.endsAt).toBeNull();
    expect(screen?.event.fullDate).toBe('October · Coming soon');
    expect(JSON.stringify(screen)).not.toMatch(/capacity|normalized_email|token_hash|notifyHost|2026-10-04/);
  });
});
