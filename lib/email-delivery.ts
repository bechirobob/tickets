import { createSecureToken, hashToken } from "./attendee-auth";

type DeliveryKind = "organizer_signup" | "registration_access" | "registration_update" | "event_announcement" | "payment_confirmation" | "ticket_recovery" | "ticket_transfer" | "waitlist_offer" | "payment_recovery" | "support_update" | "operational_alert";

type OrderForEmail = {
  id: string;
  reference: string;
  eventSlug: string;
  customerEmail: string;
  customerName: string | null;
  faceAmountMinor: number;
  bookingFeeMinor: number;
  totalAmountMinor: number;
  currency: string;
  quantity: number;
  paidAt: string | null;
};

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}

function quotaRetryAt(response:Response,name?:string) {
  if(name==='daily_quota_exceeded') {const next=new Date();next.setUTCDate(next.getUTCDate()+1);next.setUTCHours(0,1,0,0);return next.toISOString();}
  if(name==='monthly_quota_exceeded')return new Date(Date.now()+86400000).toISOString();
  const seconds=Number(response.headers.get('retry-after'));
  return new Date(Date.now()+Math.max(60,Number.isFinite(seconds)?Math.min(seconds,86400):60)*1000).toISOString();
}

export async function sendEmail(input: {
  db: D1Database;
  kind: DeliveryKind;
  recipient: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  orderId?: string;
  recoveryGrantId?: string;
  deliveryId?: string;
}) {
  const { env } = await import("cloudflare:workers");
  const deliveryId = input.deliveryId ?? (input.kind === "payment_confirmation" && input.orderId ? `payment-confirmation/${input.orderId}` : crypto.randomUUID());
  const now = new Date().toISOString();
  const inserted = await input.db.prepare(`
    INSERT OR IGNORE INTO delivery_events (
      id, order_id, recovery_grant_id, kind, recipient, status, attempt_count,
      payload_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)
  `).bind(
    deliveryId, input.orderId ?? null, input.recoveryGrantId ?? null, input.kind, input.recipient,
    JSON.stringify({ subject: input.subject, html: input.html, text: input.text, idempotencyKey: input.idempotencyKey }), now, now,
  ).run();

  if (!inserted.meta.changes) return {sent:false,reason:'already_queued' as const};
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    await input.db.prepare("UPDATE delivery_events SET status = 'failed', failure_reason = ?, attempt_count = 1, updated_at = ? WHERE id = ?")
      .bind("Transactional email is not configured.", now, deliveryId).run();
    return { sent: false, reason: "not_configured" as const };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [input.recipient], subject: input.subject, html: input.html, text: input.text }),
    });
    const result = await response.json() as { id?: string; name?: string; message?: string; error?: { message?: string } };
    if(response.status===429 && ['event_announcement','organizer_signup'].includes(input.kind)) {
      await input.db.prepare("UPDATE delivery_events SET status='failed',attempt_count=0,next_attempt_at=?,failure_reason=?,updated_at=? WHERE id=?").bind(quotaRetryAt(response,result.name),result.message??'Email provider quota reached.',now,deliveryId).run();
      return {sent:false,reason:'provider_quota' as const};
    }
    if (!response.ok || !result.id) throw new Error(result.message ?? result.error?.message ?? "Email provider rejected the message.");
    await input.db.prepare("UPDATE delivery_events SET status = 'sent', provider_id = ?, attempt_count = 1, next_attempt_at = NULL, updated_at = ? WHERE id = ?")
      .bind(result.id, new Date().toISOString(), deliveryId).run();
    return { sent: true, providerId: result.id };
  } catch (error) {
    const failedAt = new Date();
    await input.db.prepare("UPDATE delivery_events SET status = 'failed', failure_reason = ?, attempt_count = 1, next_attempt_at = ?, updated_at = ? WHERE id = ?")
      .bind((error instanceof Error ? error.message : String(error)).slice(0, 500), new Date(failedAt.getTime() + 5 * 60 * 1000).toISOString(), failedAt.toISOString(), deliveryId).run();
    return { sent: false, reason: "provider_error" as const };
  }
}

export async function applyDeliveryWebhook(db: D1Database, input: {
  providerId: string;
  type: string;
  eventAt?: string | null;
  detail?: string | null;
}) {
  const statusByType: Record<string, string> = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.delivery_delayed": "delayed",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.suppressed": "suppressed",
    "email.failed": "failed",
  };
  const status = statusByType[input.type];
  if (!status) return { updated: false };
  const now = new Date().toISOString();
  const result = await db.prepare(`
    UPDATE delivery_events SET status = ?, failure_reason = ?, provider_event_at = ?,
      next_attempt_at = CASE WHEN ? = 'failed' AND provider_id IS NULL AND attempt_count < 3
        THEN datetime('now', '+' || (attempt_count * 5) || ' minutes') ELSE NULL END,
      updated_at = ?
    WHERE provider_id = ? AND (provider_event_at IS NULL OR julianday(provider_event_at) <= julianday(?))
      AND status NOT IN ('bounced','complained','suppressed')
      AND (status<>'delivered' OR ? IN ('bounced','complained','suppressed'))
  `).bind(status, input.detail?.slice(0, 500) ?? null, input.eventAt ?? now, status, now, input.providerId,input.eventAt??now,status).run();
  return { updated: result.meta.changes === 1, status };
}

export async function retryFailedDeliveries(env: Cloudflare.Env, limit = 20, scope: 'all' | 'audience' | 'standard' = 'all') {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { attempted: 0, delivered: 0 };
  const scopeSql = scope === 'audience' ? "kind IN ('event_announcement','organizer_signup')" : scope === 'standard' ? "kind NOT IN ('event_announcement','organizer_signup')" : '1=1';
  const due = await env.DB.prepare(`
    SELECT id, recipient, payload_json AS payloadJson, attempt_count AS attemptCount
    FROM delivery_events
    WHERE (${scopeSql}) AND ((status='failed' AND attempt_count < 3 AND next_attempt_at IS NOT NULL AND julianday(next_attempt_at) <= julianday(?)) OR (status='queued' AND julianday(updated_at) < julianday('now','-5 minutes')))
    ORDER BY next_attempt_at LIMIT ?
  `).bind(new Date().toISOString(), limit).all<{ id: string; recipient: string; payloadJson: string | null; attemptCount: number }>();
  let delivered = 0;
  for (const item of due.results) {
    const lease=await env.DB.prepare("UPDATE delivery_events SET status='queued',updated_at=?,next_attempt_at=NULL WHERE id=? AND ((status='failed' AND next_attempt_at IS NOT NULL AND julianday(next_attempt_at)<=julianday('now')) OR (status='queued' AND julianday(updated_at)<julianday('now','-5 minutes'))) ").bind(new Date().toISOString(),item.id).run();
    if (!lease.meta.changes) continue;
    try {
      const payload = JSON.parse(item.payloadJson ?? "{}") as { subject?: string; html?: string; text?: string; idempotencyKey?: string };
      if (!payload.subject || !payload.html || !payload.text || !payload.idempotencyKey) throw new Error("Saved delivery payload is incomplete.");
      if (payload.idempotencyKey.startsWith('event-announcement/')) {
        const [,campaignId,contactId]=payload.idempotencyKey.split('/');
        const allowed=await env.DB.prepare(`SELECT 1 FROM event_audience_contacts a JOIN curated_event_records e ON e.slug=a.event_slug WHERE a.id=? AND a.consented_at IS NOT NULL AND a.consented_at > COALESCE(a.unsubscribed_at,'') AND e.removed_at IS NULL`).bind(contactId).first();
        if(!allowed){await env.DB.batch([
          env.DB.prepare("UPDATE delivery_events SET status='suppressed',next_attempt_at=NULL,updated_at=? WHERE id=?").bind(new Date().toISOString(),item.id),
          env.DB.prepare("UPDATE event_announcement_recipients SET status='skipped' WHERE campaign_id=? AND contact_id=?").bind(campaignId,contactId),
        ]);continue;}
      }
      if(payload.idempotencyKey.startsWith('organizer-signup/')) {
        const [,slug,,accountId]=payload.idempotencyKey.split('/');
        const allowed=await env.DB.prepare(`SELECT 1 FROM staff_event_assignments a JOIN staff_accounts s ON s.id=a.account_id JOIN curated_event_records e ON e.slug=a.event_slug LEFT JOIN event_registration_settings r ON r.event_slug=e.slug WHERE a.account_id=? AND a.event_slug=? AND s.status='active' AND s.role='organizer' AND s.normalized_email=? AND e.removed_at IS NULL AND COALESCE(r.notify_host,1)=1`).bind(accountId,slug,item.recipient).first();
        if(!allowed){await env.DB.prepare("UPDATE delivery_events SET status='suppressed',next_attempt_at=NULL WHERE id=?").bind(item.id).run();continue;}
      }
      if(/^(event-announcement|organizer-signup)\//u.test(payload.idempotencyKey))await new Promise(resolve=>setTimeout(resolve,200));
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": payload.idempotencyKey.slice(0, 256) },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [item.recipient], subject: payload.subject, html: payload.html, text: payload.text }),
      });
      const result = await response.json() as { id?: string; name?:string; message?: string };
      if(response.status===429 && /^(event-announcement|organizer-signup)\//u.test(payload.idempotencyKey)) {
        await env.DB.prepare("UPDATE delivery_events SET status='failed',next_attempt_at=?,failure_reason=?,updated_at=? WHERE id=?").bind(quotaRetryAt(response,result.name),result.message??'Email provider quota reached.',new Date().toISOString(),item.id).run();continue;
      }
      if (!response.ok || !result.id) throw new Error(result.message ?? "Email retry was rejected.");
      await env.DB.prepare("UPDATE delivery_events SET status = 'sent', provider_id = ?, attempt_count = attempt_count + 1, failure_reason = NULL, next_attempt_at = NULL, updated_at = ? WHERE id = ? AND status='queued'")
        .bind(result.id, new Date().toISOString(), item.id).run();
      delivered += 1;
    } catch (error) {
      const nextAttempts = item.attemptCount + 1;
      const nextAt = nextAttempts < 3 ? new Date(Date.now() + nextAttempts * 5 * 60 * 1000).toISOString() : null;
      await env.DB.prepare("UPDATE delivery_events SET status = 'failed', attempt_count = ?, failure_reason = ?, next_attempt_at = ?, updated_at = ? WHERE id = ? AND status='queued'")
        .bind(nextAttempts, (error instanceof Error ? error.message : String(error)).slice(0, 500), nextAt, new Date().toISOString(), item.id).run();
    }
  }
  return { attempted: due.results.length, delivered };
}

export async function sendOperationalAlert(env: Cloudflare.Env, input: { source: string; severity: "warning" | "critical"; message: string; detail?: string | null }) {
  const duplicate = await env.DB.prepare(`
    SELECT id FROM system_alerts
    WHERE source = ? AND message = ? AND status != 'resolved' AND created_at >= datetime('now', '-60 minutes')
    LIMIT 1
  `).bind(input.source, input.message.slice(0, 240)).first<{ id: string }>();
  if (duplicate) return { id: duplicate.id, notified: false, duplicate: true };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO system_alerts (id, source, severity, message, detail, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`)
    .bind(id, input.source, input.severity, input.message.slice(0, 240), input.detail?.slice(0, 2000) ?? null, now).run();
  if (!env.OPS_ALERT_EMAIL) return { id, notified: false };
  const subject = `${input.severity === "critical" ? "Action needed" : "Heads up"}: ${input.message}`;
  const text = `${input.message}\n\nSource: ${input.source}\n${input.detail ?? "No extra detail."}\n\nOpen operations: https://tickets.becoreops.com/admin/operations`;
  const result = await sendEmail({
    db: env.DB,
    kind: "operational_alert",
    recipient: env.OPS_ALERT_EMAIL,
    subject,
    text,
    html: `<div style="max-width:560px;margin:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#181914"><p style="color:#f05a28;font-weight:700">BECORE TICKETS · OPERATIONS</p><h1 style="font-size:25px">${escapeHtml(input.message)}</h1><p><b>${escapeHtml(input.source)}</b></p><p>${escapeHtml(input.detail ?? "No extra detail.")}</p><p><a href="https://tickets.becoreops.com/admin/operations">Open event operations</a></p></div>`,
    idempotencyKey: `ops-alert/${id}`,
  });
  return { id, notified: result.sent };
}

export async function issueRecoveryGrant(input: {
  db: D1Database;
  normalizedEmail: string;
  origin: string;
  kind: DeliveryKind;
  order?: OrderForEmail;
  requestedIp?: string | null;
  ttlMinutes?: number;
}) {
  const token = createSecureToken();
  const grantId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMinutes ?? 20) * 60 * 1000).toISOString();
  const requestedIpHash = input.requestedIp ? await hashToken(input.requestedIp) : null;
  await input.db.prepare(`
    INSERT INTO attendee_recovery_grants (
      id, normalized_email, token_hash, expires_at, created_at, requested_ip_hash
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(grantId, input.normalizedEmail, await hashToken(token), expiresAt, now.toISOString(), requestedIpHash).run();

  const recoveryUrl = `${input.origin}/api/customer/recovery/claim?token=${encodeURIComponent(token)}`;
  const name = input.order?.customerName?.trim() || "there";
  const event = input.order ? await input.db.prepare(`
    SELECT title, venue, area, CASE WHEN schedule_status != 'coming_soon' THEN starts_at END AS startsAt
    FROM curated_event_records WHERE slug = ? LIMIT 1
  `).bind(input.order.eventSlug).first<{ title: string; venue: string; area: string; startsAt: string | null }>() : null;
  const subject = input.kind === "payment_confirmation" && event
    ? `${event.title}: payment confirmed and tickets ready`
    : "Your Nights are ready to come back";
  const receipt = input.order ? `
    <table style="width:100%;border-collapse:collapse;margin:24px 0">
      <tr><td style="padding:8px 0;color:#666">Reference</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(input.order.reference)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Admissions</td><td style="padding:8px 0;text-align:right">${input.order.quantity}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Ticket subtotal</td><td style="padding:8px 0;text-align:right">${money(input.order.faceAmountMinor, input.order.currency)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Booking fee</td><td style="padding:8px 0;text-align:right">${money(input.order.bookingFeeMinor, input.order.currency)}</td></tr>
      <tr><td style="padding:12px 0;border-top:1px solid #ddd;font-weight:700">Total paid</td><td style="padding:12px 0;border-top:1px solid #ddd;text-align:right;font-weight:700">${money(input.order.totalAmountMinor, input.order.currency)}</td></tr>
    </table>` : "";
  const eventBlock = event ? `<p style="font-size:18px"><strong>${escapeHtml(event.title)}</strong><br>${escapeHtml(event.venue)}, ${escapeHtml(event.area)}<br>${escapeHtml(event.startsAt ? new Intl.DateTimeFormat("en-GH", { dateStyle: "full", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(event.startsAt)) : "Coming soon")}</p>` : "";
  const html = `<div style="max-width:560px;margin:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#181914"><p style="color:#f05a28;font-weight:700">BECORE TICKETS</p><h1 style="font-size:28px">${input.kind === "payment_confirmation" ? "Paid. Verified. Your Night is ready." : "Your Nights missed you. Slightly."}</h1><p>Hi ${escapeHtml(name)},</p>${eventBlock}${receipt}<p>This private link opens My Nights on this device and brings together every confirmed purchase on this email. Tickets, perks, Rooms and receipts—no password archaeology. It expires at ${escapeHtml(new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(expiresAt)))}.</p><p style="margin:28px 0"><a href="${escapeHtml(recoveryUrl)}" style="background:#181914;color:white;text-decoration:none;padding:14px 20px;border-radius:6px;font-weight:700">Open My Nights</a></p><p style="color:#666;font-size:13px">The link is one-time and private. Fresh rotating QR passes appear only after you open it. Forwarding it would be a very generous mistake.</p></div>`;
  const plain = `${input.kind === "payment_confirmation" ? "Paid. Verified. Your Night is ready." : "Your Nights missed you. Slightly."}\n\n${event ? `${event.title}\n${event.venue}, ${event.area}\n\n` : ""}${input.order ? `Reference: ${input.order.reference}\nTotal paid: ${money(input.order.totalAmountMinor, input.order.currency)}\n\n` : ""}Secure one-time My Nights link: ${recoveryUrl}\n\nThis link expires at ${expiresAt}. It does not contain a QR pass.`;
  const idempotencyKey = `${input.kind}/${input.order?.id ?? grantId}/${grantId}`;
  return sendEmail({ db: input.db, kind: input.kind, recipient: input.normalizedEmail, subject, html, text: plain, idempotencyKey, orderId: input.order?.id, recoveryGrantId: grantId });
}

export async function sendTicketTransferEmail(input: {
  db: D1Database;
  transferId: string;
  recipientEmail: string;
  recipientName: string;
  senderName: string;
  eventTitle: string;
  eventDate: string;
  venue: string;
  claimUrl: string;
}) {
  const subject = `${input.senderName} sent you a ticket for ${input.eventTitle}`;
  const html = `<div style="max-width:560px;margin:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#181914"><p style="color:#f05a28;font-weight:700">BECORE TICKETS</p><h1 style="font-size:28px">A Night has changed hands.</h1><p>Hi ${escapeHtml(input.recipientName)},</p><p><strong>${escapeHtml(input.senderName)}</strong> sent you one ticket for:</p><p style="font-size:18px"><strong>${escapeHtml(input.eventTitle)}</strong><br>${escapeHtml(input.eventDate)}<br>${escapeHtml(input.venue)}</p><p>Accept it below and it will move into your own My Nights with a brand-new QR, Room access and ticket-linked perks. The sender’s old QR stops working the moment you accept.</p><p style="margin:28px 0"><a href="${escapeHtml(input.claimUrl)}" style="background:#181914;color:white;text-decoration:none;padding:14px 20px;border-radius:6px;font-weight:700">Accept my ticket</a></p><p style="color:#666;font-size:13px">This private link expires in 48 hours. If you were not expecting this, ignore it and the ticket stays where it is. Very un-dramatic.</p></div>`;
  const text = `${input.senderName} sent you a ticket for ${input.eventTitle}.\n${input.eventDate}\n${input.venue}\n\nAccept it: ${input.claimUrl}\n\nThe private link expires in 48 hours.`;
  return sendEmail({
    db: input.db,
    kind: "ticket_transfer",
    recipient: input.recipientEmail,
    subject,
    html,
    text,
    idempotencyKey: `ticket-transfer/${input.transferId}`,
    recoveryGrantId: input.transferId,
  });
}

export async function sendOrderConfirmation(db: D1Database, order: OrderForEmail, origin: string) {
  const existing = await db.prepare(`
    SELECT id FROM delivery_events
    WHERE order_id = ? AND kind = 'payment_confirmation'
    LIMIT 1
  `).bind(order.id).first();
  if (existing) return { sent: true, duplicate: true };
  return issueRecoveryGrant({ db, normalizedEmail: order.customerEmail.trim().toLowerCase(), origin, kind: "payment_confirmation", order, ttlMinutes: 7 * 24 * 60 });
}

export async function sendWaitlistOfferEmail(input: { db: D1Database; entryId: string; recipient: string; eventTitle: string; tierName: string; expiresAt: string; claimUrl: string }) {
  const subject = `${input.eventTitle}: a ticket found its way back`;
  const html = `<div style="max-width:560px;margin:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#181914"><p style="color:#f05a28;font-weight:700">BECORE TICKETS</p><h1 style="font-size:28px">Your wait is doing something useful.</h1><p>A <strong>${escapeHtml(input.tierName)}</strong> ticket for <strong>${escapeHtml(input.eventTitle)}</strong> is available.</p><p>This private checkout link is yours until ${escapeHtml(new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(input.expiresAt)))}. After that, the next person gets the nod.</p><p style="margin:28px 0"><a href="${escapeHtml(input.claimUrl)}" style="background:#181914;color:white;text-decoration:none;padding:14px 20px;border-radius:6px;font-weight:700">Take the ticket</a></p><p style="color:#666;font-size:13px">The invite is private and one-time. Payment still has to complete before the timer does.</p></div>`;
  const text = `${input.eventTitle}: ${input.tierName} is available.\n\nTake the ticket before ${input.expiresAt}: ${input.claimUrl}`;
  return sendEmail({ db: input.db, kind: "waitlist_offer", recipient: input.recipient, subject, html, text, idempotencyKey: `waitlist/${input.entryId}/${input.expiresAt}`, recoveryGrantId: input.entryId });
}

export async function sendAbandonedCheckoutEmail(input: { db: D1Database; orderId: string; recipient: string; eventTitle: string; eventUrl: string }) {
  const subject = `${input.eventTitle}: the payment did not finish`;
  const html = `<div style="max-width:560px;margin:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#181914"><p style="color:#f05a28;font-weight:700">BECORE TICKETS</p><h1 style="font-size:28px">The plan stopped one tap short.</h1><p>Paystack confirmed that the checkout for <strong>${escapeHtml(input.eventTitle)}</strong> was abandoned—not pending and not still processing.</p><p>No ticket was issued. If the night still has your attention, start a fresh secure checkout.</p><p style="margin:28px 0"><a href="${escapeHtml(input.eventUrl)}" style="background:#181914;color:white;text-decoration:none;padding:14px 20px;border-radius:6px;font-weight:700">Try the night again</a></p></div>`;
  const text = `${input.eventTitle}: Paystack confirmed the checkout was abandoned. No ticket was issued. Start again: ${input.eventUrl}`;
  return sendEmail({ db: input.db, kind: "payment_recovery", recipient: input.recipient, subject, html, text, idempotencyKey: `payment-recovery/${input.orderId}`, orderId: input.orderId, recoveryGrantId: input.orderId });
}

export async function sendSupportUpdateEmail(input: { db: D1Database; caseId: string; recipient: string; subject: string; body: string; url: string }) {
  const subject = `${input.subject}: ticket support replied`;
  const html = `<div style="max-width:560px;margin:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#181914"><p style="color:#f05a28;font-weight:700">BECORE TICKETS</p><h1 style="font-size:28px">Support wrote back.</h1><p>${escapeHtml(input.body)}</p><p style="margin:28px 0"><a href="${escapeHtml(input.url)}" style="background:#181914;color:white;text-decoration:none;padding:14px 20px;border-radius:6px;font-weight:700">Open the conversation</a></p></div>`;
  return sendEmail({ db: input.db, kind: "support_update", recipient: input.recipient, subject, html, text: `${input.body}\n\n${input.url}`, idempotencyKey: `support/${input.caseId}/${await hashToken(input.body)}`, recoveryGrantId: input.caseId });
}
