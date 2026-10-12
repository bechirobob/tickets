import { requireAdminSession } from "../../../lib/admin-auth";
import { STAFF_ROLE_DEFINITIONS } from "../../../lib/staff-roles";
import HostRsvpAlerts from "../../organizer/workspace/host-rsvp-alerts";
import AccountSecurity from "./account-security";
import WorkspaceChrome from "../../workspace-chrome";
export const dynamic = "force-dynamic";
export default async function AccountPage() {
  const session = await requireAdminSession("/admin/account");
  return <main className="ops-page"><WorkspaceChrome actor={session.actor} role={session.role} active={session.role === "organizer" ? "account" : "/admin/account"} host={session.role === "organizer"}/><section className="ops-main"><header><div><p>Account settings</p><h1>{session.actor}</h1><p>{session.email} · {STAFF_ROLE_DEFINITIONS[session.role].label}</p></div></header><AccountSecurity mustChangePassword={session.mustChangePassword}/>{session.role === "owner" && !session.mustChangePassword ? <HostRsvpAlerts accountId={session.accountId} owner/> : null}</section></main>;
}
