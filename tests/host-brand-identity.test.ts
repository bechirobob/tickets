import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { GET } from '../app/api/public/events/route';
import { findEventHosts, findHostBySlug, findPrimaryHost, listEventHosts, listHostEventSlugs } from '../lib/event-experience';
import type { CustomerEventScreen } from '../lib/customer-screen';
import type { PublicCatalogue } from '../lib/public-event';

const yorkeIdentity = {
  id: 'host:kofi-bills', slug: 'kofi-bills', name: 'Kofi Bills',
  brandName: 'The Yorke Way', brandLogoUrl: '/hosts/the-yorke-way.svg',
  city: 'Accra', verificationStatus: 'verified', profileImageUrl: '/hosts/kofi-bills.webp',
};
const publicHostKeys = ['slug', 'name', 'role', 'city', 'verificationStatus', 'profileImageUrl', 'brandName', 'brandLogoUrl'].sort();

async function createEvent(): Promise<string> {
  const id = crypto.randomUUID(), slug = `brand-regression-${id}`;
  await env.DB.prepare(`INSERT INTO curated_event_records (
    id, submission_id, slug, title, venue, area, starts_at, ends_at, vibe,
    price_from_minor, capacity, image_url, curation_note, status, created_at, updated_at,
    is_test_event, lineup, age_restriction, schedule_status
  ) SELECT ?, ?, ?, 'A future independently named event', venue, area,
    '2099-10-25T14:00:00.000Z', '2099-10-25T22:00:00.000Z', vibe,
    price_from_minor, capacity, image_url, 'The organiser’s event copy stays intact.',
    'published', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0,
    'Original artist and organiser credits', age_restriction, 'confirmed'
    FROM curated_event_records WHERE slug = 'sun-chasers-labadi'`).bind(id, id, slug).run();
  return slug;
}

async function createHost(name: string): Promise<string> {
  const id = `host:${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT INTO hosts (id, slug, name, bio, city, verification_status,
    profile_image_url, full_name, instagram_handle, snapchat_handle, created_at, updated_at)
    VALUES (?, ?, ?, 'Unrelated host biography', 'Kumasi', 'reviewed', '/hosts/another-portrait.webp',
      'Unrelated full name', 'another.instagram', 'another.snapchat', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .bind(id, id.slice(5), name).run();
  return id;
}

async function linkHost(eventSlug: string, hostId: string, role = 'Host', isPrimary = false) {
  await env.DB.prepare(`INSERT INTO event_hosts (event_slug, host_id, role, is_primary, created_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`).bind(eventSlug, hostId, role, Number(isPrimary)).run();
}

async function publicCatalogue(): Promise<PublicCatalogue> {
  const response = await GET();
  expect(response.status).toBe(200);
  return await response.json() as PublicCatalogue;
}

function findScreen(catalogue: PublicCatalogue, slug: string): CustomerEventScreen {
  const screen = catalogue.screens?.find(screen => screen.event.slug === slug);
  expect(screen).toBeDefined();
  return screen!;
}

describe('host-owned brand identity', () => {
  it('loads the migrated brand without replacing the verified person, portrait or social profiles', async () => {
    expect(await findHostBySlug(env.DB, 'kofi-bills')).toMatchObject({
      ...yorkeIdentity, fullName: 'Henry Yorke', instagramHandle: 'mr.yorke',
      snapchatHandle: 'kofi_billz123', role: 'Host',
    });
    expect((await findHostBySlug(env.DB, 'kofi-bills'))?.bio).toContain('Henry Yorke, better known as Kofi Bills');
  });

  it('projects the brand through every existing relation and keeps primary-host lookups compatible', async () => {
    const linkedSlugs = await listHostEventSlugs(env.DB, yorkeIdentity.id);
    expect(linkedSlugs.length).toBeGreaterThan(0);
    const primaryMap = await listEventHosts(env.DB, linkedSlugs);
    for (const slug of linkedSlugs) {
      const hosts = await findEventHosts(env.DB, slug);
      expect(hosts.find(host => host.id === yorkeIdentity.id), slug).toMatchObject(yorkeIdentity);
      expect(await findPrimaryHost(env.DB, slug), slug).toEqual(hosts[0]);
      expect(primaryMap.get(slug), slug).toMatchObject(hosts[0]);
    }
  });

  it('inherits the profile brand when a future event is linked without copying it onto the event', async () => {
    const slug = await createEvent();
    const before = await env.DB.prepare('SELECT * FROM curated_event_records WHERE slug = ?').bind(slug).first();
    await linkHost(slug, yorkeIdentity.id, 'Organiser', true);
    expect(await findEventHosts(env.DB, slug)).toEqual([expect.objectContaining({ ...yorkeIdentity, role: 'Organiser' })]);
    expect(await findPrimaryHost(env.DB, slug)).toMatchObject({ ...yorkeIdentity, role: 'Organiser' });
    expect((await listEventHosts(env.DB, [slug])).get(slug)).toMatchObject(yorkeIdentity);
    expect(await listHostEventSlugs(env.DB, yorkeIdentity.id)).toContain(slug);
    expect(await env.DB.prepare('SELECT * FROM curated_event_records WHERE slug = ?').bind(slug).first()).toEqual(before);
  });

  it('includes branded secondary hosts and orders primary first, then remaining hosts by name', async () => {
    const slug = await createEvent();
    const primary = await createHost('Zuri Primary'), alphabetic = await createHost('Ama Co-host');
    await linkHost(slug, yorkeIdentity.id, 'Co-host');
    await linkHost(slug, alphabetic, 'Music host');
    await linkHost(slug, primary, 'Lead host', true);
    const hosts = await findEventHosts(env.DB, slug);
    expect(hosts.map(host => [host.id, host.role])).toEqual([
      [primary, 'Lead host'], [alphabetic, 'Music host'], [yorkeIdentity.id, 'Co-host'],
    ]);
    expect(hosts[2]).toMatchObject(yorkeIdentity);
    expect(await findPrimaryHost(env.DB, slug)).toEqual(hosts[0]);
    expect((await listEventHosts(env.DB, [slug])).get(slug)).toMatchObject(hosts[0]);
  });

  it('does not invent brands for other hosts and handles missing profiles and relationships', async () => {
    const slug = await createEvent(), id = await createHost('Independent Host');
    const profile = await findHostBySlug(env.DB, id.slice(5));
    expect(profile).toMatchObject({ name: 'Independent Host', brandName: null, brandLogoUrl: null });
    await linkHost(slug, id, 'Host', true);
    expect(await findEventHosts(env.DB, slug)).toEqual([expect.objectContaining({ id, brandName: null, brandLogoUrl: null })]);
    expect(await findHostBySlug(env.DB, 'missing-profile')).toBeNull();
    expect(await findHostBySlug(env.DB, "kofi-bills' OR 1=1")).toBeNull();
    expect(await findEventHosts(env.DB, 'missing-event')).toEqual([]);
    expect(await findPrimaryHost(env.DB, 'missing-event')).toBeNull();
    expect(await listEventHosts(env.DB, [])).toEqual(new Map());
    expect(await listEventHosts(env.DB, ['missing-event'])).toEqual(new Map());
  });
});

describe('public brand projection', () => {
  it('exposes every co-host with only display fields and leaves event data and organizer relationships unchanged', async () => {
    const slug = await createEvent(), primary = await createHost('Zuri Primary');
    await linkHost(slug, primary, 'Lead host', true);
    await linkHost(slug, yorkeIdentity.id, 'Co-host');
    const beforeEvent = await env.DB.prepare('SELECT * FROM curated_event_records WHERE slug = ?').bind(slug).first();
    const beforeLinks = await env.DB.prepare('SELECT * FROM event_hosts WHERE event_slug = ? ORDER BY host_id').bind(slug).all();
    const screen = findScreen(await publicCatalogue(), slug);
    expect(screen.host?.slug).toBe(primary.slice(5));
    expect(screen.hosts).toHaveLength(2);
    expect(screen.host).toEqual(screen.hosts?.[0]);
    expect(screen.hosts?.[1]).toEqual({
      slug: yorkeIdentity.slug, name: yorkeIdentity.name, role: 'Co-host', city: yorkeIdentity.city,
      verificationStatus: yorkeIdentity.verificationStatus, profileImageUrl: yorkeIdentity.profileImageUrl,
      brandName: yorkeIdentity.brandName, brandLogoUrl: yorkeIdentity.brandLogoUrl,
    });
    for (const host of [screen.host, ...screen.hosts!]) expect(Object.keys(host!).sort()).toEqual(publicHostKeys);
    expect(screen.event).toMatchObject({
      slug, title: 'A future independently named event', lineup: 'Original artist and organiser credits',
      note: 'The organiser’s event copy stays intact.',
    });
    expect(await env.DB.prepare('SELECT * FROM curated_event_records WHERE slug = ?').bind(slug).first()).toEqual(beforeEvent);
    expect((await env.DB.prepare('SELECT * FROM event_hosts WHERE event_slug = ? ORDER BY host_id').bind(slug).all()).results).toEqual(beforeLinks.results);
    expect(JSON.stringify(screen.hosts)).not.toMatch(/fullName|instagram|snapchat|createdAt|updatedAt|bio|host:kofi-bills/);
  });

  it('does not infer host relationships or brands from event titles and artist credits', async () => {
    const slug = await createEvent();
    await env.DB.prepare('UPDATE curated_event_records SET title = ?, lineup = ? WHERE slug = ?')
      .bind('The Yorke Way night', 'Kofi Bills and Henry Yorke', slug).run();
    const screen = findScreen(await publicCatalogue(), slug);
    expect(screen.host).toBeNull();
    expect(screen.hosts).toEqual([]);
  });
});
