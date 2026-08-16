import { requireAdminSession } from "../../../lib/admin-auth";
import OrganizerAnalytics from "./organizer-analytics";

export const dynamic = "force-dynamic";

export default async function OrganizerAnalyticsPage() {
  const session = await requireAdminSession("/organizer/analytics", "organizer.workspace");
  return <OrganizerAnalytics actor={session.actor} role={session.role} />;
}
