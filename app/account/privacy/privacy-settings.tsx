"use client";

import BrandLogo from "../../brand-logo";
import AccountNavigation from "../../account-navigation";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, LockKeyhole, Save, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import PublicNavigation from "../../mobile-navigation";
import { RequestError, requestErrorMessage, requestJson } from "../../../lib/client-request";

export default function PrivacySettings() {
  const [visible, setVisible] = useState(false);
  const [updates, setUpdates] = useState(true);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const busy = useRef(false);
  const load = useCallback(() => requestJson<{ defaultAttendeeVisible: boolean; allowHostUpdates: boolean }>("/api/customer/privacy").then((data) => {
      if (typeof data.defaultAttendeeVisible !== "boolean" || typeof data.allowHostUpdates !== "boolean") throw new Error("Privacy choices could not be loaded. Please try again.");
      setVisible(data.defaultAttendeeVisible); setUpdates(data.allowHostUpdates); setReady(true); setLocked(false); setError("");
    }).catch((cause) => {
      if (cause instanceof RequestError && cause.status === 401) setLocked(true);
      else setError(requestErrorMessage(cause));
    }).finally(() => setLoading(false)), []);
  useEffect(() => { void load(); }, [load]);
  async function save() {
    if (busy.current || !ready) return;
    busy.current = true; setSaving(true); setSaved(false); setError("");
    try {
      await requestJson("/api/customer/privacy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultAttendeeVisible: visible, allowHostUpdates: updates }) });
      setSaved(true);
    } catch (cause) {
      if (cause instanceof RequestError && cause.status === 401) setLocked(true);
      setError(requestErrorMessage(cause));
    } finally { busy.current = false; setSaving(false); }
  }
  return <main className="account-privacy">
    <header className="directory-header"><Link href="/my-nights" aria-label="Back to My Nights"><ArrowLeft size={16} /><span className="directory-header__back-label">My Nights</span></Link><Link href="/" className="brand-mark"><BrandLogo /></Link><PublicNavigation /></header>
    <AccountNavigation />
    <section>{loading ? <div className="my-nights-loading" role="status"><Loader2 className="spin" /> Loading privacy choices</div> : locked ? <div className="privacy-locked"><LockKeyhole /><h1>Sign in to manage privacy.</h1><Link href="/tickets">Recover tickets</Link></div> : <>
      <header><ShieldCheck /><p className="eyebrow">Account privacy</p><h1>Your privacy choices.</h1><p>These are defaults for future nights. You can still change “I&apos;m in” separately for any ticketed event.</p></header>
      {ready ? <><div className="privacy-options"><label><input type="checkbox" checked={visible} disabled={saving} onChange={(event) => { setVisible(event.target.checked); setSaved(false); }} /><span><b>Show me as going by default</b><small>Add me to the attendee count for new ticketed nights. My name is not made public.</small></span></label><label><input type="checkbox" checked={updates} disabled={saving} onChange={(event) => { setUpdates(event.target.checked); setSaved(false); }} /><span><b>Allow followed Host updates</b><small>Keep followed nights in My Nights. External email delivery remains separate.</small></span></label></div><button type="button" onClick={save} disabled={saving}>{saving ? <Loader2 className="spin" size={15} /> : saved ? <Check size={15} /> : <Save size={15} />}{saved ? "Saved" : "Save privacy choices"}</button>{saved ? <p role="status">Privacy choices saved.</p> : null}</> : <button type="button" onClick={load}>Retry loading choices</button>}
    </>}{error ? <p role="alert">{error}</p> : null}</section>
  </main>;
}
