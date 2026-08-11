import {
  applyRefundWebhook,
  deliverConfirmedOrder,
  fulfillVerifiedPayment,
  initiatePaystackRefund,
  recordDisputeWebhook,
} from "../../../../lib/payment-operations";

function toHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validSignature(raw: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const expectedHex = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const [expected, received] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expectedHex)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature)),
  ]);
  let difference = 0;
  const left = new Uint8Array(expected);
  const right = new Uint8Array(received);
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function transactionReference(data: Record<string, unknown> | undefined) {
  const transaction = data?.transaction as Record<string, unknown> | undefined;
  return String(data?.reference ?? data?.transaction_reference ?? transaction?.reference ?? "");
}

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  if (!env.PAYSTACK_SECRET_KEY) return new Response("Unavailable", { status: 503 });
  const raw = await request.text();
  const signature = request.headers.get("x-paystack-signature") ?? "";
  if (!(await validSignature(raw, signature, env.PAYSTACK_SECRET_KEY))) return new Response("Invalid signature", { status: 401 });

  const payloadHash = toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  const payload = JSON.parse(raw) as { event?: string; data?: Record<string, unknown> };
  const eventType = payload.event ?? "unknown";
  const reference = transactionReference(payload.data);
  if (!reference) return new Response("OK");
  const receivedAt = new Date().toISOString();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO payment_events (id, event_type, reference, received_at, payload_hash)
    VALUES (?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), eventType, reference, receivedAt, payloadHash).run();

  if (eventType === "charge.success") {
    const result = await fulfillVerifiedPayment(env.DB, {
      id: String(payload.data?.id ?? ""),
      reference,
      status: String(payload.data?.status ?? "success"),
      amount: Number(payload.data?.amount ?? 0),
      currency: String(payload.data?.currency ?? ""),
      paidAt: payload.data?.paid_at ? String(payload.data.paid_at) : null,
      channel: payload.data?.channel ? String(payload.data.channel) : null,
      gatewayResponse: payload.data?.gateway_response ? String(payload.data.gateway_response) : null,
    });
    if (result.result === "paid") {
      await deliverConfirmedOrder(env.DB, result.order, new URL(request.url).origin);
    } else if (result.result === "requires_refund") {
      await initiatePaystackRefund(env.DB, {
        orderId: result.order.id,
        actor: "system:late-payment",
        reason: "Payment completed after reserved inventory was no longer available.",
        secret: env.PAYSTACK_SECRET_KEY,
      }).catch((error) => console.error(JSON.stringify({ message: "automatic late-payment refund failed", reference, error: error instanceof Error ? error.message : String(error) })));
    }
  } else if (["refund.pending", "refund.processing", "refund.processed", "refund.failed"].includes(eventType)) {
    await applyRefundWebhook(env.DB, {
      eventType,
      reference,
      amountMinor: Number(payload.data?.amount ?? 0),
      providerRefundId: payload.data?.id ? String(payload.data.id) : null,
      failureReason: payload.data?.merchant_note ? String(payload.data.merchant_note) : null,
    });
  } else if (["charge.dispute.create", "charge.dispute.remind", "charge.dispute.resolve"].includes(eventType)) {
    await recordDisputeWebhook(env.DB, {
      eventType,
      reference,
      payload: { event: eventType, data: payload.data ?? {} },
    });
  }
  return new Response("OK");
}
