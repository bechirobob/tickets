import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import PublicNavigation from "./mobile-navigation";

export default function NotFound() {
  return <main className="recovery-page">
    <header className="directory-header"><Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link><PublicNavigation /></header>
    <section><p className="eyebrow">404 · Page not found</p><h1>This link left early.</h1><p>The page may have moved, or the link may be incomplete. Your tickets are still in My Nights.</p><nav aria-label="Find your way back"><Link href="/events">Find a night <ArrowUpRight size={17} /></Link><Link href="/my-nights"><ArrowLeft size={17} /> My Nights</Link></nav></section>
  </main>;
}
