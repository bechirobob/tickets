'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ActionButton } from '../../action';
export default function RegistrationAccess() {
  const token = useRef('');
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [done, setDone] = useState(false), [registration,setRegistration]=useState<{status:string;eventSlug:string;partySize:number}|null>(null);
  useEffect(() => {
    token.current = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? token.current;
    window.history.replaceState(null, '', window.location.pathname);
    setReady(token.current.length >= 40);
  }, []);
  async function confirm() {
    if (busy || done) return; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/registrations/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: token.current }) });
      const data = await response.json() as { error?: string; registration?: {status:string;eventSlug:string;partySize:number} };
      if (!response.ok) throw new Error(data.error ?? 'This link could not be confirmed.');
      setDone(true); token.current = ''; setRegistration(data.registration??null); setMessage('Email confirmed.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect. Try again.'); }
    finally { setBusy(false); }
  }
  return <main className="registration-access"><Link href="/events">Back to The Drop</Link><h1>Let’s make it official.</h1><p>Open your guest-list update. Let’s see where you stand.</p>{done ? <section><h2>{registration?.status==='confirmed'?'Your RSVP is confirmed':registration?.status==='requested'?'Your request is with the host':registration?.status==='waitlisted'?'You’re on the waitlist':registration?.status==='interested'?'You’re on the email list':'Your registration'}</h2><p>{registration?.status==='confirmed'?`You have ${registration.partySize} ${registration.partySize===1?'place':'places'} reserved. Show your QR pass at entry.`:registration?.status==='requested'?'Still waiting for the host’s nod. Your spot isn’t confirmed yet.':registration?.status==='waitlisted'?'Full house for now. You’re waiting for a spot to open.':'Your RSVP lives in My Nights.'}</p><Link href="/my-nights">View my registration</Link>{registration?.status==='confirmed'?<div className="registration-actions"><Link href={`/my-nights/${registration.eventSlug}?view=passes`}>Show my QR passes</Link><a href={`/api/calendar/${registration.eventSlug}`}>Add to calendar</a></div>:null}</section> : ready ? <ActionButton onClick={confirm} disabled={busy}>{busy ? 'Confirming…' : 'Confirm my email'}</ActionButton> : <p>That link’s missing a piece. Open the full one from your email.</p>}{message ? <p role="status">{message}</p> : null}</main>;
}
