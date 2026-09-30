import { requireAdminSession } from "../../../lib/admin-auth";
import OrderOperations from "./order-operations";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ event?: string; status?: string; provider?: string }> }) {
  const query = await searchParams;
  const event = typeof query.event === "string" && /^[a-z0-9][a-z0-9-]{0,119}$/.test(query.event) ? query.event : "";
  const status = typeof query.status === "string" && ["payment_pending", "paid", "expired", "failed", "refund_pending", "refunded", "requires_refund", "disputed"].includes(query.status) ? query.status : "";
  const provider = typeof query.provider === "string" && ["paystack", "seevplus", "rsvp"].includes(query.provider) ? query.provider : "";
  const params = new URLSearchParams();
  if (event) params.set("event", event);
  if (status) params.set("status", status);
  if (provider) params.set("provider", provider);
  const filters = params.toString();
  const session = await requireAdminSession(`/admin/orders${filters ? "?" + filters : ""}`, "orders.manage");
  return <OrderOperations key={filters} actor={session.actor} role={session.role} initialEvent={event} initialStatus={status} initialProvider={provider} />;
}
