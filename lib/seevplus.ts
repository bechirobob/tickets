import { deliverConfirmedOrder, fulfillVerifiedPayment, verifyAndFulfill } from "./payment-operations";

const API = "https://api.seevplus.com/api/v1/developer/payments";
export type SeevEnvironment = "sandbox" | "production";
type Config = Pick<Cloudflare.Env, "SEEV_ENABLED" | "SEEV_ENVIRONMENT" | "SEEV_CHECKOUT_API_KEY" | "SEEV_WEBHOOK_SECRET" | "ENVIRONMENT">;

export function seevEnvironment(config: Config): SeevEnvironment | null {
  return config.SEEV_ENVIRONMENT === "sandbox" || config.SEEV_ENVIRONMENT === "production" ? config.SEEV_ENVIRONMENT : null;
}

export function seevAvailable(config: Config, isTestEvent: boolean): boolean {
  const environment = seevEnvironment(config);
  return config.SEEV_ENABLED === "true" && Boolean(config.SEEV_CHECKOUT_API_KEY && environment)
    && (Boolean(config.SEEV_WEBHOOK_SECRET) || (config.ENVIRONMENT === "test" && environment === "sandbox"))
    && (!isTestEvent || environment === "sandbox")
    && (config.ENVIRONMENT !== "production" || isTestEvent || environment === "production");
}

export function validSeevCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.origin === "https://pay.seevplus.com" && !url.username && !url.password && /^\/PAY-[A-Za-z0-9-]+$/u.test(url.pathname);
  } catch { return false; }
}

export async function validSeevSignature(raw: string, headers: Headers, secret: string, now = Date.now()): Promise<boolean> {
  const timestamp = headers.get("x-seev-timestamp") ?? "";
  const signature = headers.get("x-seev-signature") ?? "";
  if (!/^\d{10}$/u.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300 || !/^v1=[a-f0-9]{64}$/u.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.slice(3).match(/../gu)!, (pair) => parseInt(pair, 16));
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(`${timestamp}.${raw}`));
}

type StoredSession = {
  orderId: string; reference: string; providerReference: string | null; environment: string;
  amount: number; currency: string; status: string; expiresAt: string;
  requestJson: string | null; checkoutUrl: string | null;
};

async function readSession(db: D1Database, reference: string) {
  return db.prepare(`SELECT o.id AS orderId, o.reference, o.provider_reference AS providerReference,
    o.payment_environment AS environment, o.total_amount_minor AS amount, o.currency, o.status,
    o.reservation_expires_at AS expiresAt, s.request_json AS requestJson, s.checkout_url AS checkoutUrl
    FROM orders o JOIN seev_checkout_sessions s ON s.order_id = o.id
    WHERE o.reference = ? AND o.payment_provider = 'seevplus'`).bind(reference).first<StoredSession>();
}

// The exact body and stable key are saved before contacting Seev. An uncertain
// response can be recovered without creating another logical payment attempt.
export async function createSeevCheckout(db: D1Database, reference: string, config: Config) {
  const order = await readSession(db, reference);
  if (!order || order.environment !== seevEnvironment(config) || !config.SEEV_CHECKOUT_API_KEY) throw new Error("SeevPlus credentials do not match this order.");
  if (order.providerReference && validSeevCheckoutUrl(order.checkoutUrl)) return order.checkoutUrl;
  if (!order.requestJson || order.status !== "payment_pending" || Date.parse(order.expiresAt) <= Date.now()) throw new Error("This SeevPlus payment needs a status review before retrying.");
  const response = await fetch(API, {
    method: "POST", headers: { authorization: `Bearer ${config.SEEV_CHECKOUT_API_KEY}`, "content-type": "application/json", "idempotency-key": order.orderId },
    body: order.requestJson, signal: AbortSignal.timeout(10_000), redirect: "error",
  });
  // Even a 502 can mask a gateway conflict; never assume it means no payment.
  const payload = await response.json() as { success?: boolean; data?: { reference?: unknown; checkout_url?: unknown; amount?: unknown; currency?: unknown; env?: unknown } };
  const data = payload.data;
  if (!response.ok || payload.success !== true || !data || typeof data.reference !== "string" || !/^PAY-[A-Za-z0-9-]{1,160}$/u.test(data.reference)
    || !validSeevCheckoutUrl(data.checkout_url) || new URL(data.checkout_url).pathname !== `/${data.reference}`
    || data.amount !== order.amount || data.currency !== order.currency || data.env !== order.environment) {
    throw new Error("SeevPlus did not return a matching checkout. The original payment is being checked.");
  }
  await db.batch([
    db.prepare(`UPDATE orders SET provider_reference = ?, provider_status = 'initialized', payment_updated_at = ?, failure_reason = NULL
      WHERE id = ? AND payment_provider = 'seevplus' AND (provider_reference IS NULL OR provider_reference = ?)`)
      .bind(data.reference, new Date().toISOString(), order.orderId, data.reference),
    db.prepare(`UPDATE seev_checkout_sessions SET checkout_url = ?, request_json = NULL, last_error = NULL
      WHERE order_id = ? AND EXISTS (SELECT 1 FROM orders WHERE id = ? AND provider_reference = ?)`)
      .bind(data.checkout_url, order.orderId, order.orderId, data.reference),
  ]);
  const saved = await readSession(db, reference);
  if (saved?.providerReference !== data.reference) throw new Error("SeevPlus returned a conflicting payment reference.");
  return data.checkout_url;
}

export async function verifySeevPayment(db: D1Database, reference: string, config: Config) {
  const order = await readSession(db, reference);
  if (!order || order.environment !== seevEnvironment(config)) throw new Error("SeevPlus environment does not match this order.");
  if (!order.providerReference) return { result: "pending" as const };
  const response = await fetch(`${API}/${encodeURIComponent(order.providerReference)}`, { signal: AbortSignal.timeout(10_000), redirect: "error" });
  const payload = await response.json() as { success?: boolean; data?: { id?: unknown; reference?: unknown; status?: unknown; amount?: unknown; final_amount?: unknown; currency?: unknown; env?: unknown } };
  const data = payload.data;
  // Some verification responses omit env; the stored reference was bound to a
  // checked environment at creation. Reject an explicit environment mismatch.
  if (!response.ok || payload.success !== true || !data || data.reference !== order.providerReference
    || data.amount !== order.amount || data.currency !== order.currency || (data.final_amount !== undefined && data.final_amount !== order.amount)
    || (data.env !== undefined && data.env !== order.environment) || typeof data.status !== "string") {
    throw new Error("SeevPlus payment details did not match this order.");
  }
  const status = ["completed", "success"].includes(data.status) ? "success"
    : ["failed", "cancelled", "canceled"].includes(data.status) ? "failed" : "pending";
  return fulfillVerifiedPayment(db, {
    id: typeof data.id === "string" || typeof data.id === "number" ? data.id : order.providerReference,
    reference: order.reference, provider: "seevplus", providerReference: order.providerReference,
    status, amount: order.amount, currency: order.currency, paidAt: null, channel: "mobile_money", gatewayResponse: null,
  });
}

export async function verifyOrderPayment(env: Cloudflare.Env, reference: string) {
  const order = await env.DB.prepare("SELECT payment_provider AS provider FROM orders WHERE reference = ?").bind(reference).first<{ provider: string }>();
  if (!order) return { result: "unknown_order" as const };
  if (order.provider === "seevplus") return verifySeevPayment(env.DB, reference, env);
  if (order.provider !== "paystack" || !env.PAYSTACK_SECRET_KEY) throw new Error("Payment verification is not configured.");
  return verifyAndFulfill(env.DB, reference, env.PAYSTACK_SECRET_KEY);
}

// A database lease limits provider polling across callbacks, cron and webhooks.
// These checks continue even when new Seev checkouts are switched off.
export async function recoverSeevPayment(env: Cloudflare.Env, reference: string, origin: string) {
  const order = await readSession(env.DB, reference);
  if (!order || order.environment !== seevEnvironment(env)) return { result: "pending" as const };
  const now = new Date().toISOString();
  const claim = await env.DB.prepare(`UPDATE seev_checkout_sessions SET lease_until = ?, checked_at = ?
    WHERE order_id = ? AND (lease_until IS NULL OR lease_until <= ?)`)
    .bind(new Date(Date.now() + 30_000).toISOString(), now, order.orderId, now).run();
  if (!claim.meta.changes) return { result: "pending" as const };
  try {
    if (!order.providerReference) {
      const authorizationUrl = await createSeevCheckout(env.DB, reference, env);
      return { result: "checkout" as const, authorizationUrl };
    }
    const result = await verifySeevPayment(env.DB, reference, env);
    if (result.result === "paid") await deliverConfirmedOrder(env.DB, result.order, origin);
    await env.DB.prepare("UPDATE seev_checkout_sessions SET last_error = NULL WHERE order_id = ?").bind(order.orderId).run();
    return result;
  } catch (error) {
    await env.DB.prepare("UPDATE seev_checkout_sessions SET last_error = ? WHERE order_id = ?")
      .bind(error instanceof Error ? error.message : "SeevPlus verification unavailable.", order.orderId).run();
    throw error;
  }
}

export async function recoverSeevPayments(env: Cloudflare.Env, origin: string, limit = 20) {
  if (!seevEnvironment(env)) return { checked: 0, failed: 0 };
  const sessions = await env.DB.prepare(`SELECT o.reference FROM orders o JOIN seev_checkout_sessions s ON s.order_id = o.id
    WHERE o.payment_provider = 'seevplus' AND o.payment_environment = ?
      AND o.status IN ('payment_pending', 'expired', 'failed')
      AND o.created_at > ? AND (s.lease_until IS NULL OR s.lease_until <= ?)
    ORDER BY COALESCE(s.checked_at, '') ASC LIMIT ?`)
    .bind(seevEnvironment(env), new Date(Date.now() - 7 * 86_400_000).toISOString(), new Date().toISOString(), limit).all<{ reference: string }>();
  let failed = 0;
  // Limit concurrency and subrequests per scheduled invocation.
  for (let offset = 0; offset < sessions.results.length; offset += 4) {
    const results = await Promise.allSettled(sessions.results.slice(offset, offset + 4).map((row) => recoverSeevPayment(env, row.reference, origin)));
    failed += results.filter((result) => result.status === "rejected").length;
  }
  await env.DB.prepare("UPDATE seev_checkout_sessions SET request_json = NULL WHERE request_json IS NOT NULL AND created_at <= ?")
    .bind(new Date(Date.now() - 86_400_000).toISOString()).run();
  return { checked: sessions.results.length, failed };
}
