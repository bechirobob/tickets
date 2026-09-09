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
    {!open ? <ActionButton onClick={() => setOpen(true)}>{mode === 'interest' ? 'Keep me posted' : approvalRequired ? 'Request an RSVP' : 'RSVP — free entry'}</ActionButton> : <form onSubmit={submit}>
      <p className="registration-free-note">{mode==='rsvp'?'Free entry · no payment details needed':'Email updates · no admission included'}</p><h2>{mode === 'interest' ? 'Be first to hear' : 'Save your place'}</h2>
      <p>{mode === 'interest' ? 'We’ll email when the date or booking details change. This does not reserve admission.' : approvalRequired ? 'The host reviews requests. Your place is reserved only after confirmation.' : 'Confirm your email, then we’ll reserve your place or add you to the waitlist.'}</p>
      {deadline?<p>Register by {new Date(deadline).toLocaleString('en-GH',{timeZone:'Africa/Accra',dateStyle:'medium',timeStyle:'short'})} (Accra time).</p>:null}
      {!sent ? <fieldset disabled={busy}><label>Your name<input name="guestName" autoComplete="name" required minLength={2} maxLength={120} /></label><label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>{mode === 'rsvp' ? <><label>Phone (optional)<input name="phone" type="tel" autoComplete="tel" maxLength={40} /></label>{maxPartySize > 1 ? <label>Guests, including you<select name="partySize">{Array.from({ length: maxPartySize }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label> : null}</> : null}<label className="registration-consent"><input name="announcementsOptIn" type="checkbox" defaultChecked={mode === 'interest'} /><span>Email me announcements from this event’s organiser. I can unsubscribe at any time.</span></label><label className="registration-consent"><input name="acceptedTerms" type="checkbox" required /><span>I accept the <Link href="/terms#purchase" target="_blank">event terms</Link> and <Link href="/privacy" target="_blank">privacy notice</Link>.</span></label><ActionButton type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send my confirmation link'}</ActionButton></fieldset> : null}
      {message ? <p role="status">{message}</p> : null}{sent?<p>Check your inbox and spam folder. The link lasts 20 minutes. <button type="button" onClick={()=>{setSent(false);setMessage('');}}>Use another email or request a new link</button></p>:null}<p><Link href="/my-nights">Already registered? View your RSVP</Link></p>
    </form>}
  </section>;
}
