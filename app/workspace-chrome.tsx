"use client";

import { clearGateManifests } from "../lib/scanner-manifest";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { Menu, X, LogOut, LayoutDashboard, CalendarDays, Users, Send, Wallet, UserRoundCog, Inbox, LifeBuoy, ScanLine, MessageSquare, SlidersHorizontal, Link2, UserRound, BookOpen, Sparkles } from "lucide-react";
import { STAFF_WORKSPACE_LINKS, STAFF_ROLE_DEFINITIONS, type StaffRole } from "../lib/staff-roles";
import { operationsFetch } from "../lib/operations-client";
import { useLayerHistory } from "./use-layer-history";
import BrandLogo from "./brand-logo";

export const hostAreas = [
  { id: "overview", label: "Overview", Icon: LayoutDashboard },
  { id: "events", label: "Events", Icon: CalendarDays },
  { id: "audience", label: "Audience", Icon: Users },
  { id: "promote", label: "Promote", Icon: Send },
  { id: "money", label: "Money", Icon: Wallet },
  { id: "team", label: "Team", Icon: UserRoundCog },
];
const icons: Record<string, typeof Menu> = { "/admin/platform-audience": Users, "/admin/hosts": UserRoundCog, "/admin/operations": LayoutDashboard, "/admin": Inbox, "/admin/events": CalendarDays, "/admin/registrations": Users, "/admin/promoters": Link2, "/admin/orders": Wallet, "/admin/support": LifeBuoy, "/scan": ScanLine, "/admin/rooms": MessageSquare, "/admin/fees": SlidersHorizontal, "/admin/accounts": UserRoundCog };
type Item = { href: string; label: string; Icon: typeof Menu; active: boolean };

export default function WorkspaceChrome({ actor, role, active, host = false, event = "", onNavigate }: { actor: string; role: StaffRole; active: string; host?: boolean; event?: string; onNavigate?: (href: string) => void }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const menuTrigger = useRef<HTMLButtonElement>(null), menuPanel = useRef<HTMLElement>(null);
  const closeMenu = useCallback(() => { setOpen(false); menuTrigger.current?.focus({ preventScroll: true }); }, []);
  const releaseHistory = useLayerHistory(open, closeMenu);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); closeMenu(); } };
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !menuPanel.current?.contains(event.target) && !menuTrigger.current?.contains(event.target)) setOpen(false); };
    const focus = (event: FocusEvent) => { if (event.target instanceof Node && !menuPanel.current?.contains(event.target) && !menuTrigger.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("keydown", key); document.addEventListener("pointerdown", outside); document.addEventListener("focusin", focus);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", focus); };
  }, [closeMenu, open]);
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
    if (open && window.matchMedia("(max-width: 760px)").matches) {
      e.preventDefault();
      const ready = releaseHistory(); setOpen(false);
      void ready.then(() => { if (onNavigate && href.startsWith("/organizer/workspace")) onNavigate(href); else router.push(href); });
    } else if (onNavigate && href.startsWith("/organizer/workspace")) { e.preventDefault(); onNavigate(href); }
    setOpen(false);
  }
  async function signOut() {
    if (busy) return;
    setBusy(true); setError("");
    const response = await operationsFetch("/api/admin/session", { method: "DELETE" });
    if (response.ok) {
      try { sessionStorage.removeItem("bct-workspace-return"); } catch {}
      try { clearGateManifests(window.localStorage); } catch { /* Server logout still wins. */ }
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } else { setBusy(false); setError("Sign out could not be confirmed. Try again."); }
  }
  const link = (x: Item) => <Link key={x.href} href={x.href} aria-current={x.active ? "page" : undefined} onClick={e => follow(e, x.href)}><x.Icon size={18}/><span>{x.label}</span></Link>;
  return <>
    <header className="workspace-topbar">
      <button ref={menuTrigger} type="button" className="workspace-menu" aria-label="Toggle workspace navigation" aria-controls="workspace-navigation" aria-expanded={open} onClick={event => { if (open) closeMenu(); else { setOpen(true); if (event.detail === 0) requestAnimationFrame(() => menuPanel.current?.querySelector<HTMLElement>("button,a[href]")?.focus({ preventScroll: true })); } }}><Menu size={19}/></button>
      <Link className="night-brand-link" href={host ? hostHref("overview") : main[0]?.href ?? "/admin/account"} onClick={e => follow(e, host ? hostHref("overview") : main[0]?.href ?? "/admin/account")} aria-label="Workspace home"><BrandLogo/></Link>
      {role === "owner" ? <label className="workspace-switch"><span className="sr-only">Workspace</span><select aria-label="Workspace" value={host ? "host" : "operations"} onChange={e => { const href = e.target.value === "host" ? "/organizer/workspace" : "/admin/operations"; const ready = releaseHistory(); setOpen(false); void ready.then(() => router.push(href)); }}><option value="operations">Operations</option><option value="host">Host workspace</option></select></label> : <span className="workspace-role">{host ? "Host workspace" : STAFF_ROLE_DEFINITIONS[role].label}</span>}
      <span className="workspace-actor">{actor}</span>
      <button type="button" aria-label="Sign out" disabled={busy} onClick={() => void signOut()}><LogOut size={17}/></button>
    </header>
    <aside ref={menuPanel} className="workspace-sidebar" data-open={open}>
      <div className="workspace-menu-heading"><b>{host ? "Host workspace" : "Operations"}</b><button type="button" aria-label="Close workspace navigation" onClick={closeMenu}><X size={20}/></button></div>
      <nav id="workspace-navigation" aria-label={host ? "Organiser workspace" : "Workspace navigation"}>
        {main.map(link)}
        <details className="workspace-tools" open={settings.some(x => x.active) || undefined}><summary>Tools & settings</summary>{settings.map(link)}</details>
      </nav>
      {error ? <p role="alert">{error}</p> : null}
      <Link className="workspace-public" href="/events" onClick={e => follow(e, "/events")}>View public site ↗</Link>
    </aside>
  </>;
}
