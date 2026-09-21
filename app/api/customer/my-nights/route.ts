import { hashToken, readCookie, touchAttendeeSession } from "../../../../lib/attendee-auth";

type NightRecord = {
  roomAccess: number;
  admissionActive: number;
  registrationMode: string;
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
  const token = readCookie(request.headers.get("cookie"));
  if (!token) {
    return Response.json({ error: "Your first verified ticket unlocks My Nights." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const tokenHash = await hashToken(token), now = new Date().toISOString();
  // Resolve current authorization and its private feed in one D1 snapshot and
  // round trip. Never cache identity: revocation must affect the next request.
  const rows = await env.DB.prepare(`
    WITH identity AS MATERIALIZED (
      SELECT p.id AS attendeeId, p.display_name AS attendeeDisplayName,
             s.last_seen_at AS sessionLastSeenAt
      FROM attendee_sessions s JOIN attendee_profiles p ON p.id = s.attendee_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND p.status = 'active'
      LIMIT 1
    ), owned AS MATERIALIZED (
      SELECT ticket.event_slug, COUNT(*) AS ticketCount,
        MAX(CASE WHEN orders.status='paid' AND ticket.status IN ('issued','checked_in') THEN 1 ELSE 0 END) AS activeAdmission
      FROM ticket_assignments assignment
      JOIN tickets ticket ON ticket.id = assignment.ticket_id
      JOIN orders orders ON orders.id = ticket.order_id
      WHERE assignment.attendee_id = (SELECT attendeeId FROM identity) AND assignment.status = 'active'
        AND ticket.status IN ('issued', 'checked_in', 'voided', 'refunded')
        AND orders.status IN ('paid', 'refund_pending', 'refunded', 'requires_refund', 'disputed')
      GROUP BY ticket.event_slug
    ), nights AS (
    SELECT event.slug AS eventSlug, event.title, event.starts_at AS sortStartsAt,
           COALESCE(owned.activeAdmission,0) AS admissionActive,
           COALESCE((SELECT mode FROM event_registration_settings WHERE event_slug=event.slug),'paid') AS registrationMode,
           CASE WHEN COALESCE(owned.activeAdmission,0)=0 OR event.event_state NOT IN ('on_sale','sold_out','rescheduled') THEN 0 WHEN COALESCE((SELECT mode FROM event_registration_settings WHERE event_slug = event.slug), 'paid') <> 'rsvp' THEN 1 ELSE COALESCE((SELECT room_access FROM event_registration_settings WHERE event_slug = event.slug), 0) END AS roomAccess,
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
    LEFT JOIN attendee_event_preferences preference ON preference.event_slug = event.slug AND preference.attendee_id = (SELECT attendeeId FROM identity)
    LEFT JOIN event_hosts host_link ON host_link.event_slug = event.slug AND host_link.is_primary = true
    LEFT JOIN hosts host ON host.id = host_link.host_id
    LEFT JOIN attendee_host_follows host_follow ON host_follow.host_id = host.id AND host_follow.attendee_id = (SELECT attendeeId FROM identity)
    LEFT JOIN attendee_privacy_settings privacy ON privacy.attendee_id = (SELECT attendeeId FROM identity)
    WHERE event.status IN ('published', 'scheduled')
      AND (
        preference.keep_posted = true
        OR (host_follow.attendee_id IS NOT NULL AND COALESCE(privacy.allow_host_updates, true) = true)
        OR owned.ticketCount > 0
      )
    GROUP BY event.slug
    ORDER BY event.starts_at
    LIMIT 100
    )
    SELECT identity.attendeeDisplayName, identity.sessionLastSeenAt, nights.*
    FROM identity LEFT JOIN nights ON 1 = 1
    ORDER BY nights.sortStartsAt
  `).bind(tokenHash, now).all<NightRecord & { attendeeDisplayName: string; sessionLastSeenAt: string; sortStartsAt: string }>();
  const identity = rows.results[0];
  if (!identity) {
    return Response.json({ error: "Your first verified ticket unlocks My Nights." }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  await touchAttendeeSession(env.DB, tokenHash, identity.sessionLastSeenAt, now);

  return Response.json({
    attendee: { displayName: identity.attendeeDisplayName },
    nights: rows.results.filter(row => row.eventSlug).map(({ attendeeDisplayName: _displayName, sessionLastSeenAt: _lastSeenAt, sortStartsAt: _sortStartsAt, ...row }) => {
      void _displayName; void _lastSeenAt; void _sortStartsAt;
      const ticketCount = Number(row.ticketCount);
      const purchased = ticketCount > 0;
      return {
        ...row,
        roomAccess: Boolean(row.roomAccess),
        admissionActive: Boolean(row.admissionActive),
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
