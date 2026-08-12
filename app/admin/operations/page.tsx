import { requireAdminSession } from "../../../lib/admin-auth";
import EventOperationsHub from "./event-operations-hub";

export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const session = await requireAdminSession("/admin/operations", "operations.view");
  return <EventOperationsHub actor={session.actor} role={session.role} />;
}

