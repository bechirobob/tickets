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
    id: "rsvp-guest", audience: "Going out", category: "RSVP", title: "RSVP for a Night",
    summary: "Found your plans? Put your name down.",
    steps: ["Open the RSVP link or choose RSVP on the event page.", "Add your details and send your request. You’ll see a message when it lands.", "If the host is reviewing requests, your spot still needs their nod. Paid registration takes you to checkout."],
    action: { href: "/events", label: "Find your Night" },
  },
  {
    id: "rsvp-host", audience: "Organising", category: "RSVP", title: "Set up RSVPs and share your link",
    summary: "Your guest list, your rules. Get the link ready in one place.",
    steps: ["Open Events, choose your Night, then Guests → RSVP review & setup. Pick RSVP, Paid registration or Email list only.", "Set the guest limit and closing time. Turn on review if you want to approve each request.", "Choose Save & copy link and send it to your guests. New requests appear automatically in Guest list.", "Guest emails shows your saved contacts. Search for someone or open the list when you need it."],
    action: { href: "/organizer/workspace?area=events&view=guests", label: "Set up RSVPs" },
  },
  {
    id: "find-ticket",
    audience: "Going out",
    category: "Tickets",
    title: "Find a ticket you already bought",
    summary: "Your ticket hasn’t gone out without you. Recover it with the email you used at checkout.",
    steps: ["Open My Nights.", "Enter the email used for payment.", "Open the link in your email. Your tickets and updates will be waiting."],
    action: { href: "/my-nights", label: "Open My Nights" },
    popular: true,
  },
  {
    id: "payment-methods",
    audience: "Going out",
    category: "Payments",
    title: "Pay with Mobile Money or card",
    summary: "Pick how you’re paying. We’ll take you from there.",
    steps: ["Choose Mobile Money to reveal MTN MoMo, Telecel Cash or AT Money, or choose Card to continue with Visa or Mastercard.", "Finish with the payment provider. Your card details and MoMo PIN stay with them.", "Come back here when you’re done. Keep the payment reference until your ticket lands in My Nights."],
    popular: true,
  },
  {
    id: "payment-pending",
    audience: "Going out",
    category: "Payments",
    title: "Payment completed but the ticket is missing",
    summary: "Once is quite enough. Don’t pay again while we check your original payment.",
    steps: ["Keep your payment reference.", "Refresh My Nights with the checkout email.", "If the order still does not appear, open that Night's Purchase tab or email support with the reference. Never send a QR screenshot."],
    action: { href: "/my-nights", label: "Check the purchase" },
    popular: true,
  },
  {
    id: "transfer-ticket",
    audience: "Going out",
    category: "Tickets",
    title: "Send a ticket to someone else",
    summary: "Plans changed? Send your ticket to a friend from My Nights.",
    steps: ["Open the purchased Night.", "Choose Purchase, then select the admission.", "Enter the recipient's email and send the secure transfer. Screenshots are not transfers."],
    action: { href: "/my-nights", label: "Manage a ticket" },
  },
  {
    id: "refund-date-change",
    audience: "Going out",
    category: "Payments",
    title: "Refunds, postponements and new dates",
    summary: "Plans change. Your Purchase tab shows the event status and whether your order qualifies for a refund.",
    steps: ["Open the Night in My Nights.", "Open Purchase to check the plan and your refund options.", "Message us there. Your booking comes along, so you won’t have to explain twice."],
    action: { href: "/terms#refund", label: "Read the refund rules" },
    popular: true,
  },
  {
    id: "submit-event",
    audience: "Organising",
    category: "Getting started",
    title: "Submit a Night for review",
    summary: "Tell us who is behind it, what makes it worth leaving the house for and where it is happening.",
    steps: ["Tell us the host or collective behind the party.", "Use the same email for your submissions and organizer account.", "Add the venue, map link, line-up, ticket prices and flier, then send it over."],
    action: { href: "/organizer/submit", label: "Submit a Night" },
    popular: true,
  },
  {
    id: "submission-status",
    audience: "Organising",
    category: "Review",
    title: "Follow a submission through review",
    summary: "Check where your submission stands and read any notes from us.",
    steps: ["Sign in with the email you used to submit.", "Open Overview, then Submission history to see its progress.", "If we need changes, the review note will tell you what to update."],
    action: { href: "/organizer/workspace", label: "Open organiser workspace" },
    popular: true,
  },
  {
    id: "organiser-dashboard",
    audience: "Organising",
    category: "Event operations",
    title: "Read your organiser dashboard",
    summary: "All your nights in one place. Open an event to see sales, guests and what needs doing.",
    steps: ["Overview shows your events, admissions and RSVPs waiting for review.", "Open Events and choose a Night. Its tabs cover Overview, Tickets, Guests, Room & VIP, Door, Insights and Help.", "Use Audience for guest history, Promote for links and coupons, Money for statements, and Team for invitations.", "Your selected event stays with you as you move between tasks. Save your changes before leaving the workspace or refreshing the page."],
    action: { href: "/organizer/workspace", label: "View the dashboard" },
  },
  {
    id: "organiser-analytics",
    audience: "Organising",
    category: "Performance",
    title: "Understand what moved your Night",
    summary: "See what sold and who brought the crowd. Useful for planning the encore; customer payment details stay private.",
    steps: ["Open Events → Insights and choose the dates you want to see.", "See what sold, who brought the crowd and when people arrived.", "Export the totals as a spreadsheet when you need to share them with your team."],
    action: { href: "/organizer/workspace?area=events&view=insights", label: "Open event insights" },
  },
  {
    id: "room-update",
    audience: "Organising",
    category: "The Room",
    title: "Post an update to ticket holders",
    summary: "New door time? Venue update? Tell the people actually coming.",
    steps: ["Choose the correct Night in Events and open Room & VIP.", "Write a clear doors, timing, entry or venue update.", "Pin the details guests will need again. They’ll see the update in The Room."],
    action: { href: "/organizer/workspace?area=events&view=room", label: "Post from the workspace" },
  },
  {
    id: "gate-staff",
    audience: "Organising",
    category: "At the door",
    title: "Give the entry team the right access",
    summary: "Give each person on the door their own access for your event.",
    steps: ["As the lead host, open Team or your event’s Door tab and choose Invite a team member.", "Enter their name and email. Choose Door staff for scanning, or Co-host for event, guest and report access.", "They accept their private invitation within 48 hours and sign in with their own account. Existing staff keep their password.", "Withdraw an unused invitation or remove event access when someone leaves the team. This does not remove their access to other events."],
    action: { href: "/organizer/workspace?area=team", label: "Manage the event team" },
  },
  {
    id: "host-money", audience: "Organising", category: "Payments", title: "Check statements and payouts",
    summary: "See collected payments, refunds and what has been paid out.",
    steps: ["Open Money and choose one event or All my events.", "Check collected payments, booking fees, refunds and ticket value after refunds.", "Use Settlement statements and Payout history to see approval and transfer status. Ticket value is an accounting total, not a promise of an immediate payout.", "Choose Export statements for a CSV. For a query, open the event’s Help tab and include the statement or transfer reference."],
    action: { href: "/organizer/workspace?area=money&event=all", label: "Check Money" },
  },
  {
    id: "host-guest-records", audience: "Organising", category: "Guests", title: "Find a guest and recover their access",
    summary: "Paid tickets, RSVPs, complimentary passes and door entries share one guest desk.",
    steps: ["Open Events → Guests and search by name, email or booking reference.", "Open the record to check the booking, arrivals, current ticket holders, delivery status and guest answers.", "Choose Resend access beside a ticket to queue a private My Nights link for its current holder.", "For a paid booking, Request a refund review sends the reason to BeCore. It does not issue a refund immediately."],
    action: { href: "/organizer/workspace?area=events&view=guests", label: "Open the guest desk" },
  },
  {
    id: "host-audience", audience: "Organising", category: "Guests", title: "Understand your returning audience",
    summary: "See guest history across the events you manage.",
    steps: ["Open Audience and choose the segment you need, such as repeat guests, VIPs or subscribers.", "Search for someone or open the list, then check their event history.", "A booking is not permission to send marketing. Subscription choices belong to the event where the guest made them.", "Use Promote → Announcements for event messages and respect the consent checks shown there."],
    action: { href: "/organizer/workspace?area=audience", label: "Open Audience" },
  },
  {
    id: "host-coupons", audience: "Organising", category: "Promotion", title: "Create a discount code",
    summary: "Give guests a time-limited discount with a clear usage limit.",
    steps: ["Open Promote → Coupons for the correct event and choose Create a discount code.", "Set the percentage or fixed discount, maximum uses, start and expiry times, and any ticket-type restriction. Times are shown in Accra time.", "Guests apply the code at checkout. A pending checkout holds a use for 15 minutes; refunds do not restore uses.", "Disable a code to stop new uses. For free admission, issue complimentary passes instead."],
    action: { href: "/organizer/workspace?area=promote", label: "Manage promotions" },
  },
  {
    id: "host-promoters", audience: "Organising", category: "Promotion", title: "Track promoter sales and commissions",
    summary: "Give each promoter a buyer link and their own private report.",
    steps: ["Open Promote → Links & promoters. Add a promoter name, unique code and commission rate, then share their buyer link.", "Open their record to see orders, commission after refunds and recorded payments. The rate applies to discounted ticket value, excluding booking fees; a rate change affects future orders.", "Create a private report link and share it only with that promoter. It expires after 90 days; creating another withdraws the old link.", "After paying the promoter, record the amount, payment reference and date. Recording a payment does not transfer money."],
    action: { href: "/organizer/workspace?area=promote", label: "Open promoter tools" },
  },
  {
    id: "host-complimentary", audience: "Organising", category: "Tickets", title: "Issue complimentary QR passes",
    summary: "Review the guest list before issuing free admissions.",
    steps: ["Open Events → Tickets → Issue complimentary passes and choose a ticket type.", "Upload or paste a CSV with name,email,quantity as its header. Quantity means admissions, including for group ticket types. Each list supports up to 100 guests and 20 admissions per guest.", "Choose Review guest list, check the names, emails and capacity, then Issue reviewed passes.", "If the connection drops, resume the same reviewed list. Issued recipients keep their existing passes. Each recipient gets private access through My Nights."],
    action: { href: "/organizer/workspace?area=events&view=tickets", label: "Issue complimentary passes" },
  },
  {
    id: "host-repeat", audience: "Organising", category: "Getting started", title: "Create the next edition of a Night",
    summary: "Start with the event setup and give the next edition its own identity.",
    steps: ["Open the event’s Overview and expand Repeat this Night.", "Give the new edition a title, start time and end time, then create its private draft.", "Review the venue, line-up, ticket types and guest questions. Orders, guest contacts, team assignments and promotions are not copied.", "Check the details, accept the host terms and privacy notice, then Submit for review. The draft stays private until BeCore publishes it."],
    action: { href: "/organizer/workspace?area=events&view=overview", label: "Prepare another Night" },
  },
  {
    id: "host-questions", audience: "Organising", category: "Guests", title: "Ask ticket holders a question",
    summary: "Collect a text answer or a choice in My Nights.",
    steps: ["Open the event’s Overview → Guest questions and choose Add question.", "Write the question, choose text or multiple choice, and set its position and whether an answer is required.", "Ticket holders answer in My Nights. Read responses in their guest record.", "Once a question has answers, close it and add a new question to change its wording or options. Existing answers stay attached to the original question."],
    action: { href: "/organizer/workspace?area=events&view=overview", label: "Manage guest questions" },
  },
  {
    id: "scan-ticket",
    audience: "At the door",
    category: "Check-in",
    title: "Scan and verify an admission",
    summary: "A successful scan must match the assigned Night and the current ticket state.",
    steps: ["Sign in with your own gate account and choose the assigned Night.", "Scan the QR or find the booking by name, email or reference.", "Read the result before admitting anyone. A screenshot or familiar face is not a successful check-in."],
    action: { href: "/scan", label: "Open Gate" },
    popular: true,
  },
  {
    id: "room-private",
    audience: "The Room",
    category: "Privacy",
    title: "Who can see a Night's Room",
    summary: "The Room is part of the ticket, not a public comment section.",
    steps: ["Got a ticket? You’re in. The host’s team is there too.", "Each Night has its own Room, looked after by the host’s team.", "Ticket-holder content stays private; do not repost someone else's message or Flash without permission."],
    action: { href: "/privacy", label: "Read the privacy notice" },
  },
  {
    id: "room-notifications",
    audience: "The Room",
    category: "Notifications",
    title: "Turn Room notifications on or off",
    summary: "Stay in the loop, or take a little quiet. The bell opens settings for this Night.",
    steps: ["Open the Night’s Room and tap the notification bell to open settings.", "Use Host updates & messages to turn notifications for that Night on or off.", "For lock-screen alerts, choose Enable under On your lock screen when available, then allow browser permission. You can decline and still use in-app notifications."],
    action: { href: "/my-nights", label: "Open My Nights" },
  },
  {
    id: "room-flashes",
    audience: "The Room",
    category: "Flashes",
    title: "Share or remove a Flash",
    summary: "Share a quick glimpse of the night with the people there.",
    steps: ["Use the camera in the Room to capture and send the Flash; uploads from your photo library are not accepted.", "Each guest gets one viewing session of up to ten seconds. Closing it or leaving the tab ends that look; refreshing does not reset it. Screenshots are still possible.", "You can preview your own Flash again, or remove it through its options in All Flashes. Any Flash still present is deleted automatically when the Room closes."],
    action: { href: "/my-nights", label: "Open My Nights" },
  },
  {
    id: "room-vip",
    audience: "The Room",
    category: "VIP",
    title: "How VIP works inside The Room",
    summary: "Your ticket earns the badge. The host opens the concierge when the team’s ready.",
    steps: ["Your VIP badge shows up beside your messages. No introduction needed.", "Open the concierge bell to see the services available for that Night, such as bottle service, a song suggestion or Host assistance.", "Your request goes straight to the host. Song suggestions are welcome; the DJ has the final say."],
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
        <p>Lost a ticket? Payment taking its time? Find the next step here. If you’re still stuck, there’s a human at the end of this.</p>
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
          <article><TicketCheck size={19} /><h3>Ticket holders</h3><p>Open your night, then Purchase. We’ll have your booking ready when you ask for help.</p><Link href="/my-nights">Open My Nights <ArrowUpRight size={15} /></Link></article>
          <article><UsersRound size={19} /><h3>Organisers</h3><p>Open your event’s Help tab and choose Make a request. We’ll have the event details handy, so you can skip the long introduction.</p><Link href="/organizer/workspace">Open workspace <ArrowUpRight size={15} /></Link></article>
          <article><ShieldCheck size={19} /><h3>Everything else</h3><p>Email <a href="mailto:tickets@becoreops.com">tickets@becoreops.com</a>. Include the account email and reference. Never send passwords or QR screenshots.</p></article>
        </div>
      </section>
    </section>
  );
}
