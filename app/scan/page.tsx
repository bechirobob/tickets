import Scanner from "./scanner";
import { requireAdminSession } from "../../lib/admin-auth";
import { getPublicEvents } from "../events";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const session = await requireAdminSession("/scan", "gate.scan");
  const allEvents = await getPublicEvents();
  let events = allEvents;
  if (session.role !== "owner") {
    const { env } = await import("cloudflare:workers");
    const assignments = await env.DB.prepare("SELECT event_slug AS eventSlug FROM staff_event_assignments WHERE account_id = ?")
      .bind(session.accountId).all<{ eventSlug: string }>();
    const allowed = new Set(assignments.results.map((item) => item.eventSlug));
    events = allEvents.filter((event) => allowed.has(event.slug));
  }
  return <Scanner events={events.map(({ slug, title, fullDate, venue }) => ({ slug, title, fullDate, venue }))} />;
}
