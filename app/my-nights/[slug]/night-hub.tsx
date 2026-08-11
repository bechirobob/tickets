"use client";

import Link from "next/link";
import { ArrowLeft, Bell, Camera, Check, Loader2, LockKeyhole, MessageCircle, QrCode, Save, ShieldCheck, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import QrPass from "../../tickets/qr-pass";

type EventSummary = { slug: string; title: string; startsAt: string; fullDate: string; time: string; venue: string; area: string; image: string };
type Question = { id: string; prompt: string; kind: "text" | "choice"; options: string[]; required: boolean; answer: string };
type Update = { id: string; title: string; body: string; pinned: boolean; publishedAt: string; publishedBy: string };
type Experience = { attendee: { displayName: string }; preference: { attendeeVisible: boolean; keepPosted: boolean }; questions: Question[]; updates: Update[]; visibleAttendees: number };
type GateTicket = { id: string; ticketType: string; status: string; checkedInAt: string | null; gateCode: string | null; qrPayload: string | null };
type TicketOrder = { orderId: string; eventSlug: string; tickets: GateTicket[] };
type View = "overview" | "passes" | "before" | "updates";

export default function NightHub({ event }: { event: EventSummary }) {
  const [experience, setExperience] = useState<Experience | null>(null);
  const [orders, setOrders] = useState<TicketOrder[]>([]);
  const [view, setView] = useState<View>("overview");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/customer/experience/${encodeURIComponent(event.slug)}`, { cache: "no-store" }),
      fetch("/api/customer/tickets", { method: "POST", cache: "no-store" }),
    ]).then(async ([experienceResponse, ticketsResponse]) => {
      if (experienceResponse.status === 401) { setLocked(true); return; }
      const experienceData = await experienceResponse.json() as Experience;
      const ticketsData = await ticketsResponse.json() as { orders?: TicketOrder[] };
      setExperience(experienceData);
      setAnswers(Object.fromEntries(experienceData.questions.map((question) => [question.id, question.answer])));
      setOrders((ticketsData.orders ?? []).filter((order) => order.eventSlug === event.slug));
    }).catch(() => setLocked(true));
  }, [event.slug]);

  const tickets = useMemo(() => orders.flatMap((order) => order.tickets), [orders]);

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
      setNotice(input.includeAnswers ? "Before the Night answers saved." : "Preference saved.");
    }
    else setNotice(data.error ?? "That change could not be saved.");
    setSaving(false);
  }

  if (locked) return <main className="night-hub night-hub--locked"><section><LockKeyhole size={30} /><h1>This night needs its ticket.</h1><p>Open the same verified attendee session used to claim the ticket, or recover your paid tickets securely.</p><Link href="/tickets">Recover tickets</Link></section></main>;
  if (!experience) return <main className="night-hub night-hub--loading"><Loader2 className="spin" /><span>Opening your night</span></main>;

  return <main className="night-hub">
    <header className="night-hub__header"><Link href="/my-nights"><ArrowLeft size={16} /> My Nights</Link><div><b>{event.title}</b><span>{event.fullDate} · {event.venue}</span></div><Link href={`/room/${event.slug}`}><MessageCircle size={15} /> Enter The Room</Link></header>
    <section className="night-hub__hero"><img src={event.image} alt={`Atmosphere for ${event.title}`} /><div><p className="eyebrow">Your night</p><h1>{event.title}</h1><span>{event.fullDate} · {event.time} · {event.venue}, {event.area}</span></div></section>
    <nav className="night-hub__tabs" aria-label="Night views">{(["overview", "passes", "before", "updates"] as const).map((item) => <button type="button" key={item} aria-current={view === item ? "page" : undefined} onClick={() => setView(item)}>{item === "overview" ? "Overview" : item === "passes" ? `Passes (${tickets.length})` : item === "before" ? "Before the Night" : `Updates (${experience.updates.length})`}</button>)}</nav>
    <section className="night-hub__view">
      {notice ? <button className="night-hub__notice" type="button" onClick={() => setNotice("")}>{notice}</button> : null}
      {view === "overview" ? <div className="night-overview"><article><p className="eyebrow">Your access</p><h2>One ticket. The whole night.</h2><div><Link href={`/room/${event.slug}`}><MessageCircle /> <span><b>The Room</b>Live chat and Host updates</span></Link><Link href={`/room/${event.slug}?view=flashes`}><Camera /> <span><b>Flashes</b>Temporary photos from inside</span></Link><button type="button" onClick={() => setView("passes")}><QrCode /> <span><b>Your passes</b>Moving QR codes for the gate</span></button></div></article><aside><p className="eyebrow">I&apos;m in</p><h3>Choose whether other ticket holders can count you in.</h3><p>Your name is private by default. Turning this on adds you only to this night&apos;s attendee count.</p><button type="button" onClick={() => save({ attendeeVisible: !experience.preference.attendeeVisible })} disabled={saving}>{experience.preference.attendeeVisible ? <Check size={15} /> : <Users size={15} />}{experience.preference.attendeeVisible ? "You’re visible as going" : "Show me as going"}</button><span>{experience.visibleAttendees} people currently visible</span></aside></div> : null}
      {view === "passes" ? <div className="night-passes"><header><p className="eyebrow">Gate access</p><h2>Your moving passes</h2><p>Open this view at the gate. The codes refresh for this verified session.</p></header><div>{tickets.map((ticket, index) => <article key={ticket.id}><span>Pass {index + 1}</span><b>{ticket.ticketType.replaceAll("-", " ")}</b>{ticket.qrPayload && ticket.gateCode ? <><QrPass payload={ticket.qrPayload} label={`Entry QR code for pass ${index + 1}`} /><code>{ticket.gateCode}</code></> : <p>{ticket.status === "checked_in" ? "Already admitted" : "This pass is not available."}</p>}</article>)}</div></div> : null}
      {view === "before" ? <form className="before-night" onSubmit={(submitEvent) => { submitEvent.preventDefault(); void save({ includeAnswers: true }); }}><header><p className="eyebrow">Before the Night</p><h2>Help the event team prepare.</h2><p>Only the Host&apos;s authorised event team can use these answers for this night.</p></header>{experience.questions.length ? experience.questions.map((question) => <label key={question.id}><span>{question.prompt}{question.required ? " *" : ""}</span>{question.kind === "choice" ? <select required={question.required} value={answers[question.id] ?? ""} onChange={(changeEvent) => setAnswers((current) => ({ ...current, [question.id]: changeEvent.target.value }))}><option value="">Choose one</option>{question.options.map((option) => <option key={option}>{option}</option>)}</select> : <textarea maxLength={500} required={question.required} value={answers[question.id] ?? ""} onChange={(changeEvent) => setAnswers((current) => ({ ...current, [question.id]: changeEvent.target.value }))} />}</label>) : <p>No questions from the Host yet.</p>}<button type="submit" disabled={saving || !experience.questions.length}>{saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />} Save answers</button></form> : null}
      {view === "updates" ? <div className="night-updates"><header><p className="eyebrow">Night Updates</p><h2>Useful information, not noise.</h2><button type="button" onClick={() => save({ keepPosted: !experience.preference.keepPosted })}>{experience.preference.keepPosted ? <Check size={14} /> : <Bell size={14} />}{experience.preference.keepPosted ? "Keeping you posted" : "Keep me posted"}</button></header>{experience.updates.length ? experience.updates.map((update) => <article key={update.id}><div><span>{update.pinned ? "Pinned" : "Update"}</span><time>{new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(update.publishedAt))}</time></div><h3>{update.title}</h3><p>{update.body}</p><small>{update.publishedBy}</small></article>) : <p className="night-updates__empty">No update from the Host yet.</p>}</div> : null}
    </section>
    <footer className="night-hub__footer"><ShieldCheck size={13} /> Ticket access is checked again for every private request.</footer>
  </main>;
}
