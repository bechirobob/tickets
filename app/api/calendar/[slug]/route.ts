import { eventCalendar } from "../../../../lib/event-calendar";

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { env } = await import("cloudflare:workers");
  const { slug } = await context.params;
  const event = await env.DB.prepare("SELECT slug, title, starts_at AS startsAt, ends_at AS endsAt, venue, area, lineup, dress_code AS dressCode, awareness_note AS awarenessNote, guest_perk AS guestPerk FROM curated_event_records WHERE slug = ? AND event_state NOT IN ('draft','cancelled') LIMIT 1")
    .bind(slug).first<{ slug: string; title: string; startsAt: string; endsAt: string; venue: string; area: string; lineup: string; dressCode: string | null; awarenessNote: string | null; guestPerk: string | null }>();
  if (!event) return new Response("Event not found", { status: 404 });
  const calendar = eventCalendar({ ...event, description: [event.title, event.lineup, event.dressCode ? `Dress code: ${event.dressCode}` : null, event.guestPerk, event.awarenessNote].filter(Boolean).join(". "), origin: new URL(request.url).origin });
  return new Response(calendar, { headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${event.slug}.ics"`, "cache-control": "public, max-age=300" } });
}
