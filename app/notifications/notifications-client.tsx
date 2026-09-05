"use client";

import Link from "next/link";
import { ArrowLeft, BadgeCheck, Bell, CheckCheck, MessageCircle, Ticket } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import BrandLogo from "../brand-logo";
import AccountNavigation from "../account-navigation";
import PublicNavigation from "../mobile-navigation";
import { ActionButton, ActionLink } from "../action";
import { requestJson, requestErrorMessage, RequestError } from "../../lib/client-request";

type Item = { id: string; eventSlug: string | null; kind: string; title: string; body: string; url: string; createdAt: string; readAt: string | null };

export default function NotificationsClient() {
  const params = useSearchParams();
  const [items, setItems] = useState<Item[] | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [markingAll, setMarkingAll] = useState(false);
  const busy = useRef(new Set<string>());

  const load = useCallback(() => requestJson<{ notifications: Item[] }>("/api/customer/notifications", { cache: "no-store" })
    .then((data) => {
      if (!Array.isArray(data.notifications)) throw new Error("Notifications could not be loaded. Please try again.");
      setItems(data.notifications); setLocked(false);
    }).catch((error) => {
      if (error instanceof RequestError && error.status === 401) setLocked(true);
      else setLoadError(requestErrorMessage(error));
    }).finally(() => setLoading(false)), []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const slug = params.get("mute");
    if (!slug || !/^[a-z0-9-]{1,80}$/u.test(slug)) return;
    const controller = new AbortController();
    void requestJson(`/api/customer/notifications/preferences/${encodeURIComponent(slug)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mute: "tonight" }), signal: controller.signal,
    }).then(() => setNotice("That Room is quiet for tonight. Your lock screen may rest."))
      .catch((error) => { if (!controller.signal.aborted) setActionError(requestErrorMessage(error)); });
    return () => controller.abort();
  }, [params]);

  async function mark(id?: string) {
    const key = id ?? "all";
    if (busy.current.has(key) || busy.current.has("all")) return;
    busy.current.add(key); setActionError("");
    if (!id) setMarkingAll(true);
    try {
      await requestJson("/api/customer/notifications", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(id ? { id } : { all: true }), keepalive: true });
      setItems((current) => current?.map((item) => !id || item.id === id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item) ?? current);
    } catch (error) { setActionError(requestErrorMessage(error)); }
    finally { busy.current.delete(key); if (!id) setMarkingAll(false); }
  }

  const unread = items?.filter((item) => !item.readAt).length ?? 0;
  return <main className="notification-page buzz-page">
    <header className="directory-header"><Link href="/my-nights" aria-label="Back to My Nights"><ArrowLeft size={16} /><span className="directory-header__back-label">My Nights</span></Link><Link href="/" className="brand-mark"><BrandLogo /></Link><PublicNavigation /></header>
    <AccountNavigation />
    <section className="buzz-shell">
      <header className="buzz-intro"><div><p className="eyebrow">The good kind of interruption</p><h1>The Buzz</h1><p>Room banter, Host updates and ticket moves. You’re in the loop.</p></div>{!locked && items && <div className="buzz-tools"><span role="status">{unread ? `${unread} unread` : "You’re all caught up."}</span><ActionButton variant="text" icon={<CheckCheck size={18} />} onClick={() => void mark()} disabled={!unread || markingAll} aria-busy={markingAll}>{markingAll ? "Marking…" : "Mark all read"}</ActionButton></div>}</header>
      {notice && <p className="buzz-feedback" role="status">{notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice("")}>Dismiss</button></p>}
      {actionError && <p className="buzz-error" role="alert">{actionError}</p>}
      {loading ? <div className="buzz-state" role="status"><Bell size={30} /><p>Collecting the useful noise…</p></div> : locked ? <div className="buzz-state"><Bell size={36} /><h2>Your buzz is private.</h2><p>Use the email you paid with to bring back My Nights. The Room pings and Host updates come with it.</p><ActionLink href="/my-nights">Bring back My Nights</ActionLink></div> : loadError ? <div className="buzz-state"><Bell size={30} /><h2>The Buzz couldn’t connect.</h2><p role="alert">{loadError}</p><ActionButton onClick={() => { setLoading(true); setLoadError(""); void load(); }}>Try again</ActionButton></div> : items?.length ? <div className="buzz-list">{items.map((item) => {
        const hostUpdate = ["host_update", "gate_update", "event_status"].includes(item.kind);
        const Icon = hostUpdate ? BadgeCheck : item.kind === "ticket_transfer" ? Ticket : MessageCircle;
        return <Link key={item.id} href={item.url} className={item.readAt ? "read" : "unread"} onClick={() => { if (!item.readAt) void mark(item.id); }}><span className="buzz-icon" data-kind={hostUpdate ? "host" : "message"}><Icon size={21} aria-hidden="true" /></span><div><small>{hostUpdate ? "From the Host" : item.kind === "ticket_transfer" ? "Your ticket" : "Your Night"}{item.eventSlug ? ` · ${item.eventSlug.replaceAll("-", " ")}` : ""}</small><h2>{item.title}</h2><p>{item.body}</p><time dateTime={item.createdAt}>{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(item.createdAt))}</time></div>{!item.readAt && <span className="buzz-unread">New</span>}</Link>;
      })}</div> : <div className="buzz-state"><Bell size={36} /><h2>Quiet. Suspiciously quiet.</h2><p>When The Room moves or the Host has news, it lands here. Until then, there’s a night with your name on it.</p><ActionLink href="/my-nights">Back to My Nights</ActionLink></div>}
    </section>
  </main>;
}
