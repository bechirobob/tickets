'use client';
import { FormEvent, useRef, useState } from 'react';
import Link from 'next/link';
import { ActionButton } from './action';
export default function RegistrationForm({ eventSlug, mode, maxPartySize, approvalRequired, initiallyOpen=false, deadline }: { eventSlug: string; mode: 'rsvp' | 'interest'; maxPartySize: number; approvalRequired: boolean; initiallyOpen?: boolean; deadline?: string }) {
  const [open, setOpen] = useState(initiallyOpen), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [sent, setSent] = useState(false);
  const inFlight = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/registrations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eventSlug, email: form.get('email'), guestName: form.get('guestName'), phone: form.get('phone') ?? '', partySize: Number(form.get('partySize') ?? 1), acceptedTerms: form.get('acceptedTerms') === 'on', announcementsOptIn: form.get('announcementsOptIn') === 'on' }) });
      const data = await response.json() as { error?: string; message: string };
      if (!response.ok) throw new Error(data.error ?? 'Registration could not be saved.');
      setMessage(data.message); setSent(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect. Your details are still here. Try again.'); }
    finally { setBusy(false); inFlight.current = false; }
  }
  return <section className="registration-form">
    {!open ? <ActionButton onClick={() => setOpen(true)}>{mode === 'interest' ? 'Keep me posted' : approvalRequired ? 'Request an RSVP' : 'RSVP'}</ActionButton> : <form onSubmit={submit}>
      {!sent ? <>{mode==='interest'?<p>Date drops & updates</p>:null}<h2>{mode === 'interest' ? 'Be first to hear' : 'Your RSVP'}</h2>
      <p>{mode === 'interest' ? 'Get the next date drop in your inbox. You’ll still need to book your spot.' : approvalRequired ? 'Drop your details. Your spot needs the host’s nod.' : 'Drop your details. If the guest list fills up, you’re next in line.'}</p>
      {deadline?<p>Register by {new Date(deadline).toLocaleString('en-GH',{timeZone:'Africa/Accra',dateStyle:'medium',timeStyle:'short'})} (Accra time).</p>:null}</> : null}
      {!sent ? <fieldset disabled={busy}><label>Your name<input name="guestName" autoComplete="name" required minLength={2} maxLength={120} /></label><label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>{mode === 'rsvp' ? <><label>Phone (optional)<input name="phone" type="tel" autoComplete="tel" maxLength={40} /></label>{maxPartySize > 1 ? <label>Guests, including you<select name="partySize">{Array.from({ length: maxPartySize }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label> : null}</> : null}<label className="registration-consent"><input name="announcementsOptIn" type="checkbox" defaultChecked={mode === 'interest'} /><span>Email me updates from this host. I can unsubscribe anytime.</span></label><label className="registration-consent"><input name="acceptedTerms" type="checkbox" required /><span>I accept the <Link href="/terms#purchase" target="_blank">event terms</Link> and <Link href="/privacy" target="_blank">privacy notice</Link>.</span></label><ActionButton type="submit" disabled={busy}>{busy ? 'Sending…' : mode === 'rsvp' ? 'Send RSVP' : 'Send my confirmation link'}</ActionButton></fieldset> : null}
      {sent && mode === 'rsvp' ? <div className="registration-success" role="status"><span aria-hidden="true">✓</span><h2>RSVP received.</h2><p>Outfit planning starts now.</p>{approvalRequired ? <p className="registration-success__detail">Now we wait for the host’s nod.</p> : <p className="registration-success__detail">The host has your details. Full house? You’re on the waitlist.</p>}</div> : <>{message ? <p role="status">{message}</p> : null}{sent ? <p>Check your inbox and spam folder. The link lasts 20 minutes.</p> : null}</>}

    </form>}
  </section>;
}
