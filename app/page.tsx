import Link from "next/link";
import { ArrowUpRight, BarChart3 } from "lucide-react";
import ActiveNightExperience from "./active-night-experience";
import { getPublicEvents } from "./events";
import ScrollReveal from "./scroll-reveal";
import PublicNavigation from "./mobile-navigation";

function BrandMark() {
  return <span className="night-brand" aria-label="BeCore Tickets"><b>B</b><span>BeCore<br />Tickets</span></span>;
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const events = await getPublicEvents();

  return <main className="night-home compact-home">
    <ScrollReveal />
    <header className="night-header">
      <Link href="/" className="night-brand-link"><BrandMark /></Link>
      <PublicNavigation />
    </header>

    <ActiveNightExperience events={events} />

    <section className="organizer-intelligence" data-scroll-reveal>
      <div className="organizer-intelligence__copy">
        <p className="night-kicker"><span /> For organisers</p>
        <BarChart3 size={25} aria-hidden="true" />
        <h2>Your Night should leave you smarter.</h2>
        <p>A sales total tells you how the story ended. BeCore shows what built the crowd, where buyers moved or dropped off and what happened when they reached the door.</p>
        <Link href="/organizer/submit">Bring us your Night <ArrowUpRight size={15} /></Link>
      </div>
      <dl>
        <div><dt>Demand</dt><dd>Event views, shares and the journey from checkout to Paystack-confirmed payment.</dd></div>
        <div><dt>Sales</dt><dd>Velocity, average order value, ticket-tier sell-through, payment mix and promoter contribution.</dd></div>
        <div><dt>Experience</dt><dd>Check-in timing, attendance and VIP concierge demand—kept with the same organiser record.</dd></div>
      </dl>
    </section>

    <footer className="night-footer compact-footer"><BrandMark /><p>Editorial nightlife outside. Private event access inside.</p><div><Link href="/admin/login">Event staff</Link><Link href="/organizer/submit">Organisers</Link><Link href="/about">About us</Link><Link href="/help">Help</Link><Link href="/privacy">Privacy</Link></div></footer>
  </main>;
}
