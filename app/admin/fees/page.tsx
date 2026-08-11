import { requireAdminSession } from "../../../lib/admin-auth";
import FeeSettings from "../fee-settings";

export const dynamic = "force-dynamic";

export default async function AdminFeesPage() {
  const session = await requireAdminSession("/admin/fees", "fees.manage");
  return <FeeSettings actor={session.actor} role={session.role} />;
}
