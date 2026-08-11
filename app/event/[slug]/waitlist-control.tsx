"use client";

import { BellRing, Loader2 } from "lucide-react";
import { useState } from "react";

type Tier = { recordId: string; name: string; status: string };

export default function WaitlistControl({ eventSlug, tiers }: { eventSlug: string; tiers: Tier[] }) {
  const sold = tiers.filter((tier) => tier.status === "sold_out");
  const [ticketTierId, setTicketTierId] = useState(sold[0]?.recordId ?? "");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  if (!sold.length) return null;
  async function join() {
    setBusy(true); setNotice("");
    const response = await fetch("/api/waitlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventSlug, ticketTierId, email, phone }) });
    const result = await response.json() as { error?: string; alreadyJoined?: boolean };
    setNotice(response.ok ? result.alreadyJoined ? "You’re already in line. Keen. We respect it." : "You’re in line. If a ticket returns, email gets first dibs." : result.error ?? "The waitlist refused to behave.");
    setBusy(false);
  }
  return <section className="event-waitlist"><header><BellRing size={16} /><span><b>Catch a returned ticket</b><small>One private 30-minute offer. No refresh Olympics.</small></span></header><select aria-label="Sold-out ticket tier" value={ticketTierId} onChange={(event) => setTicketTierId(event.target.value)}>{sold.map((tier) => <option key={tier.recordId} value={tier.recordId}>{tier.name}</option>)}</select><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" autoComplete="email" /><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone (optional)" autoComplete="tel" /><button type="button" onClick={join} disabled={busy || !email.trim()}>{busy ? <Loader2 className="spin" size={14} /> : "Join waitlist"}</button>{notice ? <p role="status">{notice}</p> : null}</section>;
}
