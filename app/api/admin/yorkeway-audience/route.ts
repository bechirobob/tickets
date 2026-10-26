import { yorkewayEligible } from '../../../../lib/yorkeway-early-access';
import { readAdminSession } from '../../../../lib/admin-session';

export async function GET(request: Request) {
  const { env } = await import('cloudflare:workers');
  const headers = { 'cache-control': 'no-store, private' };
  const session = await readAdminSession(request.headers.get('cookie'), env.DB);
  if (!session || session.role !== 'owner' || session.mustChangePassword) return Response.json({ error: 'Owner access required.' }, { status: 403, headers });
  const after = (new URL(request.url).searchParams.get('after') ?? '').slice(0, 254);
  const result = await env.DB.prepare(`SELECT email, guest_name AS name, consented_at AS consentedAt, consent_version AS consentVersion
    FROM yorkeway_early_access s WHERE ${yorkewayEligible} AND email > ? ORDER BY email LIMIT 26`).bind(after).all();
  const summary = await env.DB.prepare(`SELECT
    COALESCE(SUM(CASE WHEN ${yorkewayEligible} THEN 1 ELSE 0 END),0) AS subscribed,
    COALESCE(SUM(status='pending'),0) AS pending,
    COALESCE(SUM(status='withdrawn'),0) AS withdrawn
    FROM yorkeway_early_access s`).first();
  const rows = result.results.slice(0, 25);
  return Response.json({ contacts: rows, summary, nextCursor: result.results.length > 25 ? rows.at(-1)?.email : null, verified: true, deliveryEnabled: false }, { headers });
}
