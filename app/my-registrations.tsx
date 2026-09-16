'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
type Registration = { id: string; eventSlug: string; title: string; kind: string; status: string; partySize: number; maxPartySize: number; mode: string; roomAccess: number };
const labels: Record<string, string> = { interested: 'Here for the updates', requested: 'Waiting for the host’s nod', waitlisted: 'On the waitlist · your spot isn’t confirmed yet', confirmed: 'RSVP confirmed', cancelled: 'Cancelled', declined: 'No spot this time' };
export default function MyRegistrations() {
  const [rows, setRows] = useState<Registration[]>([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(''), [loading, setLoading] = useState(true);
  const request = useRef<AbortController | null>(null);
  const lastLoaded = useRef(0);
  const [failures, setFailures] = useState(0);
  const [locked, setLocked] = useState(false);
  const load = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch('/api/customer/registrations', { cache: 'no-store', signal: controller.signal });
      if (response.status === 401) { setLocked(true); setRows([]); setMessage(''); setFailures(0); return; }
      const data = await response.json() as { error?: string; registrations: Registration[] };
      if (!response.ok || !Array.isArray(data.registrations)) throw new Error(data.error ?? 'Could not load registrations.');
      setRows(data.registrations); setLocked(false); setMessage(''); setFailures(0);
    } catch (error) {
      if (!controller.signal.aborted) { setMessage(error instanceof Error ? error.message : 'Could not connect.'); setFailures(value => value + 1); }
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) { lastLoaded.current = Date.now(); setLoading(false); }
    }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const resume = () => { if (!document.hidden && navigator.onLine && Date.now() - lastLoaded.current >= 30_000) void load(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    return () => {
      window.clearTimeout(initial); request.current?.abort(); request.current = null;
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume); window.removeEventListener('online', resume);
    };
  }, [load]);
  const pending = rows.some(row => ['unverified', 'requested', 'waitlisted'].includes(row.status));
  useEffect(() => {
    if (loading || locked || (!pending && !failures)) return;
    // Pending decisions refresh once a minute; settled bookings need no idle polling.
    // Jitter spreads a crowd's refreshes; failures back off rather than piling up.
    const timer = window.setTimeout(() => {
      if (!document.hidden && navigator.onLine) void load();
    }, Math.min(300_000, 60_000 * 2 ** Math.min(failures, 3)) + Math.random() * 10_000);
    return () => window.clearTimeout(timer);
  }, [rows, loading, locked, pending, failures, load]);
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
