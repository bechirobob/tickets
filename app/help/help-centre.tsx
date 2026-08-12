"use client";

import Link from "next/link";
import { ArrowUpRight, BookOpenText, Check, ChevronDown, CircleHelp, Headphones, Search, ShieldCheck, Sparkles, TicketCheck, UsersRound, X } from "lucide-react";
import { useMemo, useState } from "react";

type Audience = "Everyone" | "Going out" | "Organising" | "At the door" | "The Room";

type Guide = {
  id: string;
  audience: Exclude<Audience, "Everyone">;
  category: string;
  title: string;
  summary: string;
  steps: string[];
  action?: { href: string; label: string };
  popular?: boolean;
};

const audiences: Audience[] = ["Everyone", "Going out", "Organising", "At the door", "The Room"];

const guides: Guide[] = [
  {
    id: "find-ticket",
    audience: "Going out",
    category: "Tickets",
    title: "Find a ticket you already bought",
    summary: "Use the same email from checkout and bring every confirmed Night back together.",
    steps: ["Open My Nights.", "Enter the email used for payment.", "Use the secure link we send you. Your tickets, transfers and event updates will appear together."],
    action: { href: "/my-nights", label: "Open My Nights" },
    popular: true,
  },
  {
    id: "payment-pending",
    audience: "Going out",
    category: "Payments",
    title: "Payment completed but the ticket is missing",
    summary: "Do not pay twice. Let the original payment finish reconciling first.",
    steps: ["Keep the Paystack or Mobile Money reference.", "Refresh My Nights with the checkout email.", "If the order still does not appear, open that Night's Purchase tab or email support with the reference. Never send a QR screenshot."],
    action: { href: "/my-nights", label: "Check the purchase" },
    popular: true,
  },
  {
    id: "transfer-ticket",
    audience: "Going out",
    category: "Tickets",
    title: "Send a ticket to someone else",
    summary: "Transfer the admission from My Nights so the old pass is retired safely.",
    steps: ["Open the purchased Night.", "Choose Purchase, then select the admission.", "Enter the recipient's email and send the secure transfer. Screenshots are not transfers."],
    action: { href: "/my-nights", label: "Manage a ticket" },
  },
  {
    id: "refund-date-change",
    audience: "Going out",
    category: "Payments",
    title: "Refunds, postponements and new dates",
    summary: "Eligibility stays attached to the order and the organiser's published event state.",
    steps: ["Open the Night in My Nights.", "Choose Purchase to see the current event state and refund eligibility.", "Start the order-linked support conversation there so the team has the correct payment record."],
    action: { href: "/terms#refund", label: "Read the refund rules" },
    popular: true,
  },
  {
    id: "submit-event",
    audience: "Organising",
    category: "Getting started",
    title: "Submit a Night for review",
    summary: "Tell us who is behind it, what makes it worth leaving the house for and where it is happening.",
    steps: ["Use the organiser or collective name you want attached to your record.", "Use the same working email whenever you submit; that email connects your submission history to your organiser account.", "Add the real venue, map link, line-up, ticket position and a prepared flyer, then send it to review."],
    action: { href: "/organizer/submit", label: "Submit a Night" },
    popular: true,
  },
  {
    id: "submission-status",
    audience: "Organising",
    category: "Review",
    title: "Follow a submission through review",
    summary: "Your organiser workspace keeps the complete trail, including events that did not go live.",
    steps: ["Sign in with the verified organiser email used on the submission.", "Open Submission record to see submitted, in review, changes requested, approved, scheduled, published or archived states.", "If changes are requested, use the review note as the exact correction list before contacting operations."],
    action: { href: "/organizer/workspace", label: "Open organiser workspace" },
    popular: true,
  },
  {
    id: "organiser-dashboard",
    audience: "Organising",
    category: "Event operations",
    title: "Read your organiser dashboard",
    summary: "See your whole BeCore history first, then open one Night for the operational detail.",
    steps: ["Portfolio totals show all linked events, paid orders, admissions, check-ins and gross sales.", "The event record lists upcoming and past Nights under the same verified organiser identity.", "Choose a Night to manage ticket tiers, venue details, attendee answers, settlement statements and operations requests."],
    action: { href: "/organizer/workspace", label: "View the dashboard" },
  },
  {
    id: "room-update",
    audience: "Organising",
    category: "The Room",
    title: "Post an update to ticket holders",
    summary: "Use the Room for useful night-of information, not another marketing broadcast.",
    steps: ["Choose the correct assigned Night.", "Write a clear doors, timing, entry or venue update.", "Pin only information guests may need to find again. The audience is limited to verified ticket holders."],
    action: { href: "/organizer/workspace", label: "Post from the workspace" },
  },
  {
    id: "gate-staff",
    audience: "Organising",
    category: "At the door",
    title: "Give the entry team the right access",
    summary: "Gate access is named, event-scoped and removable. No shared staff passwords.",
    steps: ["Ask the BeCore owner to create the named gate account.", "Open the Night in your organiser workspace and add that exact gate-staff email.", "Remove access after the event or whenever the person leaves the entry team."],
    action: { href: "/organizer/workspace", label: "Manage the entry team" },
  },
  {
    id: "scan-ticket",
    audience: "At the door",
    category: "Check-in",
    title: "Scan and verify an admission",
    summary: "A successful scan must match the assigned Night and the current ticket state.",
    steps: ["Sign in with your own gate account and choose the assigned Night.", "Scan the live QR or use the authorised purchase search when a phone refuses to cooperate.", "Read the result before admitting anyone. A screenshot or familiar face is not a successful check-in."],
    action: { href: "/scan", label: "Open Gate" },
    popular: true,
  },
  {
    id: "room-private",
    audience: "The Room",
    category: "Privacy",
    title: "Who can see a Night's Room",
    summary: "The Room is part of the ticket, not a public comment section.",
    steps: ["Only verified ticket holders and the authorised event team can enter.", "Each Night has its own Room and moderation boundary.", "Ticket-holder content stays private; do not repost someone else's message or Flash without permission."],
    action: { href: "/privacy", label: "Read the privacy notice" },
  },
  {
    id: "room-notifications",
    audience: "The Room",
    category: "Notifications",
    title: "Quiet a noisy Night",
    summary: "Mute one Room without losing operational notices from the rest of My Nights.",
    steps: ["Open the Night and enter its Room notification controls.", "Choose the mute window that suits you.", "Important ticket, gate and support updates remain available in the quiet in-app inbox."],
    action: { href: "/my-nights", label: "Open My Nights" },
  },
  {
    id: "room-vip",
    audience: "The Room",
    category: "VIP",
    title: "How VIP works inside The Room",
    summary: "The badge proves an eligible ticket; private services appear only when the Host has opened them.",
    steps: ["A small VIP mark appears automatically beside eligible ticket holders; General Admission remains unlabelled.", "Open the concierge bell to see the services available for that Night, such as bottle service, a song suggestion or Host assistance.", "Requests are private, service availability is controlled by the Host, and a song suggestion is never a promise that the DJ will play it."],
    action: { href: "/my-nights", label: "Open My Nights" },
  },
];

const frequent = guides.filter((guide) => guide.popular);

function normalise(value: string) {
  return value.toLocaleLowerCase("en-GB").normalize("NFKD").replace(/[\u0300-\u036f]/gu, "");
}

export default function HelpCentre() {
  const [query, setQuery] = useState("");
  const [audience, setAudience] = useState<Audience>("Everyone");
  const filtered = useMemo(() => {
    const search = normalise(query.trim());
    return guides.filter((guide) => {
      const inAudience = audience === "Everyone" || guide.audience === audience;
      const haystack = normalise(`${guide.title} ${guide.summary} ${guide.category} ${guide.audience} ${guide.steps.join(" ")}`);
      return inAudience && (!search || haystack.includes(search));
    });
  }, [audience, query]);

  return (
    <section className="help-centre">
      <div className="help-centre__intro">
        <p className="eyebrow">Useful before panic</p>
        <h1>What went sideways?</h1>
        <p>Search the straight answer for tickets, payments, organiser tools, Gate or The Room. Clear steps first. Support humans when the steps run out.</p>
        <label className="help-search">
          <Search aria-hidden="true" size={21} />
          <span className="sr-only">Search BeCore Help</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Try “missing ticket”, “event review” or “Gate”" type="search" />
          {query ? <button type="button" aria-label="Clear help search" onClick={() => setQuery("")}><X size={17} /></button> : null}
        </label>
      </div>

      <nav className="help-audiences" aria-label="Help by role">
        {audiences.map((item) => <button key={item} type="button" className={audience === item ? "active" : ""} aria-pressed={audience === item} onClick={() => setAudience(item)}>{item}</button>)}
      </nav>

      {!query && audience === "Everyone" ? <section className="help-frequent" aria-labelledby="frequent-help">
        <header><div><p>Start here</p><h2 id="frequent-help">Frequently needed</h2></div><Sparkles size={20} /></header>
        <div>{frequent.map((guide, index) => <a key={guide.id} href={`#${guide.id}`}><span>{String(index + 1).padStart(2, "0")}</span><b>{guide.title}</b><ArrowUpRight size={16} /></a>)}</div>
      </section> : null}

      <div className="help-results__heading"><div><p>{query ? "Search results" : audience === "Everyone" ? "Every guide" : audience}</p><h2>{filtered.length} {filtered.length === 1 ? "clear answer" : "clear answers"}</h2></div><BookOpenText size={21} /></div>

      {filtered.length ? <div className="help-guides">
        {filtered.map((guide) => <details id={guide.id} key={guide.id} className="help-guide" open={Boolean(query)}>
          <summary>
            <span><small>{guide.audience} · {guide.category}</small><b>{guide.title}</b><i>{guide.summary}</i></span>
            <ChevronDown aria-hidden="true" size={19} />
          </summary>
          <div>
            <ol>{guide.steps.map((step) => <li key={step}><Check aria-hidden="true" size={15} /><span>{step}</span></li>)}</ol>
            {guide.action ? <Link href={guide.action.href}>{guide.action.label}<ArrowUpRight size={15} /></Link> : null}
          </div>
        </details>)}
      </div> : <div className="help-no-results"><CircleHelp size={24} /><h2>No exact match.</h2><p>Try fewer words or choose a role above. If this is about a purchase, include the order reference when you contact support.</p><button type="button" onClick={() => { setQuery(""); setAudience("Everyone"); }}>Show every guide</button></div>}

      <section className="help-contact">
        <div><Headphones size={21} /><p>Still properly stuck?</p><h2>Bring the reference.<br />We’ll bring a human.</h2></div>
        <div>
          <article><TicketCheck size={19} /><h3>Ticket holders</h3><p>Use the Purchase tab inside the affected Night. That keeps support tied to the verified order.</p><Link href="/my-nights">Open My Nights <ArrowUpRight size={15} /></Link></article>
          <article><UsersRound size={19} /><h3>Organisers</h3><p>Use Make a request inside the organiser workspace so the event and action trail stay attached.</p><Link href="/organizer/workspace">Open workspace <ArrowUpRight size={15} /></Link></article>
          <article><ShieldCheck size={19} /><h3>Everything else</h3><p>Email <a href="mailto:tickets@becoreops.com">tickets@becoreops.com</a>. Include the account email and reference. Never send passwords or QR screenshots.</p></article>
        </div>
      </section>
    </section>
  );
}
