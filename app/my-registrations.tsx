'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
type Registration = { id: string; eventSlug: string; title: string; kind: string; status: string; partySize: number; maxPartySize: number; mode: string; roomAccess: number };
const labels: Record<string, string> = { interested: 'Announcements only · no admission reserved', requested: 'Awaiting host approval', waitlisted: 'On the waitlist · no admission reserved', confirmed: 'RSVP confirmed', cancelled: 'Cancelled', declined: 'Not confirmed by the host' };
export default function MyRegistrations() {
  const [rows, setRows] = useState<Registration[]>([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(''), [loading, setLoading] = useState(true);
  const load = useCallback(() => fetch('/api/customer/registrations', { cache: 'no-store' }).then(async response => {
    if (response.status === 401) return;
    const data = await response.json() as { error?: string; registrations: Registration[] };
    if (!response.ok) throw new Error(data.error ?? 'Could not load registrations.');
    setRows(data.registrations);
  }).catch(error => setMessage(error instanceof Error ? error.message : 'Could not connect.')).finally(() => setLoading(false)), []);
  useEffect(() => { void load();const timer=setInterval(()=>{if(!document.hidden)void load();},10000);return()=>clearInterval(timer); }, [load]);
  async function act(row: Registration, action: string) {
    if (busy) return; setBusy(row.id); setMessage('');
    try {
      const response = await fetch('/api/customer/registrations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: row.id, action, partySize: row.partySize }) });
      const data = await response.json() as { error?: string; registrations: Registration[] }; if (!response.ok) throw new Error(data.error ?? 'Could not update registration.');
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect.'); } finally { setBusy(''); }
  }
  if (loading) return <p className="registration-loading" role="status">Checking your registrations…</p>;
  if (!rows.length && !message) return null;
  return <section className="my-registrations"><h2>RSVPs & announcements</h2>{rows.map(row => <article key={row.id}><div><Link href={`/event/${row.eventSlug}`}>{row.title}</Link><p>{labels[row.status] ?? row.status}{row.kind === 'rsvp' ? ` · ${row.partySize} ${row.partySize === 1 ? 'guest' : 'guests'}` : ''}</p></div><div className="registration-actions">{row.status === 'confirmed' ? <Link href={`/my-nights/${row.eventSlug}?view=passes`}>Show my QR passes</Link> : null}{['interested', 'cancelled'].includes(row.status) && row.mode === 'rsvp' ? <button disabled={Boolean(busy)} onClick={() => void act(row, 'join')}>Request my RSVP</button> : null}{['interested', 'requested', 'waitlisted', 'confirmed'].includes(row.status) ? <button disabled={Boolean(busy)} onClick={() => void act(row, 'cancel')}>{busy === row.id ? 'Updating…' : row.kind === 'interest' ? 'Stop announcements' : 'Cancel RSVP'}</button> : null}</div></article>)}{message ? <p role="status">{message} <button onClick={() => void load()}>Retry</button></p> : null}</section>;
}
