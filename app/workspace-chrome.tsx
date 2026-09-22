"use client";

import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { Menu, LogOut, LayoutDashboard, CalendarDays, Users, Send, Wallet, UserRoundCog, Inbox, LifeBuoy, ScanLine, MessageSquare, SlidersHorizontal, Link2, UserRound, BookOpen, Sparkles } from "lucide-react";
import { STAFF_WORKSPACE_LINKS, STAFF_ROLE_DEFINITIONS, type StaffRole } from "../lib/staff-roles";
import { operationsFetch } from "../lib/operations-client";
import BrandLogo from "./brand-logo";

export const hostAreas = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "events", label: "Events", Icon: CalendarDays },
  { id: "audience", label: "Audience", Icon: Users },
  { id: "promote", label: "Promote", Icon: Send },
  { id: "money", label: "Money", Icon: Wallet },
  { id: "team", label: "Team", Icon: UserRoundCog },
];
const icons: Record<string, typeof Menu> = { "/admin/operations": LayoutDashboard, "/admin": Inbox, "/admin/events": CalendarDays, "/admin/registrations": Users, "/admin/promoters": Link2, "/admin/orders": Wallet, "/admin/support": LifeBuoy, "/scan": ScanLine, "/admin/rooms": MessageSquare, "/admin/fees": SlidersHorizontal, "/admin/accounts": UserRoundCog };
type Item = { href: string; label: string; Icon: typeof Menu; active: boolean };

export default function WorkspaceChrome({ actor, role, active, host = false, event = "", onNavigate }: { actor: string; role: StaffRole; active: string; host?: boolean; event?: string; onNavigate?: (href: string) => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pathname = usePathname(), params = useSearchParams(), router = useRouter();
  const hostHref = (area: string) => `/organizer/workspace?area=${area}${event ? `&event=${encodeURIComponent(event)}` : ""}`;
  const main: Item[] = host ? hostAreas.map(x => ({ ...x, href: hostHref(x.id), active: active === x.id })) : STAFF_WORKSPACE_LINKS.filter(x => (x.roles as readonly StaffRole[]).includes(role) && !["/admin/fees", "/admin/accounts"].includes(x.href)).map(x => ({ ...x, label: x.href === "/admin/operations" && role === "finance" ? "Finance overview" : x.label, Icon: icons[x.href], active: active === x.href }));
  const settings: Item[] = [
    ...(host ? [{ href: hostHref("desk"), label: "Event desk", Icon: Sparkles, active: active === "desk" }] : STAFF_WORKSPACE_LINKS.filter(x => (x.roles as readonly StaffRole[]).includes(role) && ["/admin/fees", "/admin/accounts"].includes(x.href)).map(x => ({ ...x, Icon: icons[x.href], active: active === x.href }))),
    { href: host ? hostHref("account") : "/admin/account", label: "Account settings", Icon: UserRound, active: active === "account" || active === "/admin/account" },
    { href: host ? hostHref("help") : "/admin/help", label: "Help centre", Icon: BookOpen, active: active === "help" || active === "/admin/help" },
  ];
  useEffect(() => {
    try { sessionStorage.setItem("bct-workspace-return", pathname + (params.toString() ? `?${params}` : "")); } catch { /* Navigation remains available without storage. */ }
  }, [pathname, params]);
  function follow(e: MouseEvent<HTMLAnchorElement>, href: string) {
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (onNavigate && href.startsWith("/organizer/workspace")) { e.preventDefault(); onNavigate(href); }
    setOpen(false);
  }
  async function signOut() {
    if (busy) return;
    setBusy(true); setError("");
    const response = await operationsFetch("/api/admin/session", { method: "DELETE" });
    if (response.ok) {
      try { sessionStorage.removeItem("bct-workspace-return"); } catch {}
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } else { setBusy(false); setError("Sign out could not be confirmed. Try again."); }
  }
  const link = (x: Item) => <Link key={x.href} href={x.href} aria-current={x.active ? "page" : undefined} onClick={e => follow(e, x.href)}><x.Icon size={18}/><span>{x.label}</span></Link>;
  return <>
    <header className="workspace-topbar">
      <button type="button" className="workspace-menu" aria-label="Toggle workspace navigation" aria-controls="workspace-navigation" aria-expanded={open} onClick={() => setOpen(!open)}><Menu size={19}/></button>
      <Link className="night-brand-link" href={host ? hostHref("overview") : main[0]?.href ?? "/admin/account"} onClick={e => follow(e, host ? hostHref("overview") : main[0]?.href ?? "/admin/account")} aria-label="Workspace home"><BrandLogo/></Link>
      {role === "owner" ? <label className="workspace-switch"><span className="sr-only">Workspace</span><select aria-label="Workspace" value={host ? "host" : "operations"} onChange={e => { router.push(e.target.value === "host" ? "/organizer/workspace" : "/admin/operations"); }}><option value="operations">Operations</option><option value="host">Host workspace</option></select></label> : <span className="workspace-role">{host ? "Host workspace" : STAFF_ROLE_DEFINITIONS[role].label}</span>}
      <span className="workspace-actor">{actor}</span>
      <button type="button" aria-label="Sign out" disabled={busy} onClick={() => void signOut()}><LogOut size={17}/></button>
    </header>
    <aside className="workspace-sidebar" data-open={open}>
      <nav id="workspace-navigation" aria-label={host ? "Organiser workspace" : "Workspace navigation"}>
        {main.map(link)}
        <details className="workspace-tools" open={settings.some(x => x.active) || undefined}><summary>Tools & settings</summary>{settings.map(link)}</details>
      </nav>
      {error ? <p role="alert">{error}</p> : null}
      <Link className="workspace-public" href="/events">View public site ↗</Link>
    </aside>
  </>;
}
