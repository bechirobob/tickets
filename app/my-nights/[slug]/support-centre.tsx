"use client";

import { Check, Headphones, Loader2, RotateCcw, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { requestErrorMessage, requestJson } from "../../../lib/client-request";

type Order = { id: string; reference: string; status: string; refundStatus: string | null; canRequestRefund: number | boolean; checkedInCount: number };
type SupportCase = { id: string; orderId: string | null; kind: string; subject: string; status: string; messages: Array<{ id: string; authorType: string; body: string; createdAt: string }> };
type State = { event?: { eventState: string; rescheduledFrom: string | null; startsAt: string }; orders?: Order[]; cases?: SupportCase[]; decision?: { decision: string } | null; error?: string };

export default function SupportCentre({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({});
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const inFlight = useRef(false);
  const load = useCallback(() => requestJson<State>(`/api/customer/support/${encodeURIComponent(slug)}`).then((data) => {
    setState(data); setReady(true);
  }), [slug]);
  useEffect(() => {
    void load().catch((cause) => setNotice(requestErrorMessage(cause)));
  }, [load]);

  async function act(body: Record<string, unknown>, success: string) {
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(true); setNotice("");
    try {
      await requestJson(`/api/customer/support/${encodeURIComponent(slug)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (body.action === "open_case") { setSubject(""); setMessage(""); }
      if (body.action === "reply" && typeof body.caseId === "string") setReply((current) => ({ ...current, [body.caseId as string]: "" }));
      setNotice(success);
      try { await load(); }
      catch { setNotice(`${success} The conversation could not refresh. Reload to see the latest messages.`); }
    } catch (cause) { setNotice(requestErrorMessage(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const eventState = state.event?.eventState ?? "on_sale";
  const changed = ["cancelled", "postponed", "rescheduled"].includes(eventState);
  return <section className="night-support">
    <header><Headphones size={17} /><span><b>Ticket support</b><small>Questions, returns and event changes.</small></span></header>
    {!ready ? <p role="status">{notice ? "Support is unavailable right now." : "Loading your conversations…"}</p> : null}
    {changed ? <div className={`night-support__state ${eventState}`}><b>{eventState.replaceAll("_", " ")}</b><span>{eventState === "cancelled" ? "The event is cancelled. Eligible original purchasers can request review below." : eventState === "postponed" ? "The date is paused. Keep the ticket or request a refund review." : "A new date is live. Accept it or request a refund review."}</span>{eventState === "rescheduled" && state.decision?.decision !== "accepted_reschedule" ? <button disabled={busy} onClick={() => act({ action: "accept_reschedule" }, "New date accepted.")}><Check size={13} /> Accept new date</button> : null}{state.orders?.filter((order) => Boolean(order.canRequestRefund) && order.status === "paid" && Number(order.checkedInCount) === 0).map((order) => <button key={order.id} disabled={busy} onClick={() => act({ action: "request_refund", orderId: order.id }, "Refund review opened. Finance will confirm the outcome.")}><RotateCcw size={13} /> Request refund · {order.reference}</button>)}</div> : null}
    <div className="night-support__threads">{state.cases?.map((item) => <details key={item.id}><summary><span><b>{item.subject}</b><small>{item.kind} · {item.status.replaceAll("_", " ")}</small></span></summary><div>{item.messages.map((entry) => <p key={entry.id} className={entry.authorType}><b>{entry.authorType === "staff" ? "Support" : entry.authorType === "system" ? "Update" : "You"}</b>{entry.body}<time>{new Date(entry.createdAt).toLocaleString("en-GH")}</time></p>)}</div>{item.status !== "closed" ? <form onSubmit={(event) => { event.preventDefault(); void act({ action: "reply", caseId: item.id, message: reply[item.id] }, "Reply sent to support."); }}><input aria-label={`Reply to ${item.subject}`} disabled={busy} value={reply[item.id] ?? ""} onChange={(event) => setReply((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Reply" maxLength={1200} /><button disabled={busy || !(reply[item.id] ?? "").trim()} aria-label="Send support reply"><Send size={13} /></button></form> : null}</details>)}</div>
    {ready ? <details className="night-support__new"><summary>Start a support conversation</summary><label>Subject<input disabled={busy} maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What needs fixing?" /></label><label>Message<textarea disabled={busy} maxLength={1200} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Tell us what happened." /></label><button disabled={busy || !subject.trim() || message.trim().length < 4} onClick={() => act({ action: "open_case", kind: "general", subject, message }, "Support conversation opened.")}>{busy ? <Loader2 className="spin" size={13} /> : <Headphones size={13} />} Send to support</button></details> : null}
    {notice ? <><p className="night-support__notice" role="status">{notice}</p><button disabled={busy} onClick={() => { void load().then(() => setNotice("")).catch((cause) => setNotice(requestErrorMessage(cause))); }}>Refresh support</button></> : null}
  </section>;
}
