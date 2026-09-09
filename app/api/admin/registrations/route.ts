import { hasEventAssignment, hasPermission, mutationHasValidOrigin, readAdminSession, recordAudit, requestMetadata } from '../../../../lib/admin-session';
import { cancelRegistration, promoteRegistrations, readRegistration, registrationSettings } from '../../../../lib/registrations';
async function access(request: Request, eventSlug: string) {
  const { env } = await import('cloudflare:workers');
  const session = await readAdminSession(request.headers.get('cookie'), env.DB);
  return { env, session: session && (hasPermission(session, 'events.manage') || hasPermission(session, 'organizer.workspace')) && await hasEventAssignment(env.DB, session, eventSlug) ? session : null };
}
export async function GET(request: Request) {
  const url = new URL(request.url), slug = url.searchParams.get('eventSlug') ?? '';
  const { env, session } = await access(request, slug);
  if (!session) return Response.json({ error: 'This event is not assigned to your account.' }, { status: 403 });
  const offset = Math.max(0, Math.min(100000, Math.floor(Number(url.searchParams.get('offset'))) || 0));
  const [settings, rows, counts] = await Promise.all([registrationSettings(env.DB, slug),
    env.DB.prepare(`SELECT id, guest_name AS guestName, normalized_email AS email, party_size AS partySize, kind, status, created_at AS createdAt FROM event_registrations WHERE event_slug = ? AND status <> 'unverified' ORDER BY created_at, id LIMIT 50 OFFSET ?`).bind(slug, offset).all(),
    env.DB.prepare(`SELECT status, COUNT(*) AS registrations, SUM(party_size) AS guests FROM event_registrations WHERE event_slug = ? AND status <> 'unverified' GROUP BY status`).bind(slug).all()]);
  return Response.json({ settings, registrations: rows.results, counts: counts.results, offset }, { headers: { 'cache-control': 'no-store, private' } });
}
export async function POST(request: Request) {
  if (!mutationHasValidOrigin(request)) return Response.json({ error: 'This event action was not accepted.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { eventSlug?: string; action?: string; id?: string; mode?: string; capacity?: number; maxPartySize?: number; approvalRequired?: boolean; roomAccess?: boolean } | null;
  if (typeof body?.eventSlug !== 'string') return Response.json({ error: 'Choose an event.' }, { status: 400 });
  const { env, session } = await access(request, body.eventSlug);
  if (!session) return Response.json({ error: 'This event is not assigned to your account.' }, { status: 403 });
  try {
    if (body.action === 'settings') {
      const s = await registrationSettings(env.DB, body.eventSlug);
      if (!s || typeof body.mode !== 'string' || !['paid', 'rsvp', 'interest'].includes(body.mode) || typeof body.capacity !== 'number' || !Number.isInteger(body.capacity) || body.capacity < 0 || body.capacity > 50000 || typeof body.maxPartySize !== 'number' || !Number.isInteger(body.maxPartySize) || body.maxPartySize < 1 || body.maxPartySize > 10 || typeof body.approvalRequired !== 'boolean' || typeof body.roomAccess !== 'boolean') throw new Error('Check the registration settings.');
      if (body.mode === 'rsvp' && (s.scheduleStatus !== 'confirmed' || body.capacity < 1)) throw new Error('Confirm the event date and admission capacity before opening RSVP.');
      const count = await env.DB.prepare(`SELECT COALESCE(SUM(party_size),0) AS guests FROM event_registrations WHERE event_slug = ? AND status = 'confirmed'`).bind(body.eventSlug).first<{ guests: number }>();
      if ((count?.guests ?? 0) > body.capacity || ((count?.guests ?? 0) > 0 && body.mode !== 'rsvp')) throw new Error('Keep enough capacity and RSVP access for the confirmed guests.');
      const paid = await env.DB.prepare(`SELECT 1 AS found FROM orders WHERE event_slug = ? AND payment_provider <> 'rsvp' AND status IN ('paid', 'payment_pending') LIMIT 1`).bind(body.eventSlug).first();
      if (paid && body.mode !== 'paid') throw new Error('This event already has paid or pending bookings. Keep its paid ticket mode.');
      const saved = await env.DB.prepare(`INSERT INTO event_registration_settings (event_slug, mode, capacity, max_party_size, approval_required, room_access, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE
          (SELECT COALESCE(SUM(party_size), 0) FROM event_registrations WHERE event_slug = ? AND status = 'confirmed') <= ?
          AND NOT EXISTS (SELECT 1 FROM event_registrations WHERE event_slug = ? AND status IN ('confirmed', 'waitlisted', 'requested') AND (party_size > ? OR ? <> 'rsvp'))
          AND (? = 'paid' OR NOT EXISTS (SELECT 1 FROM orders WHERE event_slug = ? AND payment_provider <> 'rsvp' AND status IN ('paid', 'payment_pending')))
        ON CONFLICT(event_slug) DO UPDATE SET mode = excluded.mode, capacity = excluded.capacity, max_party_size = excluded.max_party_size, approval_required = excluded.approval_required, room_access = excluded.room_access, updated_at = excluded.updated_at`)
        .bind(body.eventSlug, body.mode, body.capacity, body.maxPartySize, body.approvalRequired ? 1 : 0, body.roomAccess ? 1 : 0, new Date().toISOString(), body.eventSlug, body.capacity, body.eventSlug, body.maxPartySize, body.mode, body.mode, body.eventSlug).run();
      if (saved.meta.changes !== 1) throw new Error('Existing bookings need the current entry mode, party size or capacity. Refresh and check the guest list.');
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
    await recordAudit(env.DB, { session, action: `registrations.${body.action}`, targetType: 'event', targetId: body.eventSlug, outcome: 'success', requestId: requestMetadata(request).requestId });
    return Response.json({ saved: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Registration could not be updated.' }, { status: 409 }); }
}
