import { requireAdminSession } from "../../../lib/admin-auth";
import WorkspaceChrome from "../../workspace-chrome";
import "../workspace/suite.css";
import OrganizerAnalytics from "./organizer-analytics";

export const dynamic = "force-dynamic";

export default async function OrganizerAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const event = typeof params.event === "string" && /^[a-z0-9-]{1,120}$/.test(params.event) ? params.event : "all";
  const range = typeof params.range === "string" && ["7", "30", "90", "all"].includes(params.range) ? params.range : "30";
  const view = typeof params.view === "string" && ["guests", "sales", "reach", "door"].includes(params.view) ? params.view : "guests";
  const returnTo = `/organizer/analytics?event=${encodeURIComponent(event)}&range=${range}&view=${view}`;
  const session = await requireAdminSession(returnTo, "organizer.workspace");
  return <main className="organizer-suite"><WorkspaceChrome actor={session.actor} role={session.role} host active="events" event={event}/><div className="suite-content"><a className="workspace-back" href={`/organizer/workspace?area=events&event=${event}`}>← Back to event</a><h1>Event insights</h1><OrganizerAnalytics actor={session.actor} role={session.role} initialEvent={event} initialRange={range} initialView={view} embedded /></div></main>;
}
