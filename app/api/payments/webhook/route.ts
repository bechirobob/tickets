import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { orders, paymentEvents, tickets } from "../../../../db/schema";

function toHex(bytes: ArrayBuffer) { return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  const secret = (env as unknown as { PAYSTACK_SECRET_KEY?: string }).PAYSTACK_SECRET_KEY;
  if (!secret) return new Response("Unavailable", { status: 503 });
  const raw = await request.text();
  const signature = request.headers.get("x-paystack-signature") ?? "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const digest = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const digestBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(digest));
  const signatureBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signature));
  const expected = new Uint8Array(digestBytes);
  const received = new Uint8Array(signatureBytes);
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ received[index];
  if (difference !== 0) return new Response("Invalid signature", { status: 401 });

  const payloadHash = toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  const payload = JSON.parse(raw) as { event?: string; data?: { reference?: string; transaction_reference?: string; status?: string; amount?: number | string; currency?: string; paid_at?: string } };
  const reference = payload.data?.reference ?? payload.data?.transaction_reference ?? "";
  if (!reference) return new Response("OK");
  const db = await getDb();
  const [alreadyHandled] = await db.select({ id: paymentEvents.id }).from(paymentEvents).where(eq(paymentEvents.payloadHash, payloadHash)).limit(1);
  if (alreadyHandled) return new Response("OK");

  const receivedAt = new Date().toISOString();
  const recordEvent = db.insert(paymentEvents).values({
    id: crypto.randomUUID(),
    eventType: payload.event ?? "unknown",
    reference,
    receivedAt,
    payloadHash,
  });
  if (payload.event === "charge.success") {
    const [order] = await db.select().from(orders).where(and(eq(orders.reference, reference), eq(orders.status, "payment_pending"))).limit(1);
    if (order && Number(payload.data?.amount) === order.totalAmountMinor && payload.data?.currency === "GHS") {
      const issuedAt = new Date().toISOString();
      const issuedTickets = [];
      for (let index = 0; index < order.quantity; index += 1) {
        const token = crypto.randomUUID() + crypto.randomUUID();
        const qrTokenHash = toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
        issuedTickets.push(db.insert(tickets).values({ id: crypto.randomUUID(), orderId: order.id, eventSlug: order.eventSlug, ticketType: order.ticketType, qrTokenHash, status: "issued", issuedAt }));
      }
      await db.batch([
        recordEvent,
        db.update(orders).set({ status: "paid", paidAt: payload.data.paid_at ?? issuedAt }).where(eq(orders.id, order.id)),
        ...issuedTickets,
      ]);
    } else {
      await recordEvent;
    }
  } else if (payload.event === "refund.processed") {
    const [order] = await db.select().from(orders).where(and(eq(orders.reference, reference), eq(orders.status, "paid"))).limit(1);
    if (order && Number(payload.data?.amount) >= order.totalAmountMinor) {
      const now = new Date().toISOString();
      await db.batch([
        recordEvent,
        db.update(orders).set({ status: "refunded" }).where(eq(orders.id, order.id)),
        db.update(tickets).set({ status: "refunded" }).where(eq(tickets.orderId, order.id)),
      ]);
      const { env: runtimeEnv } = await import("cloudflare:workers");
      await runtimeEnv.DB.prepare(`
        UPDATE ticket_assignments SET status = 'revoked', revoked_at = ?
        WHERE ticket_id IN (SELECT id FROM tickets WHERE order_id = ?)
      `).bind(now, order.id).run();
    } else await recordEvent;
  } else {
    await recordEvent;
  }
  return new Response("OK");
}
