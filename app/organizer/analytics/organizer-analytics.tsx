"use client";

import { percentageChange } from "../../../lib/analytics-period";
import RsvpReport from "./rsvp-analytics";
import type { RsvpAnalytics } from "../../../lib/rsvp-analytics";
import BrandLogo from "../../brand-logo";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, BadgeCheck, BarChart3, Loader2, LogOut, TrendingDown, TrendingUp, RefreshCw } from "lucide-react";
import type { StaffRole } from "../../../lib/admin-session";
import WorkspaceJump from "../../admin/workspace-jump";

type EventOption = { slug: string; title: string; startsAt: string; eventState: string };
type Overview = { rsvpViews: number; eventViews: number; checkoutViews: number; checkoutStarts: number; paymentAttempts: number; paymentsConfirmed: number; paymentFailed: number; shares: number; paidOrders: number; revenueMinor: number; faceValueMinor: number; bookingFeesMinor: number; refundsMinor: number; admissions: number; checkedIn: number; uniqueBuyers: number; repeatBuyers: number; averageOrderValueMinor: number };
type AnalyticsData = {
  generatedAt: string;
  rsvp: RsvpAnalytics;
  events: EventOption[];
  scope: { eventSlug: string; label: string; range: string; rangeLabel: string };
  overview: Overview;
  comparison: { paidOrders: number; revenueMinor: number; eventViews: number } | null;
  salesTrend: Array<{ day: string; orders: number; admissions: number; revenueMinor: number }>;
  journeyTrend: Array<{ day: string; eventViews: number; checkoutStarts: number; paymentAttempts: number; paymentsConfirmed: number }>;
  ticketTiers: Array<{ id: string; eventTitle: string; name: string; priceMinor: number; capacityAdmissions: number; orders: number; admissions: number; revenueMinor: number }>;
  paymentMethods: Array<{ channel: string; orders: number; revenueMinor: number }>;
  promoters: Array<{ eventSlug: string; eventTitle: string; code: string; label: string; orders: number; admissions: number; revenueMinor: number }>;
  checkIns: Array<{ hour: string; admissions: number }>;
  vipUsage: Array<{ kind: string; status: string; count: number }>;
};

const money = (value: number) => new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", maximumFractionDigits: 0 }).format(value / 100);
const shortDate = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GH", { day: "numeric", month: "short", timeZone: "UTC" });
const readable = (value: string) => value.replaceAll("_", " ").replaceAll(":", " · ");
const rate = (part: number, total: number) => total > 0 ? Math.round((part / total) * 1000) / 10 : 0;

function Delta({ current, previous }: { current: number; previous?: number }) {
  if (previous === undefined) return <small>All available data</small>;
  const change = percentageChange(current, previous);
  if (change === null) return <small>New activity · none in the previous period</small>;
  if (change === 0) return <small>No change vs previous period</small>;
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
    <i aria-hidden="true"><b style={{ width: `${Math.max(0, (value(item) / maximum) * 100)}%` }} /></i>
  </div>)}</div>;
}

export default function OrganizerAnalytics({ actor, role, initialEvent = "all", initialRange = "30", initialView = "guests", embedded=false, active=true }: { embedded?:boolean; active?:boolean; actor: string; role: StaffRole; initialEvent?: string; initialRange?: string; initialView?: string }) {
  const router = useRouter();
  const [eventSlug, setEventSlug] = useState(initialEvent);
  const [range, setRange] = useState(initialRange);
  const [view, setView] = useState(initialView);
  const [eventOptions, setEventOptions] = useState<EventOption[]>([]);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if(!active)return;
    const controller = new AbortController();
    let running = false;
    async function load() {
      if (running || controller.signal.aborted) return;
      running = true;
      setRefreshing(true);
      try {
        const response = await fetch(`/api/organizer/analytics?eventSlug=${encodeURIComponent(eventSlug)}&range=${range}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        const result = await response.json() as AnalyticsData & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Analytics could not be loaded.");
        if (!controller.signal.aborted) { setData(result); setEventOptions(result.events); setError(""); }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Analytics could not be loaded.");
      } finally {
        running = false;
        if (!controller.signal.aborted) { setLoading(false); setRefreshing(false); }
      }
    }
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 60000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [eventSlug, range, retry,active]);

  useEffect(() => {
    if(embedded)return;
    const url = new URL(window.location.href);
    url.searchParams.set("event", eventSlug); url.searchParams.set("range", range); url.searchParams.set("view", view);
    window.history.replaceState(window.history.state, "", url);
  }, [eventSlug, range, view,embedded]);

  const overview = data?.overview;
  const funnel = useMemo(() => overview ? [
    { label: "Event views", value: overview.eventViews },
    { label: "Checkout views", value: overview.checkoutViews },
    { label: "Checkout starts", value: overview.checkoutStarts },
    { label: "Payment attempts", value: overview.paymentAttempts },
    { label: "Payments confirmed", value: overview.paymentsConfirmed },
  ] : [], [overview]);
  const totalVip = data?.vipUsage.reduce((sum, item) => sum + Number(item.count), 0) ?? 0;
  const workspaceUrl = `/organizer/workspace${eventSlug === "all" ? "" : `?area=events&view=overview&event=${encodeURIComponent(eventSlug)}`}`;
  const exportUrl = `/api/organizer/analytics?eventSlug=${encodeURIComponent(eventSlug)}&range=${range}&format=csv`;

  async function signOut() { await fetch("/api/admin/session", { method: "DELETE" }); router.push("/"); router.refresh(); }

  return <div className={`organizer-workspace organizer-analytics${embedded?" organizer-analytics--embedded":""}`}>
    <header className="organizer-workspace__header">
      <Link href="/" className="night-brand-link"><BrandLogo /></Link>
      <WorkspaceJump active="/organizer/analytics" role={role} compact />
      <div><span><BadgeCheck size={15} /> {actor}</span><button onClick={signOut}><LogOut size={15} /> Sign out</button></div>
    </header>

    <section className="analytics-heading">
      <div><p className="night-kicker"><span /> Organiser analytics</p><h1>How your nights are doing.</h1></div>
      <p>Follow your guest list, ticket sales and who made it through the door.</p>
    </section>

    <section className="analytics-controls" aria-label="Analytics filters">
      <label hidden={embedded}>Night<select aria-label="Night" value={eventSlug} onChange={(event) => { setLoading(true); setData(null); setError(""); setEventSlug(event.target.value); }}><option value="all">All Nights</option>{eventOptions.map((event) => <option key={event.slug} value={event.slug}>{event.title}</option>)}</select></label>
      <label>Period<select aria-label="Period" value={range} onChange={(event) => { setLoading(true); setData(null); setError(""); setRange(event.target.value); }}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="all">All time</option></select></label>
      <button type="button" disabled={refreshing} onClick={() => setRetry(value => value + 1)}><RefreshCw size={16} />{refreshing ? "Updating…" : "Refresh"}</button>
      <a href={exportUrl}><ArrowDownToLine size={15} /> Export CSV</a>
    </section>

    {loading ? <section className="analytics-loading" aria-label="Loading analytics"><Loader2 className="spin" /><div /><div /><div /></section> : error && !data ? <section className="analytics-error" role="alert"><BarChart3 /><h2>Analytics did not load.</h2><p>{error}</p><button onClick={() => { setLoading(true); setError(""); setRetry((value) => value + 1); }}>Try again</button></section> : data && overview ? <>
      <div className="analytics-freshness"><span>Updated {new Date(data.generatedAt).toLocaleTimeString("en-GH", {hour:"2-digit",minute:"2-digit",timeZone:"Africa/Accra"})} · Accra time · Refreshes automatically every minute.</span>{error ? <p role="alert">Couldn’t refresh. Showing the last loaded figures. {error}</p> : null}</div>
      {!data.events.length ? <section className="analytics-freshness"><h2>Your first night starts here.</h2><p>Once your event is approved, its guest list and numbers will appear here.</p><Link href="/organizer/submit">Submit your event</Link></section> : <>
      <section className="analytics-overview" aria-labelledby="analytics-overview-title">
        <header><div><p>{data.scope.rangeLabel} · includes today so far</p><h2 id="analytics-overview-title">{data.scope.label}</h2></div></header>
        <div>
          <article><small>Confirmed RSVP guests</small><b>{data.rsvp.totals.confirmedGuests}</b><small>{data.rsvp.totals.checkedIn} checked in</small></article>
          <article><small>Paid orders</small><b>{overview.paidOrders}</b><Delta current={overview.paidOrders} previous={data.comparison?.paidOrders} /></article>
          <article><small>Ticket face value</small><b>{money(overview.faceValueMinor)}</b><small>Before refunds · booking fees excluded</small></article>
          <article><small>Active paid passes</small><b>{overview.admissions}</b><small>{overview.checkedIn} checked in</small></article>
        </div>
      </section>
      <section className="analytics-automation" aria-label="Automatic reports">
        <div><h2>Let the numbers come to you.</h2><p>Weekly roundups and next-day recaps. Choose your email reports in the workspace.</p></div>
        <Link href={`${workspaceUrl}#email-reports`}>Email report settings</Link>
      </section>
      <nav className="analytics-views" aria-label="Analytics views">{[["guests","Guest list"],["sales","Sales"],["reach","Reach"],["door","Door & Room"]].map(([id,label]) => <button key={id} type="button" aria-pressed={view === id} aria-controls={`analytics-${id}`} onClick={() => setView(id)}>{label}</button>)}</nav>
      <div id="analytics-guests" hidden={view !== "guests"}>
        <RsvpReport key={data.scope.eventSlug} data={data.rsvp} eventSlug={data.scope.eventSlug} />
      </div>
      <section id="analytics-sales" className="analytics-layout" aria-label="Sales reports" hidden={view !== "sales"}>
        <article className="analytics-section analytics-section--wide"><header><div><small>Sales</small><h2>Gross sales over time</h2></div><b>{money(overview.revenueMinor)}</b></header><TrendChart rows={data.salesTrend} /></article>
        <article className="analytics-section"><header><div><small>Sales detail</small><h2>Collected & refunded</h2></div><b>{money(overview.revenueMinor)}</b></header><dl className="analytics-facts"><div><dt>Payment failures</dt><dd>{overview.paymentFailed}</dd></div><div><dt>Refunded</dt><dd>{money(overview.refundsMinor)}</dd></div><div><dt>Collected less refunds</dt><dd>{money(overview.revenueMinor - overview.refundsMinor)}</dd></div><div><dt>Booking fees collected</dt><dd>{money(overview.bookingFeesMinor)}</dd></div><div><dt>Average paid order</dt><dd>{money(overview.averageOrderValueMinor)}</dd></div></dl><p>These figures are not a payout balance. Payment charges, holds and settlements are under Event & sales.</p></article>
        <article className="analytics-section"><header><div><small>Checkout</small><h2>Payment methods</h2></div></header><BarList rows={data.paymentMethods as unknown as Array<Record<string, unknown>>} value={(item) => Number(item.orders)} label={(item) => readable(String(item.channel))} detail={(item) => `${item.orders} orders · ${money(Number(item.revenueMinor))}`} /></article>
        <article className="analytics-section analytics-section--wide"><header><div><small>Inventory</small><h2>Ticket sales</h2></div><b>{overview.admissions} sold</b></header><div className="analytics-table"><div><b>Night / tier</b><b>Orders</b><b>Admissions</b><b>Sold</b><b>Gross</b></div>{data.ticketTiers.map((tier) => <div key={tier.id}><span><b>{tier.name}</b><small>{tier.eventTitle} · {money(tier.priceMinor)}</small></span><span><small className="analytics-cell-label">Orders</small>{tier.orders}</span><span><small className="analytics-cell-label">Admissions</small>{tier.admissions}</span><span><small className="analytics-cell-label">Sold</small>{rate(tier.admissions, tier.capacityAdmissions)}%</span><strong><small className="analytics-cell-label">Gross</small>{money(tier.revenueMinor)}</strong></div>)}</div></article>
      </section>
      <section id="analytics-reach" className="analytics-layout" aria-label="Reach reports" hidden={view !== "reach"}>
        <article className="analytics-section"><header><div><small>Audience</small><h2>Visits & shares</h2></div></header><dl className="analytics-facts"><div><dt>Event views</dt><dd>{overview.eventViews}</dd></div><div><dt>RSVP page views</dt><dd>{overview.rsvpViews}</dd></div><div><dt>Unique paid buyers</dt><dd>{overview.uniqueBuyers}</dd></div><div><dt>Repeat buyers</dt><dd>{overview.repeatBuyers}</dd></div><div><dt>Shares started</dt><dd>{overview.shares}</dd></div></dl><p>RSVP page views start with this update. Shares count opened share actions, not confirmed posts.</p></article>
        <article className="analytics-section"><header><div><small>Booking activity</small><h2>From browsing to booking</h2></div></header><BarList rows={funnel as unknown as Array<Record<string, unknown>>} value={(item) => Number(item.value)} label={(item) => String(item.label)} detail={(item) => `${Number(item.value).toLocaleString("en-GH")} tracked`} /><p>Views count once per tab session, per page type, each day where storage is available. These are activity counts, not a joined visitor funnel; browser privacy settings can leave gaps.</p></article>
        <article className="analytics-section"><header><div><small>Promoter links</small><h2>Promoter performance</h2></div></header><BarList rows={data.promoters as unknown as Array<Record<string, unknown>>} value={(item) => Number(item.revenueMinor)} label={(item) => `${item.label} · ${item.eventTitle}`} detail={(item) => `${item.orders} orders · ${money(Number(item.revenueMinor))}`} /></article>
      </section>
      <section id="analytics-door" className="analytics-layout" aria-label="Door and Room reports" hidden={view !== "door"}>
        <article className="analytics-section"><header><div><small>At the door</small><h2>Paid check-ins · Accra time</h2></div><b>{overview.checkedIn}</b></header><BarList rows={data.checkIns as unknown as Array<Record<string, unknown>>} value={(item) => Number(item.admissions)} label={(item) => `${String(item.hour).padStart(2, "0")}:00`} detail={(item) => `${item.admissions} admitted`} /></article>
        <article className="analytics-section"><header><div><small>The Room · VIP</small><h2>Concierge usage</h2></div><b>{totalVip}</b></header><BarList rows={data.vipUsage as unknown as Array<Record<string, unknown>>} value={(item) => Number(item.count)} label={(item) => readable(String(item.kind))} detail={(item) => `${readable(String(item.status))} · ${item.count}`} /></article>
      </section>
      </>}
    </> : null}
  </div>;
}
