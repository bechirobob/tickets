import { hasPermission, mutationHasValidOrigin, readAdminSession, recordAudit, requestMetadata } from "../../../../lib/admin-session";

export const dynamic = "force-dynamic";

type EventState = "on_sale" | "sold_out" | "cancelled" | "postponed" | "rescheduled";
type TierInput = {
  id?: string;
  code?: string;
  name?: string;
  description?: string;
  priceMinor?: number;
  admissionsPerUnit?: number;
  capacityAdmissions?: number;
  maxUnitsPerOrder?: number;
  status?: "available" | "sold_out" | "hidden";
  salesOpenAt?: string | null;
  salesCloseAt?: string | null;
};

function validDate(value: unknown, optional = false): string | null {
  if (optional && !value) return null;
  const timestamp = new Date(String(value ?? "")).getTime();
  if (!Number.isFinite(timestamp)) throw new Error("Check the event and sales dates.");
  return new Date(timestamp).toISOString();
}

function validUrl(value: unknown): string {
  const url = new URL(String(value ?? ""));
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Add the exact HTTP or HTTPS venue map link.");
  return url.toString();
}

function text(value: unknown, label: string, max: number): string {
  const result = String(value ?? "").trim();
  if (!result || result.length > max) throw new Error(`Check ${label}.`);
  return result;
}

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (!session || !hasPermission(session, "events.manage")) return Response.json({ error: "Curation access is required." }, { status: 403 });
  const [events, tiers] = await Promise.all([
    env.DB.prepare(`
      SELECT id, submission_id AS submissionId, slug, title, venue, venue_map_url AS venueMapUrl,
             area, starts_at AS startsAt, ends_at AS endsAt, vibe,
             price_from_minor AS priceFromMinor, capacity, sales_open_at AS salesOpenAt,
             sales_close_at AS salesCloseAt, age_restriction AS ageRestriction,
             lineup, event_state AS eventState, rescheduled_from AS rescheduledFrom,
             image_url AS imageUrl, curation_note AS curationNote, status,
             scheduled_publish_at AS scheduledPublishAt, published_at AS publishedAt, updated_at AS updatedAt
      FROM curated_event_records ORDER BY starts_at DESC
    `).all<Record<string, unknown>>(),
    env.DB.prepare(`
      SELECT tier.id, tier.event_slug AS eventSlug, tier.code, tier.name, tier.description,
             tier.price_minor AS priceMinor, tier.admissions_per_unit AS admissionsPerUnit,
             tier.capacity_admissions AS capacityAdmissions,
             tier.max_units_per_order AS maxUnitsPerOrder, tier.status,
             tier.sales_open_at AS salesOpenAt, tier.sales_close_at AS salesCloseAt,
             tier.sort_order AS sortOrder,
             COALESCE(SUM(CASE
               WHEN reservation.status = 'consumed' THEN reservation.admission_count
               WHEN reservation.status = 'held' AND reservation.expires_at > ? THEN reservation.admission_count
               ELSE 0 END), 0) AS allocatedAdmissions
      FROM event_ticket_tiers tier
      LEFT JOIN inventory_reservations reservation ON reservation.ticket_tier_id = tier.id
      GROUP BY tier.id ORDER BY tier.event_slug, tier.sort_order, tier.name
    `).bind(new Date().toISOString()).all<Record<string, unknown>>(),
  ]);
  return Response.json({ events: events.results.map((event) => ({ ...event, tiers: tiers.results.filter((tier) => tier.eventSlug === event.slug) })) }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const session = await readAdminSession(request.headers.get("cookie"));
  if (!session || !hasPermission(session, "events.manage")) return Response.json({ error: "Curation access is required." }, { status: 403 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown> & { tiers?: TierInput[] };
    const slug = text(body.slug, "event", 80);
    const startsAt = validDate(body.startsAt)!;
    const endsAt = validDate(body.endsAt)!;
    if (endsAt <= startsAt) throw new Error("The event must end after it starts.");
    const salesOpenAt = validDate(body.salesOpenAt, true);
    const salesCloseAt = validDate(body.salesCloseAt, true) ?? startsAt;
    if (salesOpenAt && salesCloseAt <= salesOpenAt) throw new Error("Ticket sales must close after they open.");
    if (salesCloseAt > startsAt) throw new Error("Ticket sales cannot close after the event starts.");
    const eventState = String(body.eventState ?? "") as EventState;
    if (!["on_sale", "sold_out", "cancelled", "postponed", "rescheduled"].includes(eventState)) throw new Error("Choose a valid event state.");
    if (!Array.isArray(body.tiers) || body.tiers.length < 1 || body.tiers.length > 12) throw new Error("Every event needs between one and twelve ticket tiers.");

    const { env } = await import("cloudflare:workers");
    const current = await env.DB.prepare("SELECT id, submission_id AS submissionId, starts_at AS startsAt, status FROM curated_event_records WHERE slug = ? LIMIT 1")
      .bind(slug).first<{ id: string; submissionId: string; startsAt: string; status: string }>();
    if (!current) return Response.json({ error: "Event not found." }, { status: 404 });
    const existing = await env.DB.prepare("SELECT id, code FROM event_ticket_tiers WHERE event_slug = ?").bind(slug).all<{ id: string; code: string }>();
    const existingIds = new Set(existing.results.map((tier) => tier.id));
    const codes = new Set<string>();
    const now = new Date().toISOString();
    const normalizedTiers = [];

    for (let index = 0; index < body.tiers.length; index += 1) {
      const tier = body.tiers[index];
      const code = text(tier.code, "ticket tier code", 40).toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(code) || codes.has(code)) throw new Error("Ticket tier codes must be unique lower-case words.");
      codes.add(code);
      const id = tier.id && existingIds.has(tier.id) ? tier.id : crypto.randomUUID();
      const priceMinor = Number(tier.priceMinor);
      const admissionsPerUnit = Number(tier.admissionsPerUnit);
      const capacityAdmissions = Number(tier.capacityAdmissions);
      const maxUnitsPerOrder = Number(tier.maxUnitsPerOrder);
      const status = tier.status;
      if (!Number.isInteger(priceMinor) || priceMinor < 0 || priceMinor > 100_000_000) throw new Error("Check each ticket price.");
      if (!Number.isInteger(admissionsPerUnit) || admissionsPerUnit < 1 || admissionsPerUnit > 20) throw new Error("Check admissions per ticket unit.");
      if (!Number.isInteger(capacityAdmissions) || capacityAdmissions < admissionsPerUnit || capacityAdmissions > 100_000) throw new Error("Check each tier capacity.");
      if (!Number.isInteger(maxUnitsPerOrder) || maxUnitsPerOrder < 1 || maxUnitsPerOrder > 20) throw new Error("Check each tier order limit.");
      if (!status || !["available", "sold_out", "hidden"].includes(status)) throw new Error("Check each ticket tier state.");
      const tierUsage = tier.id ? await env.DB.prepare(`
        SELECT COALESCE(SUM(CASE
          WHEN status = 'consumed' THEN admission_count
          WHEN status = 'held' AND expires_at > ? THEN admission_count ELSE 0 END), 0) AS count
        FROM inventory_reservations WHERE ticket_tier_id = ?
      `).bind(now, id).first<{ count: number }>() : null;
      if ((tierUsage?.count ?? 0) > capacityAdmissions) throw new Error(`${text(tier.name, "ticket tier name", 80)} already has more admissions allocated than the new capacity.`);
      normalizedTiers.push({
        id, code, name: text(tier.name, "ticket tier name", 80),
        description: text(tier.description, "ticket tier description", 240),
        priceMinor, admissionsPerUnit, capacityAdmissions, maxUnitsPerOrder, status,
        salesOpenAt: validDate(tier.salesOpenAt, true), salesCloseAt: validDate(tier.salesCloseAt, true),
        sortOrder: index,
      });
    }

    const activeIds = new Set(normalizedTiers.map((tier) => tier.id));
    const visibleTiers = normalizedTiers.filter((tier) => tier.status !== "hidden");
    if (!visibleTiers.length) throw new Error("Keep at least one ticket tier visible.");
    const priceFromMinor = Math.min(...visibleTiers.map((tier) => tier.priceMinor));
    const capacity = normalizedTiers.reduce((sum, tier) => sum + tier.capacityAdmissions, 0);
    const rescheduledFrom = startsAt !== current.startsAt ? current.startsAt : String(body.rescheduledFrom ?? "") || null;
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        UPDATE curated_event_records SET title = ?, venue = ?, venue_map_url = ?, area = ?,
          starts_at = ?, ends_at = ?, vibe = ?, price_from_minor = ?, capacity = ?,
          sales_open_at = ?, sales_close_at = ?, age_restriction = ?, lineup = ?,
          event_state = ?, rescheduled_from = ?, curation_note = ?, updated_at = ?
        WHERE slug = ?
      `).bind(
        text(body.title, "event title", 120), text(body.venue, "venue", 160), validUrl(body.venueMapUrl),
        text(body.area, "area", 80), startsAt, endsAt, text(body.vibe, "event mood", 30),
        priceFromMinor, capacity, salesOpenAt, salesCloseAt, text(body.ageRestriction, "age restriction", 20),
        text(body.lineup, "line-up", 1000), eventState, rescheduledFrom,
        text(body.curationNote, "customer-facing event note", 1800), now, slug,
      ),
      ...normalizedTiers.map((tier) => env.DB.prepare(`
        INSERT INTO event_ticket_tiers (
          id, event_slug, code, name, description, price_minor, admissions_per_unit,
          capacity_admissions, max_units_per_order, status, sales_open_at, sales_close_at,
          sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET code = excluded.code, name = excluded.name,
          description = excluded.description, price_minor = excluded.price_minor,
          admissions_per_unit = excluded.admissions_per_unit,
          capacity_admissions = excluded.capacity_admissions,
          max_units_per_order = excluded.max_units_per_order, status = excluded.status,
          sales_open_at = excluded.sales_open_at, sales_close_at = excluded.sales_close_at,
          sort_order = excluded.sort_order, updated_at = excluded.updated_at
      `).bind(
        tier.id, slug, tier.code, tier.name, tier.description, tier.priceMinor,
        tier.admissionsPerUnit, tier.capacityAdmissions, tier.maxUnitsPerOrder, tier.status,
        tier.salesOpenAt, tier.salesCloseAt, tier.sortOrder, now, now,
      )),
      ...existing.results.filter((tier) => !activeIds.has(tier.id)).map((tier) => env.DB.prepare("UPDATE event_ticket_tiers SET status = 'hidden', updated_at = ? WHERE id = ? AND event_slug = ?").bind(now, tier.id, slug)),
      ...(["cancelled", "postponed"].includes(eventState) ? [
        env.DB.prepare("UPDATE tickets SET status = 'voided' WHERE event_slug = ? AND status = 'issued'").bind(slug),
        env.DB.prepare(`UPDATE ticket_assignments SET status = 'revoked', revoked_at = ? WHERE ticket_id IN (SELECT id FROM tickets WHERE event_slug = ?)`)
          .bind(now, slug),
      ] : [
        env.DB.prepare(`UPDATE tickets SET status = 'issued' WHERE event_slug = ? AND status = 'voided' AND order_id IN (SELECT id FROM orders WHERE status = 'paid')`).bind(slug),
        env.DB.prepare(`UPDATE ticket_assignments SET status = 'active', revoked_at = NULL WHERE ticket_id IN (SELECT tickets.id FROM tickets JOIN orders ON orders.id = tickets.order_id WHERE tickets.event_slug = ? AND orders.status = 'paid')`).bind(slug),
      ]),
      env.DB.prepare(`
        INSERT INTO curation_audit_events (id, submission_id, action, from_status, to_status, note, actor, created_at)
        VALUES (?, ?, 'edit_event_inventory', ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), current.submissionId, current.status, current.status, `Updated ${normalizedTiers.length} ticket tiers and event operations.`, session.actor, now),
    ];
    await env.DB.batch(statements);
    await recordAudit(env.DB, { session, action: "events.inventory_updated", targetType: "event", targetId: slug, outcome: "success", detail: `${normalizedTiers.length} tiers`, requestId: requestMetadata(request).requestId });
    return Response.json({ saved: true, slug, updatedAt: now });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The event could not be saved." }, { status: 400 });
  }
}
