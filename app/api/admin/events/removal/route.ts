import { hasPermission, mutationHasValidOrigin, readAdminSession } from '../../../../../lib/admin-session';
import { removalImpact, removeEvent } from '../../../../../lib/event-removal';
import { createApprovalRequest } from '../../../../../lib/operational-finance';
async function access(request: Request) {
  const { env } = await import('cloudflare:workers');
  const session = await readAdminSession(request.headers.get('cookie'), env.DB);
  return { env, session: session && hasPermission(session, 'events.manage') ? session : null };
}
export async function GET(request: Request) {
  const { env, session } = await access(request);
  if (!session) return Response.json({ error: 'Event management access is required.' }, { status: 403 });
  const impact = await removalImpact(env.DB, new URL(request.url).searchParams.get('slug') ?? '');
  if (!impact) return Response.json({ error: 'Event not found.' }, { status: 404 });
  return Response.json({ ...impact, needsApproval: Boolean(impact.eventState !== "cancelled" && impact.upcoming && impact.paidBookings && !impact.removedAt) }, { headers: { 'cache-control': 'no-store' } });
}
export async function POST(request: Request) {
  const { env, session } = await access(request);
  if (!session || !mutationHasValidOrigin(request)) return Response.json({ error: 'Event management access is required.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { slug?: string; reason?: string } | null;
  if (!body?.slug || typeof body.reason !== 'string' || body.reason.trim().length < 8) return Response.json({ error: 'Add a clear removal reason.' }, { status: 400 });
  const impact = await removalImpact(env.DB, body.slug);
  if (!impact) return Response.json({ error: 'Event not found.' }, { status: 404 });
  try {
    if (!impact.removedAt && impact.eventState !== "cancelled" && impact.upcoming && impact.paidBookings) {
      const existing = await env.DB.prepare("SELECT id FROM approval_requests WHERE event_slug = ? AND kind = 'event_cancellation' AND status IN ('pending','executing') LIMIT 1").bind(body.slug).first();
      if (existing) return Response.json({ error: 'This event already has a pending cancellation/removal request. Check Event operations.' }, { status: 409 });
      const approval = await createApprovalRequest(env.DB, session, { kind: 'event_cancellation', eventSlug: body.slug, payload: { reason: body.reason.slice(0, 500), removeEvent: true } });
      return Response.json({ requested: true, approvalId: approval.id }, { status: 202 });
    }
    return Response.json(await removeEvent(env, session, body.slug, false, body.reason));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Removal did not complete. Refresh and retry.' }, { status: 409 }); }
}
