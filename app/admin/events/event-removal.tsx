'use client';
import { useState } from 'react';
import Link from 'next/link';
import { operationsFetch } from '../../../lib/operations-client';
type Impact = { paidBookings: number; registrations: number; needsApproval: boolean };
export default function EventRemoval({ eventSlug, title, onRemoved }: { eventSlug: string; title: string; onRemoved: () => void }) {
  const [open, setOpen] = useState(false), [impact, setImpact] = useState<Impact | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [reason, setReason] = useState(''), [requested, setRequested] = useState(false);
  async function preview() {
    setOpen(true); setBusy(true); setError('');
    const response = await operationsFetch(`/api/admin/events/removal?slug=${encodeURIComponent(eventSlug)}`);
    const data = await response.json() as Impact & { error?: string }; if (response.ok) setImpact(data); else setError(data.error ?? "Could not load removal details."); setBusy(false);
  }
  async function remove() {
    if (busy) return; setBusy(true); setError('');
    const response = await operationsFetch('/api/admin/events/removal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: eventSlug, reason }) });
    const data = await response.json() as { error?: string; requested?: boolean };
    if (!response.ok) setError(data.error ?? "Removal did not complete. Please retry."); else if (data.requested) setRequested(true); else onRemoved();
    setBusy(false);
  }
  return <div className="ops-removal"><button className="ops-danger" onClick={() => void preview()} disabled={busy}>Remove event</button>{open ? <section aria-label="Confirm event removal"><h3>Remove {title}?</h3>{requested ? <p role="status">Removal requested. Another authorised person can review it in <Link href="/admin/operations">Event operations</Link>.</p> : <><p>The event, active registrations, Room content and workspace entries will be removed. Analytics, financial records and audit history stay available.</p>{impact ? <p>{impact.registrations} active registrations · {impact.paidBookings} paid bookings{impact.needsApproval ? '. A second person must approve cancellation and removal. Refunds are handled separately.' : '.'}</p> : <p>{busy ? 'Checking bookings…' : 'Could not load removal details.'}</p>}<label>Reason<input value={reason} onChange={e => setReason(e.target.value)} minLength={8} maxLength={500} /></label><button className="ops-danger" disabled={busy || !impact || reason.trim().length < 8} onClick={() => void remove()}>{busy ? 'Working…' : impact?.needsApproval ? 'Request removal approval' : 'Confirm removal'}</button></>}{error ? <p role="alert">{error}</p> : null}<button disabled={busy} onClick={() => setOpen(false)}>Close</button></section> : null}</div>;
}
