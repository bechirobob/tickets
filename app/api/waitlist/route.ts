import { mutationHasValidOrigin, requestMetadata } from "../../../lib/admin-session";
import { enforceRateLimit } from "../../../lib/security-controls";
import { hashToken } from "../../../lib/attendee-auth";

export async function POST(request: Request) {
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This waitlist request was not accepted." }, { status: 403 });
  const { env } = await import("cloudflare:workers");
  const body = await request.json() as { eventSlug?: string; ticketTierId?: string; email?: string; phone?: string };
  const eventSlug = body.eventSlug?.trim() ?? "";
  const ticketTierId = body.ticketTierId?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const phone = body.phone?.replace(/[^\d+]/gu, "").slice(0, 40) || null;
  if (!/^[a-z0-9-]{1,80}$/u.test(eventSlug) || !ticketTierId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    return Response.json({ error: "Choose a sold-out ticket and enter a valid email." }, { status: 400 });
  }
  const metadata = requestMetadata(request);
  const allowed = await enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `waitlist:${await hashToken(`${metadata.ip ?? "anonymous"}:${email}`)}`);
  if (!allowed) return Response.json({ error: "Too many waitlist attempts. Give it a minute." }, { status: 429 });
  const tier = await env.DB.prepare(`
    SELECT tier.id, tier.status, tier.capacity_admissions AS capacity,
      event.event_state AS eventState, event.starts_at AS startsAt,
      COALESCE(SUM(CASE WHEN reservation.status = 'consumed' OR
        (reservation.status = 'held' AND reservation.expires_at > ?) THEN reservation.admission_count ELSE 0 END), 0) AS allocated
    FROM event_ticket_tiers tier JOIN curated_event_records event ON event.slug = tier.event_slug
    LEFT JOIN inventory_reservations reservation ON reservation.ticket_tier_id = tier.id
    WHERE tier.id = ? AND tier.event_slug = ? GROUP BY tier.id LIMIT 1
  `).bind(new Date().toISOString(), ticketTierId, eventSlug).first<{ id: string; status: string; capacity: number; eventState: string; startsAt: string; allocated: number }>();
  if (!tier || new Date(tier.startsAt).getTime() <= Date.now()) return Response.json({ error: "That waitlist is closed." }, { status: 404 });
  const soldOut = tier.status === "sold_out" || tier.eventState === "sold_out" || Number(tier.allocated) >= Number(tier.capacity);
  if (!soldOut) return Response.json({ error: "That ticket is available now—no waiting required." }, { status: 409 });
  const now = new Date().toISOString();
  const existing = await env.DB.prepare("SELECT status FROM event_waitlist_entries WHERE event_slug = ? AND normalized_email = ? LIMIT 1").bind(eventSlug, email).first<{ status: string }>();
  if (existing && ["waiting", "offered"].includes(existing.status)) return Response.json({ joined: true, alreadyJoined: true });
  await env.DB.prepare(`
    INSERT INTO event_waitlist_entries (id, event_slug, ticket_tier_id, normalized_email, phone, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'waiting', ?, ?)
    ON CONFLICT(event_slug, normalized_email) DO UPDATE SET ticket_tier_id = excluded.ticket_tier_id,
      phone = excluded.phone, status = 'waiting', offer_token_hash = NULL, offered_at = NULL,
      offer_expires_at = NULL, updated_at = excluded.updated_at
  `).bind(crypto.randomUUID(), eventSlug, ticketTierId, email, phone, now, now).run();
  return Response.json({ joined: true }, { status: 201 });
}
