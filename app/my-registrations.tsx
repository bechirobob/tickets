'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown, Ticket, Users, X } from 'lucide-react';
type Registration = { id: string; eventSlug: string; title: string; kind: string; status: string; partySize: number; maxPartySize: number; mode: string; roomAccess: number };
const labels: Record<string, string> = { interested: 'Here for the updates', requested: 'Waiting for the host’s nod', waitlisted: 'On the waitlist · your spot isn’t confirmed yet', confirmed: 'RSVP confirmed', cancelled: 'Cancelled', declined: 'No spot this time' };
export default function MyRegistrations({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [rows, setRows] = useState<Registration[]>([]), [message, setMessage] = useState(''), [busy, setBusy] = useState(''), [loading, setLoading] = useState(true);
  const request = useRef<AbortController | null>(null);
  const lastLoaded = useRef(0);
  const [failures, setFailures] = useState(0);
  const [locked, setLocked] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  useEffect(() => { onCountChange?.(rows.length); }, [rows.length, onCountChange]);
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
      await load(); setConfirming(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect.'); } finally { setBusy(''); }
  }
  if (loading) return <p className="registration-loading" role="status">Checking your registrations…</p>;
  if (!rows.length && !message) return onCountChange ? <section className="my-nights-empty"><Ticket size={28} aria-hidden="true" /><h2>No RSVPs yet.</h2><p>Guest-list requests and event announcements will appear here.</p><Link href="/events">Explore The Drop <ArrowUpRight size={16} /></Link></section> : null;
  return <section className="my-registrations my-registrations--studio" aria-label="Your registrations">{rows.map(row => <article key={row.id}>
    <div className="registration-identity"><span className="registration-kind"><Users size={15} />{row.kind === 'rsvp' ? `${row.partySize} ${row.partySize === 1 ? 'guest' : 'guests'}` : 'Announcements'}</span><h2><Link href={`/event/${row.eventSlug}`}>{row.title}<ArrowUpRight size={16} /></Link></h2><p data-status={row.status}>{labels[row.status] ?? (row.status === 'unverified' ? 'Check your email to finish' : 'Awaiting an update')}</p></div>
    <div className="registration-actions">{row.status === 'confirmed' ? <Link href={`/my-nights/${row.eventSlug}?view=passes`}>Show my QR passes</Link> : null}{['interested', 'cancelled'].includes(row.status) && row.mode === 'rsvp' ? <button type="button" disabled={Boolean(busy)} onClick={() => void act(row, 'join')}>{busy === row.id ? 'Updating…' : 'Request my RSVP'}</button> : null}
    {['interested', 'requested', 'waitlisted', 'confirmed'].includes(row.status) ? <details className="registration-manage"><summary>Manage <ChevronDown size={14} /></summary>{confirming === row.id ? <div className="registration-confirm"><p>{row.kind === 'interest' ? 'Stop updates for this event?' : 'Cancel this RSVP? Your place may go to someone else.'}</p><div><button type="button" disabled={Boolean(busy)} onClick={() => setConfirming(null)}>Keep it</button><button type="button" disabled={Boolean(busy)} onClick={() => void act(row, 'cancel')}>{busy === row.id ? 'Updating…' : 'Yes, cancel'}</button></div></div> : <button type="button" disabled={Boolean(busy)} onClick={() => setConfirming(row.id)}><X size={14} />{row.kind === 'interest' ? 'Stop announcements' : 'Cancel RSVP'}</button>}</details> : null}</div>
  </article>)}{message ? <p role="status">{message} <button type="button" onClick={() => void load()}>Retry</button></p> : null}</section>;
}
