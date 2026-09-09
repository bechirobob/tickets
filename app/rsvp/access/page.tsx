'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ActionButton } from '../../action';
export default function RegistrationAccess() {
  const token = useRef('');
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [done, setDone] = useState(false);
  useEffect(() => {
    token.current = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? token.current;
    window.history.replaceState(null, '', window.location.pathname);
    setReady(token.current.length >= 40);
  }, []);
  async function confirm() {
    if (busy || done) return; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/registrations/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: token.current }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? 'This link could not be confirmed.');
      setDone(true); token.current = ''; setMessage('Email confirmed. Your registration is ready to view.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect. Try again.'); }
    finally { setBusy(false); }
  }
  return <main className="registration-access"><Link href="/events">Back to The Drop</Link><h1>Let’s make it official.</h1><p>Confirm your email to see whether your place is confirmed, awaiting approval, or on the waitlist.</p>{done ? <Link href="/my-nights">View my registration</Link> : ready ? <ActionButton onClick={confirm} disabled={busy}>{busy ? 'Confirming…' : 'Confirm my email'}</ActionButton> : <p>Open the complete link from your email. You can request a new one on the event page.</p>}{message ? <p role="status">{message}</p> : null}</main>;
}
