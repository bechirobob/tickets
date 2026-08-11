"use client";

import { Check, Headphones, Loader2, RotateCcw, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
  const load = useCallback(async () => {
    const response = await fetch(`/api/customer/support/${encodeURIComponent(slug)}`, { cache: "no-store" });
    const data = await response.json() as State;
    if (response.ok) setState(data); else setNotice(data.error ?? "Support could not open.");
  }, [slug]);
  useEffect(() => {
    fetch(`/api/customer/support/${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as State }))
      .then(({ response, data }) => { if (response.ok) setState(data); else setNotice(data.error ?? "Support could not open."); })
      .catch(() => setNotice("Support could not open."));
  }, [slug]);

  async function act(body: Record<string, unknown>, success: string) {
    setBusy(true); setNotice("");
    const response = await fetch(`/api/customer/support/${encodeURIComponent(slug)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json() as { error?: string };
    setNotice(response.ok ? success : data.error ?? "Support could not take that action.");
    if (response.ok) { setSubject(""); setMessage(""); await load(); }
    setBusy(false);
  }

  const eventState = state.event?.eventState ?? "on_sale";
  const changed = ["cancelled", "postponed", "rescheduled"].includes(eventState);
  return <section className="night-support"><header><Headphones size={17} /><span><b>Ticket support</b><small>Order attached. No retelling the whole story.</small></span></header>{changed ? <div className={`night-support__state ${eventState}`}><b>{eventState.replaceAll("_", " ")}</b><span>{eventState === "cancelled" ? "The event is cancelled. Eligible original purchasers can request review below." : eventState === "postponed" ? "The date is paused. Keep the ticket or request a refund review." : "A new date is live. Accept it or request a refund review."}</span>{eventState === "rescheduled" && state.decision?.decision !== "accepted_reschedule" ? <button disabled={busy} onClick={() => act({ action: "accept_reschedule" }, "New date accepted. Outfit planning may resume.")}><Check size={13} /> Accept new date</button> : null}{state.orders?.filter((order) => Boolean(order.canRequestRefund) && order.status === "paid" && Number(order.checkedInCount) === 0).map((order) => <button key={order.id} disabled={busy} onClick={() => act({ action: "request_refund", orderId: order.id }, "Refund review opened. Money does not move until finance confirms it.")}><RotateCcw size={13} /> Request refund · {order.reference}</button>)}</div> : null}<div className="night-support__threads">{state.cases?.map((item) => <details key={item.id}><summary><span><b>{item.subject}</b><small>{item.kind} · {item.status.replaceAll("_", " ")}</small></span></summary><div>{item.messages.map((entry) => <p key={entry.id} className={entry.authorType}><b>{entry.authorType === "staff" ? "Support" : entry.authorType === "system" ? "Update" : "You"}</b>{entry.body}<time>{new Date(entry.createdAt).toLocaleString("en-GH")}</time></p>)}</div>{item.status !== "closed" ? <form onSubmit={(event) => { event.preventDefault(); void act({ action: "reply", caseId: item.id, message: reply[item.id] }, "Reply sent to support."); setReply((current) => ({ ...current, [item.id]: "" })); }}><input value={reply[item.id] ?? ""} onChange={(event) => setReply((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Reply" maxLength={1200} /><button disabled={busy || !(reply[item.id] ?? "").trim()} aria-label="Send support reply"><Send size={13} /></button></form> : null}</details>)}</div><details className="night-support__new"><summary>Start a support conversation</summary><label>Subject<input maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What needs fixing?" /></label><label>Message<textarea maxLength={1200} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Short and specific wins." /></label><button disabled={busy || !subject.trim() || message.trim().length < 4} onClick={() => act({ action: "open_case", kind: "general", subject, message }, "Support conversation opened.")}>{busy ? <Loader2 className="spin" size={13} /> : <Headphones size={13} />} Send to support</button></details>{notice ? <button className="night-support__notice" onClick={() => setNotice("")}>{notice}</button> : null}</section>;
}
