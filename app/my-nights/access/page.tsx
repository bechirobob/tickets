'use client';

import Link from 'next/link';
import { ArrowLeft, Ticket } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ActionButton } from '../../action';
import BrandLogo from '../../brand-logo';
import { requestJson, requestErrorMessage } from '../../../lib/client-request';

export default function TicketAccess() {
  const token = useRef('');
  const submitting = useRef(false);
  const [kind, setKind] = useState<'recovery' | 'transfer'>('recovery');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const url = new URL(window.location.href);

    token.current = new URLSearchParams(url.hash.slice(1)).get('token') ?? token.current;
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    const timer=setTimeout(()=>{setKind(url.searchParams.get('kind') === 'transfer' ? 'transfer' : 'recovery');setReady(/^[A-Za-z0-9_-]{40,128}$/u.test(token.current));},0);
    return ()=>clearTimeout(timer);
  }, []);
  async function accept() {
    if (submitting.current || !ready) return;
    submitting.current = true; setBusy(true); setMessage('');
    try {
      const data = await requestJson<{ redirectTo: string }>(`/api/customer/${kind === 'transfer' ? 'transfers' : 'recovery'}/claim`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: token.current }),
      });
      const target = new URL(data.redirectTo, window.location.origin);
      if (target.origin !== window.location.origin || !/^\/my-nights(?:\/|$)/u.test(target.pathname)) throw new Error('Your ticket is saved. Open My Nights to find it.');
      window.location.replace(target.href);
    } catch (error) { setMessage(requestErrorMessage(error)); setBusy(false); submitting.current = false; }
  }
  return <main className="ticket-access">
    <header><Link href="/events"><ArrowLeft size={16} /> The Drop</Link><Link href="/" aria-label="BeCore Tickets home"><BrandLogo /></Link></header>
    <section aria-labelledby="ticket-access-title">
      <Ticket size={32} aria-hidden="true" />
      <p className="eyebrow">My Nights</p>
      <h1 id="ticket-access-title">{kind === 'transfer' ? 'Someone saved you a spot.' : 'Your nights, back in reach.'}</h1>
      <p>{ready ? kind === 'transfer' ? 'Accept the ticket and make your entrance.' : 'Open your tickets on this device. Outfit still up to you.' : 'This link’s missing a piece. Open the full one from your email, or ask for another in My Nights.'}</p>
      {ready ? <ActionButton onClick={accept} disabled={busy} aria-busy={busy}>{busy ? 'Opening…' : kind === 'transfer' ? 'Accept ticket' : 'Open my tickets'}</ActionButton> : null}
      {message ? <p className="ticket-access__message" role="alert">{message}</p> : null}
      <Link className="ticket-access__help" href="/my-nights">{ready ? 'Back to My Nights' : 'Get a fresh link'}</Link>
    </section>
  </main>;
}
