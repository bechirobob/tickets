"use client";

import Link from "next/link";
import { CalendarRange, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import OperationsNav from "../operations-nav";
import type { StaffRole } from "../../../lib/admin-session";

type Tier = { id?: string; code: string; name: string; description: string; priceMinor: number; admissionsPerUnit: number; capacityAdmissions: number; maxUnitsPerOrder: number; status: "available" | "sold_out" | "hidden"; salesOpenAt: string | null; salesCloseAt: string | null; allocatedAdmissions?: number };
type EventRecord = { slug: string; title: string; venue: string; venueMapUrl: string; area: string; startsAt: string; endsAt: string; vibe: string; salesOpenAt: string | null; salesCloseAt: string | null; ageRestriction: string; lineup: string; eventState: string; isTestEvent: boolean; rescheduledFrom: string | null; curationNote: string; status: string; tiers: Tier[] };

const localValue = (value: string | null) => value ? value.slice(0, 16) : "";
const minor = (value: string) => Math.round(Number(value || 0) * 100);

export default function EventOperations({ actor, role }: { actor: string; role: StaffRole }) {
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [selected, setSelected] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/events", { cache: "no-store" });
    const data = await response.json() as { events?: EventRecord[]; error?: string };
    if (!response.ok) { setMessage(data.error ?? "Events could not be loaded."); setLoading(false); return; }
    setEvents(data.events ?? []);
    setSelected((current) => {
      const refreshed = data.events?.find((event) => event.slug === current?.slug) ?? data.events?.[0] ?? null;
      return refreshed ? structuredClone(refreshed) : null;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch("/api/admin/events", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as { events?: EventRecord[]; error?: string } }))
      .then(({ response, data }) => {
        if (!response.ok) setMessage(data.error ?? "Events could not be loaded.");
        else {
          setEvents(data.events ?? []);
          setSelected(data.events?.[0] ? structuredClone(data.events[0]) : null);
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
    update("tiers", [...selected.tiers, { code: `tier-${selected.tiers.length + 1}`, name: "New tier", description: "Describe what this ticket includes", priceMinor: 0, admissionsPerUnit: 1, capacityAdmissions: 1, maxUnitsPerOrder: 10, status: "available", salesOpenAt: null, salesCloseAt: null }]);
  }

  async function save() {
    if (!selected || saving) return;
    setSaving(true); setMessage("");
    const response = await fetch("/api/admin/events", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(selected) });
    const data = await response.json() as { error?: string };
    if (!response.ok) setMessage(data.error ?? "The event could not be saved.");
    else { setMessage("Event and inventory saved."); await load(); }
    setSaving(false);
  }

  return <main className="ops-page">
    <OperationsNav actor={actor} role={role} active="/admin/events" />
    <section className="ops-main"><header><div><p>Commercial operations</p><h1>Events & inventory</h1></div><span>{events.length} records</span></header>
      {loading ? <div className="curation-empty"><Loader2 className="spin" /> Loading real inventory…</div> : !selected ? <div className="curation-empty"><CalendarRange /><h2>No approved events yet.</h2><p>Publish an approved organiser submission to create its first real ticket tier.</p><Link href="/admin">Open curation</Link></div> : <div className="ops-workspace">
        <nav className="ops-record-list">{events.map((event) => <button key={event.slug} className={selected.slug === event.slug ? "active" : ""} onClick={() => setSelected(structuredClone(event))}><b>{event.title}</b><span>{event.isTestEvent ? "Preview · " : ""}{event.area} · {event.eventState.replaceAll("_", " ")}</span></button>)}</nav>
        <article className="ops-editor"><div className="ops-grid"><label>Title<input value={selected.title} onChange={(event) => update("title", event.target.value)} /></label><label>Venue<input value={selected.venue} onChange={(event) => update("venue", event.target.value)} /></label><label>Exact map URL<input value={selected.venueMapUrl ?? ""} onChange={(event) => update("venueMapUrl", event.target.value)} /></label><label>Area<input value={selected.area} onChange={(event) => update("area", event.target.value)} /></label><label>Starts<input type="datetime-local" value={localValue(selected.startsAt)} onChange={(event) => update("startsAt", event.target.value)} /></label><label>Ends<input type="datetime-local" value={localValue(selected.endsAt)} onChange={(event) => update("endsAt", event.target.value)} /></label><label>Sales open<input type="datetime-local" value={localValue(selected.salesOpenAt)} onChange={(event) => update("salesOpenAt", event.target.value || null)} /></label><label>Sales close<input type="datetime-local" value={localValue(selected.salesCloseAt)} onChange={(event) => update("salesCloseAt", event.target.value || null)} /></label><label>State<select value={selected.eventState} onChange={(event) => update("eventState", event.target.value)}><option value="on_sale">On sale</option><option value="sold_out">Sold out</option><option value="cancelled">Cancelled</option><option value="postponed">Postponed</option><option value="rescheduled">Rescheduled</option></select></label><label>Age restriction<input value={selected.ageRestriction} onChange={(event) => update("ageRestriction", event.target.value)} /></label><label className="wide">Line-up<textarea value={selected.lineup} onChange={(event) => update("lineup", event.target.value)} /></label><label className="wide">Customer-facing note<textarea value={selected.curationNote} onChange={(event) => update("curationNote", event.target.value)} /></label></div>
          <section className="tier-editor"><header><div><p>Ticket tiers</p><h2>Prices and admission limits</h2></div><button type="button" onClick={addTier}><Plus size={15} /> Add tier</button></header>{selected.tiers.map((tier, index) => <article key={tier.id ?? `${tier.code}-${index}`}><div className="tier-editor__top"><input aria-label="Tier name" value={tier.name} onChange={(event) => updateTier(index, { name: event.target.value })} /><button type="button" aria-label={`Remove ${tier.name}`} disabled={selected.tiers.length === 1} onClick={() => update("tiers", selected.tiers.filter((_, tierIndex) => tierIndex !== index))}><Trash2 size={15} /></button></div><div className="tier-editor__grid"><label>Code<input value={tier.code} onChange={(event) => updateTier(index, { code: event.target.value })} /></label><label>Price (GH₵)<input type="number" min="0" step="0.01" value={(tier.priceMinor / 100).toString()} onChange={(event) => updateTier(index, { priceMinor: minor(event.target.value) })} /></label><label>Admissions / unit<input type="number" min="1" value={tier.admissionsPerUnit} onChange={(event) => updateTier(index, { admissionsPerUnit: Number(event.target.value) })} /></label><label>Admission capacity<input type="number" min="1" value={tier.capacityAdmissions} onChange={(event) => updateTier(index, { capacityAdmissions: Number(event.target.value) })} /><small>{tier.allocatedAdmissions ?? 0} allocated</small></label><label>Max units / order<input type="number" min="1" max="20" value={tier.maxUnitsPerOrder} onChange={(event) => updateTier(index, { maxUnitsPerOrder: Number(event.target.value) })} /></label><label>Status<select value={tier.status} onChange={(event) => updateTier(index, { status: event.target.value as Tier["status"] })}><option value="available">Available</option><option value="sold_out">Sold out</option><option value="hidden">Hidden</option></select></label><label className="wide">Description<input value={tier.description} onChange={(event) => updateTier(index, { description: event.target.value })} /></label></div></article>)}</section>
          {message ? <p className="ops-message" role="status">{message}</p> : null}<button className="ops-save" type="button" disabled={saving} onClick={save}>{saving ? <Loader2 className="spin" size={16} /> : <Save size={16} />} {saving ? "Saving…" : "Save event & inventory"}</button>
        </article>
      </div>}
    </section>
  </main>;
}
