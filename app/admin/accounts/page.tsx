import { requireAdminSession } from "../../../lib/admin-auth";
import StaffAccounts from "./staff-accounts";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const session = await requireAdminSession("/admin/accounts", "accounts.manage");
  return <StaffAccounts actor={session.actor} role={session.role} />;
}
