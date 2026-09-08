import { recoverSeevPayment, seevEnvironment, validSeevSignature } from "../../../../../lib/seevplus";

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!env.SEEV_WEBHOOK_SECRET || !seevEnvironment(env)) return new Response("Unavailable", { status: 503 });
  const raw = await request.text();
  if (raw.length > 65_536) return new Response("Payload too large", { status: 413 });
  if (!(await validSeevSignature(raw, request.headers, env.SEEV_WEBHOOK_SECRET))) return new Response("Invalid signature", { status: 401 });
  let payload: { event?: string; env?: string; data?: { transaction?: { reference?: string; env?: string } } };
  try { payload = JSON.parse(raw); } catch { return new Response("Invalid payload", { status: 400 }); }
  if (!payload || typeof payload !== "object" || !payload.data?.transaction) return new Response("Invalid payload", { status: 400 });
  const tx = payload.data.transaction;
  if (payload.env !== seevEnvironment(env) || tx.env !== payload.env) return new Response("Wrong environment", { status: 400 });
  if (!["payment.succeeded", "payment.failed"].includes(payload.event ?? "")) return new Response("OK");
  if (typeof tx.reference !== "string" || !/^PAY-[A-Za-z0-9-]{1,160}$/u.test(tx.reference)) return new Response("Invalid reference", { status: 400 });
  const order = await env.DB.prepare(`SELECT reference FROM orders WHERE payment_provider = 'seevplus' AND provider_reference = ? AND payment_environment = ?`)
    .bind(tx.reference, payload.env).first<{ reference: string }>();
  if (!order) return new Response("OK");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare(`INSERT OR IGNORE INTO payment_events (id, event_type, reference, received_at, payload_hash) VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), `seevplus.${payload.event}`, order.reference, new Date().toISOString(), hash).run();
  try {
    // Re-read current status from Seev. A replay or out-of-order failure cannot
    // override a newer successful payment, and webhook major units are never
    // mistaken for the API's minor units.
    await recoverSeevPayment(env, order.reference, new URL(request.url).origin);
    return new Response("OK");
  } catch {
    // The five-minute recovery task also checks this recorded order.
    return new Response("Verification temporarily unavailable", { status: 503 });
  }
}
