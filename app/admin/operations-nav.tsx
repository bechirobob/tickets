"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";
import type { StaffRole } from "../../lib/admin-session";
import { STAFF_ROLE_DEFINITIONS, STAFF_WORKSPACE_LINKS } from "../../lib/staff-roles";
import WorkspaceJump from "./workspace-jump";

export default function OperationsNav({ actor, role, active }: { actor: string; role: StaffRole; active: string }) {
  const router = useRouter();
  async function signOut() { await fetch("/api/admin/session", { method: "DELETE" }); router.push("/"); router.refresh(); }
  return <aside className="curation-nav">
    <Link href="/" className="night-brand-link"><span className="night-brand"><b>B</b><span>BeCore<br />Tickets</span></span></Link>
    <WorkspaceJump active={active} role={role} compact />
    <nav aria-label="Workspace navigation"><span>{STAFF_ROLE_DEFINITIONS[role].workspace}</span>{STAFF_WORKSPACE_LINKS.filter((item) => (item.roles as readonly StaffRole[]).includes(role)).map((item) => <Link key={item.href} aria-current={active === item.href ? "page" : undefined} className={active === item.href ? "active" : ""} href={item.href}>{item.href === "/admin/operations" && role === "finance" ? "Finance overview" : item.label}</Link>)}<Link aria-current={active === "/admin/account" ? "page" : undefined} className={active === "/admin/account" ? "active" : ""} href="/admin/account">My account</Link></nav>
    <p><ShieldCheck size={14} /> {STAFF_ROLE_DEFINITIONS[role].label}<br /><small>{actor}</small></p>
    <button className="curation-signout" onClick={signOut}><LogOut size={14} /> Sign out</button>
  </aside>;
}
