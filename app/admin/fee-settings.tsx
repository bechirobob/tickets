"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Info, LogOut, Save, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { StaffRole } from "../../lib/admin-session";

type FeeRule = { id: string; percentageBasisPoints: number; scope: string; effectiveAt: string; createdAt: string; createdBy: string };

const links = [
  { href: "/admin", label: "Curation queue", roles: ["owner", "curator"] },
  { href: "/admin/events", label: "Events & inventory", roles: ["owner", "curator"] },
  { href: "/admin/orders", label: "Orders & payments", roles: ["owner", "finance"] },
  { href: "/scan", label: "Gate scanner", roles: ["owner", "gate"] },
  { href: "/admin/rooms", label: "Room moderation", roles: ["owner", "moderator"] },
  { href: "/admin/fees", label: "Fees & charges", roles: ["owner", "finance"] },
  { href: "/admin/accounts", label: "People & permissions", roles: ["owner"] },
] as const;

function localInputDate(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function FeeSettings({ actor, role }: { actor: string; role: StaffRole }) {
  const router = useRouter();
  const [fee, setFee] = useState("7.50");
  const [effectiveAt, setEffectiveAt] = useState(localInputDate);
  const [history, setHistory] = useState<FeeRule[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/config/booking-fee", { cache: "no-store" });
    const result = await response.json() as { percentage?: number; history?: FeeRule[] };
    if (response.ok) { setFee(Number(result.percentage ?? 7.5).toFixed(2)); setHistory(result.history ?? []); }
  }, []);
  useEffect(() => {
    fetch("/api/config/booking-fee", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ percentage?: number; history?: FeeRule[] }>)
      .then((result) => { setFee(Number(result.percentage ?? 7.5).toFixed(2)); setHistory(result.history ?? []); })
      .catch(() => setError("Fee settings could not be loaded."));
  }, []);

  async function saveFee() {
    setSaved(false); setError("");
    const effectiveTimestamp = new Date(effectiveAt);
    if (!Number.isFinite(effectiveTimestamp.getTime())) { setError("Choose a valid effective time."); return; }
    const response = await fetch("/api/config/booking-fee", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ percentage: Number(fee), scope: "global", effectiveAt: effectiveTimestamp.toISOString() }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) setError(result.error ?? "The fee rule could not be saved.");
    else { setSaved(true); await load(); }
  }
  async function signOut() { await fetch("/api/admin/session", { method: "DELETE" }); router.push("/"); router.refresh(); }

  return <main className="settings-page">
    <header><Link href={role === "finance" ? "/admin/orders" : "/admin"}>BeCore Tickets</Link><span className="brand-mark"><span className="brand-mark__box">B</span><span>Admin</span></span><span><ShieldCheck size={16} /> {actor}</span></header>
    <div className="settings-layout">
      <aside><p>Platform configuration</p>{links.filter((item) => (item.roles as readonly StaffRole[]).includes(role)).map((item) => <Link key={item.href} className={item.href === "/admin/fees" ? "active" : ""} href={item.href}>{item.label}</Link>)}<Link href="/admin/account">My account</Link><button onClick={signOut}><LogOut size={14} /> Sign out</button></aside>
      <section className="settings-content">
        <p className="eyebrow">Commercial controls</p><h1>Booking fee</h1><p className="lead">Set the customer booking fee without changing completed orders or active reconciliation records.</p>
        <div className="settings-card">
          <label>Default booking fee <span className="percent-input"><input type="number" min="0" max="25" step="0.25" value={fee} onChange={(event) => setFee(event.target.value)} /><b>%</b></span><small>Applied to the ticket face value at checkout.</small></label>
          <label>Application scope<select value="global" disabled><option value="global">All new orders</option></select><small>Event-specific rules remain owner-assisted until target selection is available.</small></label>
          <label>Effective from<input type="datetime-local" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} /><small>Existing paid, pending and reserved orders keep their original fee.</small></label>
        </div>
        <div className="fee-preview"><Info size={19} /><div><strong>Customer price preview</strong><p>On a GH₵100.00 ticket, the buyer pays <b>GH₵{(100 + Number(fee || 0)).toFixed(2)}</b>. The booking fee is GH₵{Number(fee || 0).toFixed(2)}.</p></div></div>
        <div className="settings-actions"><button onClick={saveFee}><Save size={17} /> Save fee rule</button>{saved ? <span><CheckCircle2 size={17} /> Fee rule saved</span> : null}{error ? <span className="settings-error">{error}</span> : null}</div>
        <section className="audit-preview"><h2>Recent fee changes</h2>{history.length ? history.map((rule) => <div key={rule.id}><span>{(rule.percentageBasisPoints / 100).toFixed(2)}%</span><p><b>{rule.scope === "global" ? "Global default created" : `${rule.scope} rule created`}</b><small>Effective {new Date(rule.effectiveAt).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })} · {rule.createdBy}</small></p><time>{new Date(rule.createdAt).toLocaleDateString("en-GH", { dateStyle: "medium" })}</time></div>) : <p>No fee changes recorded yet.</p>}</section>
      </section>
    </div>
  </main>;
}
