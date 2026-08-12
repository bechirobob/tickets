import Link from "next/link";
import { ArrowLeft, Ticket } from "lucide-react";
import EventExplorer from "../event-explorer";
import { getPublicEvents } from "../events";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await getPublicEvents();
  return <main className="directory-page">
    <header className="directory-header"><Link href="/"><ArrowLeft size={16} /> Home</Link><Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link><Link href="/my-nights" className="customer-dock-duplicate"><Ticket size={15} /> My Nights</Link></header>
    <section className="directory-intro"><p className="eyebrow">The Drop</p><h1>Accra, edited.</h1><p>Verified Hosts, clear ticket terms and nights worth leaving home for. Filter the full list without scrolling past a sales pitch.</p></section>
    <section className="directory-results"><EventExplorer events={events} full /></section>
  </main>;
}
