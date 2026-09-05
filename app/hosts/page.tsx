import Link from "next/link";
import { ArrowLeft, BadgeCheck } from "lucide-react";
import { ActionLink } from "../action";
import PublicNavigation from "../mobile-navigation";

type HostRow = { slug: string; name: string; bio: string; city: string; verificationStatus: string; eventCount: number; nextEventAt: string | null };

export const dynamic = "force-dynamic";

export default async function HostsPage() {
  const { env } = await import("cloudflare:workers");
  const hosts = await env.DB.prepare(`
    SELECT host.slug, host.name, host.bio, host.city, host.verification_status AS verificationStatus,
           COUNT(DISTINCT event.slug) AS eventCount, MIN(CASE WHEN datetime(event.starts_at) > CURRENT_TIMESTAMP THEN event.starts_at END) AS nextEventAt
    FROM hosts host
    LEFT JOIN event_hosts link ON link.host_id = host.id
    LEFT JOIN curated_event_records event ON event.slug = link.event_slug
      AND (event.status = 'published' OR (event.status = 'scheduled' AND datetime(event.scheduled_publish_at) <= CURRENT_TIMESTAMP))
    GROUP BY host.id ORDER BY nextEventAt IS NULL, nextEventAt, host.name
  `).all<HostRow>();
  return <main className="hosts-page"><header className="directory-header"><Link href="/" aria-label="Back to home"><ArrowLeft size={16} /><span className="directory-header__back-label">Home</span></Link><Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link><PublicNavigation /></header><section className="directory-intro"><p className="eyebrow">Hosts</p><h1>Meet the usual instigators.</h1><p>The people giving Accra somewhere to be. Meet the Hosts, see their nights and follow your favourites after your first verified ticket.</p></section><section className="hosts-list">{hosts.results.map((host) => <article key={host.slug}><div className="host-monogram">{host.name.split(/\s+/u).map((word) => word[0]).join("").slice(0, 2)}</div><div><p>{host.verificationStatus === "verified" ? <><BadgeCheck size={13} /> Verified Host</> : "Reviewed Host"}</p><h2>{host.name}</h2><span>{host.city} · {host.eventCount} {Number(host.eventCount) === 1 ? "night" : "nights"}</span><p>{host.bio}</p><ActionLink href={`/hosts/${host.slug}`} variant="text">View Host</ActionLink></div></article>)}</section></main>;
}
