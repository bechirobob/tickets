"use client";

import { AlertTriangle, Check, CircleDollarSign, ClipboardCheck, Loader2, Radio, RefreshCw, ShieldAlert, TicketCheck, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { StaffRole } from "../../../lib/admin-session";
import OperationsNav from "../operations-nav";

type Event = { slug: string; title: string; venue: string; startsAt: string; eventState: string };
type Metric = { slug: string; title: string; eventState: string; paidOrders: number; grossMinor: number; activeTickets: number; checkedIn: number; openSupport: number; roomReports: number; openIncidents: number; activeDevices: number; pendingOffline: number; lastEntryAt: string | null };
type CheckItem = { eventSlug: string; checkKey: string; label: string; status: "pending" | "passed" | "blocked"; note: string | null };
type Device = { id: string; eventSlug: string; gate: string; accountEmail: string; pendingOfflineScans: number; lastSeenAt: string; lastSyncAt: string | null };
type Incident = { id: string; event_slug: string; severity: string; title: string; detail: string; status: string; created_at: string };
type Alert = { id: string; source: string; severity: string; message: string; detail: string | null; status: string; created_at: string };
type Approval = { id: string; kind: string; event_slug: string | null; status: string; requested_by_email: string; requested_at: string; failure_reason: string | null };

const money = (minor: number) => new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", maximumFractionDigits: 0 }).format(minor / 100);

export default function EventOperationsHub({ actor, role }: { actor: string; role: StaffRole }) {
  const [data, setData] = useState<{ events: Event[]; metrics: Metric[]; checks: CheckItem[]; devices: Device[]; incidents: Incident[]; alerts: Alert[]; approvals: Approval[] }>({ events: [], metrics: [], checks: [], devices: [], incidents: [], alerts: [], approvals: [] });
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => { const response = await fetch("/api/admin/operations", { cache: "no-store" }); const next = await response.json() as typeof data & { error?: string }; if (!response.ok) setMessage(next.error ?? "Operations could not be loaded."); else { setData(next); setSelected((current) => current || next.events[0]?.slug || ""); } setLoading(false); }, []);
  useEffect(() => { const kick = window.setTimeout(() => void load(), 0); const timer = window.setInterval(() => void load(), 30_000); return () => { window.clearTimeout(kick); window.clearInterval(timer); }; }, [load]);
  const event = data.events.find((item) => item.slug === selected);
  const metric = data.metrics.find((item) => item.slug === selected);
  const checks = data.checks.filter((item) => item.eventSlug === selected);
  const devices = data.devices.filter((item) => item.eventSlug === selected);
  const incidents = data.incidents.filter((item) => item.event_slug === selected);
  const readiness = checks.length ? Math.round(checks.filter((item) => item.status === "passed").length / checks.length * 100) : 0;
  const canFinance = role === "owner" || role === "finance";
  const canEvents = role === "owner" || role === "curator";

  async function act(body: Record<string, unknown>) { setMessage(""); const response = await fetch("/api/admin/operations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json() as { error?: string }; setMessage(response.ok ? "Saved. Operations agree." : result.error ?? "That operation failed."); await load(); }
  function incident() { const title = window.prompt("Short incident title")?.trim(); if (!title) return; const detail = window.prompt("What happened, where, and what is being done?")?.trim(); if (!detail) return; void act({ action: "incident_create", eventSlug: selected, severity: "warning", title, detail }); }
  function protectedAction(action: "request_cancellation" | "request_mass_refund") { const reason = window.prompt(action === "request_cancellation" ? "Why is this event being cancelled? A second authorised person must approve it." : "Why are all eligible orders being refunded? A second authorised person must approve it.")?.trim(); if (reason) void act({ action, eventSlug: selected, reason }); }

  return <main className="ops-page"><OperationsNav actor={actor} role={role} active="/admin/operations" /><section className="ops-main operations-hub"><header><div><p>Live truth, one page</p><h1>Event operations</h1></div><button onClick={() => void load()}><RefreshCw size={14} /> Refresh</button></header>
    {loading ? <div className="curation-empty"><Loader2 className="spin" /> Checking every moving part…</div> : <><nav className="operations-event-strip">{data.events.map((item) => <button key={item.slug} className={selected === item.slug ? "active" : ""} onClick={() => setSelected(item.slug)}><b>{item.title}</b><span>{new Date(item.startsAt).toLocaleDateString("en-GH", { dateStyle: "medium" })} · {item.eventState.replaceAll("_", " ")}</span></button>)}</nav>
    {event && metric ? <><section className="operations-title"><div><p>{event.venue}</p><h2>{event.title}</h2></div><strong className={readiness === 100 ? "ready" : ""}>{readiness}% ready</strong></section>
      <div className="operations-metrics"><article><CircleDollarSign /><b>{money(Number(metric.grossMinor))}</b><span>{metric.paidOrders} paid orders</span></article><article><TicketCheck /><b>{metric.checkedIn}/{metric.activeTickets}</b><span>checked in</span></article><article><Radio /><b>{metric.activeDevices}</b><span>live gate devices · {metric.pendingOffline} offline queued</span></article><article><ShieldAlert /><b>{metric.openSupport + metric.roomReports + metric.openIncidents}</b><span>open human issues</span></article></div>
      <div className="operations-grid"><section><header><ClipboardCheck /><div><b>Readiness</b><span>Tap a check to move pending → passed → blocked.</span></div><button onClick={() => void act({ action: "run_rehearsal", eventSlug: selected })}>Run rehearsal</button></header>{checks.map((item) => <button key={item.checkKey} className={item.status} title={item.note ?? undefined} onClick={() => void act({ action: "readiness", eventSlug: selected, checkKey: item.checkKey, status: item.status === "pending" ? "passed" : item.status === "passed" ? "blocked" : "pending" })}><i>{item.status === "passed" ? <Check size={13} /> : item.status === "blocked" ? <AlertTriangle size={13} /> : null}</i><span>{item.label}</span><small>{item.status}</small></button>)}</section>
      <section><header><Radio /><div><b>Doors & devices</b><span>Only devices seen in the last two minutes count live.</span></div></header>{devices.length ? devices.map((item) => <article key={item.id}><span><b>{item.gate}</b><small>{item.accountEmail} · seen {new Date(item.lastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span><i>{item.pendingOfflineScans ? `${item.pendingOfflineScans} queued` : "Synced"}</i></article>) : <p>No gate device has checked in yet.</p>}</section>
      <section><header><AlertTriangle /><div><b>Incidents</b><span>What happened, who owns it, and whether it is over.</span></div><button onClick={incident}>Log</button></header>{incidents.length ? incidents.map((item) => <article key={item.id}><span><b>{item.title}</b><small>{item.detail}</small></span><button onClick={() => void act({ action: "incident_status", id: item.id, status: "resolved" })}>Resolve</button></article>) : <p>No open incident. Keep it boring.</p>}</section>
      <section><header><Users /><div><b>High-risk approvals</b><span>Requester and approver must be different people.</span></div></header>{data.approvals.filter((item) => !item.event_slug || item.event_slug === selected).map((item) => <article key={item.id}><span><b>{item.kind.replaceAll("_", " ")}</b><small>{item.requested_by_email} · {item.status}{item.failure_reason ? ` · ${item.failure_reason}` : ""}</small></span>{item.status === "pending" ? <div><button onClick={() => void act({ action: "approval", approvalId: item.id, decision: "approve" })}>Approve</button><button onClick={() => void act({ action: "approval", approvalId: item.id, decision: "reject" })}>Reject</button></div> : null}</article>)}{canEvents ? <button className="operations-danger" onClick={() => protectedAction("request_cancellation")}>Request cancellation</button> : null}{canFinance ? <button className="operations-danger" onClick={() => protectedAction("request_mass_refund")}>Request mass refund</button> : null}</section></div>
      {data.alerts.length ? <section className="operations-alerts"><header><ShieldAlert /><b>System alerts</b></header>{data.alerts.map((item) => <article key={item.id}><span><b>{item.message}</b><small>{item.source} · {item.detail ?? item.severity}</small></span><button onClick={() => void act({ action: "alert_status", id: item.id, status: "resolved" })}>Resolve</button></article>)}</section> : null}
    </> : <div className="curation-empty">No approved event is ready for operations.</div>}</>}
    {message ? <p className="ops-message" role="status">{message}</p> : null}
  </section></main>;
}
