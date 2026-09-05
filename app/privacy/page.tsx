import BrandLogo from "../brand-logo";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import PublicNavigation from "../mobile-navigation";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return <main className="legal-page">
    <header><Link href="/"><ArrowLeft size={16} /> Back to events</Link><span className="brand-mark"><BrandLogo /></span><PublicNavigation /></header>
    <article>
      <p className="eyebrow"><ShieldCheck size={14} /> Privacy notice</p>
      <h1>Your ticket needs some information. The crowd does not.</h1>
      <p className="legal-updated">Effective 12 August 2026</p>
      <section><h2>What BeCore Tickets collects</h2><p>We collect the name, email address and phone number supplied at checkout, order and payment references, event and ticket selections, ticket status, gate check-in records, and security records needed to protect The Room and prevent ticket abuse. If you use member features, we also store Host and event follows, attendee-visibility choices, privacy defaults, Night Update preferences, and answers you choose to give Before the Night. We count a small set of daily product events—such as event views, checkout steps, shares and app installations—in aggregate, without creating an advertising profile or attaching those counts to your name, email or phone number. Paystack processes payment credentials; BeCore Tickets does not store card or Mobile Money PIN details.</p></section>
      <section><h2>Why we use it</h2><p>We use this information to reserve inventory, confirm payment, issue and recover tickets, operate entry scanning, provide receipts, unlock ticket-holder features, handle refunds and disputes, provide support, prevent fraud, and maintain financial and security records.</p></section>
      <section><h2>Who receives it</h2><p>Payment data is exchanged with Paystack for transaction processing and verification. Transactional email details are sent to the configured delivery provider. Approved organisers and gate staff receive only the operational information required for their role. We do not sell attendee data.</p></section>
      <section><h2>The Room and Flashes</h2><p>The Room is limited to verified ticket holders. Room and Host notifications are on by default for eligible ticket holders; the Room bell controls that Night&apos;s preference, while system notification permission remains your browser or device choice. An eligible VIP ticket may display a small VIP identity beside your Room messages. VIP concierge requests and their service status are private to you and the authorised event team for that Night. If you post a Flash, we remove embedded photo metadata, create a smaller WebP copy, and use automated safety review before it appears. The original upload is not kept. Active Flashes are stored privately, can be reported to moderators, and are permanently deleted when you remove your own Flash or when the event Room closes. A disabled download menu can discourage casual saving, but no website can prevent someone from taking a screenshot or photographing a screen.</p></section>
      <section><h2>My Nights and “I&apos;m in”</h2><p>My Nights unlocks only after a verified ticket purchase. Your attendee visibility is off by default. If you turn on “I&apos;m in,” other ticket holders see only an aggregate attendee count unless a later feature asks for separate, explicit permission to display your name. Before the Night answers are available only to authorised event staff for the relevant event and are not placed in the public listing or The Room.</p></section>
      <section><h2>Retention and control</h2><p>Financial and entry records are retained for legal, accounting, refund and fraud-prevention needs. Aggregate product counts are retained for 180 days. Expired recovery links and sessions are invalidated automatically. You may request access, correction or deletion where the law permits by contacting <a href="mailto:contact@becoreops.com">contact@becoreops.com</a>.</p></section>
      <section><h2>Security, without the mysterious fog</h2><p>A payment return proves ownership of that order only; it cannot reveal other tickets that happen to use the same email. Joining purchases into one wallet requires a one-time link delivered to that inbox. Ticket, recovery and session secrets are stored as one-way hashes. QR passes rotate when the verified wallet opens, and no name, email, phone number or payment reference is embedded in the QR code. Screenshots can try their luck elsewhere.</p></section>
    </article>
  </main>;
}
