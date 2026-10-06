'use client';
import ConfirmationNotifications from './confirmation-notifications';
import { FormEvent, useRef, useState } from 'react';
import Link from 'next/link';
import { ActionButton } from './action';
import { useCustomerRuntime } from './customer-runtime';
import { rsvpGuestGuidance } from '../lib/registration-guidance';
import { registrationDrafts } from '../lib/registration-draft';
type RegistrationFormProps = { eventSlug: string; mode: 'rsvp' | 'interest'; maxPartySize: number; approvalRequired: boolean; initiallyOpen?: boolean; deadline?: string; schedulePending?: boolean; roomAccess?: boolean };
export default function RegistrationForm(props: RegistrationFormProps) {
  return <RegistrationFormState key={`${props.eventSlug}:${props.mode}`} {...props} />;
}
function RegistrationFormState({ eventSlug, mode, maxPartySize, approvalRequired, initiallyOpen=false, deadline, schedulePending=false, roomAccess }: RegistrationFormProps) {
  const runtime = useCustomerRuntime();
  const guidance = rsvpGuestGuidance({ approvalRequired, schedulePending, roomAccess });
  const [open, setOpen] = useState(initiallyOpen), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [sent, setSent] = useState(false);
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const draft = typeof window === 'undefined' ? undefined : registrationDrafts.read(eventSlug, mode);
  const [platformOptIn, setPlatformOptIn] = useState(false);
  const [canManage, setCanManage] = useState(false);
  function rememberDraft(event: FormEvent<HTMLFormElement>) {
    const form = new FormData(event.currentTarget);
    registrationDrafts.save(eventSlug, mode, { guestName: String(form.get('guestName') ?? ''), email: String(form.get('email') ?? ''), phone: String(form.get('phone') ?? ''), partySize: String(form.get('partySize') ?? '1') });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    const attribution = new URLSearchParams(window.location.search);
    try {
      const response = await fetch('/api/registrations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: attribution.get('source'), ref: attribution.get('ref'), eventSlug, email: form.get('email'), guestName: form.get('guestName'), phone: form.get('phone') ?? '', partySize: Number(form.get('partySize') ?? 1), acceptedTerms: form.get('acceptedTerms') === 'on', announcementsOptIn: mode === 'interest' && form.get('announcementsOptIn') === 'on', platformAnnouncementsOptIn: mode === 'rsvp' && form.get('platformAnnouncementsOptIn') === 'on' }) });
      const data = await response.json() as { error?: string; message: string; canManage?: boolean };
      if (!response.ok) throw new Error(data.error ?? 'Registration could not be saved.');
      setPlatformOptIn(mode === 'rsvp' && form.get('platformAnnouncementsOptIn') === 'on');
      registrationDrafts.clear(eventSlug, mode);
      setMessage(data.message); setCanManage(data.canManage === true); setSent(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not connect. Your details are still here. Try again.'); }
    finally { setBusy(false); inFlight.current = false; }
  }
  return <section className="registration-form">
    {mode === 'rsvp' ? <p className="registration-limited">Limited RSVP spots. Get your name in early.</p> : null}
    {mode === 'rsvp' && !sent ? <div className="registration-expectations">
      {!open ? <p>{guidance.beforeRequest}</p> : null}
      {guidance.schedule ? <p>{guidance.schedule}</p> : null}
      {guidance.room ? <p>{guidance.room}</p> : <p><Link href="/help#room-private">Check how RSVP and Room access work</Link></p>}
    </div> : null}
    {!open ? <ActionButton ref={trigger} disabled={runtime.stale} onClick={() => { if (runtime.openSecurePage) void runtime.openSecurePage(`/rsvp/${eventSlug}${window.location.search}`); else setOpen(true); }}>{mode === 'interest' ? 'Keep me posted' : approvalRequired ? 'Request an RSVP' : 'RSVP'}</ActionButton> : <form onSubmit={submit} onChange={rememberDraft}>
      {!sent ? <>{mode==='interest'?<p>Date drops & updates</p>:null}<h2>{mode === 'interest' ? 'Be first to hear' : 'Your RSVP'}</h2>
      <p>{mode === 'interest' ? 'Get the next date drop in your inbox. You’ll still need to book your spot.' : guidance.form}</p>
      {deadline?<p>Register by {new Date(deadline).toLocaleString('en-GH',{timeZone:'Africa/Accra',dateStyle:'medium',timeStyle:'short'})} (Accra time).</p>:null}</> : null}
      {!sent ? <fieldset disabled={busy}><label>Your name<input name="guestName" defaultValue={draft?.guestName} autoComplete="name" required minLength={2} maxLength={120} /></label><label>Email address<input name="email" defaultValue={draft?.email} type="email" autoComplete="email" required maxLength={254} /></label>{mode === 'rsvp' ? <><label>Phone (optional)<input name="phone" defaultValue={draft?.phone} type="tel" autoComplete="tel" maxLength={40} /></label>{maxPartySize > 1 ? <label>Guests, including you<select name="partySize" defaultValue={Math.min(maxPartySize, Math.max(1, Number(draft?.partySize) || 1))}>{Array.from({ length: maxPartySize }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label> : null}</> : null}<label className="registration-consent"><input name={mode === 'rsvp' ? 'platformAnnouncementsOptIn' : 'announcementsOptIn'} type="checkbox" /><span>{mode === 'rsvp' ? 'Keep me posted on new nights from BeCore Tickets.' : 'Email me updates from this event and host.'}</span></label><label className="registration-consent"><input name="acceptedTerms" type="checkbox" required /><span>I accept the <Link href="/terms#purchase" target="_blank">event terms</Link> and <Link href="/privacy" target="_blank">privacy notice</Link>.</span></label><ActionButton type="submit" disabled={busy}>{busy ? 'Sending…' : mode === 'rsvp' ? 'Send RSVP' : 'Send my confirmation link'}</ActionButton>{!initiallyOpen ? <ActionButton variant="text" icon={null} onClick={() => { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }}>Close form</ActionButton> : null}</fieldset> : null}
      {sent && mode === 'rsvp' ? <div className="registration-success" role="status"><span aria-hidden="true">✓</span><h2>RSVP received.</h2><p>Outfit planning starts now.</p>{approvalRequired ? <p className="registration-success__detail">Check My Nights for the host’s decision. Your request is not a confirmed spot.</p> : <p className="registration-success__detail">Check My Nights to see whether your spot is confirmed or waitlisted.</p>}</div> : <>{message ? <p role="status">{message}</p> : null}{sent ? <p>Check your inbox and spam folder. The link lasts 20 minutes.</p> : null}</>}

    </form>}
    {sent && platformOptIn ? <p>Email updates: confirm the link in your inbox if needed. <Link href="/account/privacy">Manage updates</Link></p> : null}
    {sent && mode === 'rsvp' ? <>{canManage ? <><Link href="/my-nights?view=rsvps">View my RSVP in My Nights</Link><ConfirmationNotifications /></> : <p>Already registered? <Link href="/my-nights">Use your registration email to recover your RSVP.</Link></p>}</> : null}
  </section>;
}
