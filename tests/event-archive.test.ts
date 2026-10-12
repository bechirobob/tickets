import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createStaffSession, readAdminSession, hasEventAssignment, type StaffRole } from '../lib/admin-session';
import { GET as deletionImpact, POST as deleteArchive } from '../app/api/admin/events/archive/deletion/route';
import { archivedRemovalImpact } from '../lib/event-removal';
import { GET as cleanupPreview, POST as cleanupEvents } from '../app/api/admin/events/archive/cleanup/route';
import { eventCleanupPreview, protectedGuestList } from '../lib/event-archive';
import { setEventArchived } from '../lib/event-archive';
import { GET as archivedEvents, POST as archiveEvent } from '../app/api/admin/events/archive/route';
import { GET as financeOrders } from '../app/api/admin/orders/route';
import { GET as ordinaryEvents } from '../app/api/admin/events/route';
import { findCuratedEvent, findPublicRoomEvent } from '../app/events';
import { listOrganizerEvents } from '../lib/organizer-records';
import { requireOrganizerEvent } from '../lib/organizer-access';
import { registrationSettings, registrationsOpen } from '../lib/registrations';

async function staff(role: StaffRole = 'owner') {
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO staff_accounts(id,normalized_email,display_name,role,password_hash,password_salt,password_iterations,must_change_password,status,password_changed_at,created_at,created_by,updated_at) VALUES(?,?,'Archive test',?,'test','test',600000,0,'active',?,?,'test',?)`).bind(id, `${id}@example.com`, role, now, now, now).run();
  const cookie = `bct_staff=${await createStaffSession(env.DB, { id })}`;
  return { cookie, session: (await readAdminSession(cookie, env.DB))! };
}
async function event(options: { future?: boolean; test?: boolean; removed?: boolean } = {}) {
  const slug = `archive-${crypto.randomUUID()}`, now = new Date().toISOString();
  const date = options.future ? '2099-10-25T20:00:00.000Z' : '2001-01-01T20:00:00.000Z';
  await env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,image_url,curation_note,status,created_at,updated_at,is_test_event,removed_at)
    VALUES(?,?,?,'Archive candidate','Venue','Accra',?,?,'Late night',10000,'/events/test.webp','Test',?,?,?,?,?)`).bind(slug,slug,slug,date,date,options.removed ? 'unpublished' : 'published',now,now,options.test ? 1 : 0,options.removed ? now : null).run();
  return slug;
}
function request(cookie: string, body?: unknown) {
  return new Request('https://tickets.becoreops.com/api/admin/events/archive', { method: body ? 'POST' : 'GET', headers: { cookie, origin: 'https://tickets.becoreops.com', 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
describe('recoverable owner archive', () => {
  it('hides ordinary public and workspace views, then restores the exact event without destructive state changes', async () => {
    const slug = await event(), owner = await staff();
    expect(await findCuratedEvent(slug)).not.toBeNull();
    await setEventArchived(env.DB, owner.session, slug, true);
    expect(await findCuratedEvent(slug)).toBeNull();
    expect(await findPublicRoomEvent(slug)).toBeNull();
    expect((await listOrganizerEvents(env.DB, owner.session)).some(row => row.slug === slug)).toBe(false);
    expect(await hasEventAssignment(env.DB, owner.session, slug)).toBe(false);
    await expect(requireOrganizerEvent(env.DB, owner.session, slug)).rejects.toThrow();
    const ordinary = await (await ordinaryEvents(request(owner.cookie))).json() as { events: { slug: string }[] };
    expect(ordinary.events.some(row => row.slug === slug)).toBe(false);
    const archive = await (await archivedEvents(request(owner.cookie))).json() as { events: { slug: string }[] };
    expect(archive.events.some(row => row.slug === slug)).toBe(true);
    expect(await env.DB.prepare('SELECT status, removed_at FROM curated_event_records WHERE slug=?').bind(slug).first()).toEqual({ status: 'published', removed_at: null });
    expect(await env.DB.prepare('SELECT 1 FROM event_removal_cleanup WHERE event_slug=?').bind(slug).first()).toBeNull();
    await setEventArchived(env.DB, owner.session, slug, false);
    expect(await findCuratedEvent(slug)).not.toBeNull();
    expect((await listOrganizerEvents(env.DB, owner.session)).some(row => row.slug === slug)).toBe(true);
  });
  it('requires owner access, valid origin and exact per-event confirmation', async () => {
    const slug = await event(), owner = await staff(), curator = await staff('curator');
    expect((await archiveEvent(request(curator.cookie, { slug, action: 'archive', confirmation: slug }))).status).toBe(403);
    expect((await archivedEvents(request(curator.cookie))).status).toBe(403);
    expect((await archiveEvent(request(owner.cookie, { slug, action: 'archive', confirmation: 'another-event' }))).status).toBe(400);
    const badOrigin = request(owner.cookie, { slug, action: 'archive', confirmation: slug });
    badOrigin.headers.set('origin', 'https://example.com');
    expect((await archiveEvent(badOrigin)).status).toBe(403);
    expect((await archiveEvent(request(owner.cookie, { slug, action: 'archive', confirmation: slug }))).status).toBe(200);
    expect((await archiveEvent(request(owner.cookie, { slug, action: 'restore', confirmation: slug }))).status).toBe(200);
  });
  it('protects live real events regardless of legacy identity and refuses removed-event restoration', async () => {
    const owner = await staff();
    await expect(setEventArchived(env.DB, owner.session, await event({ future: true }), true)).rejects.toThrow('Only ended');
    await expect(setEventArchived(env.DB, owner.session, await event({ removed: true }), false)).rejects.toThrow('cannot be restored');
  });
  it('preserves historical paid orders and issued tickets and blocks unsettled payment work', async () => {
    const owner = await staff(), slug = await event(), id = crypto.randomUUID(), now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,ticket_type,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,payment_provider,status,created_at)
      VALUES(?,?,?,'general',1,10000,0,10000,'GHS','guest@example.com','233000000000','mobile_money:mtn','seevplus','payment_pending',?)`).bind(id,`BCT-${id}`,slug,now).run();
    await expect(setEventArchived(env.DB, owner.session, slug, true)).rejects.toThrow('Resolve pending');
    await env.DB.prepare("UPDATE orders SET status='paid' WHERE id=?").bind(id).run();
    await env.DB.prepare("INSERT INTO tickets(id,order_id,event_slug,ticket_type,admission_number,status,qr_token_hash,issued_at) VALUES(?,?,?,'general',1,'issued','fixture-hash',?)").bind(id,id,slug,now).run();
    await setEventArchived(env.DB, owner.session, slug, true);
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id=?').bind(id).first()).toEqual({ status: 'paid' });
    expect(await env.DB.prepare('SELECT status FROM tickets WHERE id=?').bind(id).first()).toEqual({ status: 'issued' });
    const finance = await (await financeOrders(new Request(`https://tickets.becoreops.com/api/admin/orders?event=${slug}`, { headers: { cookie: owner.cookie } }))).json() as { orders: { id: string }[] };
    expect(finance.orders.some(order => order.id === id)).toBe(true);
    await setEventArchived(env.DB, owner.session, slug, false);
  });
  it('rejects a test archive when a live registration arrived before the write', async () => {
    const owner = await staff(), slug = await event({ future: true, test: true }), now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,phone,party_size,kind,status,created_at,updated_at) VALUES(?,?,'guest@example.com','Guest','',1,'rsvp','requested',?,?)`).bind(crypto.randomUUID(),slug,now,now).run();
    await expect(setEventArchived(env.DB, owner.session, slug, true)).rejects.toThrow('Only ended');
    expect(await env.DB.prepare('SELECT archived_at FROM curated_event_records WHERE slug=?').bind(slug).first()).toEqual({ archived_at: null });
  });
  it('allows an empty explicitly marked test but prevents new registration while archived', async () => {
    const owner = await staff(), slug = await event({ future: true, test: true });
    await setEventArchived(env.DB, owner.session, slug, true);
    const settings = await registrationSettings(env.DB, slug);
    expect(settings).not.toBeNull();
    expect(registrationsOpen(settings!)).toBe(false);
  });
});


describe('owner-confirmed archived event content deletion', () => {
  it('rejects nonowners, missing exact confirmation, stale previews, and restored archives', async () => {
    const owner = await staff(), curator = await staff('curator'), slug = await event();
    await setEventArchived(env.DB, owner.session, slug, true);
    const impact = await archivedRemovalImpact(env.DB, slug);
    const body = { slug, confirmation: `DELETE ${slug}`, confirmationVersion: impact!.confirmationVersion, reason: 'Remove obsolete test content' };
    expect((await deleteArchive(request(curator.cookie, body))).status).toBe(403);
    expect((await deletionImpact(new Request(`https://tickets.becoreops.com/api/admin/events/archive/deletion?slug=${slug}`, { headers: { cookie: curator.cookie } }))).status).toBe(403);
    expect((await deleteArchive(request(owner.cookie, { ...body, confirmation: slug }))).status).toBe(400);
    expect((await deleteArchive(request(owner.cookie, { ...body, confirmationVersion: 'stale' }))).status).toBe(409);
    await setEventArchived(env.DB, owner.session, slug, false);
    expect((await deleteArchive(request(owner.cookie, body))).status).toBe(409);
    expect(await env.DB.prepare('SELECT removed_at FROM curated_event_records WHERE slug=?').bind(slug).first()).toEqual({ removed_at: null });
  });
  it('reuses cleanup only for the confirmed archive and retains the event tombstone', async () => {
    const owner = await staff(), slug = await event(), other = await event(), now = new Date().toISOString();
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,phone,party_size,kind,status,created_at,updated_at) VALUES(?,?,'guest@example.com','Guest','',1,'rsvp','requested',?,?)`).bind(id,slug,now,now).run();
    await setEventArchived(env.DB, owner.session, slug, true);
    const preview = await deletionImpact(new Request(`https://tickets.becoreops.com/api/admin/events/archive/deletion?slug=${slug}`, { headers: { cookie: owner.cookie } }));
    expect(preview.status).toBe(200);
    const impact = await preview.json() as { confirmationVersion: string; registrations: number };
    expect(impact.registrations).toBe(1);
    const response = await deleteArchive(request(owner.cookie, { slug, confirmation: `DELETE ${slug}`, confirmationVersion: impact.confirmationVersion, reason: 'Remove obsolete test content' }));
    expect(response.status).toBe(200);
    expect(await env.DB.prepare('SELECT status FROM event_registrations WHERE id=?').bind(id).first()).toEqual({ status: 'cancelled' });
    expect((await env.DB.prepare('SELECT removed_at FROM curated_event_records WHERE slug=?').bind(slug).first<{removed_at:string}>())?.removed_at).toBeTruthy();
    expect(await env.DB.prepare('SELECT removed_at FROM curated_event_records WHERE slug=?').bind(other).first()).toEqual({ removed_at: null });
    expect(await archivedRemovalImpact(env.DB, slug)).toBeNull();
    await expect(setEventArchived(env.DB, owner.session, slug, false)).rejects.toThrow('cannot be restored');
  });
  it('blocks newly arrived payment obligations even with a previously valid preview', async () => {
    const owner = await staff(), slug = await event(), id = crypto.randomUUID(), now = new Date().toISOString();
    await setEventArchived(env.DB, owner.session, slug, true);
    const impact = await archivedRemovalImpact(env.DB, slug);
    await env.DB.prepare(`INSERT INTO orders(id,reference,event_slug,ticket_type,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,payment_provider,status,created_at)
      VALUES(?,?,?,'general',1,10000,0,10000,'GHS','guest@example.com','233000000000','mobile_money:mtn','seevplus','payment_pending',?)`).bind(id,`BCT-${id}`,slug,now).run();
    expect((await deleteArchive(request(owner.cookie, { slug, confirmation: `DELETE ${slug}`, confirmationVersion: impact!.confirmationVersion, reason: 'Remove obsolete test content' }))).status).toBe(409);
    expect(await env.DB.prepare('SELECT status FROM orders WHERE id=?').bind(id).first()).toEqual({status:'payment_pending'});
    expect(await env.DB.prepare('SELECT removed_at FROM curated_event_records WHERE slug=?').bind(slug).first()).toEqual({removed_at:null});
  });
});


describe('reviewed archive-other-events cleanup', () => {
  it('requires owner and exact review confirmation, protects the Guest List and detects changed targets', async () => {
    const owner=await staff(), curator=await staff('curator'), first=await event(), stale=await event(), live=await event({future:true});
    expect((await cleanupPreview(request(curator.cookie))).status).toBe(403);
    const rows=await eventCleanupPreview(env.DB);
    const payload={confirmation:'ARCHIVE OTHER EVENTS',events:[first,stale,live].map(slug=>({slug,version:rows.find(row=>row.slug===slug)!.version}))};
    expect(rows.find(row=>row.slug===live)?.blockedReason).toContain('has not ended');
    expect((await cleanupEvents(request(curator.cookie,payload))).status).toBe(403);
    expect((await cleanupEvents(request(owner.cookie,{...payload,confirmation:'yes'}))).status).toBe(400);
    await env.DB.prepare("UPDATE curated_event_records SET updated_at='changed' WHERE slug=?").bind(stale).run();
    const response=await cleanupEvents(request(owner.cookie,payload));
    const result=await response.json() as {results:Array<{slug:string;archived:boolean}>};
    expect(result.results).toEqual(expect.arrayContaining([{slug:first,archived:true},expect.objectContaining({slug:stale,archived:false}),expect.objectContaining({slug:live,archived:false})]));
    const retry=await (await cleanupEvents(request(owner.cookie,payload))).json() as {results:Array<{slug:string;archived:boolean}>};
    expect(retry.results.find(row=>row.slug===first)?.archived).toBe(true);
    const protectedRow=await env.DB.prepare('SELECT slug FROM curated_event_records WHERE id=? OR slug=?').bind(protectedGuestList.id,protectedGuestList.slug).first<{slug:string}>();
    if(protectedRow) {
      const protectedResult=await (await cleanupEvents(request(owner.cookie,{confirmation:'ARCHIVE OTHER EVENTS',events:[{slug:protectedRow.slug,version:'any'}]}))).json() as {results:Array<{archived:boolean}>};
      expect(protectedResult.results[0].archived).toBe(false);
    }
  });
  it('protects the exact legacy ID even if its slug changes, without protecting every preview-prefixed ID', async () => {
    const owner=await staff(), candidate=await event(), now=new Date().toISOString();
    // The normal migration seeds the protected identity. Rename its slug only
    // inside this isolated test database to prove that protection uses both keys.
    const protectedRow=await env.DB.prepare('SELECT slug FROM curated_event_records WHERE id=?').bind(protectedGuestList.id).first<{slug:string}>();
    expect(protectedRow).not.toBeNull();
    const renamed=`protected-${crypto.randomUUID()}`;
    await env.DB.prepare("UPDATE curated_event_records SET slug=?,is_test_event=1,ends_at='2001-01-01T00:00:00Z',updated_at=? WHERE id=?").bind(renamed,now,protectedGuestList.id).run();
    await env.DB.prepare("UPDATE curated_event_records SET id=? WHERE slug=?").bind(`preview:event:${candidate}`,candidate).run();
    const rows=await eventCleanupPreview(env.DB);
    expect(rows.find(row=>row.slug===renamed)?.blockedReason).toContain('Protected');
    expect(rows.find(row=>row.slug===candidate)?.blockedReason).toBeNull();
    const result=await (await cleanupEvents(request(owner.cookie,{confirmation:'ARCHIVE OTHER EVENTS',events:[renamed,candidate].map(slug=>({slug,version:rows.find(row=>row.slug===slug)!.version}))}))).json() as {results:Array<{slug:string;archived:boolean}>};
    expect(result.results.find(row=>row.slug===renamed)?.archived).toBe(false);
    expect(result.results.find(row=>row.slug===candidate)?.archived).toBe(true);
  });
});


it('keeps eligible old events reachable behind more than one batch of blocked live events', async () => {
  const eligible=await event(), future=await event({future:true});
  await env.DB.batch(Array.from({length:101},()=>{
    const id=`blocked-${crypto.randomUUID()}`;
    return env.DB.prepare(`INSERT INTO curated_event_records(id,submission_id,slug,title,venue,area,starts_at,ends_at,vibe,price_from_minor,image_url,curation_note,status,created_at,updated_at)
      SELECT ?,?,?,title,venue,area,starts_at,ends_at,vibe,price_from_minor,image_url,curation_note,status,created_at,updated_at FROM curated_event_records WHERE slug=?`).bind(id,id,id,future);
  }));
  const preview=await eventCleanupPreview(env.DB);
  expect(preview.slice(0,100).some(row=>row.slug===eligible && !row.blockedReason)).toBe(true);
});
