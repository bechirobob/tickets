import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { readRsvpAnalytics, resolveRsvpSource } from '../lib/rsvp-analytics';

describe('RSVP analytics', () => {
  it('counts requests separately from guests, limits the cohort, and deduplicates entry methods', async () => {
    const slug = `report-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const rows = [
      ['qr', 'confirmed', 3, 'instagram', now, 'rsvp'],
      ['both', 'confirmed', 2, 'kofi-bills', now, 'rsvp'],
      ['pending', 'requested', 4, 'becore', now, 'rsvp'],
      ['waiting', 'waitlisted', 2, 'untracked', now, 'rsvp'],
      ['cancelled', 'cancelled', 1, 'untracked', now, 'rsvp'],
      ['declined', 'declined', 1, 'untracked', now, 'rsvp'],
      ['old', 'confirmed', 9, 'untracked', '2020-01-01T00:00:00Z', 'rsvp'],
      ['interest', 'interested', 1, 'instagram', now, 'interest'],
    ] as const;
    for (const [id, status, guests, source, created, kind] of rows) {
      await env.DB.prepare(`INSERT INTO event_registrations (id,event_slug,normalized_email,guest_name,party_size,kind,status,created_at,updated_at,acquisition_source,order_id)
        VALUES (?,?,?,'Guest',?,?,?,?,?,?,?)`).bind(`${slug}-${id}`, slug, `${id}@example.com`, guests, kind, status, created, now, source, `${slug}-order-${id}`).run();
    }
    for (const [id, guests] of [['qr', 1], ['both', 2]] as const) {
      for (let i = 0; i < guests; i++) await env.DB.prepare(`INSERT INTO tickets (id,order_id,event_slug,ticket_type,admission_number,qr_token_hash,status,issued_at,checked_in_at)
        VALUES (?,?,?,'RSVP',?,?,'checked_in',?,?)`).bind(`${slug}-${id}-${i}`,`${slug}-order-${id}`,slug,i+1,`${slug}-hash-${id}-${i}`,now,now).run();
    }
    await env.DB.prepare(`INSERT INTO guest_entries (id,event_slug,guest_name,admission_count,kind,note,status,created_by,created_at,checked_in_at)
      VALUES (?,?,'Guest',2,'guest','', 'checked_in','test',?,?)`).bind(`rsvp:${slug}-both`,slug,now,now).run();
    const result = await readRsvpAnalytics(env.DB, [slug], '2026-01-01T00:00:00Z');
    expect(result.totals).toEqual({ requests: 6, guests: 13, confirmedGuests: 5, checkedIn: 3, awaitingArrival: 2, turnoutPercent: 60 });
    expect(result.sources).toContainEqual(expect.objectContaining({eventSlug:slug, source: 'instagram', label: 'Instagram', requests: 1, guests: 3, confirmedGuests: 3, checkedIn: 1 }));
    expect((await readRsvpAnalytics(env.DB, [slug + '-other'], '2000')).totals.requests).toBe(0);
    expect((await readRsvpAnalytics(env.DB, [], '2000')).totals.turnoutPercent).toBeNull();
    expect((await readRsvpAnalytics(env.DB, [slug], '2000')).totals.confirmedGuests).toBe(14);
    expect(JSON.stringify(result)).not.toContain('@example.com');
  });

  it('accepts only known link sources and active promoters for the exact event', async () => {
    const slug = `source-${crypto.randomUUID()}`;
    await env.DB.prepare(`INSERT INTO event_promoter_codes (id,event_slug,code,label,status,created_at,created_by) VALUES (?,?, 'KOFI','Kofi','active',?,'test')`).bind(slug,slug,new Date().toISOString()).run();
    expect(await resolveRsvpSource(env.DB,slug,'instagram','kofi')).toBe('promoter:KOFI');
    expect(await resolveRsvpSource(env.DB,'other','instagram','KOFI')).toBe('instagram');
    for (const source of [null, {}, '__proto__', 'constructor', 'someone@email.com', '<script>']) expect(await resolveRsvpSource(env.DB,slug,source,null)).toBe('untracked');
    await env.DB.prepare("UPDATE event_promoter_codes SET status='disabled' WHERE id=?").bind(slug).run();
    expect(await resolveRsvpSource(env.DB,slug,null,'KOFI')).toBe('untracked');
  });
});

it('keeps RSVP promoter sources separate across events sharing a code',async()=>{
 const first=`first-${crypto.randomUUID()}`,second=`second-${crypto.randomUUID()}`,now=new Date().toISOString();
 for(const slug of [first,second])await env.DB.prepare("INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,party_size,kind,status,created_at,updated_at,acquisition_source) VALUES(?,?,?,'Guest',1,'rsvp','requested',?,?,'promoter:SAME')").bind(slug,slug,`${slug}@example.com`,now,now).run();
 const result=await readRsvpAnalytics(env.DB,[first,second],'2000');
 expect(result.sources).toHaveLength(2);expect(result.sources.map(row=>row.eventSlug).sort()).toEqual([first,second].sort());expect(result.sources.every(row=>row.requests===1)).toBe(true);
});
