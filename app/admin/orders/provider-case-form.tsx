"use client";

import { useRef, useState, type FormEvent } from "react";
import { operationsFetch } from "../../../lib/operations-client";
import type { ProviderCase } from "../../../lib/provider-operation-tracking";
import "./provider-tracking.css";

type CaseOrder = { id: string; reference: string; paymentProvider: string; currency: string; totalAmountMinor: number; refundedAmountMinor: number; providerCases: ProviderCase[] };

function localDateTime(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function ProviderCaseForm({ order, onClose, onSaved }: { order: CaseOrder; onClose: () => void; onSaved: () => Promise<void> }) {
  const [kind, setKind] = useState<"refund" | "settlement">("refund");
  const current = (order.providerCases ?? []).find(item => item.kind === kind);
  const [status, setStatus] = useState<"pending" | "completed" | "closed_unpaid">(current?.status ?? "pending");
  const [reference, setReference] = useState(current?.caseReference ?? "");
  const [amount, setAmount] = useState(current?.amountMinor != null ? (current.amountMinor / 100).toFixed(2) : "");
  const [completedAt, setCompletedAt] = useState(localDateTime(current?.evidenceAt));
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const operation = useRef<{ id: string; payload: string } | null>(null);
  const provider = order.paymentProvider === "seevplus" ? "SeevPlus" : "Paystack";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const amountMinor = kind === "refund" && /^\d+(\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : null;
    if (kind === "refund" && (!Number.isSafeInteger(amountMinor) || Number(amountMinor) < 1)) { setMessage("Enter the refund amount with no more than two decimal places."); return; }
    if (status === "completed" && (!completedAt || !Number.isFinite(new Date(completedAt).getTime()))) { setMessage("Enter the completed date shown by the provider."); return; }
    const details = { action: "record_provider_case", orderId: order.id, kind, status, expectedVersion: current?.version ?? 0,
      caseReference: reference.trim(), amountMinor, confirmedNoRefund: status === "closed_unpaid" && confirmed, evidenceAt: status === "completed" ? new Date(completedAt).toISOString() : null, confirmed };
    const payload = JSON.stringify(details);
    if (!operation.current || operation.current.payload !== payload) operation.current = { id: crypto.randomUUID(), payload };
    setBusy(true); setMessage("");
    try {
      const response = await operationsFetch("/api/admin/orders", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...details, operationId: operation.current.id }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) { setMessage(data.error ?? "The provider case could not be saved."); return; }
      await onSaved();
    } catch { setMessage("The result could not be confirmed. Retry the same details safely, or refresh orders to check."); }
    finally { setBusy(false); }
  }

  return <section className="provider-tracking" aria-label="Record provider case">
    <header><div><h2>Record external provider case</h2><p>{provider} · {order.reference}</p></div><button type="button" onClick={onClose} disabled={busy}>Close</button></header>
    <p>This saves your checked provider record. Refunds and settlement happen outside this form; ticket access stays unchanged.</p>
    {current?.kind === "refund" && current.status === "completed" ? <p>Completed refund evidence stays in the history. Contact finance for a correction; another refund remains blocked.</p> : null}
    {current ? <p>Latest {kind}: {current.status === "closed_unpaid" ? "closed without refund" : current.status} · {current.caseReference}{current.amountMinor != null ? ` · ${order.currency} ${(current.amountMinor / 100).toFixed(2)}` : ""}. Updates preserve the audit history.</p> : null}
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <label>Case type<select value={kind} onChange={event => { const next = event.target.value as typeof kind; const saved = (order.providerCases ?? []).find(item => item.kind === next);
          setKind(next); setStatus(saved?.status ?? "pending"); setReference(saved?.caseReference ?? "");
          setAmount(saved?.amountMinor != null ? (saved.amountMinor / 100).toFixed(2) : ""); setCompletedAt(localDateTime(saved?.evidenceAt)); setConfirmed(false); setMessage(""); }}><option value="refund">External refund</option><option value="settlement">Settlement evidence</option></select></label>
        <label>Provider case status<select value={status} onChange={event => { setStatus(event.target.value as typeof status); setConfirmed(false); }}><option value="pending" disabled={kind === "refund" && current?.status === "completed"}>Pending at provider</option><option value="completed">Completed at provider</option>{kind === "refund" && current && current.status !== "completed" ? <option value="closed_unpaid">Closed without refund</option> : null}</select></label>
        <label>Provider case or receipt reference<input required disabled={status === "closed_unpaid"} maxLength={120} value={reference} onChange={event => setReference(event.target.value)} autoComplete="off" /></label>
        {kind === "refund" ? <label>External refund amount ({order.currency})<input required disabled={status === "closed_unpaid"} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder={((order.totalAmountMinor - order.refundedAmountMinor) / 100).toFixed(2)} /></label> : <p>Use a reference that links this order to the provider settlement. Checkout totals are not proof of a payout amount or currency.</p>}
        {status === "completed" ? <label>Completed at (your local time)<input required type="datetime-local" value={completedAt} onChange={event => setCompletedAt(event.target.value)} /></label> : null}
        <label className="provider-tracking-confirm"><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> {status === "closed_unpaid" ? `I checked ${provider} and confirmed no refund was made for this case` : `I checked this case and its status in ${provider}`}</label>
        <p>Use only a case reference. Do not enter bank details, wallet addresses, credentials or customer messages.</p>
        <button type="submit" disabled={status === "closed_unpaid" && current?.status !== "pending"}>{busy ? "Saving record…" : "Save provider record"}</button>
      </fieldset>
    </form>
    {message ? <p role="alert">{message}</p> : null}
  </section>;
}
