"use client";

import { useCallback, useEffect, useState } from "react";
import type { StaffRole } from "../../../lib/staff-roles";
import { operationsFetch } from "../../../lib/operations-client";
import OperationsNav from "../operations-nav";

type Audience = { contacts: { email: string; consentedAt: string; consentVersion: string; name: string }[]; summary: { subscribed: number; withdrawn: number }; nextCursor: string | null; deliveryEnabled: false };
export default function YorkewayAudience({ actor, role }: { actor: string; role: StaffRole }) {
  const [data, setData] = useState<Audience | null>(null);
  const [cursors, setCursors] = useState<string[]>([""]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const cursor = cursors[cursors.length - 1];
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError("");
    try {
      const response = await operationsFetch(`/api/admin/yorkeway-audience?after=${encodeURIComponent(cursor)}`, { signal });
      const result = await response.json() as Audience & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Subscribers could not load.");
      if (!signal?.aborted) setData(result);
    } catch (cause) { if (!signal?.aborted) { setData(null); setError(cause instanceof Error ? cause.message : "Subscribers could not load."); } }
    finally { if (!signal?.aborted) setBusy(false); }
  }, [cursor]);
  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => void load(controller.signal), 0); return () => { clearTimeout(timer); controller.abort(); }; }, [load]);
  return <main className="ops-page"><OperationsNav actor={actor} role={role} active="/admin/yorkeway-audience" /><section className="ops-main event-audience">
    <header><div><p>BeCore Tickets</p><h1>Yorke Way early access</h1><p>Consented signups for Kofi Bills’ year-end 2026 events. Only the owner can see this list.</p></div><button type="button" disabled={busy} onClick={() => void load()}>Refresh</button></header>
    <p>Single opt-in: email ownership is not verified. Campaign sending and provider contact sync are not enabled.</p>
    {busy ? <p role="status">Loading subscribers…</p> : null}{error ? <p role="alert">{error}</p> : null}
    {data ? <><p>{data.summary.subscribed} subscribed · {data.summary.withdrawn} withdrawn</p>
      {data.contacts.length ? <div className="audience-table" role="region" aria-label="BeCore subscriber list" tabIndex={0}><table><thead><tr><th>Email</th><th>Name</th><th>Subscribed</th></tr></thead><tbody>{data.contacts.map(contact => <tr key={contact.email}><td>{contact.email}</td><td>{contact.name}</td><td>{new Date(contact.consentedAt).toLocaleDateString("en-GB")}</td></tr>)}</tbody></table></div> : <p>No subscribers on this page.</p>}
      <nav className="audience-pagination" aria-label="Subscriber pages"><button type="button" disabled={busy || cursors.length === 1} onClick={() => setCursors(previous => previous.slice(0, -1))}>Previous</button><span>Page {cursors.length}</span><button type="button" disabled={busy || !data.nextCursor} onClick={() => { if (data.nextCursor) setCursors(previous => [...previous, data.nextCursor!]); }}>Next</button></nav>
    </> : null}
  </section></main>;
}
