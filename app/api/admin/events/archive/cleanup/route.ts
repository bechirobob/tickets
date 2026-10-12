import { limitRequestBody } from '../../../../../../lib/request-body';
import { hasPermission, mutationHasValidOrigin, readAdminSession } from '../../../../../../lib/admin-session';
import { eventCleanupPreview, protectedGuestList, setEventArchived } from '../../../../../../lib/event-archive';
async function access(request: Request) {
  const { env } = await import('cloudflare:workers');
  const session = await readAdminSession(request.headers.get('cookie'), env.DB);
  return { db: env.DB, session: session?.role === 'owner' && hasPermission(session, 'events.manage') ? session : null };
}
export async function GET(request: Request) {
  const { db, session } = await access(request);
  if (!session) return Response.json({ error: 'Owner access is required.' }, { status: 403 });
  const events = await eventCleanupPreview(db);
  return Response.json({ events: events.slice(0,100), truncated: events.length > 100 }, { headers: { 'cache-control': 'no-store' } });
}
export async function POST(request: Request) {
  const bounded = await limitRequestBody(request);
  if (bounded instanceof Response) return bounded;
  request = bounded;
  const { db, session } = await access(request);
  if (!session || !mutationHasValidOrigin(request)) return Response.json({ error: 'Owner access is required.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { confirmation?: unknown; events?: Array<{slug?:unknown;version?:unknown}> } | null;
  if (body?.confirmation !== 'ARCHIVE OTHER EVENTS' || !Array.isArray(body.events) || !body.events.length || body.events.length > 100
    || body.events.some(item => !item || typeof item.slug !== 'string' || !/^[a-z0-9-]{1,80}$/u.test(item.slug) || typeof item.version !== 'string' || item.version.length > 2000)
    || new Set(body.events.map(item => item.slug)).size !== body.events.length) {
    return Response.json({ error: 'Review and confirm the exact events to archive.' }, { status: 400 });
  }
  const results: Array<{slug:string;archived:boolean;error?:string}> = [];
  for (const item of body.events) {
    const slug = item.slug as string;
    const current = await db.prepare('SELECT id, archived_at AS archivedAt, removed_at AS removedAt FROM curated_event_records WHERE slug=?').bind(slug).first<{id:string;archivedAt:string|null;removedAt:string|null}>();
    if (!current || current.removedAt || current.id === protectedGuestList.id || slug === protectedGuestList.slug) {
      results.push({ slug, archived:false, error:'This event is protected or unavailable.' }); continue;
    }
    if (current.archivedAt) { results.push({ slug, archived:true }); continue; }
    try {
      await setEventArchived(db, session, slug, true, item.version as string);
      results.push({ slug, archived:true });
    } catch {
      results.push({ slug, archived:false, error:'The event changed or has live bookings or unresolved payment work. Review it again.' });
    }
  }
  return Response.json({ results }, { headers: { 'cache-control': 'no-store' } });
}
