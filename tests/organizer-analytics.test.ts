import { recordProductMetric } from '../lib/product-analytics';
import { GET as readWorkspace } from '../app/api/organizer/workspace/route';
import { readHostSummary } from '../lib/host-summary';
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { enforceAnalyticsReadLimit, GET as readAnalytics } from "../app/api/organizer/analytics/route";
import { adminCookieHeader, createPasswordRecord, createStaffSession } from "../lib/admin-session";
import { POST as recordVisit } from "../app/api/analytics/route";
import { PASSWORD_ITERATIONS } from "../lib/staff-password-policy";

const passwordRecord = {
  password: "CorrectHorse9Battery",
  passwordProof: "XTlKa_gLf3KD0M8mv-ZrlYn-p7YiT-JYfq52B4UNCVI",
  passwordSalt: "AAECAwQFBgcICQoLDA0ODw",
  passwordIterations: PASSWORD_ITERATIONS,
};

async function organizer(suffix: string) {
  const id = `analytics-organizer-${suffix}`;
  const email = `${id}@example.com`;
  const now = new Date().toISOString();
  const record = await createPasswordRecord(passwordRecord);
  await env.DB.prepare(`INSERT INTO staff_accounts (
    id, normalized_email, display_name, role, password_hash, password_salt, password_iterations,
    must_change_password, status, failed_login_count, password_changed_at, created_at, created_by, updated_at
  ) VALUES (?, ?, 'Analytics Organiser', 'organizer', ?, ?, ?, 0, 'active', 0, ?, ?, 'test', ?)`)
    .bind(id, email, record.hash, record.salt, record.iterations, now, now, now).run();
  const token = await createStaffSession(env.DB, { id });
  return { id, email, cookie: adminCookieHeader(token).split(";")[0] };
}

async function seedNight(slug: string, title: string) {
  const now = new Date().toISOString();
  const startsAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const endsAt = new Date(Date.parse(startsAt) + 18_000_000).toISOString();
  await env.DB.prepare(`INSERT INTO curated_event_records (
    id, submission_id, slug, title, venue, venue_map_url, area, starts_at, ends_at, vibe,
    price_from_minor, capacity, sales_open_at, sales_close_at, age_restriction, lineup,
    event_state, image_url, curation_note, status, published_at, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 'Analytics Venue', 'https://maps.google.com/analytics', 'Accra', ?, ?,
    'Alté', 10000, 300, ?, ?, '18+', 'Analytics line-up', 'on_sale',
    'https://example.com/analytics.jpg', 'A production-shaped analytics test event.', 'published', ?, ?, ?)`)
    .bind(`event-${slug}`, `submission-${slug}`, slug, title, startsAt, endsAt, now, startsAt, now, now, now).run();
}

describe("organiser analytics", () => {
  it("returns complete first-party analytics only for assigned Nights and exports aggregate CSV", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const account = await organizer(suffix);
    const outsider = await organizer(`outsider-${suffix}`);
    const slug = `analytics-${suffix}`;
    const otherSlug = `private-${suffix}`;
    const tierId = `tier-${suffix}`;
    const now = new Date().toISOString();
    await seedNight(slug, "Analytics Night");
    await seedNight(otherSlug, "Private Night");
    await env.DB.batch([
      env.DB.prepare("INSERT INTO staff_event_assignments (account_id, event_slug, assigned_by, assigned_at) VALUES (?, ?, 'test', ?)").bind(account.id, slug, now),
      env.DB.prepare(`INSERT INTO event_ticket_tiers (id, event_slug, code, name, description, price_minor, admissions_per_unit, capacity_admissions, max_units_per_order, status, sort_order, created_at, updated_at)
        VALUES (?, ?, 'general', '=General Admission', 'General entry', 12000, 1, 200, 10, 'available', 0, ?, ?)`).bind(tierId, slug, now, now),
      env.DB.prepare("INSERT INTO event_promoter_codes (id, event_slug, code, label, status, created_at, created_by) VALUES (?, ?, 'NANA', '@Nana street team', 'active', ?, 'test')").bind(`promoter-${suffix}`, slug, now),
      env.DB.prepare(`INSERT INTO orders (id, reference, event_slug, ticket_type, quantity, face_amount_minor, booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, customer_name, payment_channel, status, ticket_tier_id, unit_quantity, promoter_code, refunded_amount_minor, created_at, paid_at)
        VALUES (?, ?, ?, 'general', 2, 24000, 2000, 26000, 'GHS', 'repeat@example.com', '233000000001', 'Repeat Guest', 'mobile_money:mtn', 'paid', ?, 2, 'NANA', 0, ?, ?)`)
        .bind(`order-a-${suffix}`, `BCT-A-${suffix}`, slug, tierId, now, now),
      env.DB.prepare(`INSERT INTO orders (id, reference, event_slug, ticket_type, quantity, face_amount_minor, booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, customer_name, payment_channel, status, ticket_tier_id, unit_quantity, refunded_amount_minor, created_at, paid_at)
        VALUES (?, ?, ?, 'general', 1, 12000, 1000, 13000, 'GHS', 'repeat@example.com', '233000000001', 'Repeat Guest', 'card', 'refunded', ?, 1, 3000, ?, ?)`)
        .bind(`order-b-${suffix}`, `BCT-B-${suffix}`, slug, tierId, now, now),
      env.DB.prepare(`INSERT INTO orders (id, reference, event_slug, ticket_type, quantity, face_amount_minor, booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, payment_channel, status, refunded_amount_minor, created_at, paid_at)
        VALUES (?, ?, ?, 'general', 9, 90000, 0, 90000, 'GHS', 'private@example.com', '233000000002', 'card', 'paid', 0, ?, ?)`)
        .bind(`order-private-${suffix}`, `BCT-P-${suffix}`, otherSlug, now, now),
      env.DB.prepare("INSERT INTO tickets (id, order_id, event_slug, ticket_type, admission_number, qr_token_hash, status, issued_at, checked_in_at) VALUES (?, ?, ?, 'general', 1, ?, 'checked_in', ?, ?)")
        .bind(`ticket-a1-${suffix}`, `order-a-${suffix}`, slug, `qr-a1-${suffix}`, now, now),
      env.DB.prepare("INSERT INTO tickets (id, order_id, event_slug, ticket_type, admission_number, qr_token_hash, status, issued_at) VALUES (?, ?, ?, 'general', 2, ?, 'issued', ?)")
        .bind(`ticket-a2-${suffix}`, `order-a-${suffix}`, slug, `qr-a2-${suffix}`, now),
      env.DB.prepare("INSERT INTO tickets (id, order_id, event_slug, ticket_type, admission_number, qr_token_hash, status, issued_at, checked_in_at) VALUES (?, ?, ?, 'general', 1, ?, 'checked_in', ?, ?)")
        .bind(`ticket-b1-${suffix}`, `order-b-${suffix}`, slug, `qr-b1-${suffix}`, now, now),
      env.DB.prepare("INSERT INTO attendee_profiles (id, normalized_email, display_name, email_verified_at, status, created_at, updated_at) VALUES (?, 'vip@example.com', 'VIP Guest', ?, 'active', ?, ?)")
        .bind(`attendee-${suffix}`, now, now, now),
      env.DB.prepare("INSERT INTO vip_concierge_requests (id, event_slug, attendee_id, ticket_id, kind, detail, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'bottle_service', 'Table bottle', 'confirmed', ?, ?)")
        .bind(`vip-${suffix}`, slug, `attendee-${suffix}`, `ticket-a1-${suffix}`, now, now),
    ]);
    for (const [metric, count] of [["rsvp_view", 11], ["event_view", 20], ["checkout_view", 12], ["checkout_started", 8], ["payment_attempted", 4], ["payment_confirmed", 2], ["payment_failed", 1], ["share_started", 3]] as const) {
      await env.DB.prepare("INSERT INTO product_metrics_daily (day, event_slug, metric, count, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(now.slice(0, 10), slug, metric, count, now).run();
    }

    await env.DB.prepare(`INSERT INTO orders (id, reference, event_slug, ticket_type, quantity, face_amount_minor, booking_fee_minor, total_amount_minor, currency, customer_email, customer_phone, payment_channel, payment_provider, status, created_at, paid_at)
      VALUES (?, ?, ?, 'RSVP', 5, 0, 0, 0, 'GHS', 'free@example.com', '', 'rsvp', 'rsvp', 'paid', ?, ?)`)
      .bind(`free-${suffix}`, `FREE-${suffix}`, slug, now, now).run();
    await env.DB.prepare(`INSERT INTO event_registrations (id,event_slug,normalized_email,guest_name,party_size,kind,status,created_at,updated_at,order_id)
      VALUES (?,?, 'free@example.com','RSVP Guest',5,'rsvp','confirmed',?,?,?)`).bind(`reg-${suffix}`,slug,now,now,`free-${suffix}`).run();
    const response = await readAnalytics(new Request(`https://tickets.becoreops.com/api/organizer/analytics?eventSlug=${slug}&range=30`, { headers: { cookie: account.cookie } }));
    expect(response.status).toBe(200);
    const data = await response.json() as {
      events: Array<{ slug: string; title: string }>;
      rsvp: { totals: { confirmedGuests: number } };
      overview: Record<string, number>;
      salesTrend: Array<{ day: string }>;
      ticketTiers: Array<Record<string, unknown>>;
      promoters: Array<Record<string, unknown>>;
      vipUsage: Array<Record<string, unknown>>;
    };
    expect(data.overview).toMatchObject({ rsvpViews: 11, eventViews: 20, checkoutStarts: 8, paymentAttempts: 4, paymentsConfirmed: 2, paidOrders: 2, revenueMinor: 39000, refundsMinor: 3000, admissions: 3, checkedIn: 2, uniqueBuyers: 1, repeatBuyers: 1 });
    expect(data.rsvp.totals.confirmedGuests).toBe(5);
    expect(data.events.map((event) => event.slug)).toEqual([slug]);
    expect(data.ticketTiers).toEqual([expect.objectContaining({ name: "=General Admission", orders: 2, admissions: 3, revenueMinor: 39000 })]);
    expect(data.promoters).toEqual(expect.arrayContaining([expect.objectContaining({ code: "NANA", orders: 1 }), expect.objectContaining({ code: "direct", orders: 1 })]));
    expect(data.vipUsage).toEqual([expect.objectContaining({ kind: "bottle_service", status: "confirmed", count: 1 })]);
    expect(JSON.stringify(data)).not.toContain("Private Night");
    expect(JSON.stringify(data)).not.toContain("private@example.com");

    const denied = await readAnalytics(new Request(`https://tickets.becoreops.com/api/organizer/analytics?eventSlug=${slug}`, { headers: { cookie: outsider.cookie } }));
    expect(denied.status).toBe(403);
    expect(denied.headers.get("cache-control")).toContain("no-store");
    const deniedAudit = await env.DB.prepare("SELECT outcome, detail FROM operational_audit_events WHERE actor_account_id = ? AND action = 'organizer.analytics_access_denied' ORDER BY created_at DESC LIMIT 1")
      .bind(outsider.id).first<{ outcome: string; detail: string }>();
    expect(deniedAudit).toMatchObject({ outcome: "denied", detail: "event_not_assigned" });

    const allTime = await readAnalytics(new Request(`https://tickets.becoreops.com/api/organizer/analytics?eventSlug=${slug}&range=all`, { headers: { cookie: account.cookie } }));
    const allTimeData = await allTime.json() as { salesTrend: Array<{ day: string }>; journeyTrend: Array<{ day: string }> };
    expect(allTimeData.salesTrend[0].day).toMatch(/^\d{4}-\d{2}-01$/u);
    expect(allTimeData.journeyTrend[0].day).toMatch(/^\d{4}-\d{2}-01$/u);

    const csv = await readAnalytics(new Request(`https://tickets.becoreops.com/api/organizer/analytics?eventSlug=${slug}&range=30&format=csv`, { headers: { cookie: account.cookie } }));
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const exportText = await csv.text();
    expect(exportText).toContain("Analytics Night");
    expect(exportText).toContain("Confirmed guests,5");
    expect(exportText).toContain('"\t=General Admission"');
    expect(exportText).toContain('"\t@Nana street team"');
    expect(exportText).not.toContain("repeat@example.com");
    const exportAudit = await env.DB.prepare("SELECT outcome, target_id AS targetId, detail FROM operational_audit_events WHERE actor_account_id = ? AND action = 'organizer.analytics_exported' ORDER BY created_at DESC LIMIT 1")
      .bind(account.id).first<{ outcome: string; targetId: string; detail: string }>();
    expect(exportAudit).toMatchObject({ outcome: "success", targetId: slug, detail: "range=30;events=1" });

    // Identical promoter codes belong to distinct Nights, not one combined promoter.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES(?,?,'test',?)").bind(account.id,otherSlug,now),
      env.DB.prepare("UPDATE orders SET promoter_code='NANA' WHERE id=?").bind(`order-private-${suffix}`),
      env.DB.prepare("INSERT INTO event_promoter_codes(id,event_slug,code,label,status,created_at,created_by) VALUES(?,?,'NANA','Other team','active',?,'test')").bind(`other-promoter-${suffix}`,otherSlug,now),
    ]);
    const combined = await (await readAnalytics(new Request('https://tickets.becoreops.com/api/organizer/analytics?range=all', {headers:{cookie:account.cookie}}))).json() as {promoters:Array<{eventSlug:string;code:string;orders:number}>};
    expect(combined.promoters.filter(row=>row.code==='NANA')).toEqual(expect.arrayContaining([expect.objectContaining({eventSlug:slug,orders:1}),expect.objectContaining({eventSlug:otherSlug,orders:1})]));
    await env.DB.prepare("UPDATE curated_event_records SET removed_at=? WHERE slug=?").bind(now,otherSlug).run();
    const active = await (await readAnalytics(new Request('https://tickets.becoreops.com/api/organizer/analytics?range=all', {headers:{cookie:account.cookie}}))).json() as {events:Array<{slug:string}>;overview:{paidOrders:number}};
    expect(active.events.map(row=>row.slug)).toEqual([slug]);expect(active.overview.paidOrders).toBe(2);
    expect((await readAnalytics(new Request(`https://tickets.becoreops.com/api/organizer/analytics?eventSlug=${otherSlug}`,{headers:{cookie:account.cookie}}))).status).toBe(403);

    await env.DB.prepare("DELETE FROM staff_event_assignments WHERE account_id = ? AND event_slug = ?").bind(account.id, slug).run();
    const revoked = await readAnalytics(new Request(`https://tickets.becoreops.com/api/organizer/analytics?eventSlug=${slug}`, { headers: { cookie: account.cookie } }));
    expect(revoked.status).toBe(403);

    await env.DB.prepare("UPDATE staff_accounts SET status = 'disabled' WHERE id = ?").bind(outsider.id).run();
    const disabled = await readAnalytics(new Request("https://tickets.becoreops.com/api/organizer/analytics", { headers: { cookie: outsider.cookie } }));
    expect(disabled.status).toBe(403);
    expect(disabled.headers.get("cache-control")).toContain("no-store");
  });

  it("uses a dedicated per-account read limit key", async () => {
    const keys: string[] = [];
    const allowed = await enforceAnalyticsReadLimit({
      limit: async ({ key }) => {
        keys.push(key);
        return { success: false };
      },
    }, "organizer-123");

    expect(allowed).toBe(false);
    expect(keys).toEqual(["organizer-analytics:organizer-123"]);
  });
});

it('counts direct RSVP visits only for published, non-removed events and rejects forged payment metrics',async()=>{
 const slug=`visits-${crypto.randomUUID().slice(0,8)}`;await seedNight(slug,'Visit tracking');
 const request=(metric:string,eventSlug=slug)=>new Request('https://tickets.becoreops.com/api/analytics',{method:'POST',headers:{origin:'https://tickets.becoreops.com','content-type':'application/json'},body:JSON.stringify({metric,eventSlug})});
 await recordVisit(request('rsvp_view'));await recordVisit(request('payment_confirmed'));await recordVisit(request('rsvp_view','does-not-exist'));
 await env.DB.prepare("UPDATE curated_event_records SET removed_at=? WHERE slug=?").bind(new Date().toISOString(),slug).run();
 await recordVisit(request('rsvp_view'));
 const rows=await env.DB.prepare('SELECT metric,count FROM product_metrics_daily WHERE event_slug=?').bind(slug).all();
 expect(rows.results).toEqual([{metric:'rsvp_view',count:1}]);
 expect(await env.DB.prepare("SELECT count FROM product_metrics_daily WHERE event_slug='does-not-exist'").first()).toBeNull();
});


it('resets every analytics cohort once while preserving bookings and excluding automated visits',async()=>{
  const suffix=crypto.randomUUID(),slug=`reset-${suffix}`,now=new Date().toISOString();
  const old=new Date(Date.now()-60000).toISOString(),baseline=new Date(Date.now()-30000).toISOString();
  const account=await organizer(suffix);await seedNight(slug,'Clean analytics');
  await env.DB.prepare("INSERT INTO staff_event_assignments(account_id,event_slug,assigned_by,assigned_at) VALUES(?,?,'test',?)").bind(account.id,slug,now).run();
  for(const [label,at] of [['old',old],['new',now]]) {
    const id=`${slug}-${label}`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO orders(id,reference,event_slug,quantity,face_amount_minor,booking_fee_minor,total_amount_minor,currency,customer_email,customer_phone,payment_channel,status,payment_provider,created_at,paid_at) VALUES(?,?,?,1,10000,1000,11000,'GHS',?,'233000000000','card','paid','seevplus',?,?)").bind(id,id,slug,`${id}@example.com`,at,at),
      env.DB.prepare("INSERT INTO tickets(id,order_id,event_slug,ticket_type,qr_token_hash,status,issued_at) VALUES(?,?,?,'general',?,'issued',?)").bind(id,id,slug,id,at),
      env.DB.prepare("INSERT INTO event_registrations(id,event_slug,normalized_email,guest_name,party_size,kind,status,created_at,updated_at,acquisition_source) VALUES(?,?,?,'Guest',1,'rsvp','requested',?,?,'instagram')").bind(id,slug,`${id}@example.com`,at,at),
    ]);
  }
  await recordProductMetric(env.DB,'event_view',slug,new Date(old));
  try {
    await env.DB.prepare('INSERT INTO analytics_baseline(id,reset_key,started_at) VALUES(1,?,?)').bind(slug,baseline).run();
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM product_metrics_daily').first()).toEqual({n:0});
    await recordProductMetric(env.DB,'event_view',slug,new Date(old));
    await recordProductMetric(env.DB,'event_view',slug);
    await env.DB.prepare('INSERT OR IGNORE INTO analytics_baseline(id,reset_key,started_at) VALUES(1,?,?)').bind(slug,now).run();
    const request=new Request(`https://tickets.becoreops.com/api/organizer/analytics?eventSlug=${slug}&range=all`,{headers:{cookie:account.cookie}});
    const result=await (await readAnalytics(request)).json() as {scope:{baseline:string};overview:{paidOrders:number;revenueMinor:number;eventViews:number;admissions:number};rsvp:{totals:{requests:number}};salesTrend:unknown[];comparison:unknown};
    expect(result.scope.baseline).toBe(baseline);expect(result.overview).toMatchObject({paidOrders:1,revenueMinor:11000,eventViews:1,admissions:1});expect(result.rsvp.totals.requests).toBe(1);
    expect(result.comparison).toBeNull();
    const summary=await readHostSummary(env.DB,slug);expect(summary).toMatchObject({baseline,sales:{orders:1},pending:2});
    expect(summary?.rsvp.totals.requests).toBe(1);
    const workspace=await (await readWorkspace(new Request('https://tickets.becoreops.com/api/organizer/workspace',{headers:{cookie:account.cookie}}))).json() as {events:Array<{slug:string;analyticsBaseline:string;paidOrders:number;grossMinor:number;issuedAdmissions:number}>};
    expect(workspace.events.find(event=>event.slug===slug)).toMatchObject({analyticsBaseline:baseline,paidOrders:1,grossMinor:11000,issuedAdmissions:2});
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM orders WHERE event_slug=?').bind(slug).first()).toEqual({n:2});
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM tickets WHERE event_slug=?').bind(slug).first()).toEqual({n:2});
    for(const headers of ([{'x-becore-analytics':'exclude'},{'user-agent':'HeadlessChrome/150'}] as Array<Record<string,string>>)) {
      expect((await recordVisit(new Request('https://tickets.becoreops.com/api/analytics',{method:'POST',headers:{origin:'https://tickets.becoreops.com','content-type':'application/json',...headers},body:JSON.stringify({metric:'event_view',eventSlug:slug})}))).status).toBe(204);
    }
    expect(await env.DB.prepare('SELECT count FROM product_metrics_daily WHERE event_slug=?').bind(slug).first()).toEqual({count:1});
    const csv=await (await readAnalytics(new Request(`${request.url}&format=csv`,{headers:{cookie:account.cookie}}))).text();expect(csv).toContain(`Analytics start (UTC),${baseline}`);
  } finally { await env.DB.prepare('DELETE FROM analytics_baseline WHERE id=1').run(); }
});
