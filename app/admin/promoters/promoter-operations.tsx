"use client";

import { Copy, Link2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import OperationsNav from "../operations-nav";
import type { StaffRole } from "../../../lib/admin-session";

type Code = { id: string; eventSlug: string; eventTitle: string; code: string; label: string; status: string; orderCount: number; grossMinor: number };

export default function PromoterOperations({ actor, role }: { actor: string; role: StaffRole }) {
  const [events, setEvents] = useState<Array<{ slug: string; title: string }>>([]);
  const [codes, setCodes] = useState<Code[]>([]);
  const [eventSlug, setEventSlug] = useState("");
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const response = await fetch("/api/admin/promoters", { cache: "no-store" }); const data = await response.json() as { events?: Array<{ slug: string; title: string }>; codes?: Code[]; error?: string }; if (response.ok) { setEvents(data.events ?? []); setCodes(data.codes ?? []); setEventSlug((current) => current || data.events?.[0]?.slug || ""); } else setNotice(data.error ?? "Promoter links could not load."); }, []);
  useEffect(() => {
    fetch("/api/admin/promoters", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as { events?: Array<{ slug: string; title: string }>; codes?: Code[]; error?: string } }))
      .then(({ response, data }) => { if (response.ok) { setEvents(data.events ?? []); setCodes(data.codes ?? []); setEventSlug(data.events?.[0]?.slug || ""); } else setNotice(data.error ?? "Promoter links could not load."); })
      .catch(() => setNotice("Promoter links could not load."));
  }, []);
  async function operate(body: Record<string, unknown>, success: string) { setBusy(true); const response = await fetch("/api/admin/promoters", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const data = await response.json() as { error?: string }; setNotice(response.ok ? success : data.error ?? "Promoter action failed."); if (response.ok) { setLabel(""); setCode(""); await load(); } setBusy(false); }
  return <main className="ops-page"><OperationsNav actor={actor} role={role} active="/admin/promoters" /><section className="ops-main promoter-ops"><header><div><p>Attributable event links</p><h1>Promoter links</h1></div></header><form onSubmit={(event) => { event.preventDefault(); void operate({ action: "create", eventSlug, label, code }, "Promoter link created."); }}><select value={eventSlug} onChange={(event) => setEventSlug(event.target.value)}>{events.map((event) => <option key={event.slug} value={event.slug}>{event.title}</option>)}</select><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Promoter name" maxLength={100} /><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="CODE" maxLength={32} /><button disabled={busy || !eventSlug || !label.trim() || code.trim().length < 2}>{busy ? <Loader2 className="spin" size={14} /> : <Link2 size={14} />} Create</button></form>{notice ? <button className="ops-message" onClick={() => setNotice("")}>{notice}</button> : null}<div className="promoter-ops__list">{codes.map((item) => { const url = `https://tickets.becoreops.com/event/${item.eventSlug}?ref=${encodeURIComponent(item.code)}`; return <article key={item.id}><div><b>{item.label}</b><span>{item.eventTitle} · {item.code}</span></div><strong>{item.orderCount} orders · GH₵{(Number(item.grossMinor) / 100).toLocaleString("en-GH")}</strong><button onClick={() => { void navigator.clipboard.writeText(url); setNotice("Trackable link copied."); }}><Copy size={13} /> Copy</button><button onClick={() => operate({ action: "toggle", id: item.id }, item.status === "active" ? "Link disabled." : "Link active.")}>{item.status}</button></article>; })}</div></section></main>;
}
