"use client";

import { Plus, UserCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type Guest = { id: string; guestName: string; admissionCount: number; kind: string; note: string | null; status: string };
type Tier = { id: string; code: string; name: string; priceMinor: number; admissionsPerUnit: number };

export default function DoorDesk({ eventSlug }: { eventSlug: string }) {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(async () => { if (!eventSlug) return; const response = await fetch(`/api/admin/door?eventSlug=${encodeURIComponent(eventSlug)}`, { cache: "no-store" }); const data = await response.json() as { guests?: Guest[]; tiers?: Tier[] }; if (response.ok) { setGuests(data.guests ?? []); setTiers(data.tiers ?? []); } }, [eventSlug]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function act(body: Record<string, unknown>) { const response = await fetch("/api/admin/door", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventSlug, ...body }) }); const data = await response.json() as { error?: string }; setMessage(response.ok ? "Door list updated." : data.error ?? "Door action failed."); if (response.ok) { setName(""); await load(); } }
  return <section className="door-desk"><header><UserCheck size={18} /><span><strong>Door desk</strong><small>Guest list, will-call and a clean walk-up path.</small></span></header><form onSubmit={(event) => { event.preventDefault(); void act({ action: "add", guestName: name, kind: "guest_list" }); }}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Add guest name" /><button disabled={!name.trim()}><Plus size={14} /> Add</button></form>{tiers.length ? <div className="door-desk__walkup"><span>Walk-up sale</span>{tiers.map((tier) => <a key={tier.id} href={`/checkout/${eventSlug}?tier=${encodeURIComponent(tier.id)}`} target="_blank" rel="noreferrer">{tier.name} · GH₵{(tier.priceMinor / 100).toLocaleString("en-GH")}</a>)}</div> : null}<div className="door-desk__list">{guests.map((guest) => <article key={guest.id}><span><b>{guest.guestName}</b><small>{guest.kind.replaceAll("_", " ")} · {guest.admissionCount} {guest.admissionCount === 1 ? "guest" : "guests"}{guest.note ? ` · ${guest.note}` : ""}</small></span>{guest.status === "expected" ? <button onClick={() => void act({ action: "check_in", id: guest.id })}>Admit</button> : <i>In</i>}</article>)}</div>{message ? <button className="door-desk__message" onClick={() => setMessage("")}>{message}</button> : null}</section>;
}
