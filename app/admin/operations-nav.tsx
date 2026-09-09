"use client";

import { operationsFetch } from "../../lib/operations-client";

import BrandLogo from "../brand-logo";
import Link from "next/link";
import { useState } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import type { StaffRole } from "../../lib/admin-session";
import { STAFF_ROLE_DEFINITIONS, STAFF_WORKSPACE_LINKS } from "../../lib/staff-roles";
import WorkspaceJump from "./workspace-jump";

export default function OperationsNav({ actor, role, active }: { actor: string; role: StaffRole; active: string }) {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true); setError("");
    const response = await operationsFetch("/api/admin/session", { method: "DELETE" });
    if (response.ok) {
      // Full navigation clears cached authenticated screens after revoking the session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    }
    else { setError("Sign out could not be confirmed. Please try again."); setSigningOut(false); }
  }
  return <aside className="curation-nav">
    <Link href="/" className="night-brand-link"><BrandLogo /></Link>
    <WorkspaceJump active={active} role={role} compact />
    <nav aria-label="Workspace navigation"><span>{STAFF_ROLE_DEFINITIONS[role].workspace}</span>{STAFF_WORKSPACE_LINKS.filter((item) => (item.roles as readonly StaffRole[]).includes(role)).map((item) => <Link key={item.href} aria-current={active === item.href ? "page" : undefined} className={active === item.href ? "active" : ""} href={item.href}>{item.href === "/admin/operations" && role === "finance" ? "Finance overview" : item.label}</Link>)}{(role === "owner" || role === "organizer") && <><Link href="/organizer/workspace">Organiser workspace</Link><Link href="/organizer/analytics">Organiser analytics</Link></>}<Link aria-current={active === "/admin/account" ? "page" : undefined} className={active === "/admin/account" ? "active" : ""} href="/admin/account">My account</Link></nav>
    <p><ShieldCheck size={14} /> {STAFF_ROLE_DEFINITIONS[role].label}<br /><small>{actor}</small></p>
    <button className="curation-signout" disabled={signingOut} onClick={signOut}><LogOut size={14} /> Sign out</button>
    {error ? <p role="alert">{error}</p> : null}
  </aside>;
}
