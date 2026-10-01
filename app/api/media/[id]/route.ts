import { hasPermission, readAdminSession } from '../../../../lib/admin-session';

export const dynamic = 'force-dynamic';
const privateHeaders = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { env } = await import('cloudflare:workers');
  // A submission link is not publication authority. Draft, removed and future
  // scheduled artwork remains available only to the curation workspace.
  const media = await env.DB.prepare(`SELECT poster_data AS body, poster_content_type AS type,
    EXISTS (SELECT 1 FROM curated_event_records e WHERE e.submission_id=s.id
      AND e.removed_at IS NULL AND e.is_test_event=0
      AND (e.status='published' OR (e.status='scheduled' AND e.scheduled_publish_at<=?))) AS public
    FROM party_submissions s WHERE s.id=? LIMIT 1`)
    .bind(new Date().toISOString(), id).first<{body: number[] | ArrayBuffer; type: string; public: number}>();
  if (!media?.body || !['image/jpeg','image/png','image/webp'].includes(media.type)) return new Response('Not found', { status:404, headers:privateHeaders });
  if (!media.public) {
    const session = await readAdminSession(request.headers.get('cookie'), env.DB);
    if (!session || !hasPermission(session,'curation.manage')) return new Response('Not found', { status:404, headers:privateHeaders });
  }
  const bytes = media.body instanceof ArrayBuffer ? new Uint8Array(media.body) : Uint8Array.from(media.body);
  return new Response(bytes, { headers: {
    ...privateHeaders, 'content-type':media.type, 'content-length':String(bytes.byteLength),
    // Revalidate public artwork so withdrawal takes effect without a week-long
    // stale-while-revalidate window; private previews must never populate caches.
    'cache-control':media.public ? 'public, max-age=0, must-revalidate' : 'private, no-store',
  } });
}
