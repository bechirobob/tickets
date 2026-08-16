import { hasPermission, readAdminSession } from "../../../../lib/admin-session";

type RangeKey = "7" | "30" | "90" | "all";

const paidStatuses = "'paid','refund_pending','refunded','disputed'";

function rangeWindow(value: string | null) {
  const range: RangeKey = value === "7" || value === "90" || value === "all" ? value : "30";
  const end = new Date();
  if (range === "all") return { range, start: "2000-01-01T00:00:00.000Z", previousStart: null, previousEnd: null };
  const days = Number(range);
  const start = new Date(end.getTime() - days * 86_400_000);
  const previousStart = new Date(start.getTime() - days * 86_400_000);
  return { range, start: start.toISOString(), previousStart: previousStart.toISOString(), previousEnd: start.toISOString() };
}

function placeholders(values: readonly string[]) {
  return values.map(() => "?").join(",");
}

function number(value: unknown) {
  return Number(value ?? 0);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function analyticsCsv(data: Record<string, unknown>) {
  const overview = data.overview as Record<string, unknown>;
  const rows: unknown[][] = [
    ["BeCore Tickets organiser analytics"],
    ["Scope", (data.scope as Record<string, unknown>).label],
    ["Range", (data.scope as Record<string, unknown>).rangeLabel],
    [],
    ["Overview"],
    ["Metric", "Value"],
    ["Tracked event views", overview.eventViews],
    ["Checkout starts", overview.checkoutStarts],
    ["Paid orders", overview.paidOrders],
    ["Admissions sold", overview.admissions],
    ["Gross collected (minor units)", overview.revenueMinor],
    ["Refunded (minor units)", overview.refundsMinor],
    ["Unique buyers", overview.uniqueBuyers],
    ["Repeat buyers", overview.repeatBuyers],
    [],
    ["Sales trend"],
    ["Day", "Orders", "Admissions", "Gross collected (minor units)"],
    ...((data.salesTrend as Array<Record<string, unknown>>).map((item) => [item.day, item.orders, item.admissions, item.revenueMinor])),
    [],
    ["Ticket tiers"],
    ["Event", "Tier", "Orders", "Admissions", "Capacity", "Gross collected (minor units)"],
    ...((data.ticketTiers as Array<Record<string, unknown>>).map((item) => [item.eventTitle, item.name, item.orders, item.admissions, item.capacityAdmissions, item.revenueMinor])),
    [],
    ["Promoter attribution"],
    ["Code", "Label", "Orders", "Admissions", "Gross collected (minor units)"],
    ...((data.promoters as Array<Record<string, unknown>>).map((item) => [item.code, item.label, item.orders, item.admissions, item.revenueMinor])),
    [],
    ["Payment methods"],
    ["Channel", "Orders", "Gross collected (minor units)"],
    ...((data.paymentMethods as Array<Record<string, unknown>>).map((item) => [item.channel, item.orders, item.revenueMinor])),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

async function organizerSession(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  return { env, session: session && hasPermission(session, "organizer.workspace") ? session : null };
}

export async function GET(request: Request) {
  const { env, session } = await organizerSession(request);
  if (!session) return Response.json({ error: "Organiser access is required." }, { status: 403 });

  const url = new URL(request.url);
  const window = rangeWindow(url.searchParams.get("range"));
  const eventStatement = env.DB.prepare(`
    SELECT event.slug, event.title, event.starts_at AS startsAt, event.event_state AS eventState
    FROM curated_event_records event
    LEFT JOIN party_submissions submission ON submission.id = event.submission_id
    ${session.role === "owner" ? "" : `WHERE (
      EXISTS (SELECT 1 FROM staff_event_assignments assignment WHERE assignment.account_id = ? AND assignment.event_slug = event.slug)
      OR submission.contact_email = ?
    )`}
    ORDER BY event.starts_at DESC
  `);
  const events = session.role === "owner"
    ? await eventStatement.all<{ slug: string; title: string; startsAt: string; eventState: string }>()
    : await eventStatement.bind(session.accountId, session.email).all<{ slug: string; title: string; startsAt: string; eventState: string }>();
  const requestedSlug = url.searchParams.get("eventSlug") ?? "all";
  if (requestedSlug !== "all" && !events.results.some((event) => event.slug === requestedSlug)) {
    return Response.json({ error: "This Night is not assigned to your organiser account." }, { status: 403 });
  }
  const slugs = requestedSlug === "all" ? events.results.map((event) => event.slug) : [requestedSlug];
  const label = requestedSlug === "all" ? "All Nights" : events.results.find((event) => event.slug === requestedSlug)?.title ?? "Night";
  const rangeLabel = window.range === "all" ? "All time" : `Last ${window.range} days`;
  const empty = {
    events: events.results,
    scope: { eventSlug: requestedSlug, label, range: window.range, rangeLabel },
    overview: { eventViews: 0, checkoutViews: 0, checkoutStarts: 0, paymentAttempts: 0, paymentsConfirmed: 0, paymentFailed: 0, shares: 0, paidOrders: 0, revenueMinor: 0, faceValueMinor: 0, bookingFeesMinor: 0, refundsMinor: 0, admissions: 0, checkedIn: 0, uniqueBuyers: 0, repeatBuyers: 0, averageOrderValueMinor: 0 },
    comparison: null,
    salesTrend: [], journeyTrend: [], ticketTiers: [], paymentMethods: [], promoters: [], checkIns: [], vipUsage: [],
  };
  if (!slugs.length) return Response.json(empty, { headers: { "cache-control": "no-store, private" } });

  const marks = placeholders(slugs);
  const orderBindings = [...slugs, window.start];
  const metricBindings = [...slugs, window.start.slice(0, 10)];
  const [orders, admissions, product, salesTrend, journeyTrend, ticketTiers, paymentMethods, promoters, checkIns, vipUsage, repeatBuyers] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) AS paidOrders, COALESCE(SUM(total_amount_minor), 0) AS revenueMinor,
        COALESCE(SUM(face_amount_minor), 0) AS faceValueMinor, COALESCE(SUM(booking_fee_minor), 0) AS bookingFeesMinor,
        COALESCE(SUM(refunded_amount_minor), 0) AS refundsMinor,
        COUNT(DISTINCT lower(customer_email)) AS uniqueBuyers,
        COALESCE(ROUND(AVG(total_amount_minor)), 0) AS averageOrderValueMinor
      FROM orders WHERE event_slug IN (${marks}) AND status IN (${paidStatuses}) AND COALESCE(paid_at, created_at) >= ?
    `).bind(...orderBindings).first<Record<string, unknown>>(),
    env.DB.prepare(`
      SELECT COUNT(ticket.id) AS admissions,
        COALESCE(SUM(CASE WHEN ticket.status = 'checked_in' THEN 1 ELSE 0 END), 0) AS checkedIn
      FROM tickets ticket JOIN orders orders ON orders.id = ticket.order_id
      WHERE ticket.event_slug IN (${marks}) AND orders.status IN (${paidStatuses}) AND COALESCE(orders.paid_at, orders.created_at) >= ?
        AND ticket.status IN ('issued','checked_in')
    `).bind(...orderBindings).first<Record<string, unknown>>(),
    env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN metric = 'event_view' THEN count ELSE 0 END), 0) AS eventViews,
        COALESCE(SUM(CASE WHEN metric = 'checkout_view' THEN count ELSE 0 END), 0) AS checkoutViews,
        COALESCE(SUM(CASE WHEN metric = 'checkout_started' THEN count ELSE 0 END), 0) AS checkoutStarts,
        COALESCE(SUM(CASE WHEN metric = 'payment_attempted' THEN count ELSE 0 END), 0) AS paymentAttempts,
        COALESCE(SUM(CASE WHEN metric = 'payment_confirmed' THEN count ELSE 0 END), 0) AS paymentsConfirmed,
        COALESCE(SUM(CASE WHEN metric = 'payment_failed' THEN count ELSE 0 END), 0) AS paymentFailed,
        COALESCE(SUM(CASE WHEN metric = 'share_started' THEN count ELSE 0 END), 0) AS shares
      FROM product_metrics_daily WHERE event_slug IN (${marks}) AND day >= ?
    `).bind(...metricBindings).first<Record<string, unknown>>(),
    env.DB.prepare(`
      SELECT substr(COALESCE(paid_at, created_at), 1, 10) AS day, COUNT(*) AS orders,
        COALESCE(SUM(quantity), 0) AS admissions, COALESCE(SUM(total_amount_minor), 0) AS revenueMinor
      FROM orders WHERE event_slug IN (${marks}) AND status IN (${paidStatuses}) AND COALESCE(paid_at, created_at) >= ?
      GROUP BY day ORDER BY day
    `).bind(...orderBindings).all<Record<string, unknown>>(),
    env.DB.prepare(`
      SELECT day,
        COALESCE(SUM(CASE WHEN metric = 'event_view' THEN count ELSE 0 END), 0) AS eventViews,
        COALESCE(SUM(CASE WHEN metric = 'checkout_started' THEN count ELSE 0 END), 0) AS checkoutStarts,
        COALESCE(SUM(CASE WHEN metric = 'payment_attempted' THEN count ELSE 0 END), 0) AS paymentAttempts,
        COALESCE(SUM(CASE WHEN metric = 'payment_confirmed' THEN count ELSE 0 END), 0) AS paymentsConfirmed
      FROM product_metrics_daily WHERE event_slug IN (${marks}) AND day >= ? GROUP BY day ORDER BY day
    `).bind(...metricBindings).all<Record<string, unknown>>(),
    env.DB.prepare(`
      SELECT tier.id, tier.event_slug AS eventSlug, event.title AS eventTitle, tier.name, tier.price_minor AS priceMinor,
        tier.capacity_admissions AS capacityAdmissions, COUNT(orders.id) AS orders,
        COALESCE(SUM(orders.quantity), 0) AS admissions, COALESCE(SUM(orders.total_amount_minor), 0) AS revenueMinor
      FROM event_ticket_tiers tier JOIN curated_event_records event ON event.slug = tier.event_slug
      LEFT JOIN orders ON orders.ticket_tier_id = tier.id AND orders.status IN (${paidStatuses}) AND COALESCE(orders.paid_at, orders.created_at) >= ?
      WHERE tier.event_slug IN (${marks}) GROUP BY tier.id ORDER BY event.starts_at DESC, tier.sort_order
    `).bind(window.start, ...slugs).all<Record<string, unknown>>(),
    env.DB.prepare(`
      SELECT payment_channel AS channel, COUNT(*) AS orders, COALESCE(SUM(total_amount_minor), 0) AS revenueMinor
      FROM orders WHERE event_slug IN (${marks}) AND status IN (${paidStatuses}) AND COALESCE(paid_at, created_at) >= ?
      GROUP BY payment_channel ORDER BY orders DESC
    `).bind(...orderBindings).all<Record<string, unknown>>(),
    env.DB.prepare(`
      SELECT COALESCE(orders.promoter_code, 'direct') AS code,
        COALESCE(MAX(promoter.label), 'Direct / untagged') AS label, COUNT(*) AS orders,
        COALESCE(SUM(orders.quantity), 0) AS admissions, COALESCE(SUM(orders.total_amount_minor), 0) AS revenueMinor
      FROM orders LEFT JOIN event_promoter_codes promoter ON promoter.event_slug = orders.event_slug AND promoter.code = orders.promoter_code
      WHERE orders.event_slug IN (${marks}) AND orders.status IN (${paidStatuses}) AND COALESCE(orders.paid_at, orders.created_at) >= ?
      GROUP BY COALESCE(orders.promoter_code, 'direct') ORDER BY orders DESC
    `).bind(...orderBindings).all<Record<string, unknown>>(),
    env.DB.prepare(`
      SELECT substr(checked_in_at, 12, 2) AS hour, COUNT(*) AS admissions
      FROM tickets WHERE event_slug IN (${marks}) AND status = 'checked_in' AND checked_in_at >= ?
      GROUP BY hour ORDER BY hour
    `).bind(...slugs, window.start).all<Record<string, unknown>>(),
    env.DB.prepare(`
      SELECT kind, status, COUNT(*) AS count FROM vip_concierge_requests
      WHERE event_slug IN (${marks}) AND created_at >= ? GROUP BY kind, status ORDER BY kind, status
    `).bind(...slugs, window.start).all<Record<string, unknown>>(),
    env.DB.prepare(`
      SELECT COUNT(*) AS repeatBuyers FROM (
        SELECT lower(customer_email) FROM orders
        WHERE event_slug IN (${marks}) AND status IN (${paidStatuses}) AND COALESCE(paid_at, created_at) >= ?
        GROUP BY lower(customer_email) HAVING COUNT(*) > 1
      )
    `).bind(...orderBindings).first<{ repeatBuyers: number }>(),
  ]);

  const overview = {
    eventViews: number(product?.eventViews), checkoutViews: number(product?.checkoutViews), checkoutStarts: number(product?.checkoutStarts),
    paymentAttempts: number(product?.paymentAttempts), paymentsConfirmed: number(product?.paymentsConfirmed), paymentFailed: number(product?.paymentFailed), shares: number(product?.shares),
    paidOrders: number(orders?.paidOrders), revenueMinor: number(orders?.revenueMinor), faceValueMinor: number(orders?.faceValueMinor),
    bookingFeesMinor: number(orders?.bookingFeesMinor), refundsMinor: number(orders?.refundsMinor), averageOrderValueMinor: number(orders?.averageOrderValueMinor),
    admissions: number(admissions?.admissions), checkedIn: number(admissions?.checkedIn), uniqueBuyers: number(orders?.uniqueBuyers), repeatBuyers: number(repeatBuyers?.repeatBuyers),
  };

  let comparison: Record<string, number> | null = null;
  if (window.previousStart && window.previousEnd) {
    const [previousOrders, previousProduct] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) AS paidOrders, COALESCE(SUM(total_amount_minor), 0) AS revenueMinor FROM orders
        WHERE event_slug IN (${marks}) AND status IN (${paidStatuses}) AND COALESCE(paid_at, created_at) >= ? AND COALESCE(paid_at, created_at) < ?`)
        .bind(...slugs, window.previousStart, window.previousEnd).first<Record<string, unknown>>(),
      env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN metric = 'event_view' THEN count ELSE 0 END), 0) AS eventViews FROM product_metrics_daily
        WHERE event_slug IN (${marks}) AND day >= ? AND day < ?`)
        .bind(...slugs, window.previousStart.slice(0, 10), window.previousEnd.slice(0, 10)).first<Record<string, unknown>>(),
    ]);
    comparison = { paidOrders: number(previousOrders?.paidOrders), revenueMinor: number(previousOrders?.revenueMinor), eventViews: number(previousProduct?.eventViews) };
  }

  const data = {
    events: events.results,
    scope: { eventSlug: requestedSlug, label, range: window.range, rangeLabel },
    overview,
    comparison,
    salesTrend: salesTrend.results,
    journeyTrend: journeyTrend.results,
    ticketTiers: ticketTiers.results,
    paymentMethods: paymentMethods.results,
    promoters: promoters.results,
    checkIns: checkIns.results,
    vipUsage: vipUsage.results,
  };
  if (url.searchParams.get("format") === "csv") {
    return new Response(analyticsCsv(data), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="becore-organiser-${requestedSlug}-${window.range}.csv"`,
        "cache-control": "no-store, private",
      },
    });
  }
  return Response.json(data, { headers: { "cache-control": "no-store, private" } });
}
