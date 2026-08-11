import { hasPermission, mutationHasValidOrigin, readAdminSession, recordAudit, requestMetadata } from "../../../../lib/admin-session";

async function access(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  return { env, session: session && hasPermission(session, "events.manage") ? session : null };
}

export async function GET(request: Request) {
  const { env, session } = await access(request);
  if (!session) return Response.json({ error: "Curation access is required." }, { status: 403 });
  const [events, codes] = await Promise.all([
    env.DB.prepare("SELECT slug, title FROM curated_event_records ORDER BY starts_at DESC").all(),
    env.DB.prepare(`
      SELECT code.id, code.event_slug AS eventSlug, event.title AS eventTitle, code.code, code.label, code.status,
        code.created_at AS createdAt, COUNT(orders.id) AS orderCount,
        COALESCE(SUM(CASE WHEN orders.status IN ('paid', 'refund_pending', 'refunded') THEN orders.total_amount_minor ELSE 0 END), 0) AS grossMinor
      FROM event_promoter_codes code JOIN curated_event_records event ON event.slug = code.event_slug
      LEFT JOIN orders ON orders.event_slug = code.event_slug AND orders.promoter_code = code.code
      GROUP BY code.id ORDER BY code.created_at DESC
    `).all(),
  ]);
  return Response.json({ events: events.results, codes: codes.results }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const { env, session } = await access(request);
  if (!session) return Response.json({ error: "Curation access is required." }, { status: 403 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This promoter action was not accepted." }, { status: 403 });
  const body = await request.json() as { action?: string; id?: string; eventSlug?: string; code?: string; label?: string };
  const now = new Date().toISOString();
  if (body.action === "create") {
    const eventSlug = body.eventSlug?.trim() ?? "";
    const code = body.code?.trim().toUpperCase().replace(/[^A-Z0-9_-]/gu, "").slice(0, 32) ?? "";
    const label = body.label?.trim().slice(0, 100) ?? "";
    if (!eventSlug || code.length < 2 || !label) return Response.json({ error: "Choose an event, label and code." }, { status: 400 });
    await env.DB.prepare(`INSERT INTO event_promoter_codes (id, event_slug, code, label, status, created_at, created_by) VALUES (?, ?, ?, ?, 'active', ?, ?)`)
      .bind(crypto.randomUUID(), eventSlug, code, label, now, session.actor).run();
    await recordAudit(env.DB, { session, action: "promoter.created", targetType: "event", targetId: eventSlug, outcome: "success", detail: code, requestId: requestMetadata(request).requestId });
    return Response.json({ created: true }, { status: 201 });
  }
  if (body.action === "toggle") {
    const result = await env.DB.prepare("UPDATE event_promoter_codes SET status = CASE status WHEN 'active' THEN 'disabled' ELSE 'active' END WHERE id = ?").bind(body.id ?? "").run();
    if (result.meta.changes !== 1) return Response.json({ error: "Promoter link not found." }, { status: 404 });
    return Response.json({ updated: true });
  }
  return Response.json({ error: "Choose a valid promoter action." }, { status: 400 });
}
