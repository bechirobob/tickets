import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { findHostBySlug, findPrimaryHost } from '../lib/event-experience';
import { GET } from '../app/api/public/events/route';
import type { PublicCatalogue } from '../lib/public-event';

describe('owner-confirmed Kofi Bills public verification', () => {
  it('uses the same verified status for profile, event and shared app catalogue', async () => {
    expect(await findHostBySlug(env.DB, 'kofi-bills')).toMatchObject({ id: 'host:kofi-bills', slug: 'kofi-bills', name: 'Kofi Bills', verificationStatus: 'verified' });
    expect(await findPrimaryHost(env.DB, 'sun-chasers-labadi')).toMatchObject({ id: 'host:kofi-bills', verificationStatus: 'verified' });
    const catalogue = await (await GET()).json() as PublicCatalogue;
    expect(catalogue.screens?.find(screen => screen.event.slug === 'sun-chasers-labadi')?.host).toMatchObject({ slug: 'kofi-bills', verificationStatus: 'verified' });
  });
  it('does not promote an unreviewed target or an id whose public slug changed', async () => {
    const migration = env.TEST_MIGRATIONS.find(migration => migration.name === '0059_kofi_bills_verified_host.sql')!;
    const original = await env.DB.prepare("SELECT verification_status,slug FROM hosts WHERE id='host:kofi-bills'").first<{verification_status:string;slug:string}>();
    try {
      for (const [status, slug] of [['unverified', 'kofi-bills'], ['reviewed', 'kofi-bills-renamed']] as const) {
        await env.DB.prepare('UPDATE hosts SET verification_status=?,slug=? WHERE id=?').bind(status,slug,'host:kofi-bills').run();
        const before = await env.DB.prepare("SELECT * FROM hosts WHERE id='host:kofi-bills'").first();
        for (const query of migration.queries) await env.DB.prepare(query).run();
        expect(await env.DB.prepare("SELECT * FROM hosts WHERE id='host:kofi-bills'").first()).toEqual(before);
      }
    } finally {
      await env.DB.prepare('UPDATE hosts SET verification_status=?,slug=? WHERE id=?').bind(original!.verification_status,original!.slug,'host:kofi-bills').run();
    }
  });
  it('targets the exact identity, is repeatable and leaves other hosts and permissions untouched', async () => {
    await env.DB.prepare("UPDATE hosts SET verification_status='reviewed' WHERE id='host:kofi-bills'").run();
    await env.DB.prepare(`INSERT INTO hosts (id,slug,name,bio,city,verification_status,created_at,updated_at)
      VALUES ('host:other-kofi','other-kofi','Kofi Bills','','Accra','reviewed',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).run();
    const othersBefore = await env.DB.prepare("SELECT * FROM hosts WHERE id <> 'host:kofi-bills' ORDER BY id").all();
    const accountsBefore = await env.DB.prepare('SELECT * FROM staff_accounts ORDER BY id').all();
    const assignmentsBefore = await env.DB.prepare('SELECT * FROM staff_event_assignments ORDER BY account_id,event_slug').all();
    const linksBefore = await env.DB.prepare('SELECT * FROM event_hosts ORDER BY event_slug,host_id').all();
    const migration = env.TEST_MIGRATIONS.find(migration => migration.name === '0059_kofi_bills_verified_host.sql');
    expect(migration).toBeDefined();
    for (const query of migration!.queries) await env.DB.prepare(query).run();
    const once = await env.DB.prepare("SELECT * FROM hosts WHERE id='host:kofi-bills'").first();
    for (const query of migration!.queries) await env.DB.prepare(query).run();
    expect(await env.DB.prepare("SELECT * FROM hosts WHERE id='host:kofi-bills'").first()).toEqual(once);
    expect(once).toMatchObject({ verification_status: 'verified' });
    expect((await env.DB.prepare("SELECT * FROM hosts WHERE id <> 'host:kofi-bills' ORDER BY id").all()).results).toEqual(othersBefore.results);
    expect((await env.DB.prepare('SELECT * FROM staff_accounts ORDER BY id').all()).results).toEqual(accountsBefore.results);
    expect((await env.DB.prepare('SELECT * FROM staff_event_assignments ORDER BY account_id,event_slug').all()).results).toEqual(assignmentsBefore.results);
    expect((await env.DB.prepare('SELECT * FROM event_hosts ORDER BY event_slug,host_id').all()).results).toEqual(linksBefore.results);
  });
});
