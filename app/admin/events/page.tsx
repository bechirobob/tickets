import { requireAdminSession } from "../../../lib/admin-auth";
import EventOperations from "./event-operations";

export const dynamic = "force-dynamic";

export default async function AdminEventsPage() {
  const session = await requireAdminSession("/admin/events", "events.manage");
  return <EventOperations actor={session.actor} role={session.role} />;
}
