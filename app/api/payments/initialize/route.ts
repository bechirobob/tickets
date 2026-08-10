import { getDb } from "../../../../db";
import { orderAccessGrants, orders } from "../../../../db/schema";
import { createSecureToken, hashToken } from "../../../../lib/attendee-auth";
import { resolveBookingFee } from "../../../../lib/booking-fees";
import { eq } from "drizzle-orm";

const EVENT_PRICES: Record<string, number> = { "after-dark-osu": 12000 };

export async function POST(request: Request) {
  const body = await request.json() as { eventSlug?: string; quantity?: number; email?: string; phone?: string; network?: string; fullName?: string };
  const eventSlug = body.eventSlug?.trim() ?? "";
  const quantity = Math.floor(Number(body.quantity));
  const facePriceMinor = EVENT_PRICES[eventSlug];
  if (!facePriceMinor || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) return Response.json({ error: "Invalid ticket selection." }, { status: 400 });
  if (!body.email?.includes("@") || !body.phone?.trim()) return Response.json({ error: "A valid email and phone number are required." }, { status: 400 });

  const { env } = await import("cloudflare:workers");
  const secret = (env as unknown as { PAYSTACK_SECRET_KEY?: string }).PAYSTACK_SECRET_KEY;
  if (!secret) return Response.json({ error: "Live Paystack credentials have not been connected yet." }, { status: 503 });

  const feeBasisPoints = await resolveBookingFee(eventSlug);
  const faceAmountMinor = facePriceMinor * quantity;
  const bookingFeeMinor = Math.round(faceAmountMinor * feeBasisPoints / 10000);
  const totalAmountMinor = faceAmountMinor + bookingFeeMinor;
  const id = crypto.randomUUID();
  const reference = `BCT-${Date.now().toString(36).toUpperCase()}-${id.slice(0, 6).toUpperCase()}`;
  const origin = new URL(request.url).origin;
  const claimToken = createSecureToken();
  const claimTokenHash = await hashToken(claimToken);
  const now = new Date();
  const createdAt = now.toISOString();
  const db = await getDb();

  await db.batch([
    db.insert(orders).values({
      id,
      reference,
      eventSlug,
      quantity,
      faceAmountMinor,
      bookingFeeMinor,
      totalAmountMinor,
      currency: "GHS",
      customerEmail: body.email.trim().toLowerCase(),
      customerPhone: body.phone.trim(),
      customerName: body.fullName?.trim() || null,
      paymentChannel: `mobile_money:${body.network ?? "unknown"}`,
      status: "payment_pending",
      createdAt,
    }),
    db.insert(orderAccessGrants).values({
      orderId: id,
      tokenHash: claimTokenHash,
      createdAt,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  ]);

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: JSON.stringify({
      email: body.email,
      amount: totalAmountMinor,
      currency: "GHS",
      reference,
      channels: ["mobile_money"],
      callback_url: `${origin}/payment/return?reference=${encodeURIComponent(reference)}&claim=${encodeURIComponent(claimToken)}`,
      metadata: { orderId: id, eventSlug, quantity, customerName: body.fullName?.trim(), phone: body.phone, network: body.network, faceAmountMinor, bookingFeeMinor },
    }),
  });
  const result = await response.json() as { status?: boolean; message?: string; data?: { authorization_url?: string; access_code?: string; reference?: string } };
  if (!response.ok || !result.status || !result.data?.authorization_url) {
    await db.update(orders).set({ status: "failed" }).where(eq(orders.id, id));
    return Response.json({ error: result.message ?? "Paystack could not start the payment." }, { status: 502 });
  }

  await db.update(orders).set({ paystackReference: result.data.reference ?? reference }).where(eq(orders.id, id));
  return Response.json({ authorizationUrl: result.data.authorization_url, reference });
}
