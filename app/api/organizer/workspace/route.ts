import {
  hasPermission,
  mutationHasValidOrigin,
  normalizeStaffEmail,
  readAdminSession,
  recordAudit,
  requestMetadata,
} from "../../../../lib/admin-session";
import { resolveRoomPolicy } from "../../../../lib/room-policy";

async function organizer(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  return { env, session: session && hasPermission(session, "organizer.workspace") ? session : null };
}

async function assigned(db: D1Database, session: NonNullable<Awaited<ReturnType<typeof organizer>>["session"]>, slug: string) {
  if (!/^[a-z0-9-]{1,80}$/u.test(slug)) return false;
  if (session.role === "owner") return true;
  const access = await db.prepare(`
    SELECT 1 AS allowed
    FROM curated_event_records event
    LEFT JOIN party_submissions submission ON submission.id = event.submission_id
    WHERE event.slug = ? AND (
      EXISTS (
        SELECT 1 FROM staff_event_assignments assignment
        WHERE assignment.account_id = ? AND assignment.event_slug = event.slug
      )
      OR submission.contact_email = ?
    )
    LIMIT 1
  `).bind(slug, session.accountId, session.email).first<{ allowed: number }>();
  return Boolean(access?.allowed);
}

export async function GET(request: Request) {
  const { env, session } = await organizer(request);
  if (!session) return Response.json({ error: "Organiser access is required." }, { status: 403 });
  const scope = session.role === "owner" ? "" : `WHERE (
    EXISTS (
      SELECT 1 FROM staff_event_assignments assignment
      WHERE assignment.account_id = ? AND assignment.event_slug = event.slug
    )
    OR submission.contact_email = ?
  )`;
  const statement = env.DB.prepare(`
    SELECT event.slug, event.title, event.venue, event.venue_map_url AS venueMapUrl, event.area,
           event.starts_at AS startsAt, event.ends_at AS endsAt, event.lineup, event.event_state AS eventState,
           event.capacity, event.status, submission.status AS submissionStatus, submission.created_at AS submittedAt,
           COALESCE((SELECT COUNT(*) FROM orders WHERE orders.event_slug = event.slug AND orders.status = 'paid'), 0) AS paidOrders,
           COALESCE((SELECT SUM(total_amount_minor) FROM orders WHERE orders.event_slug = event.slug AND orders.status = 'paid'), 0) AS grossMinor,
           COALESCE((SELECT COUNT(*) FROM tickets WHERE tickets.event_slug = event.slug AND tickets.status IN ('issued','checked_in')), 0) AS issuedAdmissions,
           COALESCE((SELECT COUNT(*) FROM tickets WHERE tickets.event_slug = event.slug AND tickets.status = 'checked_in'), 0) AS checkedInAdmissions
    FROM curated_event_records event
    LEFT JOIN party_submissions submission ON submission.id = event.submission_id
    ${scope}
    ORDER BY event.starts_at DESC
  `);
  const submissionStatement = env.DB.prepare(`
    SELECT id, organizer_name AS organizerName, title, status, review_note AS reviewNote,
           event_slug AS eventSlug, starts_at AS startsAt, created_at AS createdAt, updated_at AS updatedAt
    FROM party_submissions
    ${session.role === "owner" ? "" : "WHERE contact_email = ?"}
    ORDER BY created_at DESC
    LIMIT 250
  `);
  const [events, submissions] = await Promise.all([
    session.role === "owner" ? statement.all<Record<string, unknown>>() : statement.bind(session.accountId, session.email).all<Record<string, unknown>>(),
    session.role === "owner" ? submissionStatement.all<Record<string, unknown>>() : submissionStatement.bind(session.email).all<Record<string, unknown>>(),
  ]);
  const slugs = events.results.map((event) => String(event.slug));
  if (!slugs.length) return Response.json({ events: [], submissions: submissions.results, tiers: [], settlements: [], requests: [], gateStaff: [], attendeeAnswers: [] }, { headers: { "cache-control": "no-store" } });
  const placeholders = slugs.map(() => "?").join(",");
  const now = new Date().toISOString();
  const [tiers, settlements, requests, gateStaff, attendeeAnswers] = await Promise.all([
    env.DB.prepare(`SELECT tier.id, tier.event_slug AS eventSlug, tier.name, tier.price_minor AS priceMinor, tier.capacity_admissions AS capacityAdmissions,
      tier.status, COALESCE(SUM(CASE WHEN reservation.status = 'consumed' OR (reservation.status = 'held' AND reservation.expires_at > ?) THEN reservation.admission_count ELSE 0 END), 0) AS allocatedAdmissions
      FROM event_ticket_tiers tier LEFT JOIN inventory_reservations reservation ON reservation.ticket_tier_id = tier.id
      WHERE tier.event_slug IN (${placeholders}) GROUP BY tier.id ORDER BY tier.event_slug, tier.sort_order`).bind(now, ...slugs).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT id, event_slug AS eventSlug, period_start AS periodStart, period_end AS periodEnd, gross_minor AS grossMinor,
      booking_fees_minor AS bookingFeesMinor, refunds_minor AS refundsMinor, net_ticket_sales_minor AS netTicketSalesMinor, currency, status
      FROM event_settlements WHERE event_slug IN (${placeholders}) ORDER BY period_end DESC`).bind(...slugs).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT id, event_slug AS eventSlug, kind, order_id AS orderId, detail, status, review_note AS reviewNote, created_at AS createdAt
      FROM organizer_requests WHERE event_slug IN (${placeholders}) ORDER BY created_at DESC LIMIT 100`).bind(...slugs).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT assignment.event_slug AS eventSlug, account.id, account.display_name AS displayName, account.normalized_email AS email, account.status
      FROM staff_event_assignments assignment JOIN staff_accounts account ON account.id = assignment.account_id
      WHERE assignment.event_slug IN (${placeholders}) AND account.role = 'gate' ORDER BY account.display_name`).bind(...slugs).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT question.event_slug AS eventSlug, question.id AS questionId, question.prompt,
      answer.answer, answer.updated_at AS updatedAt, profile.display_name AS displayName
      FROM event_questions question
      JOIN attendee_question_answers answer ON answer.question_id = question.id
      JOIN attendee_profiles profile ON profile.id = answer.attendee_id
      WHERE question.event_slug IN (${placeholders}) AND answer.answer <> ''
      ORDER BY question.event_slug, answer.updated_at DESC LIMIT 500`).bind(...slugs).all<Record<string, unknown>>(),
  ]);
  return Response.json({ events: events.results, submissions: submissions.results, tiers: tiers.results, settlements: settlements.results, requests: requests.results, gateStaff: gateStaff.results, attendeeAnswers: attendeeAnswers.results }, { headers: { "cache-control": "no-store" } });
}

export async function PATCH(request: Request) {
  const { env, session } = await organizer(request);
  if (!session) return Response.json({ error: "Organiser access is required." }, { status: 403 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const eventSlug = String(body.eventSlug ?? "");
    if (!(await assigned(env.DB, session, eventSlug))) return Response.json({ error: "This event is not assigned to your account." }, { status: 403 });
    const venue = String(body.venue ?? "").trim();
    const lineup = String(body.lineup ?? "").trim();
    const venueMapUrl = new URL(String(body.venueMapUrl ?? ""));
    if (venue.length < 2 || venue.length > 160 || lineup.length < 2 || lineup.length > 1000 || !["https:", "http:"].includes(venueMapUrl.protocol)) throw new Error("Check the venue, map link and line-up.");
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE curated_event_records SET venue = ?, venue_map_url = ?, lineup = ?, updated_at = ? WHERE slug = ?")
      .bind(venue, venueMapUrl.toString(), lineup, now, eventSlug).run();
    await recordAudit(env.DB, { session, action: "organizer.event_details_updated", targetType: "event", targetId: eventSlug, outcome: "success", requestId: requestMetadata(request).requestId });
    return Response.json({ updated: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Event details could not be updated." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const { env, session } = await organizer(request);
  if (!session) return Response.json({ error: "Organiser access is required." }, { status: 403 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const eventSlug = String(body.eventSlug ?? "");
    if (!(await assigned(env.DB, session, eventSlug))) return Response.json({ error: "This event is not assigned to your account." }, { status: 403 });
    const now = new Date().toISOString();
    const requestId = requestMetadata(request).requestId;

    if (action === "announcement") {
      const content = String(body.content ?? "").trim().slice(0, 1000);
      if (content.length < 2) throw new Error("Write a clear announcement first.");
      const policy = await resolveRoomPolicy(env.DB, eventSlug);
      if (!policy) throw new Error("This Room is not available.");
      const message = await env.THE_ROOM.getByName(eventSlug).publishAnnouncement(session.actor, content, Boolean(body.pinned), policy);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO room_moderation_actions (id, event_slug, actor, action, message_id, note, created_at) VALUES (?, ?, ?, 'announcement', ?, ?, ?)`)
          .bind(crypto.randomUUID(), eventSlug, `${session.email} (${session.role})`, message.id, content, now),
        env.DB.prepare(`INSERT INTO event_updates (id, event_slug, title, body, pinned, published_at, published_by) VALUES (?, ?, 'Night Update', ?, ?, ?, ?)`)
          .bind(crypto.randomUUID(), eventSlug, content, Boolean(body.pinned), now, session.actor),
      ]);
      await recordAudit(env.DB, { session, action: "organizer.room_announcement", targetType: "event", targetId: eventSlug, outcome: "success", requestId });
      return Response.json({ announced: true, messageId: message.id });
    }

    if (action === "request") {
      const kind = String(body.kind ?? "");
      const allowedKinds = ["cancel_event", "reschedule_event", "refund_order", "inventory_change", "other"];
      const detail = String(body.detail ?? "").trim().slice(0, 1200);
      const orderId = String(body.orderId ?? "").trim() || null;
      if (!allowedKinds.includes(kind) || detail.length < 10) throw new Error("Choose a request type and add useful detail.");
      if (kind === "refund_order") {
        const order = orderId ? await env.DB.prepare("SELECT id FROM orders WHERE id = ? AND event_slug = ? LIMIT 1").bind(orderId, eventSlug).first() : null;
        if (!order) throw new Error("That order does not belong to this event.");
      }
      const id = crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO organizer_requests (id, event_slug, requested_by, kind, order_id, detail, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`)
        .bind(id, eventSlug, session.accountId, kind, orderId, detail, now, now).run();
      await recordAudit(env.DB, { session, action: `organizer.request.${kind}`, targetType: "organizer_request", targetId: id, outcome: "success", requestId });
      return Response.json({ requested: true, id }, { status: 201 });
    }

    if (action === "assign_gate") {
      const email = normalizeStaffEmail(String(body.email ?? ""));
      const gate = await env.DB.prepare("SELECT id FROM staff_accounts WHERE normalized_email = ? AND role = 'gate' AND status = 'active' LIMIT 1").bind(email).first<{ id: string }>();
      if (!gate) throw new Error("Create an active gate-staff account for that email first.");
      if (body.remove === true) await env.DB.prepare("DELETE FROM staff_event_assignments WHERE account_id = ? AND event_slug = ?").bind(gate.id, eventSlug).run();
      else await env.DB.prepare("INSERT OR IGNORE INTO staff_event_assignments (account_id, event_slug, assigned_by, assigned_at) VALUES (?, ?, ?, ?)").bind(gate.id, eventSlug, session.accountId, now).run();
      await recordAudit(env.DB, { session, action: body.remove === true ? "organizer.gate_unassigned" : "organizer.gate_assigned", targetType: "staff_account", targetId: gate.id, outcome: "success", detail: eventSlug, requestId });
      return Response.json({ assigned: body.remove !== true });
    }
    return Response.json({ error: "Choose a valid organiser action." }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The organiser action failed." }, { status: 400 });
  }
}
