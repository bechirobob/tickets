import { requireAdminSession } from "../../../lib/admin-auth";
import OrganizerAnalytics from "./organizer-analytics";

export const dynamic = "force-dynamic";

export default async function OrganizerAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const event = typeof params.event === "string" && /^[a-z0-9-]{1,120}$/.test(params.event) ? params.event : "all";
  const range = typeof params.range === "string" && ["7", "30", "90", "all"].includes(params.range) ? params.range : "30";
  const returnTo = `/organizer/analytics?event=${encodeURIComponent(event)}&range=${range}`;
  const session = await requireAdminSession(returnTo, "organizer.workspace");
  return <OrganizerAnalytics actor={session.actor} role={session.role} initialEvent={event} initialRange={range} />;
}
