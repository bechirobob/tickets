import { createSecureToken, hashToken } from "./attendee-auth";

type DeliveryKind = "payment_confirmation" | "ticket_recovery";

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

async function sendEmail(input: {
  db: D1Database;
  kind: DeliveryKind;
  recipient: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  orderId?: string;
  recoveryGrantId: string;
}) {
  const { env } = await import("cloudflare:workers");
  const deliveryId = crypto.randomUUID();
  const now = new Date().toISOString();
  await input.db.prepare(`
    INSERT INTO delivery_events (
      id, order_id, recovery_grant_id, kind, recipient, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)
  `).bind(deliveryId, input.orderId ?? null, input.recoveryGrantId, input.kind, input.recipient, now, now).run();

  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    await input.db.prepare("UPDATE delivery_events SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ?")
      .bind("Transactional email is not configured.", now, deliveryId).run();
    return { sent: false, reason: "not_configured" as const };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [input.recipient], subject: input.subject, html: input.html, text: input.text }),
    });
    const result = await response.json() as { id?: string; message?: string; error?: { message?: string } };
    if (!response.ok || !result.id) throw new Error(result.message ?? result.error?.message ?? "Email provider rejected the message.");
    await input.db.prepare("UPDATE delivery_events SET status = 'sent', provider_id = ?, updated_at = ? WHERE id = ?")
      .bind(result.id, new Date().toISOString(), deliveryId).run();
    return { sent: true, providerId: result.id };
  } catch (error) {
    await input.db.prepare("UPDATE delivery_events SET status = 'failed', failure_reason = ?, updated_at = ? WHERE id = ?")
      .bind((error instanceof Error ? error.message : String(error)).slice(0, 500), new Date().toISOString(), deliveryId).run();
    return { sent: false, reason: "provider_error" as const };
  }
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
    SELECT title, venue, area, starts_at AS startsAt
    FROM curated_event_records WHERE slug = ? LIMIT 1
  `).bind(input.order.eventSlug).first<{ title: string; venue: string; area: string; startsAt: string }>() : null;
  const subject = input.kind === "payment_confirmation" && event
    ? `${event.title}: payment confirmed and tickets ready`
    : "Your secure BeCore Tickets access link";
  const receipt = input.order ? `
    <table style="width:100%;border-collapse:collapse;margin:24px 0">
      <tr><td style="padding:8px 0;color:#666">Reference</td><td style="padding:8px 0;text-align:right;font-weight:700">${escapeHtml(input.order.reference)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Admissions</td><td style="padding:8px 0;text-align:right">${input.order.quantity}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Ticket subtotal</td><td style="padding:8px 0;text-align:right">${money(input.order.faceAmountMinor, input.order.currency)}</td></tr>
      <tr><td style="padding:8px 0;color:#666">Booking fee</td><td style="padding:8px 0;text-align:right">${money(input.order.bookingFeeMinor, input.order.currency)}</td></tr>
      <tr><td style="padding:12px 0;border-top:1px solid #ddd;font-weight:700">Total paid</td><td style="padding:12px 0;border-top:1px solid #ddd;text-align:right;font-weight:700">${money(input.order.totalAmountMinor, input.order.currency)}</td></tr>
    </table>` : "";
  const eventBlock = event ? `<p style="font-size:18px"><strong>${escapeHtml(event.title)}</strong><br>${escapeHtml(event.venue)}, ${escapeHtml(event.area)}<br>${escapeHtml(new Intl.DateTimeFormat("en-GH", { dateStyle: "full", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(event.startsAt)))}</p>` : "";
  const html = `<div style="max-width:560px;margin:auto;font-family:Arial,sans-serif;color:#181914"><p style="color:#f05a28;font-weight:700">BECORE TICKETS</p><h1 style="font-size:28px">${input.kind === "payment_confirmation" ? "Payment confirmed. Your passes are ready." : "Open your verified ticket wallet."}</h1><p>Hi ${escapeHtml(name)},</p>${eventBlock}${receipt}<p>This private link signs you into your ticket wallet on this device. It does not contain a QR pass, and it expires at ${escapeHtml(new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" }).format(new Date(expiresAt)))}.</p><p style="margin:28px 0"><a href="${escapeHtml(recoveryUrl)}" style="background:#181914;color:white;text-decoration:none;padding:14px 20px;border-radius:6px;font-weight:700">Open secure ticket wallet</a></p><p style="color:#666;font-size:13px">Opening the verified wallet generates fresh rotating QR passes. Do not forward this one-time access link.</p></div>`;
  const plain = `${input.kind === "payment_confirmation" ? "Payment confirmed. Your passes are ready." : "Open your verified ticket wallet."}\n\n${event ? `${event.title}\n${event.venue}, ${event.area}\n\n` : ""}${input.order ? `Reference: ${input.order.reference}\nTotal paid: ${money(input.order.totalAmountMinor, input.order.currency)}\n\n` : ""}Secure one-time wallet link: ${recoveryUrl}\n\nThis link expires at ${expiresAt}. It does not contain a QR pass.`;
  const idempotencyKey = `${input.kind}/${input.order?.id ?? grantId}/${grantId}`;
  return sendEmail({ db: input.db, kind: input.kind, recipient: input.normalizedEmail, subject, html, text: plain, idempotencyKey, orderId: input.order?.id, recoveryGrantId: grantId });
}

export async function sendOrderConfirmation(db: D1Database, order: OrderForEmail, origin: string) {
  const existing = await db.prepare(`
    SELECT id FROM delivery_events
    WHERE order_id = ? AND kind = 'payment_confirmation' AND status IN ('queued', 'sent')
    LIMIT 1
  `).bind(order.id).first();
  if (existing) return { sent: true, duplicate: true };
  return issueRecoveryGrant({ db, normalizedEmail: order.customerEmail.trim().toLowerCase(), origin, kind: "payment_confirmation", order, ttlMinutes: 7 * 24 * 60 });
}
