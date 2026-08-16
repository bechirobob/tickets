/* eslint-disable @next/next/no-img-element -- event artwork already carries provider-side sizing; the public optimizer cannot safely proxy every approved host source. */
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, BadgeCheck, MapPin } from "lucide-react";
import { notFound } from "next/navigation";
import MemberActions from "../../member-actions";
import { getPublicEvents } from "../../events";
import { findHostBySlug, listHostEventSlugs } from "../../../lib/event-experience";
import PublicNavigation from "../../mobile-navigation";

export const dynamic = "force-dynamic";

export default async function HostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { env } = await import("cloudflare:workers");
  const host = await findHostBySlug(env.DB, slug);
  if (!host) notFound();
  const [eventSlugs, allEvents] = await Promise.all([listHostEventSlugs(env.DB, host.id), getPublicEvents()]);
  const events = allEvents.filter((event) => eventSlugs.includes(event.slug));
  return <main className="host-page"><header className="directory-header"><Link href="/hosts" aria-label="Back to hosts"><ArrowLeft size={16} /><span className="directory-header__back-label">Hosts</span></Link><Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link><PublicNavigation /></header><section className="host-profile"><div className="host-monogram host-monogram--large">{host.name.split(/\s+/u).map((word) => word[0]).join("").slice(0, 2)}</div><div><p className="eyebrow">{host.verificationStatus === "verified" ? <><BadgeCheck size={14} /> Verified Host</> : "Reviewed Host"}</p><h1>{host.name}</h1><span><MapPin size={13} /> {host.city}</span><p>{host.bio}</p><MemberActions hostSlug={host.slug} /></div></section><section className="host-events"><header><p className="eyebrow">From this Host</p><h2>Upcoming nights</h2></header>{events.length ? <div>{events.map((event) => <article key={event.slug}><img src={event.image} alt={`Atmosphere for ${event.title}`} /><div><span>{event.shortDate} · {event.area}</span><h3>{event.title}</h3><p>From GH₵{event.price}</p><Link href={`/event/${event.slug}`}>See the night <ArrowUpRight size={14} /></Link></div></article>)}</div> : <p className="host-events__empty">No public night is scheduled yet. Follow this Host from a member account and My Nights will keep the place.</p>}</section></main>;
}
