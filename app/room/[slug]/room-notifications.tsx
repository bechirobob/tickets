"use client";

import { Bell, BellOff, Check, Loader2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  return bytes;
}

export default function RoomNotifications({ slug }: { slug: string }) {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() => typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator && "PushManager" in window ? Notification.permission : "unsupported");
  const [available, setAvailable] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [mutedUntil, setMutedUntil] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return;
    }
    void Promise.all([
      fetch("/api/customer/notifications/subscription", { cache: "no-store" }).then((response) => response.json() as Promise<{ available?: boolean }>),
      fetch(`/api/customer/notifications/preferences/${encodeURIComponent(slug)}`, { cache: "no-store" }).then((response) => response.json() as Promise<{ mutedUntil?: string | null }>),
      navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()),
    ]).then(([configuration, preference, subscription]) => {
      setAvailable(Boolean(configuration.available));
      setMutedUntil(preference.mutedUntil ?? null);
      setSubscribed(Boolean(subscription));
    });
  }, [slug]);

  async function enable() {
    if (busy || permission === "unsupported") return;
    setBusy(true); setNotice("");
    try {
      const choice = await Notification.requestPermission();
      setPermission(choice);
      if (choice !== "granted") { setNotice("No pressure. The Room will stay inside the Room."); return; }
      const configResponse = await fetch("/api/customer/notifications/subscription", { cache: "no-store" });
      const config = await configResponse.json() as { publicKey?: string | null };
      if (!configResponse.ok || !config.publicKey) throw new Error("Push delivery is still getting dressed.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey) });
      const response = await fetch("/api/customer/notifications/subscription", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(subscription.toJSON()),
      });
      if (!response.ok) throw new Error("Notifications could not be switched on.");
      setSubscribed(true); setNotice("Done. The Room can now find you outside the browser.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Notifications could not be switched on."); }
    finally { setBusy(false); }
  }

  async function mute(value: "off" | "1h" | "tonight") {
    setBusy(true); setNotice("");
    const response = await fetch(`/api/customer/notifications/preferences/${encodeURIComponent(slug)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ mute: value }),
    });
    const result = await response.json() as { mutedUntil?: string | null; error?: string };
    if (response.ok) { setMutedUntil(result.mutedUntil ?? null); setNotice(value === "off" ? "The Room has its voice back." : value === "1h" ? "Quiet for one hour. Peace, briefly." : "Muted for tonight. Your lock screen may rest."); }
    else setNotice(result.error ?? "That mute control refused to cooperate.");
    setBusy(false);
  }

  const currentlyMuted = Boolean(mutedUntil && Date.parse(mutedUntil) > now);
  return <section className="room-notifications" aria-label="Room notifications">
    {available && permission !== "denied" && !subscribed ? <div className="room-notifications__invite"><Bell size={17} /><span><b>Let the Room find you.</b><small>Messages and Host updates can reach your lock screen—even when this tab is closed.</small></span><button type="button" onClick={enable} disabled={busy}>{busy ? <Loader2 className="spin" size={14} /> : "Turn it on"}</button></div> : null}
    {permission === "denied" ? <div className="room-notifications__invite"><BellOff size={17} /><span><b>Your browser muted us first.</b><small>Allow notifications for this site in browser settings whenever you want back in.</small></span></div> : null}
    {subscribed ? <div className="room-notifications__controls"><span>{currentlyMuted ? <VolumeX size={14} /> : <Check size={14} />} {currentlyMuted ? "Room muted" : "Lock-screen updates on"}</span><select aria-label="Mute Room notifications" disabled={busy} value={currentlyMuted ? "muted" : "off"} onChange={(event) => void mute(event.target.value === "1h" ? "1h" : event.target.value === "tonight" ? "tonight" : "off")}><option value="off">Notifications on</option>{currentlyMuted ? <option value="muted">Muted</option> : null}<option value="1h">Mute for 1 hour</option><option value="tonight">Mute for tonight</option></select></div> : null}
    {notice ? <button className="room-notifications__notice" type="button" onClick={() => setNotice("")}>{notice}</button> : null}
  </section>;
}
