import "./hosts.css";
import HostPortrait from "../host-portrait";
import BrandLogo from "../brand-logo";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ActionLink } from "../action";
import PublicNavigation from "../mobile-navigation";
import VelvetRope from "./velvet-rope";

type HostRow = { slug: string; name: string; brandName: string | null; brandLogoUrl: string | null; bio: string; city: string; profileImageUrl: string | null; verificationStatus: string; eventCount: number; nextEventAt: string | null };

export const dynamic = "force-dynamic";

export default async function HostsPage() {
  const { env } = await import("cloudflare:workers");
  const hosts = await env.DB.prepare(`
    SELECT host.slug, host.name, host.brand_name AS brandName, host.brand_logo_url AS brandLogoUrl, host.bio, host.city, host.profile_image_url AS profileImageUrl, host.verification_status AS verificationStatus,
           COUNT(DISTINCT event.slug) AS eventCount, MIN(CASE WHEN datetime(event.starts_at) > CURRENT_TIMESTAMP THEN event.starts_at END) AS nextEventAt
    FROM hosts host
    LEFT JOIN event_hosts link ON link.host_id = host.id
    LEFT JOIN curated_event_records event ON event.slug = link.event_slug
      AND (event.status = 'published' OR (event.status = 'scheduled' AND datetime(event.scheduled_publish_at) <= CURRENT_TIMESTAMP))
    WHERE host.id != 'host:becore-preview-desk'
    GROUP BY host.id ORDER BY nextEventAt IS NULL, nextEventAt, host.name
  `).all<HostRow>();
  return <main className="hosts-page hosts-box-office">
    <header className="directory-header">
      <Link href="/" aria-label="Back to home"><ArrowLeft size={16} aria-hidden="true" /><span className="directory-header__back-label">Home</span></Link>
      <Link href="/" className="brand-mark"><BrandLogo /></Link><PublicNavigation />
    </header>
    <div className="hosts-box-office__content">
      <section className="hosts-box-office__intro" aria-labelledby="hosts-heading">
        <p className="hosts-box-office__label">Hosts / Accra</p>
        <h1 id="hosts-heading">Meet the usual instigators.</h1>
        <p>The people giving Accra somewhere to be.</p>
      </section>
      <section className="hosts-box-office__list" aria-label="Host directory">
        {!hosts.results.length ? <div><p>Host profiles are coming soon.</p><ActionLink href="/events" variant="text">Explore nights</ActionLink></div> : null}
        {hosts.results.map((host) => <article key={host.slug} className="host-ticket host-ticket--directory">
          <div className="host-ticket__copy">
            <p className="hosts-box-office__label host-ticket__verification">
              {host.verificationStatus === "verified" ? "Verified host" : "Reviewed host"} · {host.city}
            </p>
            <h2>{host.name}</h2>
            {host.brandName?.trim() ? <p className="host-ticket__brand">{host.brandName}</p> : null}
            {host.eventCount > 0 ? <p className="host-ticket__night-count">{host.eventCount} {Number(host.eventCount) === 1 ? "night" : "nights"}</p> : null}
            <ActionLink href={`/hosts/${host.slug}`} className="host-ticket__cta" icon={<VelvetRope />} aria-label={`View host: ${host.name}`}>View host</ActionLink>
          </div>
          <div className="host-ticket__stub">
            <Link href={`/hosts/${host.slug}`} className="host-directory-portrait" aria-label={`Meet ${host.name}`} tabIndex={-1}>
              <HostPortrait host={host} variant="directory" />
            </Link>
          </div>
        </article>)}
      </section>
    </div>
  </main>;
}
