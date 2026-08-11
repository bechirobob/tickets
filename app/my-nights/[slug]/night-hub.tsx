"use client";

import Link from "next/link";
import { ArrowLeft, Bell, CalendarDays, Check, CircleDollarSign, Clock3, Crown, Download, ExternalLink, Loader2, LockKeyhole, MapPin, MessageCircle, QrCode, ReceiptText, Save, ShieldCheck, Sparkles, Ticket, Users, WalletCards } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import QrPass from "../../tickets/qr-pass";
import OfflineTicketSaver from "../../offline-ticket-saver";
import TicketTransfer from "./ticket-transfer";

type EventSummary = {
  slug: string; title: string; startsAt: string; endsAt: string; fullDate: string; time: string; venue: string; area: string;
  image: string; venueMapUrl: string | null; lineup: string; ageRestriction: string; eventState: string;
};
type Question = { id: string; prompt: string; kind: "text" | "choice"; options: string[]; required: boolean; answer: string };
type Update = { id: string; title: string; body: string; pinned: boolean; publishedAt: string; publishedBy: string };
type Experience = { attendee: { displayName: string }; preference: { attendeeVisible: boolean; keepPosted: boolean }; questions: Question[]; updates: Update[]; visibleAttendees: number };
type GateTicket = { id: string; ticketType: string; status: string; checkedInAt: string | null; gateCode: string | null; qrPayload: string | null };
type TicketOrder = {
  orderId: string; reference: string; eventSlug: string; faceAmountMinor: number; bookingFeeMinor: number; totalAmountMinor: number;
  currency: string; paidAt: string | null; bookedFor: string | null; canViewPurchase: boolean; tierName: string | null; tierDescription: string | null; tickets: GateTicket[];
};
type View = "overview" | "passes" | "perks" | "details" | "purchase";

const views: View[] = ["overview", "passes", "perks", "details", "purchase"];

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}

function humanTicket(value: string) {
  return value.replaceAll("-", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export default function NightHub({ event }: { event: EventSummary }) {
  const params = useSearchParams();
  const [experience, setExperience] = useState<Experience | null>(null);
  const [orders, setOrders] = useState<TicketOrder[]>([]);
  const [view, setView] = useState<View>(() => {
    const requested = params.get("view") as View | null;
    return requested && views.includes(requested) ? requested : "overview";
  });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(() => params.get("welcome") === "1" ? "Paid. Verified. This Night is officially yours." : "");
  const [locked, setLocked] = useState(false);
  const [unread, setUnread] = useState(0);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    Promise.all([
      fetch(`/api/customer/experience/${encodeURIComponent(event.slug)}`, { cache: "no-store" }),
      fetch("/api/customer/tickets", { method: "POST", cache: "no-store" }),
      fetch("/api/customer/notifications", { cache: "no-store" }),
    ]).then(async ([experienceResponse, ticketsResponse, notificationsResponse]) => {
      if (experienceResponse.status === 401) { setLocked(true); return; }
      const experienceData = await experienceResponse.json() as Experience;
      const ticketsData = await ticketsResponse.json() as { orders?: TicketOrder[] };
      const notificationsData = notificationsResponse.ok ? await notificationsResponse.json() as { unread?: number } : null;
      setExperience(experienceData);
      setAnswers(Object.fromEntries(experienceData.questions.map((question) => [question.id, question.answer])));
      setOrders((ticketsData.orders ?? []).filter((order) => order.eventSlug === event.slug));
      setUnread(notificationsData?.unread ?? 0);
    }).catch(() => setLocked(true));
  }, [event.slug]);

  const tickets = useMemo(() => orders.flatMap((order) => order.tickets), [orders]);
  const hoursUntil = Math.ceil((new Date(event.startsAt).getTime() - now) / (60 * 60 * 1000));

  async function save(input: { attendeeVisible?: boolean; keepPosted?: boolean; includeAnswers?: boolean }) {
    if (!experience || saving) return;
    setSaving(true); setNotice("");
    const body = { attendeeVisible: input.attendeeVisible ?? experience.preference.attendeeVisible, keepPosted: input.keepPosted ?? experience.preference.keepPosted, answers: input.includeAnswers ? experience.questions.map((question) => ({ questionId: question.id, answer: answers[question.id] ?? "" })) : [] };
    const response = await fetch(`/api/customer/experience/${encodeURIComponent(event.slug)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json() as { error?: string; preference?: Experience["preference"] };
    if (response.ok) {
      setExperience((current) => {
        if (!current) return current;
        const preference = data.preference ?? current.preference;
        const visibilityChange = Number(preference.attendeeVisible) - Number(current.preference.attendeeVisible);
        return { ...current, preference, visibleAttendees: Math.max(0, current.visibleAttendees + visibilityChange) };
      });
      setNotice(input.includeAnswers ? "Saved. The Host can stop guessing now." : "Preference saved. Boundaries looking excellent.");
    } else setNotice(data.error ?? "That change refused to cooperate. Try once more.");
    setSaving(false);
  }

  if (locked) return <main className="night-hub night-hub--locked"><section><LockKeyhole size={30} /><h1>This night needs its ticket.</h1><p>Use My Nights to recover every paid purchase on your checkout email. One secure link; no password archaeology.</p><Link href="/my-nights">Bring back My Nights</Link></section></main>;
  if (!experience) return <main className="night-hub night-hub--loading"><Loader2 className="spin" /><span>Getting your night together</span></main>;

  return <main className="night-hub">
    <OfflineTicketSaver event={{ slug: event.slug, title: event.title, fullDate: event.fullDate, time: event.time, venue: event.venue, area: event.area }} tickets={tickets} />
    <header className="night-hub__header"><Link href="/my-nights"><ArrowLeft size={16} /> My Nights</Link><div><b>{event.title}</b><span>{event.fullDate} · {event.venue}</span></div><span className="night-hub__header-actions"><Link className="notification-bell" href="/notifications" aria-label={unread ? `${unread} unread notifications` : "Notifications"}><Bell size={16} />{unread ? <b>{unread > 9 ? "9+" : unread}</b> : null}</Link><Link href={`/room/${event.slug}`}><MessageCircle size={15} /> Enter The Room</Link></span></header>
    <section className="night-hub__hero"><img src={event.image} alt={`Atmosphere for ${event.title}`} /><div><p className="eyebrow">Your Night</p><h1>{event.title}</h1><span>{event.fullDate} · {event.time} · {event.venue}, {event.area}</span></div><p className="night-hub__countdown">{hoursUntil > 24 ? `${Math.ceil(hoursUntil / 24)} days to go` : hoursUntil > 0 ? `${hoursUntil} hours to go` : "The night is happening"}</p></section>
    <nav className="night-hub__tabs" aria-label="Night views">
      <button type="button" aria-current={view === "overview" ? "page" : undefined} onClick={() => setView("overview")}>Overview</button>
      <button type="button" aria-current={view === "passes" ? "page" : undefined} onClick={() => setView("passes")}>Ticket ({tickets.length})</button>
      <Link href={`/room/${event.slug}`}><MessageCircle size={13} /> Room</Link>
      <button type="button" aria-current={view === "perks" ? "page" : undefined} onClick={() => setView("perks")}>Perks</button>
      <button type="button" aria-current={view === "details" ? "page" : undefined} onClick={() => setView("details")}>Details</button>
      <button type="button" aria-current={view === "purchase" ? "page" : undefined} onClick={() => setView("purchase")}>Purchase</button>
    </nav>
    <section className="night-hub__view">
      {notice ? <button className="night-hub__notice" type="button" onClick={() => setNotice("")}>{notice}<span>Tap to dismiss</span></button> : null}

      {view === "overview" ? <div className="night-overview"><article><p className="eyebrow">Everything your ticket unlocked</p><h2>One Night. No scavenger hunt.</h2><div><button type="button" onClick={() => setView("passes")}><QrCode /> <span><b>Show my ticket</b>Fresh moving passes for the gate</span></button><Link href={`/room/${event.slug}`}><MessageCircle /> <span><b>Enter The Room</b>Chat, Host updates and Flashes—same conversation</span></Link><button type="button" onClick={() => setView("perks")}><Crown /> <span><b>See my perks</b>Your ticket tier and everything it includes</span></button><button type="button" onClick={() => setView("purchase")}><ReceiptText /> <span><b>Receipt &amp; purchase</b>Payment reference, totals and support</span></button></div></article><aside><p className="eyebrow">I&apos;m in</p><h3>Choose whether other ticket holders can count you in.</h3><p>Your name stays private. Turning this on adds one to the count—not your biography.</p><button type="button" onClick={() => save({ attendeeVisible: !experience.preference.attendeeVisible })} disabled={saving}>{experience.preference.attendeeVisible ? <Check size={15} /> : <Users size={15} />}{experience.preference.attendeeVisible ? "You’re visible as going" : "Count me in, quietly"}</button><span>{experience.visibleAttendees} people currently visible</span></aside></div> : null}

      {view === "passes" ? <div className="night-passes"><header><p className="eyebrow">Gate access</p><h2>Your door-ready tickets.</h2><p>The latest copy is now saved on this device. No signal at the venue? Open the offline door pass and keep moving.</p><Link className="night-passes__offline" href="/offline-ticket.html"><WalletCards size={15} /> Open offline door pass</Link></header><div>{tickets.map((ticket, index) => <article key={ticket.id}><span>Ticket {index + 1}</span><b>{humanTicket(ticket.ticketType)}</b>{ticket.qrPayload && ticket.gateCode ? <><QrPass payload={ticket.qrPayload} label={`Entry QR code for ticket ${index + 1}`} /><code>{ticket.gateCode}</code><TicketTransfer ticketId={ticket.id} disabled={ticket.status !== "issued"} /></> : <p>{ticket.status === "checked_in" ? "Already inside. Excellent." : "This ticket is taking a moment."}</p>}</article>)}</div></div> : null}

      {view === "perks" ? <div className="night-perks"><header><p className="eyebrow">Ticket-earned perks</p><h2>Your ticket pulled strings.</h2><p>These are the exact inclusions attached to what you bought. No suspiciously vague VIP energy.</p></header><div className="night-perks__tiers">{orders.map((order) => <article key={order.orderId}><Crown size={20} /><span>{order.tickets.length} {order.tickets.length === 1 ? "admission" : "admissions"}</span><h3>{order.tierName ?? humanTicket(order.tickets[0]?.ticketType ?? "Admission")}</h3><p>{order.tierDescription ?? "Entry to the event and every ticket-holder feature inside My Nights."}</p><small><Sparkles size={12} /> The Room, updates, Flashes and Before the Night are included.</small></article>)}</div><form className="before-night" onSubmit={(submitEvent) => { submitEvent.preventDefault(); void save({ includeAnswers: true }); }}><header><p className="eyebrow">Before the Night</p><h2>Help the event team prepare.</h2><p>Only the Host&apos;s authorised event team can use these answers for this Night.</p></header>{experience.questions.length ? experience.questions.map((question) => <label key={question.id}><span>{question.prompt}{question.required ? " *" : ""}</span>{question.kind === "choice" ? <select required={question.required} value={answers[question.id] ?? ""} onChange={(changeEvent) => setAnswers((current) => ({ ...current, [question.id]: changeEvent.target.value }))}><option value="">Choose one</option>{question.options.map((option) => <option key={option}>{option}</option>)}</select> : <textarea maxLength={500} required={question.required} value={answers[question.id] ?? ""} onChange={(changeEvent) => setAnswers((current) => ({ ...current, [question.id]: changeEvent.target.value }))} />}</label>) : <p>No questions from the Host yet. Suspiciously low-maintenance.</p>}<button type="submit" disabled={saving || !experience.questions.length}>{saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />} Save answers</button></form></div> : null}

      {view === "details" ? <div className="night-details"><header><p className="eyebrow">The practical bits</p><h2>Know where. Know when. Then overthink the outfit.</h2></header><dl><div><dt><CalendarDays /> Date</dt><dd>{event.fullDate}</dd></div><div><dt><Clock3 /> Time</dt><dd>{event.time}</dd></div><div><dt><MapPin /> Venue</dt><dd>{event.venue}, {event.area}{event.venueMapUrl ? <Link href={event.venueMapUrl} target="_blank" rel="noreferrer">Open directions <ExternalLink size={12} /></Link> : null}</dd></div><div><dt><Ticket /> Entry</dt><dd>{event.ageRestriction} · Valid government-issued ID · One scan per admission</dd></div><div><dt><Sparkles /> Line-up</dt><dd>{event.lineup}</dd></div></dl><section className="night-updates"><header><div><p className="eyebrow">Night updates</p><h2>Useful information, not noise.</h2></div><button type="button" onClick={() => save({ keepPosted: !experience.preference.keepPosted })}>{experience.preference.keepPosted ? <Check size={14} /> : <Bell size={14} />}{experience.preference.keepPosted ? "Keeping you posted" : "Keep me posted"}</button></header>{experience.updates.length ? experience.updates.map((update) => <article key={update.id}><div><span>{update.pinned ? "Pinned" : "Update"}</span><time>{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(update.publishedAt))}</time></div><h3>{update.title}</h3><p>{update.body}</p><small>{update.publishedBy}</small></article>) : <p className="night-updates__empty">No update from the Host yet. Silence, but the calm kind.</p>}</section></div> : null}

      {view === "purchase" ? <div className="night-purchase"><header><p className="eyebrow">Receipts &amp; support</p><h2>The money trail, neatly behaved.</h2><p>Receipts stay with the original purchaser. Ticket-linked perks travel; someone else’s card statement does not.</p></header>{orders.some((order) => order.canViewPurchase) ? orders.filter((order) => order.canViewPurchase).map((order) => <article key={order.orderId}><header><div><CircleDollarSign /><span><b>{order.tierName ?? humanTicket(order.tickets[0]?.ticketType ?? "Admission")}</b><small>{order.reference}</small></span></div><button type="button" onClick={() => window.print()}><Download size={14} /> Print / save</button></header><dl><div><dt>Ticket subtotal</dt><dd>{money(order.faceAmountMinor, order.currency)}</dd></div><div><dt>Booking fee</dt><dd>{money(order.bookingFeeMinor, order.currency)}</dd></div><div><dt>Total paid</dt><dd>{money(order.totalAmountMinor, order.currency)}</dd></div><div><dt>Confirmed</dt><dd>{order.paidAt ? new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(order.paidAt)) : "Payment confirmed"}</dd></div></dl></article>) : <p className="night-purchase__transferred">This ticket was transferred to you. Admission, The Room and ticket-linked perks came along; the purchaser’s receipt stayed private.</p>}<p className="night-purchase__support">Something genuinely off? <Link href="mailto:tickets@tickets.becoreops.com">Tell ticket support</Link>. “My friend changed their mind” remains a group-chat matter.</p></div> : null}
    </section>
    <footer className="night-hub__footer"><ShieldCheck size={13} /> Every private request checks the ticket again. Trust, with receipts.</footer>
  </main>;
}
