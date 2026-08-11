import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export const metadata = { title: "Privacy · BeCore Tickets" };

export default function PrivacyPage() {
  return <main className="legal-page">
    <header><Link href="/"><ArrowLeft size={16} /> Back to events</Link><span className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></span></header>
    <article>
      <p className="eyebrow"><ShieldCheck size={14} /> Privacy notice</p>
      <h1>Your ticket needs some information. The crowd does not.</h1>
      <p className="legal-updated">Effective 11 August 2026</p>
      <section><h2>What BeCore Tickets collects</h2><p>We collect the name, email address and phone number supplied at checkout, order and payment references, event and ticket selections, ticket status, gate check-in records, and security records needed to protect The Room and prevent ticket abuse. If you use member features, we also store Host and event follows, attendee-visibility choices, privacy defaults, Night Update preferences, and answers you choose to give Before the Night. Paystack processes payment credentials; BeCore Tickets does not store card or Mobile Money PIN details.</p></section>
      <section><h2>Why we use it</h2><p>We use this information to reserve inventory, confirm payment, issue and recover tickets, operate entry scanning, provide receipts, unlock ticket-holder features, handle refunds and disputes, provide support, prevent fraud, and maintain financial and security records.</p></section>
      <section><h2>Who receives it</h2><p>Payment data is exchanged with Paystack for transaction processing and verification. Transactional email details are sent to the configured delivery provider. Approved organisers and gate staff receive only the operational information required for their role. We do not sell attendee data.</p></section>
      <section><h2>The Room and Flashes</h2><p>The Room is limited to verified ticket holders. If you post a Flash, we remove embedded photo metadata, create a smaller WebP copy, and use automated safety review before it appears. The original upload is not kept. Active Flashes are stored privately, can be reported to moderators, and are permanently deleted when the event Room closes. A disabled download menu can discourage casual saving, but no website can prevent someone from taking a screenshot or photographing a screen.</p></section>
      <section><h2>My Nights and “I&apos;m in”</h2><p>My Nights unlocks only after a verified ticket purchase. Your attendee visibility is off by default. If you turn on “I&apos;m in,” other ticket holders see only an aggregate attendee count unless a later feature asks for separate, explicit permission to display your name. Before the Night answers are available only to authorised event staff for the relevant event and are not placed in the public listing or The Room.</p></section>
      <section><h2>Retention and control</h2><p>Financial and entry records are retained for legal, accounting, refund and fraud-prevention needs. Expired recovery links and sessions are invalidated automatically. You may request access, correction or deletion where the law permits by contacting <a href="mailto:contact@becoreops.com">contact@becoreops.com</a>.</p></section>
      <section><h2>Security</h2><p>Ticket, recovery and session secrets are stored as one-way hashes. QR passes rotate when the verified wallet opens, and no name, email, phone number or payment reference is embedded in the QR code.</p></section>
    </article>
  </main>;
}
