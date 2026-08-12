"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";
import type { StaffRole } from "../../lib/admin-session";

const links = [
  { href: "/admin/operations", label: "Event operations", roles: ["owner", "curator", "finance"] },
  { href: "/admin", label: "Submission queue", roles: ["owner", "curator"] },
  { href: "/admin/events", label: "Events & inventory", roles: ["owner", "curator"] },
  { href: "/admin/promoters", label: "Promoter links", roles: ["owner", "curator"] },
  { href: "/admin/orders", label: "Orders & payments", roles: ["owner", "finance"] },
  { href: "/admin/support", label: "Ticket support", roles: ["owner", "finance"] },
  { href: "/scan", label: "Gate scanner", roles: ["owner", "gate"] },
  { href: "/admin/rooms", label: "Room moderation", roles: ["owner", "moderator"] },
  { href: "/admin/fees", label: "Fees & charges", roles: ["owner", "finance"] },
  { href: "/admin/accounts", label: "People & permissions", roles: ["owner"] },
] as const;

export default function OperationsNav({ actor, role, active }: { actor: string; role: StaffRole; active: string }) {
  const router = useRouter();
  async function signOut() { await fetch("/api/admin/session", { method: "DELETE" }); router.push("/"); router.refresh(); }
  return <aside className="curation-nav">
    <Link href="/" className="night-brand-link"><span className="night-brand"><b>B</b><span>BeCore<br />Tickets</span></span></Link>
    <nav><span>Operations</span>{links.filter((item) => (item.roles as readonly StaffRole[]).includes(role)).map((item) => <Link key={item.href} className={active === item.href ? "active" : ""} href={item.href}>{item.label}</Link>)}<Link className={active === "/admin/account" ? "active" : ""} href="/admin/account">My account</Link></nav>
    <p><ShieldCheck size={14} /> {role}<br /><small>{actor}</small></p>
    <button className="curation-signout" onClick={signOut}><LogOut size={14} /> Sign out</button>
  </aside>;
}
