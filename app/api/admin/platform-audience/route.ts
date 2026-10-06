import { readAdminSession } from "../../../../lib/admin-session";
import { platformAnnouncementEligible } from "../../../../lib/platform-announcements";

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  const headers = { "cache-control": "no-store, private" };
  if (!session || session.role !== "owner" || session.mustChangePassword) {
    return Response.json({ error: "Owner access is required." }, { status: 403, headers });
  }
  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(50, Number.parseInt(url.searchParams.get("limit") ?? "25", 10) || 25));
  const after = (url.searchParams.get("after") ?? "").slice(0, 254);
  const [contacts, summary] = await Promise.all([
    env.DB.prepare(`SELECT s.email, s.consented_at AS consentedAt, s.verified_at AS verifiedAt,
      s.consent_version AS consentVersion, s.source FROM platform_announcement_subscriptions s
      WHERE ${platformAnnouncementEligible} AND s.email > ? ORDER BY s.email LIMIT ?`)
      .bind(after, limit + 1).all<{ email: string; consentedAt: string; verifiedAt: string; consentVersion: string; source: string }>(),
    env.DB.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN ${platformAnnouncementEligible} THEN 1 ELSE 0 END), 0) AS subscribed,
      COALESCE(SUM(CASE WHEN s.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN s.status = 'unsubscribed' THEN 1 ELSE 0 END), 0) AS unsubscribed,
      COALESCE(SUM(CASE WHEN s.status = 'subscribed' AND NOT (${platformAnnouncementEligible}) THEN 1 ELSE 0 END), 0) AS suppressed
      FROM platform_announcement_subscriptions s`).first(),
  ]);
  const rows = contacts.results.slice(0, limit);
  return Response.json({ contacts: rows, summary, nextCursor: contacts.results.length > limit ? rows.at(-1)?.email : null, deliveryEnabled: false }, { headers });
}
