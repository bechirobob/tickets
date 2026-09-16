import { readAttendeeIdentity } from "../../../../lib/attendee-auth";

type NightRecord = {
  roomAccess: number;
  eventSlug: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  venue: string;
  area: string;
  imageUrl: string;
  eventState: string;
  isTestEvent: number;
  ticketCount: number;
  keepPosted: number;
  attendeeVisible: number;
  hostSlug: string | null;
  hostName: string | null;
  updateCount: number;
  questionCount: number;
};

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const identity = await readAttendeeIdentity(env.DB, request.headers.get("cookie"));
  if (!identity) {
    return Response.json({ error: "Your first verified ticket unlocks My Nights." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const rows = await env.DB.prepare(`
    WITH owned AS MATERIALIZED (
      SELECT ticket.event_slug, COUNT(*) AS ticketCount
      FROM ticket_assignments assignment
      JOIN tickets ticket ON ticket.id = assignment.ticket_id
      JOIN orders orders ON orders.id = ticket.order_id
      WHERE assignment.attendee_id = ? AND assignment.status = 'active'
        AND ticket.status IN ('issued', 'checked_in', 'voided', 'refunded')
        AND orders.status IN ('paid', 'refund_pending', 'refunded', 'requires_refund', 'disputed')
      GROUP BY ticket.event_slug
    )
    SELECT event.slug AS eventSlug, event.title,
           CASE WHEN COALESCE((SELECT mode FROM event_registration_settings WHERE event_slug = event.slug), 'paid') <> 'rsvp' THEN 1 ELSE COALESCE((SELECT room_access FROM event_registration_settings WHERE event_slug = event.slug), 0) END AS roomAccess,
           CASE WHEN event.schedule_status != 'coming_soon' THEN event.starts_at END AS startsAt,
           CASE WHEN event.schedule_status = 'confirmed' THEN event.ends_at END AS endsAt,
           event.venue, event.area, event.image_url AS imageUrl,
           event.event_state AS eventState, event.is_test_event AS isTestEvent,
           COALESCE(owned.ticketCount, 0) AS ticketCount,
           COALESCE(preference.keep_posted, false) AS keepPosted,
           COALESCE(preference.attendee_visible, false) AS attendeeVisible,
           host.slug AS hostSlug, host.name AS hostName,
           (SELECT COUNT(*) FROM event_updates update_item WHERE update_item.event_slug = event.slug) AS updateCount,
           (SELECT COUNT(*) FROM event_questions question WHERE question.event_slug = event.slug AND question.status = 'active') AS questionCount
    FROM curated_event_records event
    LEFT JOIN owned ON owned.event_slug = event.slug
    LEFT JOIN attendee_event_preferences preference ON preference.event_slug = event.slug AND preference.attendee_id = ?
    LEFT JOIN event_hosts host_link ON host_link.event_slug = event.slug AND host_link.is_primary = true
    LEFT JOIN hosts host ON host.id = host_link.host_id
    LEFT JOIN attendee_host_follows host_follow ON host_follow.host_id = host.id AND host_follow.attendee_id = ?
    LEFT JOIN attendee_privacy_settings privacy ON privacy.attendee_id = ?
    WHERE event.status IN ('published', 'scheduled')
      AND (
        preference.keep_posted = true
        OR (host_follow.attendee_id IS NOT NULL AND COALESCE(privacy.allow_host_updates, true) = true)
        OR owned.ticketCount > 0
      )
    GROUP BY event.slug
    ORDER BY event.starts_at
    LIMIT 100
  `).bind(identity.attendeeId, identity.attendeeId, identity.attendeeId, identity.attendeeId).all<NightRecord>();

  return Response.json({
    attendee: { displayName: identity.displayName },
    nights: rows.results.map((row) => {
      const ticketCount = Number(row.ticketCount);
      const purchased = ticketCount > 0;
      return {
        ...row,
        roomAccess: Boolean(row.roomAccess),
        ticketCount,
        purchased,
        keepPosted: Boolean(row.keepPosted),
        attendeeVisible: purchased && Boolean(row.attendeeVisible),
        isTestEvent: Boolean(row.isTestEvent),
        updateCount: purchased ? Number(row.updateCount) : 0,
        questionCount: purchased ? Number(row.questionCount) : 0,
      };
    }),
  }, { headers: { "cache-control": "no-store, private" } });
}
