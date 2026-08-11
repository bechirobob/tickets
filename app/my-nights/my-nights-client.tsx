"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Bell, CalendarDays, Loader2, LockKeyhole, MapPin, ShieldCheck, Ticket } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Night = {
  eventSlug: string; title: string; startsAt: string; endsAt: string; venue: string; area: string; imageUrl: string;
  eventState: string; isTestEvent: boolean; ticketCount: number; purchased: boolean; keepPosted: boolean;
  attendeeVisible: boolean; hostSlug: string | null; hostName: string | null; updateCount: number; questionCount: number;
};
type Payload = { attendee: { displayName: string }; nights: Night[] };
type View = "upcoming" | "past" | "following";

export default function MyNightsClient() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [view, setView] = useState<View>("upcoming");
  const [now] = useState(() => Date.now());

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
  }, []);

  const nights = useMemo(() => {
    return (payload?.nights ?? []).filter((night) => {
      if (view === "following") return night.keepPosted || !night.purchased;
      if (!night.purchased) return false;
      return view === "past" ? new Date(night.endsAt).getTime() < now : new Date(night.endsAt).getTime() >= now;
    });
  }, [now, payload, view]);

  return <main className="my-nights-page">
    <header className="directory-header"><Link href="/"><ArrowLeft size={16} /> Home</Link><Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link><Link href="/account/privacy"><ShieldCheck size={15} /> Privacy</Link></header>
    <section className="my-nights-shell">
      <header><div><p className="eyebrow">Ticket-earned access</p><h1>{loading ? "Gathering your evidence…" : payload ? `${payload.attendee.displayName}’s nights.` : "My Nights starts with a ticket."}</h1></div>{payload ? <span><LockKeyhole size={13} /> The useful kind of exclusive</span> : null}</header>
      {loading ? <div className="my-nights-loading"><Loader2 className="spin" /> Lining up your nights</div> : locked ? <section className="my-nights-locked"><Ticket size={30} /><h2>Your first paid ticket opens the interesting door.</h2><p>Anyone can browse The Drop. My Nights, Host follows, Before the Night and private event access start after a completed purchase. Exclusivity, but useful.</p><div><Link href="/events">Browse The Drop</Link><Link href="/tickets">Recover paid tickets</Link></div></section> : <>
        <nav className="my-nights-tabs" aria-label="My Nights views">{(["upcoming", "past", "following"] as const).map((item) => <button key={item} type="button" aria-current={view === item ? "page" : undefined} onClick={() => setView(item)}>{item === "upcoming" ? "Upcoming" : item === "past" ? "Past" : "Following"}</button>)}</nav>
        {nights.length ? <div className="my-nights-list">{nights.map((night) => <article key={night.eventSlug}><img src={night.imageUrl} alt={`Atmosphere for ${night.title}`} /><div><p>{night.isTestEvent ? "Working preview" : night.purchased ? `${night.ticketCount} ${night.ticketCount === 1 ? "ticket" : "tickets"}` : "Following"}</p><h2>{night.title}</h2><span><CalendarDays size={13} /> {new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(night.startsAt))}</span><span><MapPin size={13} /> {night.venue}, {night.area}</span>{night.hostName ? <small>Hosted by {night.hostName}</small> : null}</div><aside>{night.updateCount ? <span><Bell size={12} /> {night.updateCount} {night.updateCount === 1 ? "update" : "updates"}</span> : null}{night.purchased ? <Link href={`/my-nights/${night.eventSlug}`}>Open this night <ArrowUpRight size={14} /></Link> : <Link href={`/event/${night.eventSlug}`}>View event <ArrowUpRight size={14} /></Link>}</aside></article>)}</div> : <section className="my-nights-empty"><h2>This tab is suspiciously tidy.</h2><p>{view === "following" ? "Use Keep me posted on an event or follow a Host. A little anticipation is healthy." : view === "past" ? "Your attended nights will gather here, evidence and all." : "Your next paid ticket will appear here automatically. No filing cabinet required."}</p><Link href="/events">Find a night</Link></section>}
      </>}
    </section>
  </main>;
}
