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
  if (digest !== signature) return new Response("Invalid signature", { status: 401 });

  const payloadHash = toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  const payload = JSON.parse(raw) as { event?: string; data?: { reference?: string; status?: string; amount?: number; currency?: string; paid_at?: string } };
  const reference = payload.data?.reference ?? "";
  if (!reference) return new Response("OK");
  const db = await getDb();
  const [alreadyHandled] = await db.select({ id: paymentEvents.id }).from(paymentEvents).where(eq(paymentEvents.payloadHash, payloadHash)).limit(1);
  if (alreadyHandled) return new Response("OK");

  await db.insert(paymentEvents).values({ id: crypto.randomUUID(), eventType: payload.event ?? "unknown", reference, receivedAt: new Date().toISOString(), payloadHash });
  if (payload.event === "charge.success") {
    const [order] = await db.select().from(orders).where(and(eq(orders.reference, reference), eq(orders.status, "payment_pending"))).limit(1);
    if (order && payload.data?.amount === order.totalAmountMinor && payload.data.currency === "GHS") {
      await db.update(orders).set({ status: "paid", paidAt: payload.data.paid_at ?? new Date().toISOString() }).where(eq(orders.id, order.id));
      const issuedAt = new Date().toISOString();
      for (let index = 0; index < order.quantity; index += 1) {
        const token = crypto.randomUUID() + crypto.randomUUID();
        const qrTokenHash = toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
        await db.insert(tickets).values({ id: crypto.randomUUID(), orderId: order.id, eventSlug: order.eventSlug, ticketType: "general", qrTokenHash, status: "issued", issuedAt });
      }
    }
  }
  return new Response("OK");
}
