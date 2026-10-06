"use client";

import { useEffect, useRef, useState } from "react";
import { requestJson, requestErrorMessage } from "../../../lib/client-request";

type Preferences = { platformAnnouncementsOptIn: boolean; status: "not_subscribed" | "pending" | "subscribed" | "unsubscribed" | "verification_required"; revision: number; emailVerified: boolean };

function validPreferences(value: unknown): value is Preferences {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<Preferences>;
  return typeof data.platformAnnouncementsOptIn === "boolean" && typeof data.emailVerified === "boolean"
    && Number.isSafeInteger(data.revision) && Number(data.revision) >= 0
    && ["not_subscribed", "pending", "subscribed", "unsubscribed", "verification_required"].includes(String(data.status));
}

export default function PlatformAnnouncements() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [optedIn, setOptedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [verificationSent, setVerificationSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  async function load() {
    try {
      const data = await requestJson<Preferences>("/api/customer/platform-announcements");
      if (!validPreferences(data)) throw new Error("Your email choice did not load. Please try again.");
      setPreferences(data); setOptedIn(data.platformAnnouncementsOptIn); setMessage("");
    } catch (error) { setMessage(requestErrorMessage(error)); }
  }
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, []);
  async function save() {
    if (!preferences || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const data = await requestJson<Preferences & { saved?: boolean }>("/api/customer/platform-announcements", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ platformAnnouncementsOptIn: optedIn, revision: preferences.revision }) });
      if (!validPreferences(data) || data.saved !== true) throw new Error("Your saved email choice could not be confirmed.");
      setPreferences(data); setOptedIn(data.platformAnnouncementsOptIn); setMessage("Email choice saved.");
    } catch (error) { setMessage(`${requestErrorMessage(error)} Reload your choice before trying again.`); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function verifyEmail(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      await requestJson("/api/customer/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, confirmPlatformAnnouncements: true }) });
      setVerificationSent(true); setMessage("If that email has a booking or RSVP, check your inbox for the My Nights link. If you previously chose BeCore email updates, confirming that link also confirms them.");
    } catch (error) { setMessage(requestErrorMessage(error)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section aria-labelledby="platform-announcements-title">
    <h2 id="platform-announcements-title">New nights by email</h2>
    {preferences ? <>
      <div className="privacy-options"><label><input type="checkbox" checked={optedIn} disabled={busy || !preferences.emailVerified} onChange={event => { setOptedIn(event.target.checked); setMessage(""); }} /><span><b>Keep me posted on new nights from BeCore Tickets.</b><small>Your tickets and booking updates are separate.</small></span></label></div>
      {!preferences.emailVerified ? <form onSubmit={verifyEmail}><p>Verify your booking email to manage updates. Any pending choice is confirmed with the same link.</p><label>Booking or RSVP email<input type="email" autoComplete="email" required value={email} disabled={busy || verificationSent} onChange={event => setEmail(event.target.value)} /></label><button type="submit" disabled={busy || verificationSent}>{verificationSent ? "Check your email" : busy ? "Sending…" : "Verify email"}</button></form> : <><button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : preferences.status === "pending" && optedIn ? "Confirm email updates" : "Save email choice"}</button>{preferences.status === "pending" ? <p>Your earlier choice is waiting for confirmation.</p> : null}</>}
    </> : !message ? <p>Loading your email choice…</p> : null}
    {message ? <><p role="status">{message}</p><button type="button" disabled={busy} onClick={() => void load()}>Reload email choice</button></> : null}
  </section>;
}
