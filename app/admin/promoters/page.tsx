import { requireAdminSession } from "../../../lib/admin-auth";
import PromoterOperations from "./promoter-operations";

export const dynamic = "force-dynamic";

export default async function PromoterPage() {
  const session = await requireAdminSession("/admin/promoters", "events.manage");
  return <PromoterOperations actor={session.actor} role={session.role} />;
}
