"use client";

import { operationsFetch } from "../../../lib/operations-client";

import EventRemoval from "./event-removal";

import RegistrationManager from "../../registration-manager";

import Link from "next/link";
import { CalendarRange, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { eventColourSchemes } from "../../../lib/event-presentation";
import OperationsNav from "../operations-nav";
import type { StaffRole } from "../../../lib/admin-session";

type Tier = { id?: string; code: string; name: string; description: string; priceMinor: number; priceDraft?: string; admissionsPerUnit: number | string; capacityAdmissions: number | string; maxUnitsPerOrder: number | string; status: "available" | "sold_out" | "hidden"; salesOpenAt: string | null; salesCloseAt: string | null; roomBadge: "VIP" | null; allocatedAdmissions?: number };
type EventRecord = { slug: string; title: string; venue: string; venueMapUrl: string; area: string; startsAt: string; endsAt: string; vibe: string; salesOpenAt: string | null; salesCloseAt: string | null; ageRestriction: string; lineup: string; eventState: string; scheduleStatus: "confirmed" | "coming_soon" | "end_pending"; isTestEvent: boolean; rescheduledFrom: string | null; curationNote: string; tagline?: string | null; dressCode?: string | null; colourScheme?: string | null; awarenessNote?: string | null; guestPerk?: string | null; status: string; tiers: Tier[] };

const localValue = (value: string | null) => value ? value.slice(0, 16) : "";

export default function EventOperations({ actor, role }: { actor: string; role: StaffRole }) {
  const [viewTime] = useState(() => Date.now());
  const [view, setView] = useState("upcoming");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selected, setSelected] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await operationsFetch("/api/admin/events", { cache: "no-store" });
    const data = await response.json() as { events?: EventRecord[]; error?: string };
    if (!response.ok) { setMessage(data.error ?? "Events could not be loaded."); setLoading(false); return; }
    setEvents(data.events ?? []);
    setSelected((current) => {
      const refreshed = data.events?.find((event) => event.slug === current?.slug) ?? null;
      return refreshed ? structuredClone(refreshed) : null;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    operationsFetch("/api/admin/events", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as { events?: EventRecord[]; error?: string } }))
      .then(({ response, data }) => {
        if (!response.ok) setMessage(data.error ?? "Events could not be loaded.");
        else {
          setEvents(data.events ?? []);
          const requested = new URLSearchParams(window.location.search).get("event");
          setSelected(data.events?.find(event => event.slug === requested) ?? null);
        }
        setLoading(false);
      })
      .catch(() => { setMessage("Events could not be loaded."); setLoading(false); });
  }, []);

  function update<K extends keyof EventRecord>(key: K, value: EventRecord[K]) {
    setSelected((current) => current ? { ...current, [key]: value } : current);
  }

  function updateTier(index: number, patch: Partial<Tier>) {
    if (!selected) return;
    update("tiers", selected.tiers.map((tier, tierIndex) => tierIndex === index ? { ...tier, ...patch } : tier));
  }

  function addTier() {
    if (!selected) return;
    update("tiers", [...selected.tiers, { code: `tier-${selected.tiers.length + 1}`, name: "New tier", description: "Describe what this ticket includes", priceMinor: 0, admissionsPerUnit: 1, capacityAdmissions: 1, maxUnitsPerOrder: 10, status: "available", salesOpenAt: null, salesCloseAt: null, roomBadge: null }]);
  }

  async function saveCopy() {
    if (!selected || saving) return;
    setSaving(true); setMessage("");
    try {
      const response = await operationsFetch("/api/admin/events", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: selected.slug, action: "save_copy", tagline: selected.tagline }) });
      const data = await response.json() as { error?: string };
      setMessage(response.ok ? "Event line saved." : data.error ?? "The event line could not be saved.");
    } catch { setMessage("Could not save the event line. Your words are still here; try again."); }
    finally { setSaving(false); }
  }

  async function save() {
    if (!selected || saving) return;
    if (selected.tiers.some(tier => [tier.priceDraft ?? tier.priceMinor, tier.admissionsPerUnit, tier.capacityAdmissions, tier.maxUnitsPerOrder].some(value => String(value).trim()==='' || !Number.isFinite(Number(value))))) {
      setMessage('Fill in each ticket price and admission limit before saving.'); return;
    }
    const payload = {...selected,tiers:selected.tiers.map(({priceDraft,...tier})=>({...tier,priceMinor:priceDraft===undefined?tier.priceMinor:Math.round(Number(priceDraft)*100),admissionsPerUnit:Number(tier.admissionsPerUnit),capacityAdmissions:Number(tier.capacityAdmissions),maxUnitsPerOrder:Number(tier.maxUnitsPerOrder)}))};
    setSaving(true); setMessage("");
    const response = await operationsFetch("/api/admin/events", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json() as { error?: string };
    if (!response.ok) setMessage(data.error ?? "The event could not be saved.");
    else { setMessage("Event and inventory saved."); await load(); }
    setSaving(false);
  }

  const matchesView = (event: EventRecord) => view === "all" || (view === "previews" ? Boolean(event.isTestEvent) : !event.isTestEvent && (view === "past" ? event.scheduleStatus !== "coming_soon" && Date.parse(event.endsAt) < viewTime : event.scheduleStatus === "coming_soon" || Date.parse(event.endsAt) >= viewTime));
  const filtered = events.filter(event => matchesView(event) && `${event.title} ${event.venue} ${event.area}`.toLowerCase().includes(query.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const visible = filtered.slice((Math.min(page, pageCount) - 1) * 10, Math.min(page, pageCount) * 10);
  return <main className="ops-page">
    <OperationsNav actor={actor} role={role} active="/admin/events" />
    <section className="ops-main"><header><div><p>Commercial operations</p><h1>Events & inventory</h1></div><span>{events.length} records</span></header>
      {message && !selected ? <p className="ops-message" role="status">{message}</p> : null}
      {!selected ? <>
        <nav className="ops-tabs" aria-label="Event views">{Object.entries({ upcoming: "Upcoming", past: "Past", previews: "Previews", all: "All events" }).map(([key, label]) => <button key={key} aria-pressed={view === key} onClick={() => { setView(key); setPage(1); }}>{label}</button>)}</nav>
        <label className="ops-search">Search events<input value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Event, venue or area" /></label>
        {loading ? <p role="status"><Loader2 className="spin" /> Loading events…</p> : <div className="ops-directory">{visible.map(event => <button key={event.slug} className="ops-directory__row" onClick={() => { setSelected(structuredClone(event)); setMessage(""); }}><span><b>{event.title}</b><small>{event.venue} · {event.area}</small></span><span>{event.isTestEvent ? "Preview" : event.status !== "published" ? event.status : event.eventState.replaceAll("_", " ")}</span><time>{event.scheduleStatus === "coming_soon" ? "Date to be announced" : new Date(event.startsAt).toLocaleDateString("en-GH", { dateStyle: "medium", timeZone: "Africa/Accra" })}</time><span aria-hidden="true">→</span></button>)}{!visible.length ? <p className="ops-empty"><CalendarRange size={18} /> {query ? "No matching events." : "No events in this view."}</p> : null}</div>}
        <nav className="order-pagination" aria-label="Event pages"><span>{filtered.length} events</span><div><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>{Math.min(page, pageCount)} / {pageCount}</span><button disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</button></div></nav>
      </> : <div className="ops-detail-view">
        <header className="ops-detail-header"><button className="ops-back" disabled={saving} onClick={() => setSelected(null)}>← Back to events</button><EventRemoval eventSlug={selected.slug} title={selected.title} onRemoved={() => { setSelected(null); setMessage("Event removed. Analytics remain available."); void load(); }} /></header>
        <article className="ops-editor"><h2>{selected.title}</h2><details className="ops-section" open><summary>Event details</summary><div className="ops-grid"><label className="wide">Event line<input maxLength={100} value={selected.tagline ?? ""} onChange={(event) => update("tagline", event.target.value)} placeholder="One original line for this event." /></label><button type="button" disabled={saving} onClick={saveCopy}>Save event line</button><label>Title<input value={selected.title} onChange={(event) => update("title", event.target.value)} /></label><label>Venue<input value={selected.venue} onChange={(event) => update("venue", event.target.value)} /></label><label>Exact map URL<input value={selected.venueMapUrl ?? ""} onChange={(event) => update("venueMapUrl", event.target.value)} /></label><label>Area<input value={selected.area} onChange={(event) => update("area", event.target.value)} /></label><label>Date status<select value={selected.scheduleStatus} onChange={(event) => update("scheduleStatus", event.target.value as EventRecord["scheduleStatus"])}><option value="coming_soon" disabled={selected.scheduleStatus !== "coming_soon"}>Date to be announced</option><option value="confirmed">Date and end time confirmed</option><option value="end_pending">Date confirmed, end time pending</option></select></label><label>Starts (Ghana time)<input type="datetime-local" value={localValue(selected.startsAt)} onChange={(event) => update("startsAt", event.target.value ? `${event.target.value}:00.000Z` : "")} /></label><label>Ends (Ghana time)<input type="datetime-local" value={localValue(selected.endsAt)} onChange={(event) => update("endsAt", event.target.value ? `${event.target.value}:00.000Z` : "")} /></label><label>Sales open (Ghana time)<input type="datetime-local" value={localValue(selected.salesOpenAt)} onChange={(event) => update("salesOpenAt", event.target.value ? `${event.target.value}:00.000Z` : null)} /></label><label>Sales close (Ghana time)<input type="datetime-local" value={localValue(selected.salesCloseAt)} onChange={(event) => update("salesCloseAt", event.target.value ? `${event.target.value}:00.000Z` : null)} /></label><label>State<select value={selected.eventState} onChange={(event) => update("eventState", event.target.value)}><option value="on_sale">On sale</option><option value="sold_out">Sold out</option><option value="cancelled" disabled>Cancelled (approval required)</option><option value="postponed">Postponed</option><option value="rescheduled">Rescheduled</option></select></label><label>Age restriction<input value={selected.ageRestriction} onChange={(event) => update("ageRestriction", event.target.value)} /></label><label>Dress code<input maxLength={100} value={selected.dressCode ?? ""} onChange={(event) => update("dressCode", event.target.value)} /></label><label>Event colours<select value={selected.colourScheme ?? ""} onChange={(event) => update("colourScheme", event.target.value || null)}><option value="">Match the event mood</option>{Object.entries(eventColourSchemes).map(([key, palette]) => <option key={key} value={key}>{palette.label}</option>)}</select></label><label className="wide">Guest perk (optional)<input maxLength={160} value={selected.guestPerk ?? ""} onChange={(event) => update("guestPerk", event.target.value)} /></label><label className="wide">Cause or occasion (optional)<input maxLength={160} value={selected.awarenessNote ?? ""} onChange={(event) => update("awarenessNote", event.target.value)} /></label><label className="wide">Line-up<textarea value={selected.lineup} onChange={(event) => update("lineup", event.target.value)} /></label><label className="wide">Customer-facing note<textarea value={selected.curationNote} onChange={(event) => update("curationNote", event.target.value)} /></label></div></details>
          <p>Cancellation requires a second person’s approval in <Link href="/admin/operations">Event operations</Link>.</p><RegistrationManager key={selected.slug} eventSlug={selected.slug} /><details className="tier-editor ops-section"><summary>Ticket prices & capacity</summary><header><div><p>Ticket tiers</p><h2>Prices and admission limits</h2></div><button type="button" onClick={addTier}><Plus size={15} /> Add tier</button></header>{selected.tiers.map((tier, index) => <article key={tier.id ?? `${tier.code}-${index}`}><div className="tier-editor__top"><input aria-label="Tier name" value={tier.name} onChange={(event) => updateTier(index, { name: event.target.value })} /><button type="button" aria-label={`Remove ${tier.name}`} disabled={selected.tiers.length === 1} onClick={() => update("tiers", selected.tiers.filter((_, tierIndex) => tierIndex !== index))}><Trash2 size={15} /></button></div><div className="tier-editor__grid"><label>Code<input value={tier.code} onChange={(event) => updateTier(index, { code: event.target.value })} /></label><label>Price (GH₵)<input type="number" min="0" step="0.01" value={tier.priceDraft ?? (tier.priceMinor / 100).toString()} onChange={(event) => updateTier(index, { priceDraft: event.target.value })} /></label><label>Admissions / unit<input type="number" min="1" value={tier.admissionsPerUnit} onChange={(event) => updateTier(index, { admissionsPerUnit: event.target.value })} /></label><label>Admission capacity<input type="number" min="1" value={tier.capacityAdmissions} onChange={(event) => updateTier(index, { capacityAdmissions: event.target.value })} /><small>{tier.allocatedAdmissions ?? 0} allocated</small></label><label>Max units / order<input type="number" min="1" max="20" value={tier.maxUnitsPerOrder} onChange={(event) => updateTier(index, { maxUnitsPerOrder: event.target.value })} /></label><label>Status<select value={tier.status} onChange={(event) => updateTier(index, { status: event.target.value as Tier["status"] })}><option value="available">Available</option><option value="sold_out">Sold out</option><option value="hidden">Hidden</option></select></label><label>Room identity<select value={tier.roomBadge ?? ""} onChange={(event) => updateTier(index, { roomBadge: event.target.value === "VIP" ? "VIP" : null })}><option value="">No visible badge</option><option value="VIP">VIP badge + concierge</option></select></label><label className="wide">Description<input value={tier.description} onChange={(event) => updateTier(index, { description: event.target.value })} /></label></div></article>)}</details>
          {message ? <p className="ops-message" role="status">{message}</p> : null}<button className="ops-save" type="button" disabled={saving} onClick={save}>{saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />} {saving ? "Saving…" : "Save event & inventory"}</button>
        </article>
      </div>}
    </section>
  </main>;
}
