import { requireAdminSession } from "../../../lib/admin-auth";
import OrganizerWorkspace from "./organizer-suite";

export const dynamic = "force-dynamic";

export default async function OrganizerWorkspacePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const params = new URLSearchParams();
  const allowed: Record<string, readonly string[]> = {
    area: ["overview", "events", "audience", "promote", "money", "team", "help", "submit", "account", "desk"],
    view: ["overview", "details", "tickets", "guests", "room", "insights", "help", "rsvp", "door"],
    tab: ["settings", "roster", "guests"],
    status: ["requested", "confirmed", "waitlisted", "declined", "cancelled", "interested"],
  };
  for (const key of ["area", "event", "view", "tab", "status"]) {
    const value = query[key];
    if (typeof value !== "string") continue;
    if (key === "event" ? /^[a-z0-9][a-z0-9-]{0,119}$/u.test(value) : allowed[key].includes(value)) params.set(key, value);
  }
  const filters = params.toString();
  const session = await requireAdminSession(`/organizer/workspace${filters ? `?${filters}` : ""}`, "organizer.workspace");
  return <OrganizerWorkspace actor={session.actor} role={session.role} email={session.email} />;
}
