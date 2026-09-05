"use client";

import BrandLogo from "../../brand-logo";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  ConciergeBell,
  CalendarRange,
  CheckCircle2,
  CircleDollarSign,
  FileCheck2,
  History,
  LifeBuoy,
  Loader2,
  LogOut,
  Megaphone,
  Save,
  ScanLine,
  ShieldCheck,
  TicketCheck,
  UsersRound,
  Wine,
} from "lucide-react";
import type { StaffRole } from "../../../lib/admin-session";
import WorkspaceJump from "../../admin/workspace-jump";

type EventItem = {
  slug: string;
  title: string;
  venue: string;
  venueMapUrl: string;
  area: string;
  startsAt: string;
  endsAt: string;
  lineup: string;
  eventState: string;
  capacity: number;
  status: string;
  submissionStatus: string | null;
  submittedAt: string | null;
  paidOrders: number;
  grossMinor: number;
  issuedAdmissions: number;
  checkedInAdmissions: number;
};
type Submission = { id: string; organizerName: string; title: string; status: string; reviewNote: string | null; eventSlug: string | null; startsAt: string; createdAt: string; updatedAt: string };
type Tier = { id: string; eventSlug: string; name: string; priceMinor: number; capacityAdmissions: number; allocatedAdmissions: number; status: string };
type Settlement = { id: string; eventSlug: string; periodEnd: string; grossMinor: number; bookingFeesMinor: number; refundsMinor: number; netTicketSalesMinor: number; currency: string; status: string };
type RequestItem = { id: string; eventSlug: string; kind: string; detail: string; status: string; reviewNote: string | null; createdAt: string };
type GateStaff = { eventSlug: string; id: string; displayName: string; email: string; status: string };
type AttendeeAnswer = { eventSlug: string; questionId: string; prompt: string; answer: string; updatedAt: string; displayName: string };
type VipSetting = { eventSlug: string; bottleServiceEnabled: number; bottleMenu: string | null; songSuggestionsEnabled: number; assistanceEnabled: number; updatedAt: string };
type VipRequest = { id: string; eventSlug: string; kind: string; detail: string; location: string | null; status: string; organizerNote: string | null; createdAt: string; displayName: string };
type WorkspaceData = { events: EventItem[]; submissions: Submission[]; tiers: Tier[]; settlements: Settlement[]; requests: RequestItem[]; gateStaff: GateStaff[]; attendeeAnswers: AttendeeAnswer[]; vipSettings: VipSetting[]; vipRequests: VipRequest[] };

const empty: WorkspaceData = { events: [], submissions: [], tiers: [], settlements: [], requests: [], gateStaff: [], attendeeAnswers: [], vipSettings: [], vipRequests: [] };
const money = (value: number) => new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", maximumFractionDigits: 0 }).format(value / 100);
const date = (value: string) => new Date(value).toLocaleDateString("en-GH", { dateStyle: "medium" });
const readable = (value: string) => value.replaceAll("_", " ");

export default function OrganizerWorkspace({ actor, role }: { actor: string; role: StaffRole }) {
  const router = useRouter();
  const [data, setData] = useState<WorkspaceData>(empty);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/organizer/workspace", { cache: "no-store" });
      const result = await response.json() as WorkspaceData & { error?: string };
      if (!response.ok) setMessage(result.error ?? "Workspace could not be loaded.");
      else {
        setData(result);
        setSelectedSlug((current) => result.events.some((item) => item.slug === current) ? current : result.events[0]?.slug ?? "");
      }
    } catch {
      setMessage("Workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch("/api/organizer/workspace", { cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json() as WorkspaceData & { error?: string } }))
      .then(({ response, result }) => {
        if (!response.ok) setMessage(result.error ?? "Workspace could not be loaded.");
        else { setData(result); setSelectedSlug(result.events[0]?.slug ?? ""); }
        setLoading(false);
      })
      .catch(() => { setMessage("Workspace could not be loaded."); setLoading(false); });
  }, []);

  const selected = useMemo(() => data.events.find((item) => item.slug === selectedSlug) ?? null, [data.events, selectedSlug]);
  const portfolio = useMemo(() => data.events.reduce((total, item) => ({
    paidOrders: total.paidOrders + Number(item.paidOrders),
    grossMinor: total.grossMinor + Number(item.grossMinor),
    issuedAdmissions: total.issuedAdmissions + Number(item.issuedAdmissions),
    checkedInAdmissions: total.checkedInAdmissions + Number(item.checkedInAdmissions),
  }), { paidOrders: 0, grossMinor: 0, issuedAdmissions: 0, checkedInAdmissions: 0 }), [data.events]);
  const tiers = data.tiers.filter((tier) => tier.eventSlug === selectedSlug);
  const settlements = data.settlements.filter((item) => item.eventSlug === selectedSlug);
  const requests = data.requests.filter((item) => item.eventSlug === selectedSlug);
  const gateStaff = data.gateStaff.filter((item) => item.eventSlug === selectedSlug);
  const attendeeAnswers = data.attendeeAnswers.filter((item) => item.eventSlug === selectedSlug);
  const vipSetting = data.vipSettings.find((item) => item.eventSlug === selectedSlug);
  const vipRequests = data.vipRequests.filter((item) => item.eventSlug === selectedSlug);

  async function request(action: string, body: Record<string, unknown>, method = "POST"): Promise<boolean> {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/organizer/workspace", { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ action, eventSlug: selectedSlug, ...body }) });
      const result = await response.json() as { error?: string };
      setMessage(response.ok ? "Saved." : result.error ?? "The action failed.");
      if (response.ok) await load();
      return response.ok;
    } catch {
      setMessage("The action could not be completed. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await request("update", { venue: form.get("venue"), venueMapUrl: form.get("venueMapUrl"), lineup: form.get("lineup") }, "PATCH");
  }
  async function submitAnnouncement(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const element = event.currentTarget; const form = new FormData(element); if (await request("announcement", { content: form.get("content"), pinned: form.get("pinned") === "on" })) element.reset(); }
  async function submitRequest(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const element = event.currentTarget; const form = new FormData(element); if (await request("request", { kind: form.get("kind"), orderId: form.get("orderId"), detail: form.get("detail") })) element.reset(); }
  async function assignGate(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const element = event.currentTarget; const form = new FormData(element); if (await request("assign_gate", { email: form.get("email") })) element.reset(); }
  async function saveVip(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await request("vip_settings", { bottleServiceEnabled: form.get("bottleServiceEnabled") === "on", songSuggestionsEnabled: form.get("songSuggestionsEnabled") === "on", assistanceEnabled: form.get("assistanceEnabled") === "on", bottleMenu: form.get("bottleMenu") }); }
  async function signOut() { await fetch("/api/admin/session", { method: "DELETE" }); router.push("/"); router.refresh(); }

  return (
    <main className="organizer-workspace">
      <header className="organizer-workspace__header">
        <Link href="/" className="night-brand-link"><BrandLogo /></Link>
        <WorkspaceJump active="/organizer/workspace" role={role} compact />
        <div><span><BadgeCheck size={15} /> {actor}</span><button onClick={signOut}><LogOut size={15} /> Sign out</button></div>
      </header>

      <section className="organizer-workspace__intro">
        <div><p className="night-kicker"><span /> Organiser workspace</p><h1>Every Night.<br />One record.</h1></div>
        <p>Your submissions, live events, sales, attendance and operations trail stay together under the verified email on this account. Less chasing. More hosting.</p>
      </section>

      {loading ? <div className="organizer-empty"><Loader2 className="spin" /> Loading your record…</div> : <>
        <section className="organizer-portfolio" aria-labelledby="organizer-record-title">
          <header><div><p>All-time on BeCore</p><h2 id="organizer-record-title">Your organiser record</h2></div><div className="organizer-portfolio__actions"><Link href="/organizer/analytics">Open analytics <BarChart3 size={15} /></Link><Link href="/help">How this works <LifeBuoy size={15} /></Link></div></header>
          <div>
            <article><CalendarRange /><small>Linked Nights</small><b>{data.events.length}</b></article>
            <article><TicketCheck /><small>Paid orders</small><b>{portfolio.paidOrders}</b></article>
            <article><UsersRound /><small>Admissions</small><b>{portfolio.issuedAdmissions}</b></article>
            <article><ScanLine /><small>Checked in</small><b>{portfolio.checkedInAdmissions}</b></article>
            <article><CircleDollarSign /><small>Gross collected</small><b>{money(portfolio.grossMinor)}</b></article>
          </div>
        </section>

        <section className="organizer-history" aria-labelledby="organizer-history-title">
          <header><div><p>Nothing disappears</p><h2 id="organizer-history-title">Submission trail</h2></div><Link href="/organizer/submit">Submit another Night <ArrowUpRight size={15} /></Link></header>
          {data.submissions.length ? <div>{data.submissions.map((submission) => <article key={submission.id}>
            <time>{date(submission.createdAt)}</time>
            <div><h3>{submission.title}</h3><p>{submission.organizerName} · Event date {date(submission.startsAt)}</p>{submission.reviewNote ? <small>{submission.reviewNote}</small> : null}</div>
            <span data-status={submission.status}>{readable(submission.status)}</span>
            {submission.eventSlug ? <button type="button" onClick={() => { setSelectedSlug(submission.eventSlug ?? ""); document.getElementById("organizer-event-detail")?.scrollIntoView({ behavior: "smooth" }); }}>Open record</button> : <i>Ref {submission.id.slice(0, 8).toUpperCase()}</i>}
          </article>)}</div> : <div className="organizer-history__empty"><History size={22} /><p>No submissions are linked to this account yet. Use this account email the next time you submit.</p></div>}
        </section>

        {data.events.length === 0 ? <div className="organizer-empty"><CalendarRange /><h2>No approved Nights yet.</h2><p>Your submission trail will stay above while the curation team reviews it.</p><Link href="/organizer/submit">Submit an event</Link></div> : <>
          <div className="workspace-event-picker organizer-event-picker">
            <label htmlFor="organizer-event">Event record</label>
            <select id="organizer-event" value={selectedSlug} onChange={(event) => { setSelectedSlug(event.target.value); setMessage(""); }}>{data.events.map((item) => <option key={item.slug} value={item.slug}>{item.title}</option>)}</select>
            <span>{selected ? `${date(selected.startsAt)} · ${readable(selected.eventState)}` : "Choose one of your Nights."}</span>
          </div>

          {selected ? <section className="organizer-dashboard" id="organizer-event-detail">
            <header><div><p>{selected.venue} · {selected.area}</p><h2>{selected.title}</h2></div><Link href={`/event/${selected.slug}`}>View customer page <ArrowUpRight size={15} /></Link></header>
            <div className="organizer-metrics"><article><TicketCheck /><small>Paid orders</small><b>{selected.paidOrders}</b></article><article><UsersRound /><small>Admissions issued</small><b>{selected.issuedAdmissions}</b></article><article><ScanLine /><small>Checked in</small><b>{selected.checkedInAdmissions}</b></article><article><CheckCircle2 /><small>Gross collected</small><b>{money(selected.grossMinor)}</b></article></div>
            <div className="organizer-grid">
              <section className="organizer-panel organizer-panel--wide"><header><div><small>Live inventory</small><h3>Ticket tiers</h3></div><ShieldCheck size={18} /></header><div className="organizer-tier-table">{tiers.map((tier) => <div key={tier.id}><span><b>{tier.name}</b><small>{money(tier.priceMinor)} · {tier.status}</small></span><strong>{tier.allocatedAdmissions} / {tier.capacityAdmissions}</strong><i><b style={{ width: `${Math.min(100, (tier.allocatedAdmissions / Math.max(1, tier.capacityAdmissions)) * 100)}%` }} /></i></div>)}</div></section>
              <form key={`details-${selected.slug}`} className="organizer-panel" onSubmit={saveDetails}><header><div><small>Authorised details</small><h3>Venue & line-up</h3></div><Save size={18} /></header><label>Venue<input name="venue" defaultValue={selected.venue} required /></label><label>Exact map URL<input name="venueMapUrl" type="url" defaultValue={selected.venueMapUrl} required /></label><label>Line-up<textarea name="lineup" defaultValue={selected.lineup} required /></label><button disabled={busy}>Save public details</button></form>
              <form className="organizer-panel" onSubmit={submitAnnouncement}><header><div><small>The Room</small><h3>Post an update</h3></div><Megaphone size={18} /></header><label>Announcement<textarea name="content" minLength={2} maxLength={1000} placeholder="Doors, timing, entry or venue update…" required /></label><label className="organizer-check"><input name="pinned" type="checkbox" /> Pin this update</label><button disabled={busy}>Publish to ticket holders</button></form>
              <section className="organizer-panel organizer-panel--wide organizer-vip"><header><div><small>The Room · VIP</small><h3>Concierge</h3><p>VIP identity comes from the ticket. Open only the private services your event team is ready to fulfil; everything stays off by default.</p></div><ConciergeBell size={18} /></header><div className="organizer-vip__layout">
                <form key={`vip-${selected.slug}-${vipSetting?.updatedAt ?? "new"}`} onSubmit={saveVip}><label className="organizer-check"><input name="bottleServiceEnabled" type="checkbox" defaultChecked={Boolean(vipSetting?.bottleServiceEnabled)} /> Bottle service requests</label><label className="organizer-check"><input name="songSuggestionsEnabled" type="checkbox" defaultChecked={Boolean(vipSetting?.songSuggestionsEnabled)} /> Song suggestions <small>suggestions, never a guarantee</small></label><label className="organizer-check"><input name="assistanceEnabled" type="checkbox" defaultChecked={Boolean(vipSetting?.assistanceEnabled)} /> Host assistance</label><label><Wine size={14} /> Bottle menu<textarea name="bottleMenu" maxLength={1200} defaultValue={vipSetting?.bottleMenu ?? ""} placeholder="One bottle or package per line, with the current price" /></label><button disabled={busy}>Save VIP services</button></form>
                <div className="organizer-vip__queue">{vipRequests.length ? vipRequests.map((item) => <article key={item.id}><div><b>{item.displayName}</b><small>{readable(item.kind)}{item.location ? ` · ${item.location}` : ""}</small><p>{item.detail}</p></div><select aria-label={`Update ${item.displayName}'s request`} value={item.status} onChange={(event) => void request("vip_request", { id: item.id, status: event.target.value })}>{item.kind === "song_suggestion" ? <><option value="requested">Requested</option><option value="considering">Considering</option><option value="played">Played</option><option value="not_tonight">Not tonight</option></> : item.kind === "bottle_service" ? <><option value="requested">Requested</option><option value="confirmed">Confirmed</option><option value="on_the_way">On the way</option><option value="delivered">Delivered</option><option value="declined">Declined</option></> : <><option value="requested">Requested</option><option value="confirmed">Confirmed</option><option value="delivered">Resolved</option><option value="declined">Declined</option></>}</select></article>) : <p>No VIP requests waiting.</p>}</div>
              </div></section>
              <form className="organizer-panel" onSubmit={assignGate}><header><div><small>Entry team</small><h3>Gate staff</h3></div><ScanLine size={18} /></header>{gateStaff.map((person) => <div className="organizer-person" key={person.id}><span>{person.displayName}<small>{person.email}</small></span><button type="button" disabled={busy} onClick={() => void request("assign_gate", { email: person.email, remove: true })}>Remove</button></div>)}<label>Existing gate-staff email<input name="email" type="email" required /></label><button disabled={busy}>Authorise for this event</button></form>
              <section className="organizer-panel organizer-panel--wide"><header><div><small>Guest preparation</small><h3>Before the Night</h3></div><UsersRound size={18} /></header>{attendeeAnswers.length ? <div className="organizer-answers">{attendeeAnswers.map((item) => <article key={`${item.questionId}:${item.displayName}:${item.updatedAt}`}><div><b>{item.displayName}</b><time>{new Date(item.updatedAt).toLocaleString("en-GH")}</time></div><span>{item.prompt}</span><p>{item.answer}</p></article>)}</div> : <p>No attendee answers yet.</p>}</section>
              <form className="organizer-panel" onSubmit={submitRequest}><header><div><small>BeCore operations</small><h3>Make a request</h3></div><ArrowUpRight size={18} /></header><label>Request<select name="kind"><option value="cancel_event">Cancel event</option><option value="reschedule_event">Reschedule event</option><option value="refund_order">Refund an order</option><option value="inventory_change">Change inventory</option><option value="other">Other</option></select></label><label>Order ID <small>refund only</small><input name="orderId" /></label><label>Detail<textarea name="detail" minLength={10} maxLength={1200} required /></label><button disabled={busy}>Send to BeCore</button></form>
              <section className="organizer-panel"><header><div><small>Operations trail</small><h3>Requests</h3></div><FileCheck2 size={18} /></header>{requests.length ? requests.map((item) => <article className="organizer-request" key={item.id}><b>{readable(item.kind)}</b><span>{item.status}</span><p>{item.detail}</p>{item.reviewNote ? <small>{item.reviewNote}</small> : null}</article>) : <p>No requests yet.</p>}</section>
              <section className="organizer-panel organizer-panel--wide"><header><div><small>Finance</small><h3>Settlement statements</h3></div></header>{settlements.length ? <div className="organizer-settlements">{settlements.map((item) => <div key={item.id}><time>{date(item.periodEnd)}</time><span>{money(item.grossMinor)} gross</span><span>{money(item.refundsMinor)} refunds</span><b>{money(item.netTicketSalesMinor)} net</b><small>{item.status}</small></div>)}</div> : <p>Statements appear after reconciliation runs.</p>}</section>
            </div>
            {message ? <p className="organizer-message" role="status">{message}</p> : null}
          </section> : null}
        </>}
      </>}
    </main>
  );
}
