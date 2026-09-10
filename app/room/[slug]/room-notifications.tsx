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
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [settingsReady, setSettingsReady] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    const preference = requestJson<{ roomMessages?: boolean; hostUpdates?: boolean }>(`/api/customer/notifications/preferences/${encodeURIComponent(slug)}`);
    const device = supported ? Promise.all([
      requestJson<{ available?: boolean }>("/api/customer/notifications/subscription"),
      readyRegistration().then((registration) => registration.pushManager.getSubscription()),
    ]) : Promise.resolve([{ available: false }, null] as const);
    void preference.then((settings) => {
      if (cancelled) return;
      setEnabled(settings.roomMessages !== false && settings.hostUpdates !== false);
      setSettingsReady(true);
    }).catch(() => { if (!cancelled) { setFeedback("Notification preferences could not be loaded. Refresh to try again."); onNotice("Notification settings could not be checked."); } });
    void device.then(([configuration, subscription]) => {
      if (cancelled) return;
      setPushAvailable(Boolean(configuration.available));
      setSubscribed(Boolean(subscription));
    }).catch(() => { if (!cancelled) setPushAvailable(false); });
    return () => { cancelled = true; };
  }, [onNotice, slug, supported]);

  async function savePreference(next: boolean) {
    await requestJson(`/api/customer/notifications/preferences/${encodeURIComponent(slug)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: next }),
    });
    setEnabled(next);
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
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(subscription.toJSON()),
    });
    setSubscribed(true);
    onNotice("Room notifications are on, including lock-screen delivery.");
    return true;
  }

  async function toggle(device = false) {
    if (busy || !settingsReady) return;
    setBusy(true);
    setFeedback("");
    try {
      if (device) setFeedback(await enableDevice() ? "Lock-screen notifications enabled." : "Browser permission was not granted. In-app notifications are unchanged.");
      else { await savePreference(!enabled); setFeedback(enabled ? "Notifications muted for this Night." : "Notifications on for this Night."); }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Notification settings could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return <><button ref={trigger} type="button" className={`room-notification-toggle${enabled ? " is-on" : ""}`} aria-label="Room notification settings" title="Room notification settings" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(true); }}>
    {busy ? <Loader2 aria-hidden="true" className="spin" size={16} /> : enabled ? <Bell aria-hidden="true" size={17} /> : <BellOff aria-hidden="true" size={17} />}
    {enabled ? <i aria-hidden="true" /> : null}
  </button>{open && <NotificationPanel anchor={trigger} label="Room notifications" onClose={() => setOpen(false)}>{(dismiss) => <><header className="notification-panel-header"><div><h2>Keep an ear out.</h2><span>This Night’s notifications.</span></div><button type="button" aria-label="Close notification settings" onClick={dismiss}><X aria-hidden="true" size={18} /></button></header><div className="notification-panel-scroll room-notification-settings"><div className="room-notification-option"><span><b>Host updates & messages</b><small>{enabled ? "You’re in the loop." : "A little peace and quiet."}</small></span><button type="button" role="switch" aria-checked={enabled} aria-label="Host updates and Room messages" disabled={busy || !settingsReady} onClick={() => void toggle()}><i aria-hidden="true" /><span>{!settingsReady ? "Loading…" : enabled ? "On" : "Off"}</span></button></div><div className="room-notification-option"><span><b>On your lock screen</b><small>{!supported ? "Not supported in this browser" : permission === "denied" ? "Blocked in your browser settings" : subscribed ? "This device is connected" : !pushAvailable ? "Device delivery is currently unavailable" : "Take the useful noise with you."}</small></span>{supported && pushAvailable && !subscribed && permission !== "denied" && <button type="button" disabled={busy || !enabled} onClick={() => void toggle(true)}>Enable</button>}</div>{feedback && <p className="notification-settings-feedback" role="status">{feedback}</p>}</div></>}</NotificationPanel>}</>;
}
