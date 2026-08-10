"use client";

import Link from "next/link";
import { ArrowLeft, BadgeCheck, CalendarDays, LogOut, MapPin, MessageCircle, Ticket } from "lucide-react";
import { useEffect, useState } from "react";

type Wallet = { attendee: { displayName: string }; events: Array<{ eventSlug: string; ticketCount: number; title?: string; date?: string; venue?: string }> };
const DETAILS: Record<string, { title: string; date: string; venue: string }> = {
  "after-dark-osu": { title: "After Dark: Osu", date: "Fri, 14 Aug · 10:00 PM", venue: "The Treehouse, Osu" },
  "noir-room-labone": { title: "The Noir Room", date: "Sat, 15 Aug · 9:30 PM", venue: "The Glass House, Labone" },
  "sun-chasers-labadi": { title: "Sun Chasers", date: "Sun, 16 Aug · 3:00 PM", venue: "The Cove, Labadi" },
  "longitude-spintex": { title: "Longitude 05", date: "Fri, 21 Aug · 11:00 PM", venue: "Untamed Empire, Spintex" },
};

export default function TicketWallet() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/customer/session", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<Wallet> : null)
      .then((data) => { setWallet(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  async function signOut() {
    await fetch("/api/customer/session", { method: "DELETE" });
    setWallet(null);
  }
  return <main className="wallet-page wallet-page--real">
    <header><Link href="/"><ArrowLeft size={17} /> Back to the shortlist</Link><span className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></span>{wallet ? <button onClick={signOut}><LogOut size={14} /> Sign out</button> : <span />}</header>
    <section><Ticket size={38} /><p className="eyebrow">Your ticket wallet</p><h1>{loading ? "Finding your tickets…" : wallet ? `Good to see you, ${wallet.attendee.displayName}.` : "Your verified tickets live here."}</h1>
      {!loading && !wallet && <div className="wallet-locked"><BadgeCheck /><h2>Access starts after a verified checkout.</h2><p>Complete payment in the same browser and we’ll unlock your ticket wallet and event Room automatically. We never grant access from a screenshot or public event link.</p><Link href="/#drop">Choose an event</Link></div>}
      {wallet?.events.map((item) => {
        const detail = DETAILS[item.eventSlug] ?? { title: item.eventSlug.replaceAll("-", " "), date: "Event date confirmed in your order", venue: "See event details" };
        return <article key={item.eventSlug}><div><small><BadgeCheck size={12} /> Verified attendee · {item.ticketCount} {item.ticketCount === 1 ? "ticket" : "tickets"}</small><h2>{detail.title}</h2><p><CalendarDays size={15} /> {detail.date}</p><p><MapPin size={15} /> {detail.venue}</p></div><Link href={`/room/${item.eventSlug}`}><MessageCircle size={16} /> Enter The Room</Link></article>;
      })}
    </section>
  </main>;
}
