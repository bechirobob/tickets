"use client";

import { Headphones, Loader2, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import OperationsNav from "../operations-nav";
import type { StaffRole } from "../../../lib/admin-session";

type SupportCase = { id: string; eventTitle: string; reference: string | null; displayName: string; email: string; kind: string; subject: string; status: string; updatedAt: string; messages: Array<{ id: string; authorType: string; body: string; createdAt: string }> };

export default function SupportOperations({ actor, role }: { actor: string; role: StaffRole }) {
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [reply, setReply] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/admin/support", { cache: "no-store" });
    const data = await response.json() as { cases?: SupportCase[]; error?: string };
    if (response.ok) { setCases(data.cases ?? []); setSelectedId((current) => current || data.cases?.[0]?.id || ""); } else setNotice(data.error ?? "Support queue could not load.");
  }, []);
  useEffect(() => {
    fetch("/api/admin/support", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as { cases?: SupportCase[]; error?: string } }))
      .then(({ response, data }) => { if (response.ok) { setCases(data.cases ?? []); setSelectedId(data.cases?.[0]?.id || ""); } else setNotice(data.error ?? "Support queue could not load."); })
      .catch(() => setNotice("Support queue could not load."));
  }, []);
  const selected = cases.find((item) => item.id === selectedId) ?? null;
  async function operate(action: "reply" | "status", status?: string) {
    if (!selected) return;
    setBusy(true); setNotice("");
    const response = await fetch("/api/admin/support", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, caseId: selected.id, message: reply, status }) });
    const data = await response.json() as { error?: string };
    setNotice(response.ok ? action === "reply" ? "Reply sent by push and email." : "Case status updated." : data.error ?? "Support action failed.");
    if (response.ok) { setReply(""); await load(); }
    setBusy(false);
  }
  return <main className="ops-page"><OperationsNav actor={actor} role={role} active="/admin/support" /><section className="ops-main support-ops"><header><div><p>Order-attached conversations</p><h1>Ticket support</h1></div><button onClick={load}><RefreshCw size={14} /> Refresh</button></header>{notice ? <button className="ops-message" onClick={() => setNotice("")}>{notice}</button> : null}<div className="support-ops__layout"><nav>{cases.map((item) => <button key={item.id} className={item.id === selectedId ? "active" : ""} onClick={() => setSelectedId(item.id)}><span><b>{item.subject}</b><small>{item.displayName} · {item.eventTitle}</small></span><i>{item.status.replaceAll("_", " ")}</i></button>)}{!cases.length ? <p>No support conversations. Lovely.</p> : null}</nav>{selected ? <article><header><Headphones /><div><b>{selected.subject}</b><span>{selected.displayName} · {selected.email}<br />{selected.eventTitle}{selected.reference ? ` · ${selected.reference}` : ""}</span></div><select value={selected.status} onChange={(event) => void operate("status", event.target.value)}><option value="open">Open</option><option value="waiting_support">Waiting support</option><option value="waiting_customer">Waiting customer</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></header><div className="support-ops__messages">{selected.messages.map((message) => <p key={message.id} className={message.authorType}><b>{message.authorType === "staff" ? "Support" : message.authorType === "system" ? "System" : selected.displayName}</b>{message.body}<time>{new Date(message.createdAt).toLocaleString("en-GH")}</time></p>)}</div><form onSubmit={(event) => { event.preventDefault(); void operate("reply"); }}><textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={1200} placeholder="Reply with a clear next step" /><button disabled={busy || reply.trim().length < 2}>{busy ? <Loader2 className="spin" size={14} /> : <Send size={14} />} Send reply</button></form></article> : null}</div></section></main>;
}
