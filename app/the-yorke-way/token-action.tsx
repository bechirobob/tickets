'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const subscribeToReadiness = () => () => {};
const clientIsReady = () => true;
const serverIsReady = () => false;

export default function YorkeTokenAction() {
  const ready = useSyncExternalStore(subscribeToReadiness, clientIsReady, serverIsReady);
  const [state, setState] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const token = useRef<string | null>(null);
  const pending = useRef(false);
  const result = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Keep the unsubscribe token in memory, not the address bar or browser storage.
    if (token.current === null) {
      token.current = window.location.hash.slice(1);
      window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    }
  }, []);

  async function submit() {
    if (!ready || pending.current) return;
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token.current ?? '')) {
      setError('Open the complete unsubscribe link from your email to continue.');
      setState('error');
      return;
    }
    pending.current = true;
    setState('sending');
    setError('');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/yorkeway/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token: token.current }),
        signal: controller.signal,
      });
      if (!response.ok) {
        setError(response.status === 429 ? 'Please wait a little, then try again.' : 'We couldn’t process your request. Please try again.');
        setState('error');
        return;
      }
      token.current = null;
      setState('success');
      window.requestAnimationFrame(() => result.current?.focus());
    } catch {
      setError('We couldn’t reach the service. Check your connection and try again.');
      setState('error');
    } finally {
      window.clearTimeout(timeout);
      pending.current = false;
    }
  }

  if (state === 'success') return <div className="yorke-token-result" role="status" tabIndex={-1} ref={result}>
    <p className="yorke-eyebrow">The Yorke Way · Year-end 2026</p>
    <h1>Request received.</h1>
    <p>Any matching active signup has been removed from The Yorke Way early-access list.</p>
    <a className="yorke-text-button" href="/the-yorke-way">Back to The Yorke Way <span aria-hidden="true">↗</span></a>
  </div>;

  return <div aria-busy={!ready || state === 'sending'}>
    <p className="yorke-eyebrow">The Yorke Way · Year-end 2026</p>
    <h1>Leave the list?</h1>
    <p>Stop early-access emails about Kofi Bills’ year-end 2026 events. No hard feelings.</p>
    {state === 'error' && <p className="yorke-error" role="alert">{error}</p>}
    <button className="yorke-submit" type="button" onClick={submit} disabled={!ready || state === 'sending'}><span>{!ready ? 'Preparing…' : state === 'sending' ? 'Sending your request…' : 'Unsubscribe'}</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></button>
    <p className="yorke-token-note">Nothing changes until you choose Unsubscribe.</p>
    <a className="yorke-text-button" href="/the-yorke-way">Back to The Yorke Way <span aria-hidden="true">↗</span></a>
  </div>;
}
