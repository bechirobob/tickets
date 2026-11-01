'use client';
import Image from 'next/image';
import { useRef, useState, type FormEvent } from 'react';
import { I18nProvider } from 'react-aria-components';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/boardui/components/base/buttons/button';
import { Input } from '@/components/boardui/components/base/input/input';

// Same consent and single-opt-in meaning as the existing public Yorke Way flow.
const consentText = 'Email me early-access updates about Kofi Bills’ events through the end of 2026. I can unsubscribe at any time.';
export default function SignupPreview() {
  const [name, setName] = useState(''), [email, setEmail] = useState('');
  const [consent, setConsent] = useState(false), [done, setDone] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; consent?: string }>({});
  const nameInput = useRef<HTMLInputElement>(null), emailInput = useRef<HTMLInputElement>(null), consentInput = useRef<HTMLInputElement>(null);
  const success = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current) return;
    const next = { name: !name.trim() || name.trim().length > 100 ? 'Enter a name of up to 100 characters.' : undefined, email: !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254 ? 'Enter a valid email address.' : undefined, consent: !consent ? 'Choose whether to receive early-access updates.' : undefined };
    setErrors(next);
    if (next.name || next.email || next.consent) { (next.name ? nameInput : next.email ? emailInput : consentInput).current?.focus(); return; }
    pending.current = true; setDone(true); requestAnimationFrame(() => success.current?.focus());
  }
  function reset() { pending.current = false; setName(''); setEmail(''); setConsent(false); setErrors({}); setDone(false); requestAnimationFrame(() => nameInput.current?.focus()); }
  return <I18nProvider locale="en-GB"><main className="boardui-trial yorke-trial">
    <header className="trial-header"><div className="yorke-trial-brand"><Image src="/hosts/the-yorke-way.svg" alt="" width={48} height={48} unoptimized /><div><b>The Yorke Way</b><small>Sponsored by BeCore Tickets</small></div></div><span>Signup preview · nothing is sent</span></header>
    <section className="trial-workspace yorke-signup-workspace" aria-label="Recipient signup preview">
      <nav className="yorke-trial-nav" aria-label="Trial work areas"><a href="/boardui-trial/yorke-way"><ArrowLeft size={16} aria-hidden />Back to audience trial</a></nav>
      <div className="yorke-signup-grid"><div className="yorke-recipient-intro"><Image src="/hosts/the-yorke-way.svg" alt="The Yorke Way metallic logo" width={150} height={150} unoptimized /><p className="trial-eyebrow">Early access · Year-end 2026</p><h1>Your year-end plans called.<br />They said Kofi Bills.</h1><p>Get early access to Kofi Bills’ year-end events. Give the group chat something to work with.</p></div>
      {done ? <div className="yorke-preview-result" tabIndex={-1} ref={success} role="status"><h2>Preview complete.</h2><p>No signup was saved and no email was sent.</p><p>The existing signup confirms new subscriptions immediately and queues one welcome email. No extra confirmation is needed.</p><p className="yorke-scope">Previously unsubscribed addresses stay withdrawn. Early access is not a ticket or guarantee of entry.</p><Button variant="secondary" onClick={reset}>Try another preview</Button></div> : <form className="yorke-signup-form" noValidate onSubmit={submit}>
        <Input ref={nameInput} label="Your name" value={name} onChange={setName} autoComplete="off" isRequired validationBehavior="aria" isInvalid={Boolean(errors.name)} hint={errors.name} fieldClassName="trial-input" />
        <Input ref={emailInput} label="Email address" type="email" value={email} onChange={setEmail} autoComplete="off" isRequired validationBehavior="aria" isInvalid={Boolean(errors.email)} hint={errors.email} fieldClassName="trial-input" />
        <div><label className="yorke-consent-label"><input ref={consentInput} type="checkbox" aria-required="true" checked={consent} onChange={event => setConsent(event.target.checked)} aria-invalid={Boolean(errors.consent)} aria-describedby={errors.consent ? 'yorke-consent-error' : undefined} /><span>{consentText}</span></label>{errors.consent && <p id="yorke-consent-error" className="yorke-form-error">{errors.consent}</p>}</div>
        <Button type="submit" className="trial-primary">Preview signup</Button><p className="yorke-scope">Use fictional details. Nothing is submitted. Early-access updates only; not a ticket or guarantee of entry.</p>
      </form>}</div>
    </section>
  </main></I18nProvider>;
}
