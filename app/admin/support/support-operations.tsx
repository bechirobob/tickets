"use client";

import { Input } from '@/components/boardui/components/base/input/input';
import { Pagination } from '@/components/boardui/components/base/pagination/pagination';
import { operationsFetch } from "../../../lib/operations-client";

import { Headphones, Loader2, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import OperationsNav from "../operations-nav";
import type { StaffRole } from "../../../lib/admin-session";

type SupportCase = { id: string; eventTitle: string; reference: string | null; displayName: string; email: string; kind: string; subject: string; status: string; updatedAt: string; messages: Array<{ id: string; authorType: string; body: string; createdAt: string }> };

export default function SupportOperations({ actor, role }: { actor: string; role: StaffRole }) {
  const pendingLoad=useRef<AbortController|null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [cases, setCases] = useState<SupportCase[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  const reply=drafts[selectedId]??'';
  const setReply=(value:string)=>setDrafts(current=>({...current,[selectedId]:value}));
  const [query,setQuery]=useState(''),[conversationOpen,setConversationOpen]=useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (requestedPage = 1) => {
    pendingLoad.current?.abort();const controller=new AbortController();pendingLoad.current=controller;setLoading(true);
    const response = await operationsFetch(`/api/admin/support?page=${requestedPage}`, { cache: "no-store",signal:controller.signal });
    const data = await response.json() as { cases?: SupportCase[]; page?: number; total?: number; error?: string };
    if(controller.signal.aborted)return;
    if (response.ok) { setPage(data.page ?? 1); setTotal(data.total ?? 0); setCases(data.cases ?? []); setSelectedId((current) => data.cases?.some(item => item.id === current) ? current : data.cases?.[0]?.id || ""); } else setNotice(data.error ?? "Support queue could not load.");
    setLoading(false);
  }, []);
  useEffect(() => {const timer=window.setTimeout(()=>void load(),0);return ()=>{window.clearTimeout(timer);pendingLoad.current?.abort();};}, [load]);
  const selected = cases.find((item) => item.id === selectedId) ?? null;
  async function operate(action: "reply" | "status", status?: string) {
    if (!selected || busy) return;
    setBusy(true); setNotice("");
    const response = await operationsFetch("/api/admin/support", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, caseId: selected.id, message: reply, status }) });
    const data = await response.json() as { error?: string };
    setNotice(response.ok ? action === "reply" ? "Reply saved. Customer notifications queued." : "Case status updated." : data.error ?? "Support action failed.");
    if (response.ok) { setReply(""); await load(page); }
    setBusy(false);
  }
  return <main className="ops-page workspace-boardui"><OperationsNav actor={actor} role={role} active="/admin/support" /><section className="ops-main support-ops"><header><div><p>Order-attached conversations</p><h1>Ticket support</h1></div><button onClick={() => void load(page)}><RefreshCw size={14} /> Refresh</button></header>{loading?<p role="status">Loading support conversations…</p>:null}{notice ? <button className="ops-message" role="status" onClick={() => setNotice("")}>{notice}</button> : null}<p>{total} conversations</p><fieldset className="workspace-pager-guard" disabled={busy}><Pagination aria-label="Support pages" page={page} totalPages={Math.max(1,Math.ceil(total/20))} onChange={value=>{setQuery('');setConversationOpen(false);void load(value);}}/></fieldset><Input label="Find a conversation on this page" value={query} onChange={setQuery} placeholder="Subject, guest or event" fieldClassName="workspace-input"/><div className="support-ops__layout" data-conversation-open={conversationOpen}><nav aria-label="Support conversations">{cases.filter(item=>`${item.subject} ${item.displayName} ${item.eventTitle}`.toLowerCase().includes(query.toLowerCase())).map((item) => <button key={item.id} data-case-id={item.id} className={item.id === selectedId ? "active" : ""} disabled={busy} onClick={() => { setSelectedId(item.id); setConversationOpen(true);requestAnimationFrame(()=>{if(window.matchMedia("(max-width:700px)").matches)document.querySelector<HTMLElement>(".support-ops__layout > article")?.focus({preventScroll:true});}); }}><span><b>{item.subject}</b><small>{item.displayName} · {item.eventTitle}</small></span><i>{item.status.replaceAll("_", " ")}</i></button>)}{cases.length&&cases.every(item=>!`${item.subject} ${item.displayName} ${item.eventTitle}`.toLowerCase().includes(query.toLowerCase()))?<p>No conversations match on this page.</p>:null}{!cases.length ? <p>{loading ? "Loading support conversations…" : "No support conversations."}</p> : null}</nav>{selected ? <article tabIndex={-1} aria-label={selected.subject}><button type="button" className="workspace-conversation-back" onClick={()=>{setConversationOpen(false);requestAnimationFrame(()=>document.querySelector<HTMLElement>(`[data-case-id="${CSS.escape(selectedId)}"]`)?.focus({preventScroll:true}));}}>Back to conversations</button><header><Headphones /><div><b>{selected.subject}</b><span>{selected.displayName} · {selected.email}<br />{selected.eventTitle}{selected.reference ? ` · ${selected.reference}` : ""}</span></div><select aria-label="Case status" disabled={busy} value={selected.status} onChange={(event) => void operate("status", event.target.value)}><option value="open">Open</option><option value="waiting_support">Waiting support</option><option value="waiting_customer">Waiting customer</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></header><div className="support-ops__messages">{selected.messages.map((message) => <p key={message.id} className={message.authorType}><b>{message.authorType === "staff" ? "Support" : message.authorType === "system" ? "System" : selected.displayName}</b>{message.body}<time>{new Date(message.createdAt).toLocaleString("en-GH")}</time></p>)}</div><form onSubmit={(event) => { event.preventDefault(); void operate("reply"); }}><textarea aria-label="Reply to customer" value={reply} onChange={(event) => setReply(event.target.value)} maxLength={1200} placeholder="Reply with a clear next step" /><button disabled={busy || reply.trim().length < 2}>{busy ? <Loader2 className="spin" size={14} /> : <Send size={14} />} Send reply</button></form></article> : null}</div></section></main>;
}
