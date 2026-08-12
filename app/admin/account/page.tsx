import Link from "next/link";
import { requireAdminSession } from "../../../lib/admin-auth";
import { STAFF_ROLE_DEFINITIONS } from "../../../lib/staff-roles";
import AccountSecurity from "./account-security";
import WorkspaceJump from "../workspace-jump";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireAdminSession("/admin/account");
  return <main className="account-page">
    <header><Link href="/">BeCore Tickets</Link><WorkspaceJump active="/admin/account" role={session.role} /></header>
    <section><p className="night-kicker"><span /> Account security</p><h1>{session.actor}</h1><p>{session.email} · {STAFF_ROLE_DEFINITIONS[session.role].label}</p><AccountSecurity mustChangePassword={session.mustChangePassword} /></section>
  </main>;
}
