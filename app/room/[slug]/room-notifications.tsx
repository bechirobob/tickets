"use client";

import { Bell, BellOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

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

  useEffect(() => {
    const preference = fetch(`/api/customer/notifications/preferences/${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ roomMessages?: boolean; hostUpdates?: boolean }>);
    const device = supported ? Promise.all([
      fetch("/api/customer/notifications/subscription", { cache: "no-store" }).then((response) => response.json() as Promise<{ available?: boolean }>),
      navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()),
    ]) : Promise.resolve([{ available: false }, null] as const);
    void Promise.all([preference, device]).then(([settings, [configuration, subscription]]) => {
      setEnabled(settings.roomMessages !== false && settings.hostUpdates !== false);
      setPushAvailable(Boolean(configuration.available));
      setSubscribed(Boolean(subscription));
    }).catch(() => onNotice("Notification settings could not be checked."));
  }, [onNotice, slug, supported]);

  async function savePreference(next: boolean) {
    const response = await fetch(`/api/customer/notifications/preferences/${encodeURIComponent(slug)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: next }),
    });
    if (!response.ok) throw new Error("Notification settings could not be changed.");
    setEnabled(next);
  }

  async function enableDevice() {
    if (!supported || !pushAvailable || permission === "denied") return false;
    const choice = permission === "granted" ? permission : await Notification.requestPermission();
    setPermission(choice);
    if (choice !== "granted") {
      onNotice("In-app Room notifications remain on. Your browser did not enable lock-screen delivery.");
      return false;
    }
    const configResponse = await fetch("/api/customer/notifications/subscription", { cache: "no-store" });
    const config = await configResponse.json() as { publicKey?: string | null };
    if (!configResponse.ok || !config.publicKey) throw new Error("Lock-screen delivery is temporarily unavailable.");
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey) });
    const response = await fetch("/api/customer/notifications/subscription", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(subscription.toJSON()),
    });
    if (!response.ok) throw new Error("Lock-screen notifications could not be enabled.");
    setSubscribed(true);
    onNotice("Room notifications are on, including lock-screen delivery.");
    return true;
  }

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      if (enabled && pushAvailable && !subscribed && permission !== "denied") {
        await enableDevice();
      } else if (enabled) {
        await savePreference(false);
        onNotice("Room notifications are off for this Night.");
      } else {
        if (pushAvailable && !subscribed && permission !== "denied") await enableDevice();
        await savePreference(true);
        onNotice("Room notifications are on for this Night.");
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Notification settings could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  const label = enabled && pushAvailable && !subscribed && permission !== "denied"
    ? "Enable lock-screen notifications; in-app Room notifications are on"
    : enabled ? "Turn Room notifications off" : "Turn Room notifications on";
  return <button type="button" className={`room-notification-toggle${enabled ? " is-on" : ""}${enabled && !subscribed ? " needs-device" : ""}`} aria-label={label} aria-pressed={enabled} title={label} disabled={busy} onClick={() => void toggle()}>
    {busy ? <Loader2 className="spin" size={16} /> : enabled ? <Bell size={17} /> : <BellOff size={17} />}
    {enabled ? <i aria-hidden="true" /> : null}
  </button>;
}
