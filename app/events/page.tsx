import BrandLogo from "../brand-logo";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import EventExplorer from "../event-explorer";
import { getPublicEvents } from "../events";
import PublicNavigation from "../mobile-navigation";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await getPublicEvents();
  return <main className="directory-page discovery-directory">
    <header className="directory-header"><Link href="/" aria-label="Back to home"><ArrowLeft size={16} /><span className="directory-header__back-label">Home</span></Link><Link href="/" className="brand-mark"><BrandLogo /></Link><PublicNavigation /></header>
    <section className="directory-intro"><p className="eyebrow">The Drop / Accra, Ghana</p><h1>Find your next night.</h1><p>Late sets, day parties and very convincing reasons to leave the house.</p></section>
    <section className="directory-results"><EventExplorer events={events} full /></section>
  </main>;
}
