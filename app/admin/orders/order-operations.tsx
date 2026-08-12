"use client";

import { ChevronLeft, ChevronRight, CircleDollarSign, Loader2, Mail, RefreshCcw, RotateCcw, Search } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import OperationsNav from "../operations-nav";
import type { StaffRole } from "../../../lib/admin-session";

type Order = { id: string; reference: string; eventSlug: string; eventTitle: string; ticketType: string; unitQuantity: number; quantity: number; totalAmountMinor: number; refundedAmountMinor: number; currency: string; customerEmail: string; customerPhone: string; customerName: string | null; status: string; paystackStatus: string | null; refundStatus: string | null; disputeStatus: string | null; createdAt: string; paidAt: string | null; checkedInCount: number };
type Run = { id: string; period_start: string; period_end: string; status: string; matched_count: number; mismatch_count: number; missing_count: number };
type Settlement = { id: string; event_slug: string; gross_minor: number; booking_fees_minor: number; refunds_minor: number; net_ticket_sales_minor: number; currency: string; status: string; period_end: string };
type Dispute = { id: string; reference: string; status: string; category: string | null; amount_minor: number | null; due_at: string | null };

const money = (minor: number, currency: string) => new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(minor / 100);

export default function OrderOperations({ actor, role }: { actor: string; role: StaffRole }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState("");

  const load = useCallback(async (requestedPage = page) => {
    const params = new URLSearchParams(); if (query) params.set("q", query); if (status) params.set("status", status); params.set("page", String(requestedPage));
    const response = await fetch(`/api/admin/orders?${params}`, { cache: "no-store" });
    const data = await response.json() as { orders?: Order[]; total?: number; page?: number; pageSize?: number; reconciliationRuns?: Run[]; settlements?: Settlement[]; disputes?: Dispute[]; error?: string };
    if (!response.ok) { setMessage(data.error ?? "Orders could not be loaded."); return; }
    setOrders(data.orders ?? []); setRuns(data.reconciliationRuns ?? []); setSettlements(data.settlements ?? []); setDisputes(data.disputes ?? []);
    setTotal(data.total ?? 0); setPage(data.page ?? requestedPage); setPageSize(data.pageSize ?? 10);
  }, [page, query, status]);

  useEffect(() => {
    fetch("/api/admin/orders", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as { orders?: Order[]; total?: number; page?: number; pageSize?: number; reconciliationRuns?: Run[]; settlements?: Settlement[]; disputes?: Dispute[]; error?: string } }))
      .then(({ response, data }) => {
        if (!response.ok) setMessage(data.error ?? "Orders could not be loaded.");
        else {
          setOrders(data.orders ?? []);
          setRuns(data.reconciliationRuns ?? []);
          setSettlements(data.settlements ?? []);
          setDisputes(data.disputes ?? []);
          setTotal(data.total ?? 0); setPage(data.page ?? 1); setPageSize(data.pageSize ?? 10);
        }
      })
      .catch(() => setMessage("Orders could not be loaded."));
  }, []);

  async function operate(action: string, order?: Order, extra: Record<string, unknown> = {}) {
    const key = `${action}:${order?.id ?? "all"}`; setWorking(key); setMessage("");
    let reason = "";
    let amountMinor: number | undefined;
    if (action === "refund") { reason = window.prompt("Why is this refund being issued?")?.trim() ?? ""; if (!reason) { setWorking(""); return; } }
    if (action === "refund" && order) { const amount = window.prompt(`Refund amount in ${order.currency}. Leave blank for the remaining full amount.`)?.trim(); if (amount) { amountMinor = Math.round(Number(amount) * 100); if (!Number.isInteger(amountMinor) || amountMinor < 1) { setMessage("Enter a valid refund amount."); setWorking(""); return; } } }
    const response = await fetch("/api/admin/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, orderId: order?.id, reason, amountMinor, ...extra }) });
    const data = await response.json() as { error?: string; result?: string; evidence?: unknown };
    if (response.ok && data.evidence) { const blob = new Blob([JSON.stringify(data.evidence, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `dispute-evidence-${String(extra.disputeId ?? "case")}.json`; link.click(); URL.revokeObjectURL(url); }
    setMessage(response.ok ? data.result ? `Operation completed: ${data.result.replaceAll("_", " ")}.` : "Operation completed." : data.error ?? "Operation failed.");
    setWorking(""); await load(page);
  }

  function search(event: FormEvent) { event.preventDefault(); void load(1); }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstVisible = total ? (page - 1) * pageSize + 1 : 0;
  const lastVisible = Math.min(total, page * pageSize);

  return <main className="ops-page"><OperationsNav actor={actor} role={role} active="/admin/orders" />
    <section className="ops-main"><header><div><p>Finance and customer operations</p><h1>Orders & payments</h1></div><button onClick={() => operate("reconcile")} disabled={working !== ""}>{working === "reconcile:all" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />} Reconcile last 24h</button></header>
      <form className="order-search" onSubmit={search}><label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Reference, customer, email or phone" /></label><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="payment_pending">Payment pending</option><option value="paid">Paid</option><option value="expired">Expired</option><option value="failed">Failed</option><option value="refund_pending">Refund pending</option><option value="refunded">Refunded</option><option value="requires_refund">Needs refund</option><option value="disputed">Disputed</option></select><button>Search</button></form>
      {message ? <p className="ops-message" role="status">{message}</p> : null}
      <div className="order-table"><table><thead><tr><th>Order</th><th>Customer</th><th>Tickets</th><th>Payment</th><th>Total</th><th>Actions</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><b>{order.eventTitle}</b><small>{order.reference}<br />{new Date(order.createdAt).toLocaleString("en-GH")}</small></td><td>{order.customerName ?? "Guest"}<small>{order.customerEmail}<br />{order.customerPhone}</small></td><td>{order.unitQuantity} × {order.ticketType.replaceAll("-", " ")}<small>{order.quantity} admissions · {order.checkedInCount} checked in</small></td><td><span className={`order-status ${order.status}`}>{order.status.replaceAll("_", " ")}</span><small>Paystack: {order.paystackStatus ?? "not confirmed"}{order.refundStatus ? ` · Refund: ${order.refundStatus}` : ""}</small></td><td><b>{money(order.totalAmountMinor, order.currency)}</b></td><td><div className="order-actions"><button title="Verify with Paystack" onClick={() => operate("verify", order)} disabled={working !== ""}><RefreshCcw size={14} /></button>{order.status === "paid" || order.status === "requires_refund" ? <button title="Start full refund" onClick={() => operate("refund", order)} disabled={working !== ""}><RotateCcw size={14} /></button> : null}{order.status === "paid" ? <button title="Resend receipt and recovery" onClick={() => operate("resend", order)} disabled={working !== ""}><Mail size={14} /></button> : null}</div></td></tr>)}</tbody></table>{!orders.length ? <p>No orders match this view.</p> : null}</div>
      <nav className="order-pagination" aria-label="Orders pages"><span>Showing {firstVisible}–{lastVisible} of {total}</span><div><button type="button" aria-label="Previous orders page" disabled={page <= 1} onClick={() => void load(page - 1)}><ChevronLeft size={15} /> Previous</button><b>{page} / {pageCount}</b><button type="button" aria-label="Next orders page" disabled={page >= pageCount} onClick={() => void load(page + 1)}>Next <ChevronRight size={15} /></button></div></nav>
      <div className="finance-panels"><section><h2><CircleDollarSign size={18} /> Reconciliation</h2>{runs.length ? runs.slice(0, 5).map((run) => <article key={run.id}><b>{run.status}</b><span>{new Date(run.period_start).toLocaleDateString("en-GH")} · {run.matched_count} matched · {run.mismatch_count} mismatches · {run.missing_count} missing</span></article>) : <p>No reconciliation run yet.</p>}</section><section><h2>Open disputes</h2>{disputes.length ? disputes.map((dispute) => <article key={dispute.id}><b>{dispute.reference}</b><span>{dispute.category ?? "Payment dispute"} · {dispute.status}{dispute.due_at ? ` · Due ${new Date(dispute.due_at).toLocaleString("en-GH")}` : ""}</span><div><button onClick={() => void operate("dispute_evidence", undefined, { disputeId: dispute.id })}>Evidence</button><button onClick={() => window.confirm("Accept this dispute with Paystack?") && void operate("dispute_resolve", undefined, { disputeId: dispute.id, resolution: "merchant-accepted" })}>Accept</button><button onClick={() => window.confirm("Challenge this dispute with the evidence on file?") && void operate("dispute_resolve", undefined, { disputeId: dispute.id, resolution: "declined" })}>Challenge</button></div></article>) : <p>No open disputes recorded.</p>}</section><section><h2>Settlement records</h2>{settlements.length ? settlements.slice(0, 8).map((settlement) => <article key={settlement.id}><b>{settlement.event_slug.replaceAll("-", " ")}</b><span>{money(settlement.net_ticket_sales_minor, settlement.currency)} net ticket sales · {settlement.status}</span></article>) : <p>Settlements appear after reconciliation.</p>}</section></div>
    </section></main>;
}
