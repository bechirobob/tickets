import { eventCalendar } from "../../../../lib/event-calendar";
import { findCuratedEvent } from "../../../events";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const event = await findCuratedEvent(slug);
  if (!event || !event.startsAt || event.eventState === "cancelled" || event.eventState === "postponed") return new Response("Event date not available", { status: 404, headers: { "cache-control": "no-store" } });
  const calendar = eventCalendar({ ...event, startsAt: event.startsAt, description: [event.title, event.lineup, event.dressCode ? `Dress code: ${event.dressCode}` : null, event.guestPerk, event.awarenessNote].filter(Boolean).join(". "), origin: new URL(request.url).origin });
  return new Response(calendar, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${event.slug}.ics"`, "cache-control": "no-store" } });
}
