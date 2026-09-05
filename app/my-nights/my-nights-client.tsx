/* eslint-disable @next/next/no-img-element -- authenticated event artwork uses the stored responsive source and must not be fetched through a shared optimizer cache. */
"use client";

import Link from "next/link";
import { ActionButton } from "../action";
import { ArrowLeft, ArrowUpRight, Bell, CalendarDays, CheckCircle2, Loader2, LockKeyhole, Mail, MapPin, MessageCircle, QrCode, ShieldCheck, Ticket } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import LoadingSkeleton from "../loading-skeleton";
import { requestJson, requestErrorMessage } from "../../lib/client-request";

type Night = {
  eventSlug: string; title: string; startsAt: string; endsAt: string; venue: string; area: string; imageUrl: string;
  eventState: string; isTestEvent: boolean; ticketCount: number; purchased: boolean; keepPosted: boolean;
  attendeeVisible: boolean; hostSlug: string | null; hostName: string | null; updateCount: number; questionCount: number;
};
type Payload = { attendee: { displayName: string }; nights: Night[] };
type View = "upcoming" | "past" | "following";

function nextAction(night: Night, now: number) {
  const startsIn = new Date(night.startsAt).getTime() - now;
  const ended = new Date(night.endsAt).getTime() < now;
  if (["cancelled", "postponed"].includes(night.eventState)) return { href: `/my-nights/${night.eventSlug}?view=details`, label: "See what changed", icon: Bell };
  if (ended) return { href: `/my-nights/${night.eventSlug}?view=details`, label: "Look back", icon: ArrowUpRight };
  if (startsIn <= 0) return { href: `/room/${night.eventSlug}`, label: "Enter the live Room", icon: MessageCircle };
  if (startsIn <= 6 * 60 * 60 * 1000) return { href: `/my-nights/${night.eventSlug}?view=passes`, label: "Show my ticket", icon: QrCode };
  if (startsIn <= 48 * 60 * 60 * 1000) return { href: `/room/${night.eventSlug}`, label: "Enter the Room", icon: MessageCircle };
  return { href: `/my-nights/${night.eventSlug}`, label: "Open my Night", icon: ArrowUpRight };
}

export default function MyNightsClient() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [view, setView] = useState<View>("upcoming");
  const [now] = useState(() => Date.now());
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryState, setRecoveryState] = useState<"idle" | "sending" | "sent">("idle");
  const [recoveryError, setRecoveryError] = useState("");
  const recoveryBusy = useRef(false);
  const [unread, setUnread] = useState(0);
  const [recovered] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("recovered") === "1");

  useEffect(() => {
    fetch("/api/customer/my-nights", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) { setLocked(true); return null; }
        const data = await response.json() as Payload & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "My Nights could not be prepared.");
        return data;
      })
      .then((data) => { setPayload(data); setLoading(false); })
      .catch(() => { setLocked(true); setLoading(false); });
    void fetch("/api/customer/notifications", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ unread?: number }> : null)
      .then((result) => setUnread(result?.unread ?? 0))
      .catch(() => setUnread(0));
  }, []);

  async function requestRecovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recoveryBusy.current || recoveryState !== "idle") return;
    recoveryBusy.current = true;
    setRecoveryState("sending");
    setRecoveryError("");
    try {
      await requestJson("/api/customer/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: recoveryEmail }) });
      setRecoveryState("sent");
    } catch (error) {
      setRecoveryError(requestErrorMessage(error));
      setRecoveryState("idle");
    } finally {
      recoveryBusy.current = false;
    }
  }

  const nights = useMemo(() => {
    return (payload?.nights ?? []).filter((night) => {
      if (view === "following") return night.keepPosted || !night.purchased;
      if (!night.purchased) return false;
      return view === "past" ? new Date(night.endsAt).getTime() < now : new Date(night.endsAt).getTime() >= now;
    });
  }, [now, payload, view]);

  if (loading) return <LoadingSkeleton kind="wallet" label="Lining up your nights" />;

  return <main className="my-nights-page">
    <header className="directory-header"><Link href="/" aria-label="Back to home"><ArrowLeft size={16} /><span className="directory-header__back-label">Home</span></Link><Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link><span className="my-nights-header-actions"><Link className="notification-bell" href="/notifications" aria-label={unread ? `${unread} unread notifications` : "Notifications"}><Bell size={16} />{unread ? <b>{unread > 9 ? "9+" : unread}</b> : null}</Link><Link href="/account/privacy"><ShieldCheck size={15} /> Privacy</Link></span></header>
    <section className="my-nights-shell">
      <header><div><p className="eyebrow">Tickets, perks and the Room</p><h1>{loading ? "Gathering your evidence…" : payload ? `${payload.attendee.displayName}’s nights.` : "Been here before? Good."}</h1><p className="my-nights-intro">Everything your ticket unlocked, exactly where you left it. No password archaeology.</p></div>{payload ? <span><LockKeyhole size={13} /> The useful kind of exclusive</span> : null}</header>
      {recovered && payload ? <div className="my-nights-recovered"><CheckCircle2 size={18} /><span><b>Your nights are back.</b> Fresh passes, familiar plans. We love a clean recovery.</span></div> : null}
      {loading ? <div className="my-nights-loading"><Loader2 className="spin" /> Lining up your nights</div> : locked ? <section className="my-nights-locked"><Ticket size={30} /><h2>Use the email you paid with. We’ll do the remembering.</h2><p>Same checkout email. One private link. Your tickets, perks and Rooms, all back where you can find them.</p><form className="my-nights-recovery" onSubmit={requestRecovery}><label>Email used at checkout<input type="email" required autoComplete="email" value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} placeholder="you@example.com" /></label><ActionButton type="submit" disabled={recoveryState !== "idle"} aria-busy={recoveryState === "sending"} icon={recoveryState === "sending" ? <Loader2 className="spin" size={17} /> : <Mail size={17} />}>{recoveryState === "sending" ? "Sending…" : recoveryState === "sent" ? "Check your email" : "Bring back my Nights"}</ActionButton></form>{recoveryError ? <p className="my-nights-recovery-error" role="alert">{recoveryError}</p> : null}{recoveryState === "sent" ? <small>If that email has paid tickets, your one-time access link is on its way. Inbox ownership gets the final say.</small> : null}<div><Link href="/events">I’m new here</Link><Link href="/tickets">Just need the wallet</Link></div></section> : <>
        <nav className="my-nights-tabs" aria-label="My Nights views">{(["upcoming", "past", "following"] as const).map((item) => <button key={item} type="button" aria-current={view === item ? "page" : undefined} onClick={() => setView(item)}>{item === "upcoming" ? "Upcoming" : item === "past" ? "Past" : "Following"}</button>)}</nav>
        {nights.length ? <div className="my-nights-list">{nights.map((night) => {
          const action = nextAction(night, now);
          const ActionIcon = action.icon;
          return <article key={night.eventSlug}><img src={night.imageUrl} alt={`Atmosphere for ${night.title}`} /><div><p>{night.isTestEvent ? "Working preview" : night.purchased ? `${night.ticketCount} ${night.ticketCount === 1 ? "ticket" : "tickets"}` : "Following"}</p><h2>{night.title}</h2><span><CalendarDays size={13} /> {new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(night.startsAt))}</span><span><MapPin size={13} /> {night.venue}, {night.area}</span>{night.hostName ? <small>Hosted by {night.hostName}</small> : null}</div><aside>{night.updateCount ? <span><Bell size={12} /> {night.updateCount} {night.updateCount === 1 ? "update" : "updates"}</span> : null}{night.purchased ? <div className="my-nights-actions"><Link href={action.href}>{action.label} <ActionIcon size={14} /></Link><Link href={`/my-nights/${night.eventSlug}?view=perks`}>Ticket &amp; perks</Link></div> : <Link href={`/event/${night.eventSlug}`}>View event <ArrowUpRight size={14} /></Link>}</aside></article>;
        })}</div> : <section className="my-nights-empty"><h2>This tab is suspiciously tidy.</h2><p>{view === "following" ? "Use Keep me posted on an event or follow a Host. A little anticipation is healthy." : view === "past" ? "Your attended nights will gather here, evidence and all." : "Your next paid ticket will appear here automatically. No filing cabinet required."}</p><Link href="/events">Find a night</Link></section>}
      </>}
    </section>
  </main>;
}
