"use client";

import BrandLogo from "../../brand-logo";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowLeft, BadgeCheck, BarChart3, Loader2, LogOut, TrendingDown, TrendingUp } from "lucide-react";
import type { StaffRole } from "../../../lib/admin-session";
import WorkspaceJump from "../../admin/workspace-jump";

type EventOption = { slug: string; title: string; startsAt: string; eventState: string };
type Overview = { eventViews: number; checkoutViews: number; checkoutStarts: number; paymentAttempts: number; paymentsConfirmed: number; paymentFailed: number; shares: number; paidOrders: number; revenueMinor: number; faceValueMinor: number; bookingFeesMinor: number; refundsMinor: number; admissions: number; checkedIn: number; uniqueBuyers: number; repeatBuyers: number; averageOrderValueMinor: number };
type AnalyticsData = {
  events: EventOption[];
  scope: { eventSlug: string; label: string; range: string; rangeLabel: string };
  overview: Overview;
  comparison: { paidOrders: number; revenueMinor: number; eventViews: number } | null;
  salesTrend: Array<{ day: string; orders: number; admissions: number; revenueMinor: number }>;
  journeyTrend: Array<{ day: string; eventViews: number; checkoutStarts: number; paymentAttempts: number; paymentsConfirmed: number }>;
  ticketTiers: Array<{ id: string; eventTitle: string; name: string; priceMinor: number; capacityAdmissions: number; orders: number; admissions: number; revenueMinor: number }>;
  paymentMethods: Array<{ channel: string; orders: number; revenueMinor: number }>;
  promoters: Array<{ code: string; label: string; orders: number; admissions: number; revenueMinor: number }>;
  checkIns: Array<{ hour: string; admissions: number }>;
  vipUsage: Array<{ kind: string; status: string; count: number }>;
};

const money = (value: number) => new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", maximumFractionDigits: 0 }).format(value / 100);
const shortDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GH", { day: "numeric", month: "short", timeZone: "UTC" });
const readable = (value: string) => value.replaceAll("_", " ").replaceAll(":", " · ");
const rate = (part: number, total: number) => total > 0 ? Math.round((part / total) * 1000) / 10 : 0;

function delta(current: number, previous: number) {
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function Delta({ current, previous }: { current: number; previous?: number }) {
  if (previous === undefined) return <small>All available data</small>;
  const change = delta(current, previous);
  return <small className={change < 0 ? "is-down" : "is-up"}>{change < 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />}{Math.abs(change)}% vs previous period</small>;
}

function TrendChart({ rows }: { rows: AnalyticsData["salesTrend"] }) {
  const values = rows.map((item) => Number(item.revenueMinor));
  const maximum = Math.max(1, ...values);
  const points = rows.map((item, index) => {
    const x = rows.length === 1 ? 50 : (index / Math.max(1, rows.length - 1)) * 100;
    const y = 42 - (Number(item.revenueMinor) / maximum) * 36;
    return `${x},${y}`;
  }).join(" ");
  if (!rows.length) return <div className="analytics-empty">No paid orders in this period.</div>;
  return <div className="analytics-trend">
    <svg viewBox="0 0 100 48" role="img" aria-label="Gross ticket sales trend">
      <line x1="0" x2="100" y1="42" y2="42" />
      <line x1="0" x2="100" y1="24" y2="24" />
      <polyline points={points} />
      {rows.map((item, index) => {
        const x = rows.length === 1 ? 50 : (index / Math.max(1, rows.length - 1)) * 100;
        const y = 42 - (Number(item.revenueMinor) / maximum) * 36;
        return <circle key={item.day} cx={x} cy={y} r="1.2"><title>{shortDate(item.day)} · {money(item.revenueMinor)} · {item.orders} orders</title></circle>;
      })}
    </svg>
    <div><span>{shortDate(rows[0].day)}</span><b>Peak {money(maximum)}</b><span>{shortDate(rows.at(-1)!.day)}</span></div>
  </div>;
}

function BarList({ rows, value, label, detail }: { rows: Array<Record<string, unknown>>; value: (item: Record<string, unknown>) => number; label: (item: Record<string, unknown>) => string; detail: (item: Record<string, unknown>) => string }) {
  const maximum = Math.max(1, ...rows.map(value));
  if (!rows.length) return <div className="analytics-empty">Nothing recorded in this period.</div>;
  return <div className="analytics-bar-list">{rows.map((item, index) => <div key={`${label(item)}-${index}`}>
    <span><b>{label(item)}</b><small>{detail(item)}</small></span>
    <i aria-hidden="true"><b style={{ width: `${Math.max(2, (value(item) / maximum) * 100)}%` }} /></i>
  </div>)}</div>;
}

export default function OrganizerAnalytics({ actor, role }: { actor: string; role: StaffRole }) {
  const router = useRouter();
  const [eventSlug, setEventSlug] = useState("all");
  const [range, setRange] = useState("30");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/organizer/analytics?eventSlug=${encodeURIComponent(eventSlug)}&range=${range}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, result: await response.json() as AnalyticsData & { error?: string } }))
      .then(({ response, result }) => { if (!response.ok) throw new Error(result.error ?? "Analytics could not be loaded."); setData(result); })
      .catch((reason) => { if (reason instanceof DOMException && reason.name === "AbortError") return; setError(reason instanceof Error ? reason.message : "Analytics could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [eventSlug, range, retry]);

  const overview = data?.overview;
  const funnel = useMemo(() => overview ? [
    { label: "Event views", value: overview.eventViews },
    { label: "Checkout views", value: overview.checkoutViews },
    { label: "Checkout starts", value: overview.checkoutStarts },
    { label: "Payment attempts", value: overview.paymentAttempts },
    { label: "Payments confirmed", value: overview.paymentsConfirmed },
  ] : [], [overview]);
  const totalVip = data?.vipUsage.reduce((sum, item) => sum + Number(item.count), 0) ?? 0;
  const exportUrl = `/api/organizer/analytics?eventSlug=${encodeURIComponent(eventSlug)}&range=${range}&format=csv`;

  async function signOut() { await fetch("/api/admin/session", { method: "DELETE" }); router.push("/"); router.refresh(); }

  return <main className="organizer-workspace organizer-analytics">
    <header className="organizer-workspace__header">
      <Link href="/" className="night-brand-link"><BrandLogo /></Link>
      <WorkspaceJump active="/organizer/analytics" role={role} compact />
      <div><span><BadgeCheck size={15} /> {actor}</span><button onClick={signOut}><LogOut size={15} /> Sign out</button></div>
    </header>

    <section className="analytics-heading">
      <div><p className="night-kicker"><span /> Organiser analytics</p><h1>Know what<br />moved the Night.</h1></div>
      <p>First-party sales, demand and entry signals. Aggregated for decisions; customer payment details stay private.</p>
    </section>

    <section className="analytics-controls" aria-label="Analytics filters">
      <Link href="/organizer/workspace"><ArrowLeft size={15} /> Workspace</Link>
      <label>Night<select value={eventSlug} onChange={(event) => { setLoading(true); setError(""); setEventSlug(event.target.value); }}><option value="all">All Nights</option>{data?.events.map((event) => <option key={event.slug} value={event.slug}>{event.title}</option>)}</select></label>
      <label>Period<select value={range} onChange={(event) => { setLoading(true); setError(""); setRange(event.target.value); }}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option></select></label>
      <a href={exportUrl}><ArrowDownToLine size={15} /> Export CSV</a>
    </section>

    {loading ? <section className="analytics-loading" aria-label="Loading analytics"><Loader2 className="spin" /><div /><div /><div /></section> : error ? <section className="analytics-error" role="alert"><BarChart3 /><h2>Analytics did not load.</h2><p>{error}</p><button onClick={() => { setLoading(true); setError(""); setRetry((value) => value + 1); }}>Try again</button></section> : data && overview ? <>
      <section className="analytics-overview" aria-labelledby="analytics-overview-title">
        <header><div><p>{data.scope.rangeLabel}</p><h2 id="analytics-overview-title">{data.scope.label}</h2></div><span>Updated from live BeCore records</span></header>
        <div>
          <article><small>Gross collected</small><b>{money(overview.revenueMinor)}</b><Delta current={overview.revenueMinor} previous={data.comparison?.revenueMinor} /></article>
          <article><small>Paid orders</small><b>{overview.paidOrders}</b><Delta current={overview.paidOrders} previous={data.comparison?.paidOrders} /></article>
          <article><small>Admissions sold</small><b>{overview.admissions}</b><small>{rate(overview.checkedIn, overview.admissions)}% checked in</small></article>
          <article><small>Tracked views</small><b>{overview.eventViews}</b><Delta current={overview.eventViews} previous={data.comparison?.eventViews} /></article>
          <article><small>View to payment</small><b>{rate(overview.paymentsConfirmed, overview.eventViews)}%</b><small>{overview.paymentsConfirmed} confirmed payments</small></article>
          <article><small>Average order</small><b>{money(overview.averageOrderValueMinor)}</b><small>{overview.uniqueBuyers} unique buyers</small></article>
        </div>
      </section>

      <section className="analytics-layout">
        <article className="analytics-section analytics-section--wide"><header><div><small>Sales velocity</small><h2>Gross sales over time</h2></div><b>{money(overview.revenueMinor)}</b></header><TrendChart rows={data.salesTrend} /></article>
        <article className="analytics-section"><header><div><small>Conversion</small><h2>Booking funnel</h2></div><b>{rate(overview.paymentsConfirmed, overview.eventViews)}%</b></header><BarList rows={funnel as unknown as Array<Record<string, unknown>>} value={(item) => Number(item.value)} label={(item) => String(item.label)} detail={(item) => `${Number(item.value).toLocaleString("en-GH")} tracked`} /><p>Views are counted once per browser session per Night each day.</p></article>
        <article className="analytics-section"><header><div><small>Audience</small><h2>Buyer quality</h2></div><b>{overview.uniqueBuyers}</b></header><dl className="analytics-facts"><div><dt>Repeat buyers</dt><dd>{overview.repeatBuyers}</dd></div><div><dt>Shares started</dt><dd>{overview.shares}</dd></div><div><dt>Payment failures</dt><dd>{overview.paymentFailed}</dd></div><div><dt>Refunded</dt><dd>{money(overview.refundsMinor)}</dd></div></dl></article>
        <article className="analytics-section analytics-section--wide"><header><div><small>Inventory</small><h2>Ticket-tier performance</h2></div><b>{overview.admissions} sold</b></header><div className="analytics-table"><div><b>Night / tier</b><b>Orders</b><b>Admissions</b><b>Sell-through</b><b>Gross</b></div>{data.ticketTiers.map((tier) => <div key={tier.id}><span><b>{tier.name}</b><small>{tier.eventTitle} · {money(tier.priceMinor)}</small></span><span>{tier.orders}</span><span>{tier.admissions}</span><span>{rate(tier.admissions, tier.capacityAdmissions)}%</span><strong>{money(tier.revenueMinor)}</strong></div>)}</div></article>
        <article className="analytics-section"><header><div><small>Attribution</small><h2>Promoter performance</h2></div></header><BarList rows={data.promoters as unknown as Array<Record<string, unknown>>} value={(item) => Number(item.revenueMinor)} label={(item) => String(item.label)} detail={(item) => `${item.orders} orders · ${money(Number(item.revenueMinor))}`} /></article>
        <article className="analytics-section"><header><div><small>Checkout</small><h2>Payment methods</h2></div></header><BarList rows={data.paymentMethods as unknown as Array<Record<string, unknown>>} value={(item) => Number(item.orders)} label={(item) => readable(String(item.channel))} detail={(item) => `${item.orders} orders · ${money(Number(item.revenueMinor))}`} /></article>
        <article className="analytics-section"><header><div><small>At the door</small><h2>Check-in timing</h2></div><b>{overview.checkedIn}</b></header><BarList rows={data.checkIns as unknown as Array<Record<string, unknown>>} value={(item) => Number(item.admissions)} label={(item) => `${String(item.hour).padStart(2, "0")}:00`} detail={(item) => `${item.admissions} admitted`} /></article>
        <article className="analytics-section"><header><div><small>The Room · VIP</small><h2>Concierge usage</h2></div><b>{totalVip}</b></header><BarList rows={data.vipUsage as unknown as Array<Record<string, unknown>>} value={(item) => Number(item.count)} label={(item) => readable(String(item.kind))} detail={(item) => `${readable(String(item.status))} · ${item.count}`} /></article>
      </section>
    </> : null}
  </main>;
}
