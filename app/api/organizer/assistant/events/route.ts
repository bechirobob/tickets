import { organizerScope } from "../../../../../lib/organizer-access";
import { hasPermission, readAdminSession } from "../../../../../lib/admin-session";

type EventOption = {
  slug: string;
  title: string;
  startsAt: string;
  eventState: string;
};

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (!session || !hasPermission(session, "organizer.workspace")) {
    return Response.json({ error: "Organiser access is required." }, { status: 403, headers: { "cache-control": "no-store" } });
  }

  const scope=organizerScope(session,"event");
  const events = await env.DB.prepare(`
    SELECT event.slug, event.title, event.starts_at AS startsAt, event.event_state AS eventState
    FROM curated_event_records event
    LEFT JOIN party_submissions submission ON submission.id = event.submission_id
    WHERE event.removed_at IS NULL
      AND ${scope.sql}
    ORDER BY event.starts_at DESC
    LIMIT 100
  `).bind(...scope.bindings).all<EventOption>();

  return Response.json({ events: events.results }, { headers: { "cache-control": "no-store" } });
}
