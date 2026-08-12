import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

export const metadata: Metadata = {
  title: "About us — BeCore Tickets",
  description: "Why BeCore Tickets is building a sharper, more accountable way to find and run nights in Accra.",
};

const reasons = [
  ["01", "The good stuff, edited.", "Fewer random listings. More nights worth leaving the house for, presented clearly enough to choose without opening fifteen tabs."],
  ["02", "The Room comes with the ticket.", "Plans, verified Host updates, live conversation and disappearing Flashes stay with the people who are actually going."],
  ["03", "Organisers keep the full story.", "Every submission, decision, event, attendee and operational request belongs to one accountable record—not a trail of screenshots and DMs."],
  ["04", "Made for how Accra moves.", "Mobile-first tickets, locally familiar checkout, gate-ready access and human help when a real night needs a real answer."],
];

export default function AboutPage() {
  return <main className="about-page">
    <header className="directory-header">
      <Link href="/"><ArrowLeft size={16} /> Home</Link>
      <Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link>
      <Link href="/events" className="customer-dock-duplicate">The Drop</Link>
    </header>

    <section className="about-hero">
      <p className="eyebrow">About BeCore Tickets</p>
      <h1>Accra plans differently.<br />So do we.</h1>
      <div className="about-hero__story">
        <p>BeCore Tickets is not a listings dump with a payment button. We are building the place Accra checks before deciding where the night is going.</p>
        <p>For guests, that means a sharper edit, a familiar way to pay, tickets that stay easy to find and a private Room that carries the plan into the party. For organisers, it means one proper record from submission and approval through sales, entry, updates and support.</p>
      </div>
    </section>

    <section className="about-reasons" aria-label="Why BeCore Tickets">
      {reasons.map(([number, title, copy]) => <article key={number}>
        <span>{number}</span>
        <div><h2>{title}</h2><p>{copy}</p></div>
      </article>)}
    </section>

    <section className="about-close">
      <p>We want to become Accra&apos;s first call for events and parties by making every part of the night feel better—not by simply calling ourselves the biggest.</p>
      <div><Link href="/events">See what is dropping <ArrowUpRight size={15} /></Link><Link href="/organizer/submit">Bring us your night <ArrowUpRight size={15} /></Link></div>
    </section>
  </main>;
}
