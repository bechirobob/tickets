import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { ActionLink } from "../action";
import PublicNavigation from "../mobile-navigation";

export const metadata: Metadata = {
  title: "About us",
  description: "Accra nights worth leaving the house for. Find your people, get your tickets and give the group chat an actual plan.",
};

const reasons = [
  ["01", "The good stuff, edited.", "Fewer random listings. More nights worth leaving the house for, presented clearly enough to choose without opening fifteen tabs."],
  ["02", "Your people are already in the Room.", "A private space for the people actually going: Host updates, conversation and Flashes that disappear when the Room closes. Eligible VIP tickets can add private requests for bottle service, song suggestions or assistance when the Host enables them. The DJ still gets the final say."],
  ["03", "A good night deserves an encore.", "Organisers can see which tickets sold, which promoters brought people and when the crowd arrived. Useful numbers for the next party, kept in a private dashboard. Customer payment details stay private."],
  ["04", "Made for how Accra moves.", "Pay with Mobile Money, Visa or Mastercard through Paystack. Keep your passes on your phone. And when something needs a human, ask for help. Even a very good night can misplace an email."],
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
      <h1>“We should go out”<br />needed a plan.</h1>
      <div className="about-hero__story">
        <p>You know the chat. Someone suggests a night out, six people say they’re in, and nobody picks a place. BeCore Tickets gives Accra an actual plan.</p>
        <p>Find a night worth dressing for, get your tickets and meet the people going in The Room. If you’re throwing the party, we help with sales, guest updates and the door. You can get back to arguing about the line-up.</p>
      </div>
    </section>

    <figure className="about-atmosphere">
      <Image src="https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1600&q=80" width={1600} height={700} sizes="100vw" alt="A concert crowd under colourful stage lighting" unoptimized />
    </figure>

    <section className="about-reasons" aria-label="Why BeCore Tickets">
      {reasons.map(([number, title, copy]) => <article key={number}>
        <span>{number}</span>
        <div><h2>{title}</h2><p>{copy}</p></div>
      </article>)}
    </section>

    <section className="about-close">
      <p>The outfit can wait.<br />Pick the night first.</p>
      <div><ActionLink href="/events">See what is dropping</ActionLink><ActionLink href="/organizer/submit" variant="text">Bring us your night</ActionLink></div>
    </section>
  </main>;
}
