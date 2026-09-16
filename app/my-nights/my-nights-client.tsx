/* eslint-disable @next/next/no-img-element -- private event artwork must not use a shared optimizer cache. */
"use client";

import MyRegistrations from "../my-registrations";
import BrandLogo from "../brand-logo";
import PublicNavigation from "../mobile-navigation";
import NotificationBell from "../notification-bell";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ActionButton, ActionLink } from "../action";
import { ArrowLeft, ArrowUpRight, Bell, CheckCircle2, ChevronRight, Loader2, Mail, MapPin, MessageCircle, QrCode, Search, ShieldCheck, Ticket, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCurrentTime } from "../use-current-time";
import LoadingSkeleton from "../loading-skeleton";
import { requestJson, requestErrorMessage, RequestError } from "../../lib/client-request";

type Night = {
  roomAccess?: boolean; eventSlug: string; title: string; startsAt: string | null; endsAt: string | null; venue: string; area: string; imageUrl: string;
  eventState: string; isTestEvent: boolean; ticketCount: number; purchased: boolean; keepPosted: boolean;
  attendeeVisible: boolean; hostSlug: string | null; hostName: string | null; updateCount: number; questionCount: number;
};
type Payload = { attendee: { displayName: string }; nights: Night[] };
const views = ["upcoming", "past", "following", "rsvps"] as const;
type View = typeof views[number];
function resolveView(value: string | null): View { return views.includes(value as View) ? value as View : "upcoming"; }
function ended(night: Night, now: number) { return Boolean(night.endsAt && Date.parse(night.endsAt) <= now); }
function belongs(night: Night, view: View, now: number) {
  if (view === "rsvps") return false;
  if (view === "following") return night.keepPosted || !night.purchased;
  return night.purchased && (view === "past" ? ended(night, now) : !ended(night, now));
}
function nextAction(night: Night, now: number) {
  const base = `/my-nights/${night.eventSlug}`;
  if (!night.startsAt || !night.endsAt) return { href: `${base}?view=details`, label: "See event details", icon: Bell };
  if (["cancelled", "postponed"].includes(night.eventState)) return { href: `${base}?view=details`, label: "See what changed", icon: Bell };
  if (ended(night, now)) return { href: `${base}?view=details`, label: "Look back", icon: ArrowUpRight };
  return { href: `${base}?view=passes`, label: night.roomAccess === false ? "Show my RSVP pass" : "Show my ticket", icon: QrCode };
}
function datePart(value: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-GH", { ...options, timeZone: "Africa/Accra" }).format(new Date(value));
}

export default function MyNightsClient() {
  const params = useSearchParams();
  const requestedView = resolveView(params.get("view"));
  const [view, setView] = useState(requestedView);
  const [previousView, setPreviousView] = useState(requestedView);
  if (requestedView !== previousView) { setPreviousView(requestedView); setView(requestedView); }
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [registrationCount, setRegistrationCount] = useState(0);
  const now = useCurrentTime();
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryState, setRecoveryState] = useState<"idle" | "sending" | "sent">("idle");
  const [recoveryError, setRecoveryError] = useState("");
  const recoveryBusy = useRef(false);
  const recovered = params.get("recovered") === "1";
  const activeView = locked && registrationCount > 0 && view === "upcoming" ? "rsvps" : view;

  const load = useCallback(() => requestJson<Payload>("/api/customer/my-nights", { cache: "no-store" })
    .then((data) => {
      if (!data.attendee || !Array.isArray(data.nights)) throw new Error("We couldn’t load your nights. Try again.");
      setPayload(data); setLocked(false); setLoadError("");
    }).catch((error) => {
      if (error instanceof RequestError && error.status === 401) { setPayload(null); setLocked(true); }
      else setLoadError(requestErrorMessage(error));
    }).finally(() => setLoading(false)), []);
  useEffect(() => { void load(); }, [load]);

  function chooseView(next: View) {
    setView(next);
    const url = new URL(window.location.href);
    url.searchParams.set("view", next);
    window.history.replaceState(window.history.state, "", url);
  }
  async function requestRecovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (recoveryBusy.current || recoveryState !== "idle") return;
    recoveryBusy.current = true; setRecoveryState("sending"); setRecoveryError("");
    try {
      await requestJson("/api/customer/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: recoveryEmail }) });
      setRecoveryState("sent");
    } catch (error) { setRecoveryError(requestErrorMessage(error)); setRecoveryState("idle"); }
    finally { recoveryBusy.current = false; }
  }
  const counts = useMemo(() => Object.fromEntries(views.map(item => [item, item === "rsvps" ? registrationCount : (payload?.nights ?? []).filter(night => belongs(night, item, now)).length])) as Record<View, number>, [payload, now, registrationCount]);
  const nights = useMemo(() => (payload?.nights ?? [])
    .filter(night => belongs(night, activeView, now) && `${night.title} ${night.venue} ${night.area}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => {
      const aTime = a.startsAt ? Date.parse(a.startsAt) : Infinity;
      const bTime = b.startsAt ? Date.parse(b.startsAt) : Infinity;
      return activeView === "past" ? bTime - aTime : aTime - bTime;
    }), [payload, activeView, now, query]);

  if (loading) return <LoadingSkeleton kind="wallet" label="Lining up your nights" />;
  const member = Boolean(payload) || registrationCount > 0;
  return <main className="my-nights-page my-nights-page--studio">
    <header className="directory-header"><Link href="/events" aria-label="Back to The Drop"><ArrowLeft size={16} /><span className="directory-header__back-label">The Drop</span></Link><Link href="/" className="brand-mark"><BrandLogo /></Link><span className="my-nights-header-actions"><PublicNavigation /><NotificationBell /></span></header>
    <section className="my-nights-shell">
      <header className="nights-heading"><div><p className="eyebrow">{payload ? `For ${payload.attendee.displayName}` : "BeCore Tickets"}</p><h1>My Nights<span aria-hidden="true">.</span></h1></div><Link className="nights-privacy" href="/account/privacy"><ShieldCheck size={17} /><span>Privacy</span></Link></header>
      {recovered && payload ? <div className="my-nights-recovered" role="status"><CheckCircle2 size={18} /><span>Your nights are back.</span></div> : null}
      {member ? <div className="nights-toolbar"><nav className="my-nights-tabs night-glass" aria-label="My Nights views">{views.map(item => <button key={item} type="button" aria-current={activeView === item ? "page" : undefined} onClick={() => chooseView(item)}>{item === "upcoming" ? "Upcoming" : item === "past" ? "Past" : item === "following" ? "Following" : "RSVPs"}<span aria-label={`${counts[item]} ${item === "rsvps" ? "registrations" : "nights"}`}>{counts[item]}</span></button>)}</nav>{(payload?.nights.length ?? 0) > 3 && activeView !== "rsvps" ? <label className="nights-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Find a night" placeholder="Find a night" value={query} onChange={e => setQuery(e.target.value)} />{query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={16} /></button> : null}</label> : null}</div> : null}
      <div hidden={activeView !== "rsvps" || !member} className="nights-registration-view"><MyRegistrations onCountChange={setRegistrationCount} /></div>
      {loadError ? <section className="my-nights-empty"><h2>Your nights are taking a moment.</h2><p role="alert">{loadError}</p><ActionButton onClick={() => { setLoading(true); setLoadError(""); void load(); }}>Try again</ActionButton></section> : !member && locked ? <section className="my-nights-locked"><Ticket size={30} /><h2>Your plans are still here.</h2><p>Use your booking email. We’ll send a link to your tickets and RSVPs.</p><form className="my-nights-recovery" onSubmit={requestRecovery}><label>Booking or registration email<input type="email" required autoComplete="email" value={recoveryEmail} onChange={event => setRecoveryEmail(event.target.value)} placeholder="you@example.com" /></label><ActionButton type="submit" disabled={recoveryState !== "idle"} aria-busy={recoveryState === "sending"} icon={recoveryState === "sending" ? <Loader2 className="spin" size={17} /> : <Mail size={17} />}>{recoveryState === "sending" ? "Sending…" : recoveryState === "sent" ? "Check your email" : "Bring back my Nights"}</ActionButton></form>{recoveryError ? <p className="my-nights-recovery-error" role="alert">{recoveryError}</p> : null}{recoveryState === "sent" ? <div className="nights-recovery-sent" role="status"><p>If that email has tickets or RSVPs, your access link is on its way.</p><button type="button" onClick={() => setRecoveryState("idle")}>Use another email</button></div> : null}<div><Link href="/events">Find my first night <ArrowUpRight size={16} /></Link></div></section> : activeView !== "rsvps" ? <>
        {nights.length ? <div className="nights-collection">{nights.map((night, index) => {
          const action = nextAction(night, now); const ActionIcon = action.icon;
          const changed = ["cancelled", "postponed"].includes(night.eventState);
          const live = Boolean(night.startsAt && Date.parse(night.startsAt) <= now && !ended(night, now) && !changed);
          const canEnterRoom = night.purchased && night.roomAccess !== false && !changed && !ended(night, now);
          const featured = activeView === "upcoming" && index === 0 && !query.trim();
          return <article className={`night-listing${featured ? " night-listing--next" : ""}`} key={night.eventSlug}>
            <Link href={night.purchased ? `/my-nights/${night.eventSlug}?view=details` : `/event/${night.eventSlug}`} className="night-listing__art" tabIndex={-1} aria-hidden="true"><img src={night.imageUrl} alt="" loading={index ? "lazy" : "eager"} /></Link>
            <div className="night-listing__body"><div className="night-listing__status"><span>{night.isTestEvent ? "Preview" : changed ? night.eventState === "cancelled" ? "Cancelled" : "Date to be confirmed" : live ? "Happening now" : featured ? "Up next" : activeView === "past" ? "Past night" : night.purchased ? "You’re going" : "On your radar"}</span>{night.purchased ? <span><Ticket size={13} />{night.ticketCount} {night.ticketCount === 1 ? "pass" : "passes"}</span> : null}</div>
            <h2><Link href={night.purchased ? `/my-nights/${night.eventSlug}?view=details` : `/event/${night.eventSlug}`}>{night.title}<ChevronRight size={20} aria-hidden="true" /></Link></h2>
            <div className="night-listing__when">{night.startsAt ? <time dateTime={night.startsAt}>{datePart(night.startsAt, { weekday: "short", day: "numeric", month: "short" })}<span> · {datePart(night.startsAt, { hour: "numeric", minute: "2-digit" })}</span></time> : "Date coming soon"}</div>
            <p className="night-listing__venue"><MapPin size={15} />{night.venue}{night.area ? `, ${night.area}` : ""}</p>
            <div className="night-listing__actions">{night.purchased ? <><ActionLink href={action.href} icon={<ActionIcon size={17} />}>{action.label}</ActionLink>{canEnterRoom ? <Link className="night-listing__room" href={`/room/${night.eventSlug}`}><MessageCircle size={17} />The Room<ArrowUpRight size={14} /></Link> : null}</> : <ActionLink href={`/event/${night.eventSlug}`} icon={<ArrowUpRight size={17} />}>View event</ActionLink>}</div>
            {night.updateCount > 0 && night.purchased ? <Link className="night-listing__update" href={`/my-nights/${night.eventSlug}?view=details#host-updates`}><Bell size={13} />{night.updateCount} {night.updateCount === 1 ? "host update" : "host updates"}<ChevronRight size={13} /></Link> : null}</div>
          </article>;
        })}</div> : <section className="my-nights-empty"><Ticket size={28} aria-hidden="true" /><h2>{query.trim() ? "No matching nights." : activeView === "following" ? "Something catch your eye?" : activeView === "past" ? "The memories start here." : "Your next night is out there."}</h2><p>{query.trim() ? "Try the event name or venue." : activeView === "following" ? "Events you follow will land here." : activeView === "past" ? "Your past bookings will stay here after the event." : "Pick a night. We’ll keep your passes here."}</p>{query.trim() ? <button type="button" className="nights-text-button" onClick={() => setQuery("")}>Clear search</button> : <Link href="/events">Explore The Drop <ArrowUpRight size={16} /></Link>}</section>}
      </> : null}
    </section>
  </main>;
}
