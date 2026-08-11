import Link from "next/link";
import { requireAdminSession } from "../../../lib/admin-auth";
import AccountSecurity from "./account-security";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await requireAdminSession("/admin/account");
  return <main className="account-page">
    <header><Link href="/">BeCore Tickets</Link><Link href={session.role === "organizer" ? "/organizer/workspace" : "/admin"}>Back to workspace</Link></header>
    <section><p className="night-kicker"><span /> Account security</p><h1>{session.actor}</h1><p>{session.email} · {session.role}</p><AccountSecurity mustChangePassword={session.mustChangePassword} /></section>
  </main>;
}
