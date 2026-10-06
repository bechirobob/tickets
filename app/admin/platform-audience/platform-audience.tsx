"use client";

import { useCallback, useEffect, useState } from "react";
import type { StaffRole } from "../../../lib/staff-roles";
import { operationsFetch } from "../../../lib/operations-client";
import OperationsNav from "../operations-nav";

type Audience = { contacts: { email: string; consentedAt: string; verifiedAt: string; consentVersion: string; source: string }[]; summary: { total: number; subscribed: number; pending: number; unsubscribed: number; suppressed: number }; nextCursor: string | null; deliveryEnabled: false };
export default function PlatformAudience({ actor, role }: { actor: string; role: StaffRole }) {
  const [data, setData] = useState<Audience | null>(null);
  const [cursors, setCursors] = useState<string[]>([""]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const cursor = cursors[cursors.length - 1];
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true); setError("");
    try {
      const response = await operationsFetch(`/api/admin/platform-audience?limit=25&after=${encodeURIComponent(cursor)}`, { signal });
      const result = await response.json() as Audience & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Subscribers could not load.");
      if (!signal?.aborted) setData(result);
    } catch (cause) { if (!signal?.aborted) { setData(null); setError(cause instanceof Error ? cause.message : "Subscribers could not load."); } }
    finally { if (!signal?.aborted) setBusy(false); }
  }, [cursor]);
  useEffect(() => { const controller = new AbortController(); const timer = setTimeout(() => void load(controller.signal), 0); return () => { clearTimeout(timer); controller.abort(); }; }, [load]);
  return <main className="ops-page"><OperationsNav actor={actor} role={role} active="/admin/platform-audience" /><section className="ops-main event-audience">
    <header><div><p>BeCore Tickets</p><h1>BeCore subscribers</h1><p>Guests who chose future nights from BeCore. Only the owner can see this list.</p></div><button type="button" disabled={busy} onClick={() => void load()}>Refresh</button></header>
    <p>Saved locally. Provider sync and campaign sending are not enabled.</p>
    {busy ? <p role="status">Loading subscribers…</p> : null}{error ? <p role="alert">{error}</p> : null}
    {data ? <><p>{data.summary.subscribed} subscribed · {data.summary.pending} awaiting confirmation · {data.summary.unsubscribed} unsubscribed · {data.summary.suppressed} suppressed</p>
      {data.contacts.length ? <div className="audience-table" role="region" aria-label="BeCore subscriber list" tabIndex={0}><table><thead><tr><th>Email</th><th>Source</th><th>Subscribed</th></tr></thead><tbody>{data.contacts.map(contact => <tr key={contact.email}><td>{contact.email}</td><td>{contact.source}</td><td>{new Date(contact.consentedAt).toLocaleDateString("en-GB")}</td></tr>)}</tbody></table></div> : <p>No confirmed subscribers on this page.</p>}
      <nav className="audience-pagination" aria-label="Subscriber pages"><button type="button" disabled={busy || cursors.length === 1} onClick={() => setCursors(previous => previous.slice(0, -1))}>Previous</button><span>Page {cursors.length}</span><button type="button" disabled={busy || !data.nextCursor} onClick={() => { if (data.nextCursor) setCursors(previous => [...previous, data.nextCursor!]); }}>Next</button></nav>
    </> : null}
  </section></main>;
}
