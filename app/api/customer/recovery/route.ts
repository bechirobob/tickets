import { hashToken } from "../../../../lib/attendee-auth";
import { issueRecoveryGrant } from "../../../../lib/email-delivery";
import { hashToken as hashStaffToken, mutationHasValidOrigin, requestMetadata, recordSecurityEvent } from "../../../../lib/admin-session";
import { enforceRateLimit } from "../../../../lib/security-controls";

const GENERIC_MESSAGE = "If that email has active paid tickets, a secure access link is on the way.";

export async function POST(request: Request) {
  if (!mutationHasValidOrigin(request)) return Response.json({ message: GENERIC_MESSAGE }, { status: 202, headers: { "cache-control": "no-store" } });
  const body = await request.json().catch(() => ({})) as { email?: string };
  const normalizedEmail = body.email?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalizedEmail)) {
    return Response.json({ message: GENERIC_MESSAGE }, { status: 202, headers: { "cache-control": "no-store" } });
  }
  const { env } = await import("cloudflare:workers");
  const metadata = requestMetadata(request);
  const [ipRateAllowed, customerRateAllowed] = await Promise.all([
    enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `recovery-ip:${await hashStaffToken(metadata.ip || "anonymous")}`),
    enforceRateLimit(env.PUBLIC_WRITE_RATE_LIMITER, `recovery-customer:${await hashStaffToken(normalizedEmail)}`),
  ]);
  if (!ipRateAllowed || !customerRateAllowed) {
    await recordSecurityEvent(env.DB, { kind: "rate_limited", subject: normalizedEmail || metadata.ip, path: "/api/customer/recovery", requestId: metadata.requestId });
    return Response.json({ message: GENERIC_MESSAGE }, { status: 202, headers: { "cache-control": "no-store" } });
  }
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const ipHash = ip ? await hashToken(ip) : null;
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const recent = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM attendee_recovery_grants
    WHERE created_at > ? AND (normalized_email = ? OR (? IS NOT NULL AND requested_ip_hash = ?))
  `).bind(since, normalizedEmail, ipHash, ipHash).first<{ count: number }>();
  if ((recent?.count ?? 0) >= 3) {
    return Response.json({ message: GENERIC_MESSAGE }, { status: 202, headers: { "cache-control": "no-store" } });
  }
  const active = await env.DB.prepare(`
    SELECT id FROM orders
    WHERE customer_email = ? AND status = 'paid'
      AND EXISTS (SELECT 1 FROM tickets WHERE tickets.order_id = orders.id AND tickets.status IN ('issued', 'checked_in', 'voided'))
    LIMIT 1
  `).bind(normalizedEmail).first();
  if (active) {
    await issueRecoveryGrant({
      db: env.DB,
      normalizedEmail,
      origin: new URL(request.url).origin,
      kind: "ticket_recovery",
      requestedIp: ip,
      ttlMinutes: 20,
    });
  }
  return Response.json({ message: GENERIC_MESSAGE }, { status: 202, headers: { "cache-control": "no-store" } });
}
