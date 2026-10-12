import { limitRequestBody } from '../../../../../../lib/request-body';
import { hasPermission, mutationHasValidOrigin, readAdminSession } from '../../../../../../lib/admin-session';
import { archivedRemovalImpact, removeEvent } from '../../../../../../lib/event-removal';

async function access(request: Request) {
  const { env } = await import('cloudflare:workers');
  const session = await readAdminSession(request.headers.get('cookie'), env.DB);
  return { env, session: session?.role === 'owner' && hasPermission(session, 'events.manage') ? session : null };
}
export async function GET(request: Request) {
  const { env, session } = await access(request);
  if (!session) return Response.json({ error: 'Owner access is required.' }, { status: 403 });
  const impact = await archivedRemovalImpact(env.DB, new URL(request.url).searchParams.get('slug') ?? '');
  if (!impact) return Response.json({ error: 'Archived event not found.' }, { status: 404 });
  return Response.json(impact, { headers: { 'cache-control': 'no-store' } });
}
export async function POST(request: Request) {
  const bounded = await limitRequestBody(request);
  if (bounded instanceof Response) return bounded;
  request = bounded;
  const { env, session } = await access(request);
  if (!session || !mutationHasValidOrigin(request)) return Response.json({ error: 'Owner access is required.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { slug?: unknown; confirmation?: unknown; confirmationVersion?: unknown; reason?: unknown } | null;
  if (typeof body?.slug !== 'string' || !/^[a-z0-9-]{1,80}$/u.test(body.slug)
    || body.confirmation !== `DELETE ${body.slug}` || typeof body.confirmationVersion !== 'string'
    || typeof body.reason !== 'string' || body.reason.trim().length < 8 || body.reason.length > 500) {
    return Response.json({ error: 'Review this event, type its exact deletion confirmation and give a reason.' }, { status: 400 });
  }
  const impact = await archivedRemovalImpact(env.DB, body.slug);
  if (!impact || !impact.eligible || impact.confirmationVersion !== body.confirmationVersion) {
    return Response.json({ error: 'The archive or its bookings changed. Review the deletion impact again. Pending payments, refunds and disputes must be resolved first.' }, { status: 409 });
  }
  try {
    return Response.json(await removeEvent(env, session, body.slug, false, body.reason, body.confirmationVersion));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Deletion did not finish. Check event status before retrying.' }, { status: 409 });
  }
}
