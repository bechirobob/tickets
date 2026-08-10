"use client";

import Link from "next/link";
import { CheckCircle2, ChevronLeft, Info, Save, ShieldCheck } from "lucide-react";
import { useState } from "react";

export default function FeeSettings() {
  const [fee, setFee] = useState("7.50");
  const [scope, setScope] = useState("global");
  const [saved, setSaved] = useState(false);
  async function saveFee() {
    setSaved(false);
    const response = await fetch("/api/config/booking-fee", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ percentage: Number(fee), scope, effectiveAt: new Date().toISOString() }) });
    setSaved(response.ok);
  }
  return (
    <main className="settings-page">
      <header><Link href="/admin"><ChevronLeft size={17} /> Curation queue</Link><span className="brand-mark"><span className="brand-mark__box">B</span><span>Admin</span></span><span><ShieldCheck size={16} /> Restricted</span></header>
      <div className="settings-layout">
        <aside><p>Platform configuration</p><Link href="/admin">Curation queue</Link><Link className="active" href="/admin/fees">Fees & charges</Link><Link href="/admin/payments">Payment provider</Link><Link href="/admin/payouts">Payout rules</Link><Link href="/admin/audit">Audit log</Link></aside>
        <section className="settings-content">
          <p className="eyebrow">Commercial controls</p><h1>Booking fee</h1><p className="lead">Set the customer booking fee without changing completed orders or active reconciliation records.</p>
          <div className="settings-card">
            <label>Default booking fee <span className="percent-input"><input type="number" min="0" max="25" step="0.25" value={fee} onChange={(event) => setFee(event.target.value)} /><b>%</b></span><small>Applied to the ticket face value at checkout.</small></label>
            <label>Application scope<select value={scope} onChange={(event) => setScope(event.target.value)}><option value="global">All new orders</option><option value="event">Selected event only</option><option value="organizer">Selected organiser only</option></select><small>Event-specific rules take priority over the global default.</small></label>
            <label>Effective from<input type="datetime-local" defaultValue="2026-08-10T15:00" /><small>Existing paid, pending and reserved orders keep their original fee.</small></label>
          </div>
          <div className="fee-preview"><Info size={19} /><div><strong>Customer price preview</strong><p>On a GH₵100.00 ticket, the buyer pays <b>GH₵{(100 + Number(fee || 0)).toFixed(2)}</b>. The booking fee is GH₵{Number(fee || 0).toFixed(2)}.</p></div></div>
          <div className="settings-actions"><button onClick={saveFee}><Save size={17} /> Save fee rule</button>{saved && <span><CheckCircle2 size={17} /> Fee rule saved</span>}</div>
          <section className="audit-preview"><h2>Recent fee changes</h2><div><span>7.50%</span><p><b>Global default created</b><small>Effective 10 Aug 2026 · BeCore Finance</small></p><time>Today, 3:00 PM</time></div></section>
        </section>
      </div>
    </main>
  );
}
