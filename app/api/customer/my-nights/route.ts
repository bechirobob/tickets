import { readAttendeeIdentity } from "../../../../lib/attendee-auth";

type NightRecord = {
  eventSlug: string;
  title: string;
  startsAt: string;
  endsAt: string;
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
    SELECT event.slug AS eventSlug, event.title, event.starts_at AS startsAt,
           event.ends_at AS endsAt, event.venue, event.area, event.image_url AS imageUrl,
           event.event_state AS eventState, event.is_test_event AS isTestEvent,
           COUNT(DISTINCT CASE WHEN assignment.status = 'active' AND ticket.status IN ('issued', 'checked_in') THEN ticket.id END) AS ticketCount,
           COALESCE(preference.keep_posted, false) AS keepPosted,
           COALESCE(preference.attendee_visible, false) AS attendeeVisible,
           host.slug AS hostSlug, host.name AS hostName,
           COUNT(DISTINCT update_item.id) AS updateCount,
           COUNT(DISTINCT question.id) AS questionCount
    FROM curated_event_records event
    LEFT JOIN tickets ticket ON ticket.event_slug = event.slug
    LEFT JOIN ticket_assignments assignment ON assignment.ticket_id = ticket.id AND assignment.attendee_id = ?
    LEFT JOIN attendee_event_preferences preference ON preference.event_slug = event.slug AND preference.attendee_id = ?
    LEFT JOIN event_hosts host_link ON host_link.event_slug = event.slug AND host_link.is_primary = true
    LEFT JOIN hosts host ON host.id = host_link.host_id
    LEFT JOIN attendee_host_follows host_follow ON host_follow.host_id = host.id AND host_follow.attendee_id = ?
    LEFT JOIN attendee_privacy_settings privacy ON privacy.attendee_id = ?
    LEFT JOIN event_updates update_item ON update_item.event_slug = event.slug
    LEFT JOIN event_questions question ON question.event_slug = event.slug AND question.status = 'active'
    WHERE event.status IN ('published', 'scheduled')
      AND (
        preference.keep_posted = true
        OR (host_follow.attendee_id IS NOT NULL AND COALESCE(privacy.allow_host_updates, true) = true)
        OR EXISTS (
          SELECT 1 FROM tickets owned_ticket
          JOIN ticket_assignments owned_assignment ON owned_assignment.ticket_id = owned_ticket.id
          JOIN orders owned_order ON owned_order.id = owned_ticket.order_id
          WHERE owned_assignment.attendee_id = ? AND owned_assignment.status = 'active'
            AND owned_ticket.event_slug = event.slug
            AND owned_ticket.status IN ('issued', 'checked_in') AND owned_order.status = 'paid'
        )
      )
    GROUP BY event.slug
    ORDER BY event.starts_at
    LIMIT 100
  `).bind(identity.attendeeId, identity.attendeeId, identity.attendeeId, identity.attendeeId, identity.attendeeId).all<NightRecord>();

  return Response.json({
    attendee: { displayName: identity.displayName },
    nights: rows.results.map((row) => {
      const ticketCount = Number(row.ticketCount);
      const purchased = ticketCount > 0;
      return {
        ...row,
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
