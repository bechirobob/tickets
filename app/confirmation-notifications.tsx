'use client';
import './confirmation-notifications.css';

import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { requestJson, requestErrorMessage } from '../lib/client-request';

type Configuration = { available: boolean; publicKey: string | null; deviceSubscribed: boolean; confirmationUpdates: boolean; hostUpdates: boolean };
const endpoint = '/api/customer/notifications/subscription';
async function workerReady(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Phone alerts are not ready. Refresh and try again.')), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}

export default function ConfirmationNotifications({ compact = false, onEnabled }: { compact?: boolean; onEnabled?: () => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'on' | 'install' | 'unsupported' | 'denied' | 'unavailable'>('loading');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const active = useRef(false);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const ios = /iPad|iPhone|iPod/u.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const installed = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (ios && !installed) return setState('install');
      if (!('Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window)) return setState('unsupported');
      if (Notification.permission === 'denied') return setState('denied');
      try {
        const registration = await workerReady();
        const subscription = await registration.pushManager.getSubscription();
        const config = await requestJson<Configuration>(`${endpoint}${subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : ''}`);
        if (!cancelled) setState(!config.available ? 'unavailable' : subscription && Notification.permission === 'granted' && config.deviceSubscribed && config.confirmationUpdates && config.hostUpdates ? 'on' : 'ready');
      } catch { if (!cancelled) setState('unavailable'); }
    }
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('becore-notifications-changed', refresh);
    return () => { cancelled = true; window.removeEventListener('becore-notifications-changed', refresh); };
  }, []);

  async function change(enable: boolean) {
    if (active.current) return;
    active.current = true; setBusy(true); setMessage('');
    try {
      // This must run directly from a tap, before network/worker awaits.
      if (enable && Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setState(permission === 'denied' ? 'denied' : 'ready');
          setMessage('Email confirmations are still on. You can choose phone alerts later.'); return;
        }
      }
      const config = await requestJson<Configuration>(endpoint);
      if (!config.available || !config.publicKey) throw new Error('Phone alerts are unavailable right now. Email confirmations are still on.');
      const registration = await workerReady();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription && enable) {
        const key = config.publicKey.replaceAll('-', '+').replaceAll('_', '/');
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(key.padEnd(Math.ceil(key.length / 4) * 4, '=')), character => character.charCodeAt(0)) });
      }
      if (subscription) await requestJson(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...subscription.toJSON(), confirmationUpdates: enable, hostUpdates: enable }) });
      setState(enable ? 'on' : 'ready');
      if (enable) onEnabled?.();
      window.dispatchEvent(new Event('becore-notifications-changed'));
      setMessage(enable ? 'Booking confirmations and host announcements are on for this device.' : 'Booking and host alerts are off on this device. Your updates stay in My Nights.');
    } catch (error) { setMessage(requestErrorMessage(error)); }
    finally { active.current = false; setBusy(false); }
  }
  if (state === 'loading' || (compact && state === 'on')) return null;
  const content = <>

    <Bell size={18} aria-hidden="true" />
    <div><strong>{state === 'on' ? 'Your event alerts are on' : 'Don’t miss the host'}</strong>
      <p>{state === 'on' ? 'Booking confirmations and host announcements arrive on this device. Chat alerts have their own settings in The Room.' : 'The Room is your event’s private guest chat. Get booking confirmations and host announcements on your phone, even before you open it. Your passes stay in My Nights.'}</p>
      {state === 'install' ? <details><summary>Want alerts on this iPhone or iPad?</summary><p>In Safari, tap Share → Add to Home Screen. Open the saved app, open My Nights and turn on event alerts. If asked, recover your booking with your email. This is optional.</p></details> : null}
      {state === 'unsupported' ? <p>This browser doesn’t support phone alerts. Booking confirmations still arrive by email; host announcements stay in your inbox.</p> : null}
      {state === 'denied' ? <p>Alerts are blocked in your browser or phone settings. Allow notifications there, then refresh. Booking confirmations still arrive by email; host announcements stay in your inbox.</p> : null}
      {state === 'unavailable' ? <p>Phone alerts couldn’t be checked. Refresh to try again. Your current delivery preference still applies.</p> : null}
      {state === 'ready' || state === 'on' ? <><button type="button" disabled={busy} aria-busy={busy} onClick={() => void change(state !== 'on')}>{busy ? 'Saving…' : state === 'on' ? 'Turn off on this device' : 'Enable event alerts'}</button><p className="confirmation-notifications__hint">Booking confirmations use email if phone alerts can’t be sent. Your phone’s notification and Focus settings control banners and sound.</p></> : null}
      {message ? <p role="status">{message}</p> : null}
    </div>
  </>;
  return compact ? <details className="event-alert-nudge"><summary><Bell size={16} aria-hidden="true" /><span>Don’t miss the host</span><b>Enable alerts</b></summary><aside className="confirmation-notifications" aria-label="Event notifications">{content}</aside></details>
    : <aside className="confirmation-notifications" aria-label="Event notifications">{content}</aside>;
}
