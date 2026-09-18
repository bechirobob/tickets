/* eslint-disable @next/next/no-img-element -- approved host and event assets are served directly. */
import type { Metadata } from "next";
import BrandLogo from "../../brand-logo";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, BadgeCheck, Instagram, MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import MemberActions from "../../member-actions";
import { getPublicEvents } from "../../events";
import { eventTiming, findHostBySlug, listHostEventSlugs } from "../../../lib/event-experience";
import PublicNavigation from "../../mobile-navigation";
import "../hosts.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { env } = await import("cloudflare:workers");
  const host = await findHostBySlug(env.DB, slug);
  if (!host) return { title: "Host not found" };
  return {
    title: `${host.name} | BeCore Tickets`, description: host.bio,
    alternates: { canonical: `/hosts/${host.slug}` },
    openGraph: { title: `${host.name} | BeCore Tickets`, description: host.bio,
      url: `/hosts/${host.slug}`, images: host.profileImageUrl ? [{ url: host.profileImageUrl, alt: host.name }] : [] },
  };
}

export default async function HostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { env } = await import("cloudflare:workers");
  const host = await findHostBySlug(env.DB, slug);
  if (!host) notFound();
  const [eventSlugs, allEvents] = await Promise.all([listHostEventSlugs(env.DB, host.id), getPublicEvents()]);
  const events = allEvents.filter((event) => eventSlugs.includes(event.slug) && eventTiming(event) !== "past");
  return <main className="host-page">
    <header className="directory-header">
      <Link href="/hosts" aria-label="Back to hosts"><ArrowLeft size={16} /><span className="directory-header__back-label">Hosts</span></Link>
      <Link href="/" className="brand-mark"><BrandLogo /></Link><PublicNavigation />
    </header>
    <section className="host-profile host-profile--portrait" aria-labelledby="host-name">
      <div className="host-profile__portrait">
        {host.profileImageUrl ? <img src={host.profileImageUrl} alt={host.name} width={886} height={1080} fetchPriority="high" />
          : <div className="host-monogram host-monogram--large">{host.name.split(/\s+/u).map((word) => word[0]).join("").slice(0, 2)}</div>}
      </div>
      <div className="host-profile__identity">
        <p className="eyebrow">{host.verificationStatus === "verified" ? <><BadgeCheck size={14} /> Verified host</> : "Meet your host"}</p>
        <h1 id="host-name">{host.name}</h1>
        {host.fullName && host.fullName !== host.name ? <p className="host-profile__full-name">{host.fullName}</p> : null}
        <span className="host-profile__city"><MapPin size={14} aria-hidden="true" /> {host.city}</span>
      </div>
      <div className="host-profile__details">
        <p className="host-profile__bio">{host.bio}</p>
        {host.instagramHandle || host.snapchatHandle ? <nav className="host-profile__socials" aria-label={`${host.name} on social media`}>
          {host.instagramHandle ? <a href={`https://www.instagram.com/${encodeURIComponent(host.instagramHandle)}/`} target="_blank" rel="noopener noreferrer"><Instagram size={18} aria-hidden="true" /><span>Instagram<small>@{host.instagramHandle}</small></span><ArrowUpRight size={16} aria-hidden="true" /></a> : null}
          {host.snapchatHandle ? <a href={`https://www.snapchat.com/add/${encodeURIComponent(host.snapchatHandle)}`} target="_blank" rel="noopener noreferrer"><span>Snapchat<small>@{host.snapchatHandle}</small></span><ArrowUpRight size={16} aria-hidden="true" /></a> : null}
        </nav> : null}
        <MemberActions hostSlug={host.slug} />
      </div>
    </section>
    <section className="host-events">
      <header><p className="eyebrow">From {host.name}</p><h2>Next on the list</h2></header>
      {events.length ? <div>{events.map((event) => <article key={event.slug}>
        <img src={event.image} alt={`Poster for ${event.title}`} loading="lazy" />
        <div><span>{event.shortDate} · {event.area}</span><h3>{event.title}</h3><p>{event.registrationMode === "rsvp" ? "RSVP" : event.registrationMode === "interest" ? "Keep me posted" : `From GH₵${event.price}`}</p><Link href={`/event/${event.slug}`}>See the night <ArrowUpRight size={14} /></Link></div>
      </article>)}</div> : <div className="host-profile__empty"><p>The next invite is still under wraps. Keep an eye here.</p><Link href="/events">See what else is on <ArrowUpRight size={15} aria-hidden="true" /></Link></div>}
    </section>
  </main>;
}
