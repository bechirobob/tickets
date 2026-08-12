import { hasPermission, mutationHasValidOrigin, readAdminSession, recordAudit, requestMetadata } from "../../../../lib/admin-session";
import { createApprovalRequest, createPayoutAccount, decideApproval, requestMassRefund, requestPayout } from "../../../../lib/operational-finance";

const readiness = [
  ["inventory", "Inventory and sales window verified"],
  ["venue", "Venue, entrance and access notes confirmed"],
  ["staff", "Named event staff and shifts assigned"],
  ["gates", "Scanner devices charged and synchronised"],
  ["comms", "Customer update and escalation copy ready"],
  ["emergency", "Emergency contact and Room lock tested"],
  ["finance", "Reconciliation and refund owner confirmed"],
  ["rehearsal", "Full event rehearsal passed"],
] as const;

async function seedReadiness(db: D1Database, eventSlugs: string[]) {
  const statements = eventSlugs.flatMap((slug) => readiness.map(([key, label]) => db.prepare("INSERT OR IGNORE INTO event_readiness_checks (event_slug, check_key, label, status) VALUES (?, ?, ?, 'pending')").bind(slug, key, label)));
  if (statements.length) await db.batch(statements);
}

export async function GET(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (!session || !hasPermission(session, "operations.view")) return Response.json({ error: "Event operations access is required." }, { status: 403 });
  const events = await env.DB.prepare("SELECT slug, title, venue, starts_at AS startsAt, event_state AS eventState FROM curated_event_records ORDER BY starts_at DESC LIMIT 100")
    .all<{ slug: string; title: string; venue: string; startsAt: string; eventState: string }>();
  await seedReadiness(env.DB, events.results.map((event) => event.slug));
  const [metrics, checks, devices, incidents, alerts, approvals] = await Promise.all([
    env.DB.prepare(`
      SELECT event.slug, event.title, event.event_state AS eventState,
        (SELECT COUNT(*) FROM orders WHERE event_slug = event.slug AND status IN ('paid','refund_pending','refunded','disputed')) AS paidOrders,
        (SELECT COALESCE(SUM(total_amount_minor),0) FROM orders WHERE event_slug = event.slug AND status IN ('paid','refund_pending','refunded','disputed')) AS grossMinor,
        (SELECT COUNT(*) FROM tickets WHERE event_slug = event.slug AND status IN ('issued','checked_in')) AS activeTickets,
        (SELECT COUNT(*) FROM tickets WHERE event_slug = event.slug AND status = 'checked_in') AS checkedIn,
        (SELECT COUNT(*) FROM support_cases WHERE event_slug = event.slug AND status NOT IN ('resolved','closed')) AS openSupport,
        (SELECT COUNT(*) FROM room_reports WHERE event_slug = event.slug AND status = 'open') + (SELECT COUNT(*) FROM room_flash_reports WHERE event_slug = event.slug AND status = 'open') AS roomReports,
        (SELECT COUNT(*) FROM operational_incidents WHERE event_slug = event.slug AND status != 'resolved') AS openIncidents,
        (SELECT COUNT(*) FROM gate_devices WHERE event_slug = event.slug AND last_seen_at > datetime('now','-2 minutes')) AS activeDevices,
        (SELECT COALESCE(SUM(pending_offline_scans),0) FROM gate_devices WHERE event_slug = event.slug AND last_seen_at > datetime('now','-30 minutes')) AS pendingOffline,
        (SELECT MAX(created_at) FROM gate_checkin_events WHERE event_slug = event.slug) AS lastEntryAt
      FROM curated_event_records event ORDER BY event.starts_at DESC
    `).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT event_slug AS eventSlug, check_key AS checkKey, label, status, note, checked_by AS checkedBy, checked_at AS checkedAt FROM event_readiness_checks ORDER BY event_slug, check_key").all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, event_slug AS eventSlug, gate, account_email AS accountEmail, pending_offline_scans AS pendingOfflineScans, manifest_generated_at AS manifestGeneratedAt, last_sync_at AS lastSyncAt, last_seen_at AS lastSeenAt FROM gate_devices ORDER BY last_seen_at DESC LIMIT 100").all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM operational_incidents WHERE status != 'resolved' ORDER BY created_at DESC LIMIT 100").all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM system_alerts WHERE status != 'resolved' ORDER BY created_at DESC LIMIT 100").all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM approval_requests WHERE status IN ('pending','executing','failed') ORDER BY requested_at DESC LIMIT 100").all<Record<string, unknown>>(),
  ]);
  return Response.json({ events: events.results, metrics: metrics.results, checks: checks.results, devices: devices.results, incidents: incidents.results, alerts: alerts.results, approvals: approvals.results, role: session.role }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const session = await readAdminSession(request.headers.get("cookie"), env.DB);
  if (!session || !hasPermission(session, "operations.view")) return Response.json({ error: "Event operations access is required." }, { status: 403 });
  if (!mutationHasValidOrigin(request)) return Response.json({ error: "This request was not accepted." }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? "");
  const eventSlug = String(body.eventSlug ?? "");
  const requestId = requestMetadata(request).requestId;
  try {
    if (action === "readiness") {
      const status = ["pending", "passed", "blocked"].includes(String(body.status)) ? String(body.status) : "pending";
      await env.DB.prepare("UPDATE event_readiness_checks SET status = ?, note = ?, checked_by = ?, checked_at = ? WHERE event_slug = ? AND check_key = ?")
        .bind(status, String(body.note ?? "").slice(0, 500) || null, session.email, new Date().toISOString(), eventSlug, String(body.checkKey ?? "")).run();
    } else if (action === "incident_create") {
      const title = String(body.title ?? "").trim().slice(0, 160);
      const detail = String(body.detail ?? "").trim().slice(0, 2000);
      if (!title || !detail) throw new Error("Add a short incident title and exact detail.");
      await env.DB.prepare("INSERT INTO operational_incidents (id, event_slug, severity, title, detail, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)")
        .bind(crypto.randomUUID(), eventSlug, ["info", "warning", "critical"].includes(String(body.severity)) ? body.severity : "warning", title, detail, session.email, new Date().toISOString()).run();
    } else if (action === "incident_status") {
      const status = ["open", "monitoring", "resolved"].includes(String(body.status)) ? String(body.status) : "open";
      await env.DB.prepare("UPDATE operational_incidents SET status = ?, resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END, resolved_by = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END WHERE id = ?")
        .bind(status, status, new Date().toISOString(), status, session.email, String(body.id ?? "")).run();
    } else if (action === "alert_status") {
      const status = ["open", "acknowledged", "resolved"].includes(String(body.status)) ? String(body.status) : "acknowledged";
      await env.DB.prepare("UPDATE system_alerts SET status = ?, resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE resolved_at END, resolved_by = CASE WHEN ? = 'resolved' THEN ? ELSE resolved_by END WHERE id = ?")
        .bind(status, status, new Date().toISOString(), status, session.email, String(body.id ?? "")).run();
    } else if (action === "run_rehearsal") {
      const rehearsal = await env.DB.prepare(`
        SELECT
          EXISTS(SELECT 1 FROM curated_event_records WHERE slug = ? AND event_state NOT IN ('cancelled','past')) AS eventReady,
          EXISTS(SELECT 1 FROM event_ticket_tiers WHERE event_slug = ? AND status != 'hidden' AND capacity_admissions > 0) AS inventoryReady,
          EXISTS(SELECT 1 FROM staff_event_assignments WHERE event_slug = ?) AS staffReady,
          EXISTS(SELECT 1 FROM staff_accounts account JOIN staff_event_assignments assignment ON assignment.account_id = account.id WHERE assignment.event_slug = ? AND account.status = 'active') AS accessReady
      `).bind(eventSlug, eventSlug, eventSlug, eventSlug).first<{ eventReady: number; inventoryReady: number; staffReady: number; accessReady: number }>();
      const missing = Object.entries({ event: rehearsal?.eventReady, inventory: rehearsal?.inventoryReady, staff: rehearsal?.staffReady, access: rehearsal?.accessReady }).filter(([, value]) => !value).map(([key]) => key);
      const resultStatus = missing.length ? "blocked" : "passed";
      const note = missing.length ? `Missing: ${missing.join(", ")}.` : "Event record, sellable inventory, named staff and staff access all passed.";
      await env.DB.prepare("UPDATE event_readiness_checks SET status = ?, note = ?, checked_by = ?, checked_at = ? WHERE event_slug = ? AND check_key = 'rehearsal'")
        .bind(resultStatus, note, session.email, new Date().toISOString(), eventSlug).run();
      await recordAudit(env.DB, { session, action: "operations.run_rehearsal", targetType: "event", targetId: eventSlug, outcome: resultStatus === "passed" ? "success" : "failed", detail: note, requestId });
      return Response.json({ status: resultStatus, note });
    } else if (action === "request_cancellation") {
      if (!hasPermission(session, "events.manage")) throw new Error("Event management access is required.");
      return Response.json(await createApprovalRequest(env.DB, session, { kind: "event_cancellation", eventSlug, payload: { reason: String(body.reason ?? "").slice(0, 500) } }), { status: 201 });
    } else if (action === "request_mass_refund") {
      if (!hasPermission(session, "orders.manage")) throw new Error("Finance access is required.");
      return Response.json(await requestMassRefund(env.DB, session, eventSlug, String(body.reason ?? "")), { status: 201 });
    } else if (action === "payout_account") {
      if (!hasPermission(session, "orders.manage")) throw new Error("Finance access is required.");
      return Response.json(await createPayoutAccount(env, session, { eventSlug, accountName: String(body.accountName ?? ""), recipientType: body.recipientType === "mobile_money" ? "mobile_money" : "ghipss", bankCode: String(body.bankCode ?? ""), accountNumber: String(body.accountNumber ?? "") }), { status: 201 });
    } else if (action === "request_payout") {
      if (!hasPermission(session, "orders.manage")) throw new Error("Finance access is required.");
      return Response.json(await requestPayout(env.DB, session, { settlementId: String(body.settlementId ?? ""), payoutAccountId: String(body.payoutAccountId ?? ""), amountMinor: body.amountMinor ? Number(body.amountMinor) : undefined }), { status: 201 });
    } else if (action === "approval") {
      if (!hasPermission(session, "orders.manage") && !hasPermission(session, "events.manage")) throw new Error("Approval access is required.");
      return Response.json(await decideApproval(env, session, { approvalId: String(body.approvalId ?? ""), decision: body.decision === "reject" ? "reject" : "approve", note: String(body.note ?? "") }));
    } else throw new Error("Choose a valid operations action.");
    await recordAudit(env.DB, { session, action: `operations.${action}`, targetType: "event", targetId: eventSlug || String(body.id ?? ""), outcome: "success", requestId });
    return Response.json({ saved: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The operation failed." }, { status: 400 });
  }
}
