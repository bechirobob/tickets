import { requireAdminSession } from "../../../lib/admin-auth";
import SupportOperations from "./support-operations";

export const dynamic = "force-dynamic";

export default async function AdminSupportPage() {
  const session = await requireAdminSession("/admin/support", "support.manage");
  return <SupportOperations actor={session.actor} role={session.role} />;
}
