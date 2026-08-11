import { requireAdminSession } from "../../../lib/admin-auth";
import OrderOperations from "./order-operations";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const session = await requireAdminSession("/admin/orders", "orders.manage");
  return <OrderOperations actor={session.actor} role={session.role} />;
}
