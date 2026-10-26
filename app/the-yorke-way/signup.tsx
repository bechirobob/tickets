'use client';

import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react';

const subscribeToReadiness = () => () => {};
const clientIsReady = () => true;
const serverIsReady = () => false;

const consentText = 'Email me early-access updates about Kofi Bills’ events through the end of 2026. I can unsubscribe at any time.';

export default function YorkeSignup() {
  const ready = useSyncExternalStore(subscribeToReadiness, clientIsReady, serverIsReady);
  const [state, setState] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const pending = useRef(false);
  const success = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending.current) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get('name') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const consent = data.get('consent') === 'on';
    if (!name || !email || !consent) {
      setError('Enter your name and email, then choose whether to receive these updates.');
      setState('error');
      return;
    }
    pending.current = true;
    setState('sending');
    setError('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/yorkeway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name, email, consent: true }),
        signal: controller.signal,
      });
      if (!response.ok) {
        setError(response.status === 429 ? 'A few too many tries. Please wait a little, then try again.' : response.status === 410 ? 'Signups for the year-end 2026 list have closed.' : 'We couldn’t send your request. Please try again.');
        setState('error');
        return;
      }
      setState('success');
      window.requestAnimationFrame(() => success.current?.focus());
    } catch {
      setError('We couldn’t reach the signup service. Check your connection and try again.');
      setState('error');
    } finally {
      window.clearTimeout(timeout);
      pending.current = false;
    }
  }

  if (state === 'success') return <div className="yorke-success" role="status" tabIndex={-1} ref={success}>
    <svg className="yorke-status-icon" aria-hidden="true" viewBox="0 0 32 32" fill="none"><path d="M4 8h24v17H4zM4 8l12 10L28 8" /></svg>
    <p className="yorke-eyebrow">One more step</p>
    <h2>Check your inbox.</h2>
    <p>If this signup needs confirmation, you’ll receive an email with the next step. Follow the link to finish joining the list.</p>
    <p className="yorke-success-hint">Nothing there? Check your spam folder, or try again a little later.</p>
    <button className="yorke-text-button" type="button" onClick={() => { setState('idle'); window.requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>('input')?.focus()); }}>Use another email <span aria-hidden="true">↗</span></button>
  </div>;

  return <form ref={form} className="yorke-form" method="post" onSubmit={submit} aria-busy={!ready || state === 'sending'}>
    <div className="yorke-fields">
      <div className="yorke-field"><label htmlFor="yorke-name">Your name</label><input id="yorke-name" name="name" autoComplete="name" maxLength={100} placeholder="Full name" required disabled={!ready || state === 'sending'} /></div>
      <div className="yorke-field"><label htmlFor="yorke-email">Email address</label><input id="yorke-email" name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} placeholder="you@example.com" required disabled={!ready || state === 'sending'} /></div>
    </div>
    <label className="yorke-consent" htmlFor="yorke-consent"><input id="yorke-consent" name="consent" type="checkbox" required disabled={!ready || state === 'sending'} /><span>{consentText}</span></label>
    {state === 'error' && <p className="yorke-error" role="alert">{error}</p>}
    <button className="yorke-submit" type="submit" disabled={!ready || state === 'sending'}><span>{!ready ? 'Preparing signup…' : state === 'sending' ? 'Sending your request…' : 'Sign up for early access'}</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></button>
    <p className="yorke-form-note">We’ll ask you to confirm your email before joining the list.</p>
  </form>;
}
