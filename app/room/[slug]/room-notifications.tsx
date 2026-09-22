"use client";

import { Bell, BellOff, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import NotificationPanel from "../../notifications/notification-panel";
import { requestJson } from "../../../lib/client-request";

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Device notifications are not ready. Refresh and try again.")), 10_000); })]);
  } finally { clearTimeout(timer); }
}

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export default function RoomNotifications({ slug, onNotice }: { slug: string; onNotice: (message: string) => void }) {
  const supported = typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() => supported ? Notification.permission : "unsupported");
  const [pushAvailable, setPushAvailable] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [hostEnabled, setHostEnabled] = useState(true);
  const [mutedUntil, setMutedUntil] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [settingsReady, setSettingsReady] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    const preference = requestJson<{ roomMessages?: boolean; hostUpdates?: boolean; mutedUntil?: string | null }>(`/api/customer/notifications/preferences/${encodeURIComponent(slug)}`);
    const device = supported ? readyRegistration().then(async registration => {
      const subscription = await registration.pushManager.getSubscription();
      const configuration = await requestJson<{ available?: boolean; roomUpdates?: boolean; deviceSubscribed?: boolean }>(`/api/customer/notifications/subscription${subscription ? `?endpoint=${encodeURIComponent(subscription.endpoint)}` : ''}`);
      return [configuration, subscription] as const;
    }) : Promise.resolve([{ available: false, roomUpdates: false, deviceSubscribed: false }, null] as const);
    void preference.then((settings) => {
      if (cancelled) return;
      setEnabled(settings.roomMessages !== false);
      setHostEnabled(settings.hostUpdates !== false);
      setMutedUntil(settings.mutedUntil && Date.parse(settings.mutedUntil) > Date.now() ? settings.mutedUntil : null);
      setSettingsReady(true);
    }).catch(() => { if (!cancelled) { setFeedback("Notification preferences could not be loaded. Refresh to try again."); onNotice("Notification settings could not be checked."); } });
    void device.then(([configuration, subscription]) => {
      if (cancelled) return;
      setPushAvailable(Boolean(configuration.available));
      setSubscribed(Boolean(subscription && configuration.deviceSubscribed && configuration.roomUpdates));
    }).catch(() => { if (!cancelled) setPushAvailable(false); });
    return () => { cancelled = true; };
  }, [onNotice, slug, supported]);

  useEffect(() => {
    if (!mutedUntil) return;
    const timer = setTimeout(() => setMutedUntil(null), Math.max(0, Math.min(2147483647, Date.parse(mutedUntil) - Date.now())));
    return () => clearTimeout(timer);
  }, [mutedUntil]);

  async function savePreference(next: boolean, host: boolean) {
    await requestJson(`/api/customer/notifications/preferences/${encodeURIComponent(slug)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(host ? { hostUpdates: next } : { roomMessages: next }),
    });
    if (host) setHostEnabled(next); else setEnabled(next);
  }

  async function resume() {
    setBusy(true); setFeedback('');
    try {
      await requestJson(`/api/customer/notifications/preferences/${encodeURIComponent(slug)}`, {method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({mute:'off'})});
      setMutedUntil(null); setFeedback('This Night’s alerts have resumed.');
    } catch(error) { setFeedback(error instanceof Error ? error.message : 'Could not resume alerts. Try again.'); }
    finally { setBusy(false); }
  }

  async function enableDevice() {
    if (!supported || !pushAvailable || permission === "denied") return false;
    const choice = permission === "granted" ? permission : await Notification.requestPermission();
    setPermission(choice);
    if (choice !== "granted") {
      onNotice("Updates still land here. Lock-screen alerts didn’t turn on this time.");
      return false;
    }
    const config = await requestJson<{ publicKey?: string | null }>("/api/customer/notifications/subscription");
    if (!config.publicKey) throw new Error("Lock-screen delivery is temporarily unavailable.");
    const registration = await readyRegistration();
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey) });
    await requestJson("/api/customer/notifications/subscription", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...subscription.toJSON(), roomUpdates: true }),
    });
    setSubscribed(true);
    window.dispatchEvent(new Event("becore-notifications-changed"));
    onNotice("Room messages are enabled on this device. Your phone controls banners and sound.");
    return true;
  }

  async function toggle(device = false, host = false) {
    if (busy || !settingsReady) return;
    setBusy(true);
    setFeedback("");
    try {
      if (device) setFeedback(await enableDevice() ? "Chat alerts enabled on this device." : "Browser permission was not granted. In-app notifications are unchanged.");
      else { const current = host ? hostEnabled : enabled; await savePreference(!current, host); setFeedback(`${host ? "Host announcements" : "Room messages"} ${current ? "muted" : "on"} for this Night.`); }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Notification settings could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return <><button ref={trigger} type="button" className={`room-notification-toggle${enabled || hostEnabled ? " is-on" : ""}`} aria-label="Room notification settings" title="Room notification settings" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(true); }}>
    {busy ? <Loader2 aria-hidden="true" className="spin" size={16} /> : enabled || hostEnabled ? <Bell aria-hidden="true" size={17} /> : <BellOff aria-hidden="true" size={17} />}
    {enabled || hostEnabled ? <i aria-hidden="true" /> : null}
  </button>{open && <NotificationPanel anchor={trigger} label="Room notifications" onClose={() => setOpen(false)}>{(dismiss) => <><header className="notification-panel-header"><div><h2>Keep an ear out.</h2><span>This Night’s notifications.</span></div><button type="button" aria-label="Close notification settings" onClick={dismiss}><X aria-hidden="true" size={18} /></button></header><div className="notification-panel-scroll room-notification-settings">{mutedUntil ? <div className="room-notification-option"><span><b>Alerts paused</b><small>Until {new Date(mutedUntil).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</small></span><button type="button" disabled={busy} onClick={() => void resume()}>Resume</button></div> : null}<div className="room-notification-option"><span><b>Host announcements</b><small>Plans, timings and the details you need.</small></span><button type="button" role="switch" aria-checked={hostEnabled} aria-label="Host announcements" disabled={busy || !settingsReady} onClick={() => void toggle(false, true)}><i aria-hidden="true" /><span>{!settingsReady ? "Loading…" : hostEnabled ? "On" : "Off"}</span></button></div><div className="room-notification-option"><span><b>Room messages</b><small>{enabled ? "You’re in the loop." : "A little peace and quiet."}</small></span><button type="button" role="switch" aria-checked={enabled} aria-label="Room messages" disabled={busy || !settingsReady} onClick={() => void toggle()}><i aria-hidden="true" /><span>{!settingsReady ? "Loading…" : enabled ? "On" : "Off"}</span></button></div><div className="room-notification-option"><span><b>Chat on this device</b><small>{!supported ? "Not supported in this browser" : permission === "denied" ? "Blocked in your browser settings" : subscribed ? "This device is connected" : !pushAvailable ? "Device delivery is currently unavailable" : "Get alerts when guests send messages."}</small></span>{supported && pushAvailable && !subscribed && permission !== "denied" && <button type="button" disabled={busy || !enabled} onClick={() => void toggle(true)}>Enable</button>}</div>{feedback && <p className="notification-settings-feedback" role="status">{feedback}</p>}</div></>}</NotificationPanel>}</>;
}
