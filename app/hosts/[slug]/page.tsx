/* eslint-disable @next/next/no-img-element -- approved host and event assets are served directly. */
import type { Metadata } from "next";
import HostPortrait from "../../host-portrait";
import BoxOfficeHeader from "../../box-office-header";
import BoxOfficeFooter from "../../box-office-footer";
import { ActionLink } from "../../action";
import Link from "next/link";
import { ArrowUpRight, CalendarDays, Instagram } from "lucide-react";
import { notFound } from "next/navigation";
import MemberActions from "../../member-actions";
import { getPublicEvents } from "../../events";
import { isWebsiteListedEvent } from "../../../lib/website-event-listings";
import { eventTiming, findHostBySlug, listHostEventSlugs } from "../../../lib/event-experience";
import "../hosts.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { env } = await import("cloudflare:workers");
  const host = await findHostBySlug(env.DB, slug);
  if (!host) return { title: "Host not found" };
  return {
    title: host.name, description: host.bio,
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
  const events = allEvents.filter((event) => isWebsiteListedEvent(event) && eventSlugs.includes(event.slug) && eventTiming(event) !== "past");
  return <main className="host-page hosts-box-office">
    <BoxOfficeHeader />
    <div className="hosts-box-office__content">
      <Link href="/hosts" className="host-profile__back">Back to Hosts</Link>
      <section className="host-ticket host-ticket--profile" aria-labelledby="host-name">
        <div className="host-ticket__copy">
          {host.brandName?.trim() ? <p className="hosts-box-office__label">{host.brandName}</p> : null}
          <h1 id="host-name">{host.name}</h1>
          <p className="host-ticket__brand">{host.city}{host.verificationStatus === "verified" ? " · Verified host" : ""}</p>
          <p className="host-ticket__bio">{host.bio}</p>
          {host.instagramHandle || host.snapchatHandle ? <nav className="host-profile__socials" aria-label={`${host.name} on social media`}>
            {host.instagramHandle ? <a href={`https://www.instagram.com/${encodeURIComponent(host.instagramHandle)}/`} target="_blank" rel="noopener noreferrer"><Instagram size={18} aria-hidden="true" /><span>Instagram<small>@{host.instagramHandle}</small></span><ArrowUpRight size={16} aria-hidden="true" /></a> : null}
            {host.snapchatHandle ? <a href={`https://www.snapchat.com/add/${encodeURIComponent(host.snapchatHandle)}`} target="_blank" rel="noopener noreferrer"><span>Snapchat<small>@{host.snapchatHandle}</small></span><ArrowUpRight size={16} aria-hidden="true" /></a> : null}
          </nav> : null}
          <MemberActions hostSlug={host.slug} />
        </div>
        <div className="host-ticket__stub">
          <HostPortrait host={host} variant="profile" />
        </div>
      </section>
      <section className="host-events" aria-labelledby="host-nights-heading">
        <header><p className="hosts-box-office__label">From {host.name}</p><h2 id="host-nights-heading">Next on the list</h2></header>
        {events.length ? <div>{events.map((event) => <article key={event.slug}>
          <img src={event.image} alt={`Poster for ${event.title}`} loading="lazy" />
          <div><span>{event.shortDate} · {event.area}</span><h3>{event.title}</h3><p>{event.registrationMode === "rsvp" ? "RSVP" : event.registrationMode === "interest" ? "Keep me posted" : `From GH₵${event.price}`}</p><Link href={`/event/${event.slug}`}>See the night <ArrowUpRight size={14} /></Link></div>
        </article>)}</div> : <div className="host-profile__empty"><p>The next invite is still under wraps. Keep an eye here.</p><ActionLink href="/events" variant="secondary" icon={<CalendarDays size={17} />}>Browse events</ActionLink></div>}
      </section>
    </div>
    <BoxOfficeFooter />
  </main>;
}
