import { hasEventAssignment, hasPermission, mutationHasValidOrigin, readAdminSession, recordAudit, requestMetadata } from '../../../../lib/admin-session';
import { cancelRegistration, promoteRegistrations, readRegistration, registrationSettings, registrationShareState, registrationStartConfirmed } from '../../../../lib/registrations';
async function access(request: Request, eventSlug: string) {
  const { env } = await import('cloudflare:workers');
  const session = await readAdminSession(request.headers.get('cookie'), env.DB);
  return { env, session: session && (hasPermission(session, 'events.manage') || hasPermission(session, 'organizer.workspace')) && await hasEventAssignment(env.DB, session, eventSlug) ? session : null };
}
export async function GET(request: Request) {
  const url = new URL(request.url), slug = url.searchParams.get('eventSlug') ?? '';
  const { env, session } = await access(request, slug);
  if (!session) return Response.json({ error: 'This event is not assigned to your account.' }, { status: 403 });
  if (url.searchParams.get('live') === '1') {
    const [counts, paid, latest] = await Promise.all([
      env.DB.prepare("SELECT status,SUM(party_size) AS guests FROM event_registrations WHERE event_slug=? AND status <> 'unverified' GROUP BY status").bind(slug).all<{status:string;guests:number}>(),
      env.DB.prepare("SELECT COALESCE(SUM(quantity),0) AS guests FROM orders WHERE event_slug=? AND payment_provider <> 'rsvp' AND status='paid'").bind(slug).first<{guests:number}>(),
      env.DB.prepare(`SELECT * FROM (SELECT id,guest_name AS name,status,party_size AS guests,updated_at AS updatedAt FROM event_registrations WHERE event_slug=? AND status <> 'unverified'
        UNION ALL SELECT id,COALESCE(customer_name,'Guest') AS name,status,quantity AS guests,paid_at AS updatedAt FROM orders WHERE event_slug=? AND payment_provider <> 'rsvp' AND status='paid') ORDER BY updatedAt DESC,id DESC LIMIT 10`).bind(slug,slug).all(),
    ]);
    const count=(status:string)=>counts.results.find(row=>row.status===status)?.guests??0;
    const sharing=registrationShareState(await registrationSettings(env.DB,slug));
    return Response.json({latest:latest.results,confirmed:count('confirmed'),waiting:count('waitlisted'),requested:count('requested'),interested:count('interested'),paid:paid?.guests??0,sharing},{headers:{'cache-control':'no-store, private'}});
  }
  const offset = Math.max(0, Math.min(100000, Math.floor(Number(url.searchParams.get('offset'))) || 0));
  const status = url.searchParams.get('status') ?? '', query = (url.searchParams.get('q') ?? '').trim().slice(0, 120);
  if (status && !['requested','confirmed','waitlisted','declined','cancelled','interested'].includes(status)) return Response.json({error:'Choose a guest status.'},{status:400});
  const filter = `event_slug = ? AND status <> 'unverified' AND (? = '' OR status = ?) AND (? = '' OR guest_name LIKE ? OR normalized_email LIKE ?)`;
  const values = [slug, status, status, query, `%${query}%`, `%${query}%`];
  const [settings, rows, counts, pricing, total] = await Promise.all([registrationSettings(env.DB, slug),
    env.DB.prepare(`SELECT id, guest_name AS guestName, normalized_email AS email, party_size AS partySize, kind, status, created_at AS createdAt FROM event_registrations WHERE ${filter} ORDER BY created_at DESC, id LIMIT 50 OFFSET ?`).bind(...values, offset).all(),
    env.DB.prepare(`SELECT status, COUNT(*) AS registrations, SUM(party_size) AS guests FROM event_registrations WHERE event_slug = ? AND status <> 'unverified' GROUP BY status`).bind(slug).all(),
    env.DB.prepare("SELECT id,price_minor AS priceMinor,capacity_admissions AS capacity FROM event_ticket_tiers WHERE event_slug=? AND status <> 'hidden' ORDER BY sort_order,id LIMIT 1").bind(slug).first(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM event_registrations WHERE ${filter}`).bind(...values).first<{count:number}>()]);
  return Response.json({ settings, pricing, registrations: rows.results, counts: counts.results, total: total?.count ?? 0, offset }, { headers: { 'cache-control': 'no-store, private' } });
}
export async function POST(request: Request) {
  if (!mutationHasValidOrigin(request)) return Response.json({ error: 'This event action was not accepted.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { eventSlug?: string; action?: string; id?: string; mode?: string; capacity?: number; priceMinor?: number; maxPartySize?: number; approvalRequired?: boolean; roomAccess?: boolean; accepting?: boolean; closesAt?: string | null; notifyHost?: boolean } | null;
  if (typeof body?.eventSlug !== 'string') return Response.json({ error: 'Choose an event.' }, { status: 400 });
  const { env, session } = await access(request, body.eventSlug);
  if (!session) return Response.json({ error: 'This event is not assigned to your account.' }, { status: 403 });
  let auditDetail = "";
  try {
    if (body.action === 'settings') {
      const s = await registrationSettings(env.DB, body.eventSlug);
      if (!s || typeof body.mode !== 'string' || !['paid', 'rsvp', 'interest'].includes(body.mode) || typeof body.capacity !== 'number' || !Number.isInteger(body.capacity) || body.capacity < 0 || body.capacity > 50000 || typeof body.maxPartySize !== 'number' || !Number.isInteger(body.maxPartySize) || body.maxPartySize < 1 || body.maxPartySize > 10 || typeof body.approvalRequired !== 'boolean' || typeof body.roomAccess !== 'boolean') throw new Error('Check the registration settings.');
      if (body.mode === 'rsvp' && (!registrationStartConfirmed(s) || body.capacity < 1)) throw new Error('Confirm the event date, start time and admission capacity before opening RSVP.');
      const count = await env.DB.prepare(`SELECT COALESCE(SUM(party_size),0) AS guests FROM event_registrations WHERE event_slug = ? AND status = 'confirmed'`).bind(body.eventSlug).first<{ guests: number }>();
      if ((count?.guests ?? 0) > body.capacity || ((count?.guests ?? 0) > 0 && body.mode !== 'rsvp')) throw new Error('Keep enough capacity and RSVP access for the confirmed guests.');
      const paid = await env.DB.prepare(`SELECT 1 AS found FROM orders WHERE event_slug = ? AND payment_provider <> 'rsvp' AND status IN ('paid', 'payment_pending') LIMIT 1`).bind(body.eventSlug).first();
      if (paid && body.mode !== 'paid') throw new Error('This event already has paid or pending bookings. Keep its paid ticket mode.');
      const tier = await env.DB.prepare("SELECT id,price_minor AS priceMinor FROM event_ticket_tiers WHERE event_slug=? AND status <> 'hidden' ORDER BY sort_order,id LIMIT 1").bind(body.eventSlug).first<{id:string;priceMinor:number}>();
      const priceMinor = body.priceMinor ?? tier?.priceMinor ?? 0;
      if (body.mode === 'paid' && (!Number.isInteger(priceMinor) || priceMinor < 100 || priceMinor > 10000000 || body.capacity < 1)) throw new Error('Add a paid registration price of at least GHS 1 and an admission capacity.');
      const accepting = body.accepting === undefined ? s.accepting !== 0 : body.accepting;
      const notifyHost = body.notifyHost === undefined ? s.notifyHost !== 0 : body.notifyHost;
      const closesAt = body.closesAt === undefined ? s.closesAt ?? null : body.closesAt;
      if (typeof accepting !== 'boolean' || typeof notifyHost !== 'boolean' || (closesAt !== null && (typeof closesAt !== 'string' || !Number.isFinite(Date.parse(closesAt))))) throw new Error('Check the registration deadline.');
      const deadline = closesAt ? new Date(closesAt).toISOString() : null;
      if (deadline && registrationStartConfirmed(s) && deadline>s.startsAt) throw new Error('Set the registration deadline before the event starts.');
      const stamp = new Date().toISOString();
      const settingStatement = env.DB.prepare(`INSERT INTO event_registration_settings (event_slug, mode, capacity, max_party_size, approval_required, room_access, updated_at, accepting, closes_at, notify_host)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE
          (SELECT COALESCE(SUM(party_size), 0) FROM event_registrations WHERE event_slug = ? AND status = 'confirmed') <= ?
          AND NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_slug = ? AND status IN ('confirmed', 'waitlisted', 'requested') AND (party_size > ? OR ? <> 'rsvp'))
          AND (? = 'paid' OR NOT EXISTS (SELECT 1 FROM orders WHERE event_slug = ? AND payment_provider <> 'rsvp' AND status IN ('paid', 'payment_pending')))
          AND (? <> 'paid' OR (SELECT COALESCE(SUM(admission_count),0) FROM inventory_reservations WHERE ticket_tier_id=? AND (status='consumed' OR (status='held' AND expires_at>?))) <= ?)
        ON CONFLICT(event_slug) DO UPDATE SET mode = excluded.mode, capacity = excluded.capacity, max_party_size = excluded.max_party_size, approval_required = excluded.approval_required, room_access = excluded.room_access, updated_at = excluded.updated_at, accepting=excluded.accepting, closes_at=excluded.closes_at, notify_host=excluded.notify_host`)
        .bind(body.eventSlug, body.mode, body.capacity, body.maxPartySize, body.approvalRequired ? 1 : 0, body.roomAccess ? 1 : 0, stamp, accepting ? 1 : 0, deadline, notifyHost ? 1 : 0, body.eventSlug, body.capacity, body.eventSlug, body.maxPartySize, body.mode, body.mode, body.eventSlug,body.mode,tier?.id??"",stamp,body.capacity);
      const pricingStatements = body.mode !== 'paid' ? [] : [
        tier ? env.DB.prepare(`UPDATE event_ticket_tiers SET price_minor=?,capacity_admissions=?,updated_at=? WHERE id=? AND EXISTS (SELECT 1 FROM event_registration_settings WHERE event_slug=? AND updated_at=?)`).bind(priceMinor,body.capacity,stamp,tier.id,body.eventSlug,stamp)
        : env.DB.prepare(`INSERT INTO event_ticket_tiers (id,event_slug,code,name,description,price_minor,admissions_per_unit,capacity_admissions,max_units_per_order,status,sort_order,created_at,updated_at)
          SELECT ?,?,'registration','Registration','One admission',?,1,?,?,'available',0,?,? WHERE EXISTS (SELECT 1 FROM event_registration_settings WHERE event_slug=? AND updated_at=?)
          ON CONFLICT(id) DO UPDATE SET price_minor=excluded.price_minor,capacity_admissions=excluded.capacity_admissions,status='available',updated_at=excluded.updated_at`)
          .bind(`${body.eventSlug}-registration`,body.eventSlug,priceMinor,body.capacity,body.maxPartySize,stamp,stamp,body.eventSlug,stamp),
        env.DB.prepare(`UPDATE curated_event_records SET price_from_minor=(SELECT MIN(price_minor) FROM event_ticket_tiers WHERE event_slug=? AND status <> 'hidden'),capacity=(SELECT SUM(capacity_admissions) FROM event_ticket_tiers WHERE event_slug=? AND status <> 'hidden'),updated_at=? WHERE slug=? AND EXISTS (SELECT 1 FROM event_registration_settings WHERE event_slug=? AND updated_at=?)`).bind(body.eventSlug,body.eventSlug,stamp,body.eventSlug,body.eventSlug,stamp),
      ];
      const [saved] = await env.DB.batch([settingStatement,...pricingStatements]);
      auditDetail = `Entry changed from ${s.mode} to ${body.mode}; capacity ${body.capacity}${body.mode === 'paid' ? `; base price GHS ${(priceMinor/100).toFixed(2)}` : ''}; ${accepting ? 'open' : 'closed'}${deadline ? ` until ${deadline}` : ''}; host email alerts ${notifyHost ? 'on' : 'off'}.`;
      if (saved.meta.changes !== 1) throw new Error('Existing bookings need the current entry mode, party size or capacity. Refresh and check the guest list.');
      if (!body.roomAccess) await env.THE_ROOM.getByName(body.eventSlug).refreshAdmissionAccess();
      if (!body.approvalRequired) await env.DB.prepare("UPDATE event_registrations SET status = 'waitlisted', version = version + 1, updated_at = ? WHERE event_slug = ? AND status = 'requested'").bind(new Date().toISOString(), body.eventSlug).run();
    } else {
      const reg = typeof body.id === 'string' ? await readRegistration(env.DB, body.id) : null;
      if (!reg || reg.eventSlug !== body.eventSlug) throw new Error('Registration not found.');
      if (body.action === 'cancel') await cancelRegistration(env.DB, reg.id);
      else if (body.action === 'approve') await env.DB.prepare(`UPDATE event_registrations SET approved_at = ?, status = 'waitlisted', version = version + 1, updated_at = ? WHERE id = ? AND kind = 'rsvp' AND status = 'requested'`).bind(new Date().toISOString(), new Date().toISOString(), reg.id).run();
      else if (body.action === 'decline') await env.DB.prepare(`UPDATE event_registrations SET status = 'declined', version = version + 1, updated_at = ? WHERE id = ? AND status IN ('requested', 'waitlisted')`).bind(new Date().toISOString(), reg.id).run();
      else throw new Error('Choose an available action.');
    }
    await promoteRegistrations(env.DB, body.eventSlug);
    await recordAudit(env.DB, { session, action: `registrations.${body.action}`, targetType: 'event', targetId: body.eventSlug, outcome: 'success', detail: auditDetail || `Guest ${body.id ?? ''}: ${body.action}.`, requestId: requestMetadata(request).requestId });
    return Response.json({ saved: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Registration could not be updated.' }, { status: 409 }); }
}
