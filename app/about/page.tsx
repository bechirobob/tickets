import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import PublicNavigation from "../mobile-navigation";

export const metadata: Metadata = {
  title: "About us",
  description: "Why BeCore Tickets is building a sharper way to find nights in Accra and a clearer way for organisers to understand what moved them.",
};

const reasons = [
  ["01", "The good stuff, edited.", "Fewer random listings. More nights worth leaving the house for, presented clearly enough to choose without opening fifteen tabs."],
  ["02", "The Room comes with the ticket.", "Plans, verified Host updates, live conversation and disappearing Flashes stay with the people who are actually going. VIP tickets can add a discreet Room identity and a private line to Host-enabled bottle service, song suggestions or assistance."],
  ["03", "Organisers see what moved the Night.", "A sales total is only the ending. BeCore connects event views, checkout conversion, sales velocity, ticket-tier sell-through, promoter performance, payment mix, check-in timing and VIP concierge use in one private organiser view—without exposing customer payment details."],
  ["04", "Made for how Accra moves.", "Mobile-first tickets, Mobile Money or Visa and Mastercard checkout through Paystack, gate-ready access and human help when a real night needs a real answer."],
];

export default function AboutPage() {
  return <main className="about-page">
    <header className="directory-header">
      <Link href="/" aria-label="Back to home"><ArrowLeft size={16} /><span className="directory-header__back-label">Home</span></Link>
      <Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link>
      <PublicNavigation />
    </header>

    <section className="about-hero">
      <p className="eyebrow">About BeCore Tickets</p>
      <h1>Accra plans differently.<br />So do we.</h1>
      <div className="about-hero__story">
        <p>BeCore Tickets is not a listings dump with a payment button. We are building the place Accra checks before deciding where the night is going.</p>
        <p>For guests, that means a sharper edit, a familiar way to pay, tickets that stay easy to find and a private Room that carries the plan into the party. For organisers, it means one proper record from submission and approval through sales, entry and support—with enough live intelligence to make the next Night better.</p>
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
