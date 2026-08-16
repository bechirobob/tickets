import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import EventExplorer from "../event-explorer";
import { getPublicEvents } from "../events";
import PublicNavigation from "../mobile-navigation";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await getPublicEvents();
  return <main className="directory-page">
    <header className="directory-header"><Link href="/"><ArrowLeft size={16} /><span className="directory-header__back-label">Home</span></Link><Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link><PublicNavigation /></header>
    <section className="directory-intro"><p className="eyebrow">The Drop</p><h1>Accra, edited.</h1><p>Verified Hosts, clear ticket terms and nights worth leaving home for. Filter the full list without scrolling past a sales pitch.</p></section>
    <section className="directory-results"><EventExplorer events={events} full /></section>
  </main>;
}
