import { readAttendeeIdentity } from '../../../../lib/attendee-auth';
import { mutationHasValidOrigin } from '../../../../lib/admin-session';
import { cancelRegistration, promoteRegistrations, readRegistration, registrationSettings, registrationsOpen } from '../../../../lib/registrations';
export async function GET(request: Request) {
  const { env } = await import('cloudflare:workers');
  const identity = await readAttendeeIdentity(env.DB, request.headers.get('cookie'));
  if (!identity) return Response.json({ registrations: [] }, { status: 401, headers: { 'cache-control': 'no-store' } });
  const rows = await env.DB.prepare(`SELECT r.id, r.event_slug AS eventSlug, e.title, r.kind, r.status, r.party_size AS partySize,
    COALESCE(s.mode, CASE WHEN e.schedule_status = 'coming_soon' THEN 'interest' ELSE 'paid' END) AS mode,
    COALESCE(s.max_party_size, 1) AS maxPartySize, COALESCE(s.room_access, 0) AS roomAccess
    FROM event_registrations r JOIN curated_event_records e ON e.slug = r.event_slug LEFT JOIN event_registration_settings s ON s.event_slug = r.event_slug
    WHERE r.attendee_id = ? AND e.removed_at IS NULL ORDER BY r.updated_at DESC LIMIT 100`).bind(identity.attendeeId).all();
  return Response.json({ registrations: rows.results }, { headers: { 'cache-control': 'no-store, private' } });
}
export async function POST(request: Request) {
  if (!mutationHasValidOrigin(request)) return Response.json({ error: 'This registration action was not accepted.' }, { status: 403 });
  const { env } = await import('cloudflare:workers');
  const identity = await readAttendeeIdentity(env.DB, request.headers.get('cookie'));
  if (!identity) return Response.json({ error: 'Open your registration email to continue.' }, { status: 401 });
  const body = await request.json().catch(() => null) as { id?: string; action?: string; partySize?: number } | null;
  const reg = typeof body?.id === 'string' ? await readRegistration(env.DB, body.id) : null;
  if (!body || !reg || reg.attendeeId !== identity.attendeeId) return Response.json({ error: 'Registration not found.' }, { status: 404 });
  try {
    if (body.action === 'cancel') await cancelRegistration(env.DB, reg.id);
    else if (body.action === 'join' && ['interested', 'cancelled'].includes(reg.status)) {
      const s = await registrationSettings(env.DB, reg.eventSlug);
      const partySize = body.partySize ?? 0;
      if (!s || !registrationsOpen(s) || s.mode !== 'rsvp' || s.scheduleStatus !== 'confirmed' || !Number.isInteger(partySize) || partySize < 1 || partySize > s.maxPartySize || (reg.orderId && partySize !== reg.partySize)) throw new Error('RSVP is not available for this group. Check the event details.');
      await env.DB.prepare(`UPDATE event_registrations SET kind = 'rsvp', status = ?, party_size = ?, approved_at = NULL, version = version + 1, created_at = ?, updated_at = ? WHERE id = ? AND status IN ('interested', 'cancelled')`)
        .bind(s.approvalRequired ? 'requested' : 'waitlisted', partySize, new Date().toISOString(), new Date().toISOString(), reg.id).run();
      await promoteRegistrations(env.DB, reg.eventSlug);
    } else throw new Error('Choose an available registration action.');
    return Response.json({ registration: await readRegistration(env.DB, reg.id) }, { headers: { 'cache-control': 'no-store' } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Could not update registration.' }, { status: 409 }); }
}
