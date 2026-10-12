"use client";

import { useEffect, useState } from 'react';
import ArchivedEventDeletion from './archived-event-deletion';
import { operationsFetch } from '../../../lib/operations-client';

type ArchivedEvent = { slug: string; title: string; archivedAt: string };
export default function EventArchive({ event, onChanged }: { event?: { slug: string; title: string }; onChanged: () => void }) {
  const [events, setEvents] = useState<ArchivedEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<{ slug: string; title: string } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<ArchivedEvent | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || event) return;
    let active = true;
    operationsFetch('/api/admin/events/archive', { cache: 'no-store' })
      .then(async response => {
        const data = await response.json() as { events?: ArchivedEvent[]; error?: string };
        if (!active) return;
        if (!response.ok) setError(data.error ?? 'Could not load archived events.');
        else setEvents(data.events ?? []);
      }).catch(() => { if (active) setError('Could not load archived events.'); });
    return () => { active = false; };
  }, [open, event]);
  async function change() {
    if (!target || busy || confirmation !== target.slug) return;
    setBusy(true); setError('');
    try {
      const response = await operationsFetch('/api/admin/events/archive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: target.slug, action: event ? 'archive' : 'restore', confirmation }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setError(data.error ?? 'Could not update this event.'); return; }
      setEvents(current => current.filter(item => item.slug !== target.slug));
      setTarget(null); setConfirmation(''); setOpen(false); onChanged();
    } catch { setError('Could not update this event. Try again.'); }
    finally { setBusy(false); }
  }
  if (deleting) return <ArchivedEventDeletion key={deleting.slug} slug={deleting.slug} title={deleting.title} onCancel={() => setDeleting(null)} onDeleted={() => { setEvents(current => current.filter(item => item.slug !== deleting.slug)); setDeleting(null); setOpen(false); onChanged(); }} />;
  return <div className="ops-removal">
    <button disabled={busy} onClick={() => { setOpen(true); setTarget(event ?? null); setConfirmation(''); setError(''); }}>{event ? 'Archive event' : 'Archived events'}</button>
    {open ? <section aria-label="Event archive">
      <h3>{target ? `${event ? 'Archive' : 'Restore'} ${target.title}?` : 'Archived events'}</h3>
      <p>Archiving hides an event from the public catalogue and ordinary workspaces. Records and customer ticket history are preserved. Only the owner can restore it.</p>
      {!event && !target ? <>{events.map(item => <div key={item.slug}><span>{item.title}</span><button onClick={() => { setTarget(item); setConfirmation(''); }}>Restore</button><button className="ops-danger" onClick={() => setDeleting(item)}>Delete permanently…</button></div>)}{!events.length ? <p>No archived events.</p> : null}</> : null}
      {target ? <>
        <p>{event ? 'Only ended events or tests without live bookings can be archived. Pending payment, refund and dispute work must be resolved first.' : 'Restoring returns the event to workspaces and makes it public if its publication settings allow.'}</p>
        <label>Type {target.slug} to confirm<input value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} autoComplete="off" /></label>
        <button disabled={busy || confirmation !== target.slug} onClick={() => void change()}>{busy ? 'Working…' : event ? 'Confirm archive' : 'Confirm restore'}</button>
      </> : null}
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={busy} onClick={() => { setOpen(false); setTarget(null); }}>Cancel</button>
    </section> : null}
  </div>;
}
