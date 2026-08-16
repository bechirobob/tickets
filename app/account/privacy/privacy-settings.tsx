"use client";

import Link from "next/link";
import { ArrowLeft, Check, Loader2, LockKeyhole, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import PublicNavigation from "../../mobile-navigation";

export default function PrivacySettings() {
  const [visible, setVisible] = useState(false);
  const [updates, setUpdates] = useState(true);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { fetch("/api/customer/privacy", { cache: "no-store" }).then(async (response) => { if (response.status === 401) { setLocked(true); return; } const data = await response.json() as { defaultAttendeeVisible: boolean; allowHostUpdates: boolean }; setVisible(data.defaultAttendeeVisible); setUpdates(data.allowHostUpdates); }).finally(() => setLoading(false)); }, []);
  async function save() { setSaving(true); setSaved(false); const response = await fetch("/api/customer/privacy", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultAttendeeVisible: visible, allowHostUpdates: updates }) }); if (response.ok) setSaved(true); setSaving(false); }
  return <main className="account-privacy"><header className="directory-header"><Link href="/my-nights"><ArrowLeft size={16} /><span className="directory-header__back-label">My Nights</span></Link><Link href="/" className="brand-mark"><span className="brand-mark__box">B</span><span>Tickets</span></Link><PublicNavigation /></header><section>{loading ? <div className="my-nights-loading"><Loader2 className="spin" /> Loading privacy choices</div> : locked ? <div className="privacy-locked"><LockKeyhole /><h1>Member privacy starts after a verified ticket.</h1><Link href="/tickets">Recover tickets</Link></div> : <><header><ShieldCheck /><p className="eyebrow">Account privacy</p><h1>Private unless you say otherwise.</h1><p>These are defaults for future nights. You can still change “I&apos;m in” separately for any ticketed event.</p></header><div className="privacy-options"><label><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} /><span><b>Show me as going by default</b><small>Add me to the attendee count for new ticketed nights. My name is not made public.</small></span></label><label><input type="checkbox" checked={updates} onChange={(event) => setUpdates(event.target.checked)} /><span><b>Allow followed Host updates</b><small>Keep followed nights in My Nights. External email delivery remains separate.</small></span></label></div><button type="button" onClick={save} disabled={saving}>{saving ? <Loader2 className="spin" size={15} /> : saved ? <Check size={15} /> : <Save size={15} />}{saved ? "Saved" : "Save privacy choices"}</button></>}</section></main>;
}
