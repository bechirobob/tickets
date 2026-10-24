'use client';

import Link from 'next/link';
import { ticketAccessRedirect } from '../../../lib/ticket-access-redirect';
import { ArrowLeft, Ticket } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ActionButton } from '../../action';
import BrandLogo from '../../brand-logo';
import { requestJson, requestErrorMessage } from '../../../lib/client-request';

export default function TicketAccess() {
  const token = useRef('');
  const submitting = useRef(false);
  const [kind, setKind] = useState<'recovery' | 'transfer' | 'host'>('recovery');
  const [checking, setChecking] = useState(true);
  const [confirmsAnnouncements, setConfirmsAnnouncements] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const url = new URL(window.location.href);

    token.current = new URLSearchParams(url.hash.slice(1)).get('token') ?? token.current;
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    const timer=setTimeout(()=>{
      const transfer = url.searchParams.get('kind') === 'transfer';
      const host = url.searchParams.get('kind') === 'host';
      setKind(host ? 'host' : transfer ? 'transfer' : 'recovery');
      const valid = /^[A-Za-z0-9_-]{40,128}$/u.test(token.current);
      if (!valid || transfer || host) { setReady(valid); setChecking(false); return; }
      void requestJson<{ confirmsAnnouncements?: boolean }>('/api/platform-announcements/verification', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: token.current, grantType: 'recovery' }) }, 5000).then(data => setConfirmsAnnouncements(data.confirmsAnnouncements === true)).catch(() => {}).finally(() => { setReady(true); setChecking(false); });
    },0);
    return ()=>clearTimeout(timer);
  }, []);
  async function accept() {
    if (submitting.current || !ready) return;
    submitting.current = true; setBusy(true); setMessage('');
    try {
      const data = await requestJson<{ redirectTo: string; eventSlug?: string }>(`/api/customer/${kind === 'host' ? 'host-pass' : kind === 'transfer' ? 'transfers' : 'recovery'}/claim`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: token.current, confirmPlatformAnnouncements: confirmsAnnouncements }),
      });
      window.location.replace(ticketAccessRedirect(kind,data.redirectTo,data.eventSlug,window.location.origin));
    } catch (error) { setMessage(requestErrorMessage(error)); setBusy(false); submitting.current = false; }
  }
  return <main className="ticket-access">
    <header><Link href="/events"><ArrowLeft size={16} /> The Drop</Link><Link href="/" aria-label="BeCore Tickets home"><BrandLogo /></Link></header>
    <section aria-labelledby="ticket-access-title">
      <Ticket size={32} aria-hidden="true" />
      <p className="eyebrow">My Nights</p>
      <h1 id="ticket-access-title">{kind === 'host' ? 'Your Room is waiting.' : kind === 'transfer' ? 'Someone saved you a spot.' : 'Your nights, back in reach.'}</h1>
      <p>{ready ? kind === 'host' ? 'Accept your Host pass, enter The Room and drop your first message.' : kind === 'transfer' ? 'Accept the ticket and make your entrance.' : 'Open your tickets on this device. Outfit still up to you.' : checking ? 'Checking your link…' : 'This link’s missing a piece. Open the full one from your email, or ask for another in My Nights.'}</p>
      {confirmsAnnouncements ? <p>This also confirms the BeCore Tickets email updates you chose. Unsubscribe any time.</p> : null}
      {ready ? <ActionButton onClick={accept} disabled={busy} aria-busy={busy}>{busy ? 'Opening…' : kind === 'host' ? 'Accept pass & enter the Room' : kind === 'transfer' ? 'Accept ticket' : confirmsAnnouncements ? 'Confirm email and open My Nights' : 'Open my tickets'}</ActionButton> : null}
      {message ? <p className="ticket-access__message" role="alert">{message}</p> : null}
      <Link className="ticket-access__help" href="/my-nights">{ready ? 'Back to My Nights' : 'Get a fresh link'}</Link>
    </section>
  </main>;
}
