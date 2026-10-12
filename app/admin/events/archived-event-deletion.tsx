"use client";

import { useEffect, useState } from 'react';
import { operationsFetch } from '../../../lib/operations-client';
type Impact = { confirmationVersion: string; eligible: number; registrations: number; issuedTickets: number; guestEntries: number; flashes: number; paidBookings: number };
export default function ArchivedEventDeletion({ slug, title, onDeleted, onCancel }: { slug: string; title: string; onDeleted: () => void; onCancel: () => void }) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    operationsFetch(`/api/admin/events/archive/deletion?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json() as Impact & { error?: string };
        if (!active) return;
        if (response.ok) setImpact(data); else setError(data.error ?? 'Could not load deletion impact.');
      }).catch(() => { if (active) setError('Could not load deletion impact.'); });
    return () => { active = false; };
  }, [slug]);
  async function remove() {
    if (busy || !impact?.eligible || confirmation !== `DELETE ${slug}` || reason.trim().length < 8) return;
    setBusy(true); setError('');
    try {
      const response = await operationsFetch('/api/admin/events/archive/deletion', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, confirmation, reason, confirmationVersion: impact.confirmationVersion }) });
      const data = await response.json() as { error?: string };
      if (response.ok) onDeleted(); else { setError(data.error ?? 'Deletion did not finish.'); setImpact(null); }
    } catch { setError('Deletion status is uncertain. Close this panel and check archived events before trying again.'); setImpact(null); }
    finally { setBusy(false); }
  }
  return <section aria-label="Confirm permanent archived event deletion">
    <h3>Permanently delete {title} content?</h3>
    <p>This cannot be undone or restored from the archive. Guest entries, Room messages and Flashes, event updates, memories, audience contacts, announcement campaigns and workspace assignments are removed. Submission artwork data and file references are cleared; externally hosted event images are not erased. Issued tickets are voided; registrations and waitlist entries are cancelled.</p>
    <p>This is not a full database purge. The event tombstone, submission text, ticket and registration records, analytics, orders, payments, refunds and audit history remain for recordkeeping. Refunds are not issued by this action.</p>
    {impact ? <p>{impact.registrations} active registrations · {impact.issuedTickets} issued tickets · {impact.guestEntries} guest entries · {impact.flashes} Flashes · {impact.paidBookings} paid bookings on record.</p> : <p>{error ? 'Close and reopen to review current impact.' : 'Checking current deletion impact…'}</p>}
    {impact && !impact.eligible ? <p role="alert">Deletion is blocked while the event has live bookings or pending payment, refund or dispute work.</p> : null}
    <label>Type DELETE {slug}<input disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off" /></label>
    <label>Reason<input disabled={busy} value={reason} minLength={8} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
    {error ? <p role="alert">{error}</p> : null}
    <button className="ops-danger" disabled={busy || !impact?.eligible || confirmation !== `DELETE ${slug}` || reason.trim().length < 8} onClick={() => void remove()}>{busy ? 'Deleting…' : 'Permanently delete event content'}</button>
    <button disabled={busy} onClick={onCancel}>Keep archived event</button>
  </section>;
}
