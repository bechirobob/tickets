"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BadgeCheck, CalendarRange, CheckCircle2, Loader2, LogOut, Megaphone, Save, ScanLine, ShieldCheck, TicketCheck, UsersRound } from "lucide-react";

type EventItem = { slug: string; title: string; venue: string; venueMapUrl: string; area: string; startsAt: string; endsAt: string; lineup: string; eventState: string; capacity: number; status: string; paidOrders: number; grossMinor: number; issuedAdmissions: number; checkedInAdmissions: number };
type Tier = { id: string; eventSlug: string; name: string; priceMinor: number; capacityAdmissions: number; allocatedAdmissions: number; status: string };
type Settlement = { id: string; eventSlug: string; periodEnd: string; grossMinor: number; bookingFeesMinor: number; refundsMinor: number; netTicketSalesMinor: number; currency: string; status: string };
type RequestItem = { id: string; eventSlug: string; kind: string; detail: string; status: string; reviewNote: string | null; createdAt: string };
type GateStaff = { eventSlug: string; id: string; displayName: string; email: string; status: string };
type WorkspaceData = { events: EventItem[]; tiers: Tier[]; settlements: Settlement[]; requests: RequestItem[]; gateStaff: GateStaff[] };

const empty: WorkspaceData = { events: [], tiers: [], settlements: [], requests: [], gateStaff: [] };
const money = (value: number) => new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", maximumFractionDigits: 0 }).format(value / 100);

export default function OrganizerWorkspace({ actor }: { actor: string }) {
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
      else { setData(result); setSelectedSlug((current) => current || result.events[0]?.slug || ""); }
    } catch { setMessage("Workspace could not be loaded."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    fetch("/api/organizer/workspace", { cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json() as WorkspaceData & { error?: string } }))
      .then(({ response, result }) => {
        if (!response.ok) setMessage(result.error ?? "Workspace could not be loaded.");
        else { setData(result); setSelectedSlug(result.events[0]?.slug || ""); }
        setLoading(false);
      })
      .catch(() => { setMessage("Workspace could not be loaded."); setLoading(false); });
  }, []);
  const selected = useMemo(() => data.events.find((item) => item.slug === selectedSlug) ?? null, [data.events, selectedSlug]);
  const tiers = data.tiers.filter((tier) => tier.eventSlug === selectedSlug);
  const settlements = data.settlements.filter((item) => item.eventSlug === selectedSlug);
  const requests = data.requests.filter((item) => item.eventSlug === selectedSlug);
  const gateStaff = data.gateStaff.filter((item) => item.eventSlug === selectedSlug);

  async function request(action: string, body: Record<string, unknown>, method = "POST"): Promise<boolean> {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/organizer/workspace", { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ action, eventSlug: selectedSlug, ...body }) });
      const result = await response.json() as { error?: string };
      setMessage(response.ok ? "Saved." : result.error ?? "The action failed.");
      if (response.ok) await load();
      return response.ok;
    } catch { setMessage("The action could not be completed. Check your connection and try again."); return false; }
    finally { setBusy(false); }
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await request("update", { venue: form.get("venue"), venueMapUrl: form.get("venueMapUrl"), lineup: form.get("lineup") }, "PATCH");
  }
  async function submitAnnouncement(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const element = event.currentTarget; const form = new FormData(element); if (await request("announcement", { content: form.get("content"), pinned: form.get("pinned") === "on" })) element.reset(); }
  async function submitRequest(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const element = event.currentTarget; const form = new FormData(element); if (await request("request", { kind: form.get("kind"), orderId: form.get("orderId"), detail: form.get("detail") })) element.reset(); }
  async function assignGate(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const element = event.currentTarget; const form = new FormData(element); if (await request("assign_gate", { email: form.get("email") })) element.reset(); }
  async function signOut() { await fetch("/api/admin/session", { method: "DELETE" }); router.push("/"); router.refresh(); }

  return <main className="organizer-workspace">
    <header className="organizer-workspace__header"><Link href="/" className="night-brand-link"><span className="night-brand"><b>B</b><span>BeCore<br />Tickets</span></span></Link><div><span><BadgeCheck size={15} /> {actor}</span><Link href="/admin/account">Account</Link><button onClick={signOut}><LogOut size={15} /> Sign out</button></div></header>
    <section className="organizer-workspace__intro"><div><p className="night-kicker"><span /> Organiser workspace</p><h1>Your night,<br />without the noise.</h1></div><p>Sales, attendance, updates and requests for only the events assigned to your account.</p></section>
    {loading ? <div className="organizer-empty"><Loader2 className="spin" /> Loading your events…</div> : data.events.length === 0 ? <div className="organizer-empty"><CalendarRange /><h2>No assigned events yet.</h2><p>Ask a BeCore owner to connect your approved event to this account.</p><Link href="/organizer/submit">Submit an event</Link></div> : <>
      <nav className="organizer-event-tabs" aria-label="Assigned events">{data.events.map((item) => <button key={item.slug} className={selectedSlug === item.slug ? "active" : ""} onClick={() => { setSelectedSlug(item.slug); setMessage(""); }}><b>{item.title}</b><small>{new Date(item.startsAt).toLocaleDateString("en-GH", { dateStyle: "medium" })} · {item.eventState.replaceAll("_", " ")}</small></button>)}</nav>
      {selected ? <section className="organizer-dashboard">
        <header><div><p>{selected.venue} · {selected.area}</p><h2>{selected.title}</h2></div><Link href={`/event/${selected.slug}`}>View customer page <ArrowUpRight size={15} /></Link></header>
        <div className="organizer-metrics"><article><TicketCheck /><small>Paid orders</small><b>{selected.paidOrders}</b></article><article><UsersRound /><small>Admissions issued</small><b>{selected.issuedAdmissions}</b></article><article><ScanLine /><small>Checked in</small><b>{selected.checkedInAdmissions}</b></article><article><CheckCircle2 /><small>Gross collected</small><b>{money(selected.grossMinor)}</b></article></div>
        <div className="organizer-grid">
          <section className="organizer-panel organizer-panel--wide"><header><div><small>Live inventory</small><h3>Ticket tiers</h3></div><ShieldCheck size={18} /></header><div className="organizer-tier-table">{tiers.map((tier) => <div key={tier.id}><span><b>{tier.name}</b><small>{money(tier.priceMinor)} · {tier.status}</small></span><strong>{tier.allocatedAdmissions} / {tier.capacityAdmissions}</strong><i><b style={{ width: `${Math.min(100, (tier.allocatedAdmissions / Math.max(1, tier.capacityAdmissions)) * 100)}%` }} /></i></div>)}</div></section>
          <form key={`details-${selected.slug}`} className="organizer-panel" onSubmit={saveDetails}><header><div><small>Authorised details</small><h3>Venue & line-up</h3></div><Save size={18} /></header><label>Venue<input name="venue" defaultValue={selected.venue} required /></label><label>Exact map URL<input name="venueMapUrl" type="url" defaultValue={selected.venueMapUrl} required /></label><label>Line-up<textarea name="lineup" defaultValue={selected.lineup} required /></label><button disabled={busy}>Save public details</button></form>
          <form className="organizer-panel" onSubmit={submitAnnouncement}><header><div><small>The Room</small><h3>Post an update</h3></div><Megaphone size={18} /></header><label>Announcement<textarea name="content" minLength={2} maxLength={1000} placeholder="Doors, timing, entry or venue update…" required /></label><label className="organizer-check"><input name="pinned" type="checkbox" /> Pin this update</label><button disabled={busy}>Publish to ticket holders</button></form>
          <form className="organizer-panel" onSubmit={assignGate}><header><div><small>Entry team</small><h3>Gate staff</h3></div><ScanLine size={18} /></header>{gateStaff.map((person) => <div className="organizer-person" key={person.id}><span>{person.displayName}<small>{person.email}</small></span><button type="button" disabled={busy} onClick={() => void request("assign_gate", { email: person.email, remove: true })}>Remove</button></div>)}<label>Existing gate-staff email<input name="email" type="email" required /></label><button disabled={busy}>Authorise for this event</button></form>
          <form className="organizer-panel" onSubmit={submitRequest}><header><div><small>BeCore operations</small><h3>Make a request</h3></div><ArrowUpRight size={18} /></header><label>Request<select name="kind"><option value="cancel_event">Cancel event</option><option value="reschedule_event">Reschedule event</option><option value="refund_order">Refund an order</option><option value="inventory_change">Change inventory</option><option value="other">Other</option></select></label><label>Order ID <small>refund only</small><input name="orderId" /></label><label>Detail<textarea name="detail" minLength={10} maxLength={1200} required /></label><button disabled={busy}>Send to BeCore</button></form>
          <section className="organizer-panel"><header><div><small>Operations trail</small><h3>Requests</h3></div></header>{requests.length ? requests.map((item) => <article className="organizer-request" key={item.id}><b>{item.kind.replaceAll("_", " ")}</b><span>{item.status}</span><p>{item.detail}</p>{item.reviewNote ? <small>{item.reviewNote}</small> : null}</article>) : <p>No requests yet.</p>}</section>
          <section className="organizer-panel organizer-panel--wide"><header><div><small>Finance</small><h3>Settlement statements</h3></div></header>{settlements.length ? <div className="organizer-settlements">{settlements.map((item) => <div key={item.id}><time>{new Date(item.periodEnd).toLocaleDateString("en-GH", { dateStyle: "medium" })}</time><span>{money(item.grossMinor)} gross</span><span>{money(item.refundsMinor)} refunds</span><b>{money(item.netTicketSalesMinor)} net</b><small>{item.status}</small></div>)}</div> : <p>Statements appear after reconciliation runs.</p>}</section>
        </div>{message ? <p className="organizer-message" role="status">{message}</p> : null}
      </section> : null}
    </>}
  </main>;
}
