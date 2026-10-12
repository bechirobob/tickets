import { limitRequestBody } from '../../../../../lib/request-body';
import { hasPermission, mutationHasValidOrigin, readAdminSession } from '../../../../../lib/admin-session';
import { setEventArchived } from '../../../../../lib/event-archive';

async function access(request: Request) {
  const { env } = await import('cloudflare:workers');
  const session = await readAdminSession(request.headers.get('cookie'), env.DB);
  return { db: env.DB, session: session?.role === 'owner' && hasPermission(session, 'events.manage') ? session : null };
}
export async function GET(request: Request) {
  const { db, session } = await access(request);
  if (!session) return Response.json({ error: 'Owner access is required.' }, { status: 403 });
  const events = await db.prepare(`SELECT slug, title, archived_at AS archivedAt FROM curated_event_records
    WHERE archived_at IS NOT NULL AND removed_at IS NULL ORDER BY archived_at DESC`).all();
  return Response.json({ events: events.results }, { headers: { 'cache-control': 'no-store' } });
}
export async function POST(request: Request) {
  const bounded = await limitRequestBody(request);
  if (bounded instanceof Response) return bounded;
  request = bounded;
  const { db, session } = await access(request);
  if (!session || !mutationHasValidOrigin(request)) return Response.json({ error: 'Owner access is required.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { slug?: unknown; action?: unknown; confirmation?: unknown } | null;
  if (typeof body?.slug !== 'string' || !['archive', 'restore'].includes(String(body.action)) || body.confirmation !== body.slug) {
    return Response.json({ error: 'Confirm the exact event before continuing.' }, { status: 400 });
  }
  try {
    return Response.json(await setEventArchived(db, session, body.slug, body.action === 'archive'));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'The archive could not be updated.' }, { status: 409 });
  }
}
