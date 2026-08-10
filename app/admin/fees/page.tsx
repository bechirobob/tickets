import { requireAdminSession } from "../../../lib/admin-auth";
import FeeSettings from "../fee-settings";

export const dynamic = "force-dynamic";

export default async function AdminFeesPage() {
  await requireAdminSession("/admin/fees");
  return <FeeSettings />;
}
